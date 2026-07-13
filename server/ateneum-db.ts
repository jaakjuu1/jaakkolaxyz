import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "path";
import fs from "fs";
import * as schema from "@shared/ateneum-schema";

const DB_PATH =
  process.env.ATENEUM_DB_PATH ||
  path.resolve(process.cwd(), "data", "ateneum.db");

// Ensure parent directory exists
const parentDir = path.dirname(DB_PATH);
if (!fs.existsSync(parentDir)) {
  fs.mkdirSync(parentDir, { recursive: true });
}

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const ateneumDb = drizzle(sqlite, { schema });
export const ateneumRawDb = sqlite;

// Helper to generate CUID-like ids without external deps
export function newId(prefix = ""): string {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 10);
  return prefix ? `${prefix}_${ts}${rnd}` : `${ts}${rnd}`;
}

// Initialize schema — runs idempotent CREATE TABLE IF NOT EXISTS
export function initAteneumSchema(): void {
  ateneumRawDb.exec(`
    CREATE TABLE IF NOT EXISTS ateneum_users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      email TEXT,
      role TEXT NOT NULL CHECK (role IN ('partner_a','partner_b','bot')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS ateneum_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES ateneum_users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS ateneum_preferences (
      user_id TEXT PRIMARY KEY REFERENCES ateneum_users(id) ON DELETE CASCADE,
      liked_tags TEXT NOT NULL DEFAULT '[]',
      disliked_tags TEXT NOT NULL DEFAULT '[]',
      energy_level TEXT NOT NULL DEFAULT 'medium' CHECK (energy_level IN ('low','medium','high')),
      budget_level TEXT NOT NULL DEFAULT 'moderate' CHECK (budget_level IN ('free','cheap','moderate','splurge')),
      social_mode TEXT NOT NULL DEFAULT 'together' CHECK (social_mode IN ('solo','together','with-friends')),
      preferred_duration INTEGER NOT NULL DEFAULT 120,
      weekday_evenings INTEGER NOT NULL DEFAULT 1,
      weekend_mornings INTEGER NOT NULL DEFAULT 1,
      notes TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS ateneum_ideas (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      energy_cost TEXT NOT NULL DEFAULT 'medium' CHECK (energy_cost IN ('low','medium','high')),
      budget_cost TEXT NOT NULL DEFAULT 'cheap' CHECK (budget_cost IN ('free','cheap','moderate','splurge')),
      social_mode TEXT NOT NULL DEFAULT 'together' CHECK (social_mode IN ('solo','together','with-friends')),
      duration_min INTEGER NOT NULL DEFAULT 90,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT REFERENCES ateneum_users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS ateneum_activities (
      id TEXT PRIMARY KEY,
      idea_id TEXT REFERENCES ateneum_ideas(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      scheduled_for INTEGER NOT NULL,
      duration_min INTEGER NOT NULL DEFAULT 60,
      status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','done','skipped')),
      rating INTEGER,
      notes TEXT NOT NULL DEFAULT '',
      details TEXT,
      created_by TEXT NOT NULL REFERENCES ateneum_users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS ateneum_wishes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES ateneum_users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      mood TEXT NOT NULL DEFAULT 'tender' CHECK (mood IN ('longing','playful','tender','restless','grateful')),
      fulfilled INTEGER NOT NULL DEFAULT 0,
      visibility TEXT NOT NULL DEFAULT 'shared' CHECK (visibility IN ('shared','private')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS ateneum_weekly_suggestions (
      week_key TEXT PRIMARY KEY,
      idea_id TEXT NOT NULL REFERENCES ateneum_ideas(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_ateneum_sessions_user ON ateneum_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_ateneum_activities_scheduled ON ateneum_activities(scheduled_for);
    CREATE INDEX IF NOT EXISTS idx_ateneum_activities_status ON ateneum_activities(status);
    CREATE INDEX IF NOT EXISTS idx_ateneum_wishes_user ON ateneum_wishes(user_id);
    CREATE INDEX IF NOT EXISTS idx_ateneum_ideas_active ON ateneum_ideas(is_active);
  `);
}
// Migration: add new tables/columns idempotently.
// Safe to run on every boot — all statements use IF NOT EXISTS / try/catch.
export function migrateAteneumSchema(): void {
  // email column on users
  try {
    ateneumRawDb.exec(`ALTER TABLE ateneum_users ADD COLUMN email TEXT`);
  } catch {
    /* column already exists */
  }
  ateneumRawDb.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_ateneum_users_email ON ateneum_users(email)`,
  );

  try {
    ateneumRawDb.exec(`ALTER TABLE ateneum_activities ADD COLUMN details TEXT`);
  } catch {
    /* column already exists */
  }

  ateneumRawDb.exec(`
    CREATE TABLE IF NOT EXISTS ateneum_email_tokens (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      purpose TEXT NOT NULL CHECK (purpose IN ('magic_link','unsubscribe')),
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_ateneum_email_tokens_email ON ateneum_email_tokens(email);
    CREATE INDEX IF NOT EXISTS idx_ateneum_email_tokens_hash ON ateneum_email_tokens(token_hash);

    CREATE TABLE IF NOT EXISTS ateneum_notification_prefs (
      user_id TEXT PRIMARY KEY REFERENCES ateneum_users(id) ON DELETE CASCADE,
      weekly_suggestion INTEGER NOT NULL DEFAULT 1,
      wish_added INTEGER NOT NULL DEFAULT 1,
      wish_fulfilled INTEGER NOT NULL DEFAULT 1,
      activity_planned INTEGER NOT NULL DEFAULT 1,
      inactivity_reminder INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS ateneum_email_log (
      id TEXT PRIMARY KEY,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      kind TEXT NOT NULL,
      sent_at INTEGER NOT NULL DEFAULT (unixepoch()),
      meta TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ateneum_email_log_kind_time ON ateneum_email_log(kind, sent_at);
    CREATE INDEX IF NOT EXISTS idx_ateneum_email_log_to ON ateneum_email_log(to_email);

    CREATE TABLE IF NOT EXISTS ateneum_email_claims (
      id TEXT PRIMARY KEY,
      to_email TEXT NOT NULL,
      kind TEXT NOT NULL,
      week_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('claimed','sent','failed')),
      claimed_at INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at INTEGER,
      error TEXT,
      UNIQUE(kind, to_email, week_key)
    );
    CREATE INDEX IF NOT EXISTS idx_ateneum_email_claims_status
      ON ateneum_email_claims(status, claimed_at);

    -- API tokens for Bearer auth (scripts, integrations)
    CREATE TABLE IF NOT EXISTS ateneum_api_tokens (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL REFERENCES ateneum_users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      scopes TEXT NOT NULL DEFAULT '["read"]',
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      last_used_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_ateneum_api_tokens_hash ON ateneum_api_tokens(token_hash);
    CREATE INDEX IF NOT EXISTS idx_ateneum_api_tokens_user ON ateneum_api_tokens(user_id);
  `);

  const apiTokenColumns = new Set(
    (ateneumRawDb.prepare("PRAGMA table_info(ateneum_api_tokens)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  let migratedLegacyApiTokens = false;
  if (!apiTokenColumns.has("scopes")) {
    ateneumRawDb.exec(`ALTER TABLE ateneum_api_tokens ADD COLUMN scopes TEXT NOT NULL DEFAULT '["read"]'`);
    migratedLegacyApiTokens = true;
  }
  if (!apiTokenColumns.has("revoked_at")) {
    ateneumRawDb.exec("ALTER TABLE ateneum_api_tokens ADD COLUMN revoked_at INTEGER");
    migratedLegacyApiTokens = true;
  }
  if (migratedLegacyApiTokens) {
    const revoked = ateneumRawDb
      .prepare("UPDATE ateneum_api_tokens SET revoked_at = unixepoch() WHERE revoked_at IS NULL")
      .run();
    console.log(`[ateneum] revoked ${revoked.changes} legacy API tokens during scope migration`);
  }

  // Raw legacy bearer values are incompatible with hash-only lookups and must not
  // remain recoverable from the database after the migration.
  const purgedLegacySessions = ateneumRawDb
    .prepare(`DELETE FROM ateneum_sessions WHERE id GLOB 'sess_*'`)
    .run();
  if (purgedLegacySessions.changes > 0) {
    console.log(`[ateneum] purged ${purgedLegacySessions.changes} legacy sessions`);
  }

  // Replace person-specific legacy roles with neutral partner roles. SQLite cannot
  // ALTER a CHECK constraint, so recreate the table only when needed.
  const roleDefRows = ateneumRawDb
    .prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='ateneum_users'`,
    )
    .all() as { sql: string }[];
  const currentSql = roleDefRows[0]?.sql ?? "";
  const needsNeutralRoles =
    currentSql &&
    (!currentSql.includes("'partner_a'") ||
      !currentSql.includes("'partner_b'") ||
      currentSql.includes("'juuso'") ||
      currentSql.includes("'wife'"));
  if (needsNeutralRoles) {
    console.log("[ateneum] migrating: replacing legacy user roles with neutral partner roles");
    ateneumRawDb.exec(`
      PRAGMA foreign_keys=OFF;
      BEGIN;
      CREATE TABLE ateneum_users__new (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        email TEXT UNIQUE,
        role TEXT NOT NULL CHECK (role IN ('partner_a','partner_b','bot')),
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT INTO ateneum_users__new (id, username, display_name, password_hash, email, role, created_at)
        SELECT id, username, display_name, password_hash, email,
          CASE role
            WHEN 'juuso' THEN 'partner_a'
            WHEN 'wife' THEN 'partner_b'
            ELSE role
          END,
          created_at
        FROM ateneum_users;
      DROP TABLE ateneum_users;
      ALTER TABLE ateneum_users__new RENAME TO ateneum_users;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ateneum_users_username ON ateneum_users(username);
      COMMIT;
      PRAGMA foreign_keys=ON;
    `);
  }
}
