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
      completed_at INTEGER,
      planning_mode TEXT NOT NULL DEFAULT 'legacy' CHECK (planning_mode IN ('legacy','mutual')),
      version INTEGER NOT NULL DEFAULT 1,
      proposed_by TEXT REFERENCES ateneum_users(id) ON DELETE SET NULL,
      updated_by TEXT REFERENCES ateneum_users(id) ON DELETE SET NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS ateneum_activity_acceptances (
      activity_id TEXT NOT NULL REFERENCES ateneum_activities(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES ateneum_users(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      accepted_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(activity_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS ateneum_plans (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL REFERENCES ateneum_users(id) ON DELETE CASCADE,
      plan_type TEXT NOT NULL CHECK (plan_type IN ('trip','event','project','other')),
      latest_version INTEGER NOT NULL DEFAULT 1 CHECK (latest_version >= 1),
      accepted_version INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      CHECK (accepted_version IS NULL OR accepted_version >= 1)
    );

    CREATE TABLE IF NOT EXISTS ateneum_plan_revisions (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES ateneum_plans(id) ON DELETE CASCADE,
      version INTEGER NOT NULL CHECK (version >= 1),
      title TEXT NOT NULL,
      start_date TEXT,
      end_date TEXT,
      summary TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '{"sections":[]}',
      status TEXT NOT NULL CHECK (status IN ('draft','proposed','accepted','superseded')),
      drafted_by TEXT NOT NULL CHECK (drafted_by IN ('into','human')),
      created_by TEXT REFERENCES ateneum_users(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(plan_id, version)
    );

    CREATE TABLE IF NOT EXISTS ateneum_plan_acceptances (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES ateneum_plans(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES ateneum_users(id) ON DELETE CASCADE,
      version INTEGER NOT NULL CHECK (version >= 1),
      accepted_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(plan_id, version, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_ateneum_plan_revisions_plan_status
      ON ateneum_plan_revisions(plan_id, status, version);
    CREATE INDEX IF NOT EXISTS idx_ateneum_plan_acceptances_user
      ON ateneum_plan_acceptances(user_id);

    CREATE TABLE IF NOT EXISTS ateneum_plan_requests (
      id TEXT PRIMARY KEY,
      requester_user_id TEXT NOT NULL REFERENCES ateneum_users(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL DEFAULT 'idea' CHECK (source_type IN ('idea','activity')),
      idea_id TEXT REFERENCES ateneum_ideas(id) ON DELETE CASCADE,
      activity_id TEXT REFERENCES ateneum_activities(id) ON DELETE CASCADE,
      plan_type TEXT NOT NULL CHECK (plan_type IN ('trip','event','project','other')),
      brief TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      claim_key TEXT,
      available_at INTEGER NOT NULL DEFAULT (unixepoch()),
      claimed_at INTEGER,
      completed_at INTEGER,
      result_plan_id TEXT REFERENCES ateneum_plans(id) ON DELETE SET NULL,
      last_error TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      CHECK (
        (source_type = 'idea' AND idea_id IS NOT NULL AND activity_id IS NULL) OR
        (source_type = 'activity' AND activity_id IS NOT NULL AND idea_id IS NULL)
      )
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

    CREATE TABLE IF NOT EXISTS ateneum_connection_cycles (
      cycle_key TEXT PRIMARY KEY,
      suggestion_ids TEXT NOT NULL DEFAULT '[]',
      committed_idea_id TEXT REFERENCES ateneum_ideas(id) ON DELETE SET NULL,
      activity_id TEXT REFERENCES ateneum_activities(id) ON DELETE SET NULL,
      completed_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS ateneum_connection_checkins (
      id TEXT PRIMARY KEY,
      cycle_key TEXT NOT NULL REFERENCES ateneum_connection_cycles(cycle_key) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES ateneum_users(id) ON DELETE CASCADE,
      energy TEXT NOT NULL CHECK (energy IN ('low','medium','high')),
      need TEXT NOT NULL CHECK (need IN ('rest','closeness','talk','play','adventure','practical_support','space')),
      capacity_min INTEGER NOT NULL CHECK (capacity_min IN (10,30,60,180)),
      togetherness TEXT NOT NULL CHECK (togetherness IN ('together','space','flexible')),
      note TEXT NOT NULL DEFAULT '',
      note_visibility TEXT NOT NULL DEFAULT 'private' CHECK (note_visibility IN ('private','shared')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(cycle_key, user_id)
    );

    CREATE TABLE IF NOT EXISTS ateneum_connection_commitments (
      id TEXT PRIMARY KEY,
      cycle_key TEXT NOT NULL REFERENCES ateneum_connection_cycles(cycle_key) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES ateneum_users(id) ON DELETE CASCADE,
      choice TEXT NOT NULL CHECK (choice IN ('choose','later')),
      idea_id TEXT REFERENCES ateneum_ideas(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      CHECK ((choice = 'later' AND idea_id IS NULL) OR (choice = 'choose' AND idea_id IS NOT NULL)),
      UNIQUE(cycle_key, user_id)
    );

    CREATE TABLE IF NOT EXISTS ateneum_connection_reflections (
      id TEXT PRIMARY KEY,
      cycle_key TEXT NOT NULL REFERENCES ateneum_connection_cycles(cycle_key) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES ateneum_users(id) ON DELETE CASCADE,
      impact TEXT NOT NULL CHECK (impact IN ('closer','same','farther')),
      note TEXT NOT NULL DEFAULT '',
      allow_learning INTEGER NOT NULL DEFAULT 0 CHECK (allow_learning IN (0,1)),
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(cycle_key, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_ateneum_connection_commitments_user
      ON ateneum_connection_commitments(user_id);
    CREATE INDEX IF NOT EXISTS idx_ateneum_connection_reflections_user
      ON ateneum_connection_reflections(user_id);

    CREATE INDEX IF NOT EXISTS idx_ateneum_sessions_user ON ateneum_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_ateneum_activities_scheduled ON ateneum_activities(scheduled_for);
    CREATE INDEX IF NOT EXISTS idx_ateneum_activities_status ON ateneum_activities(status);
    CREATE INDEX IF NOT EXISTS idx_ateneum_activity_acceptances_user ON ateneum_activity_acceptances(user_id);
    CREATE INDEX IF NOT EXISTS idx_ateneum_wishes_user ON ateneum_wishes(user_id);
    CREATE INDEX IF NOT EXISTS idx_ateneum_ideas_active ON ateneum_ideas(is_active);
    CREATE INDEX IF NOT EXISTS idx_ateneum_connection_checkins_user ON ateneum_connection_checkins(user_id);
  `);
}
// Migration: add new tables/columns idempotently.
// Safe to run on every boot: additive changes are transactional and final state is validated.
export function migrateAteneumSchema(): void {
  type ColumnInfo = { name: string; notnull: number };
  const columnInfo = (table: string): ColumnInfo[] =>
    ateneumRawDb.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
  const columnNames = (table: string): Set<string> =>
    new Set(columnInfo(table).map((column) => column.name));

  const migrateAdditiveSchema = ateneumRawDb.transaction(() => {
    ateneumRawDb.exec(`
      CREATE TABLE IF NOT EXISTS ateneum_schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
    `);

    if (!columnNames("ateneum_users").has("email")) {
      ateneumRawDb.exec(`ALTER TABLE ateneum_users ADD COLUMN email TEXT`);
    }
    ateneumRawDb.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_ateneum_users_email ON ateneum_users(email)`,
    );

    const activityColumns = columnNames("ateneum_activities");
    if (!activityColumns.has("details")) {
      ateneumRawDb.exec(`ALTER TABLE ateneum_activities ADD COLUMN details TEXT`);
    }
    if (!activityColumns.has("planning_mode")) {
      ateneumRawDb.exec(
        `ALTER TABLE ateneum_activities ADD COLUMN planning_mode TEXT NOT NULL DEFAULT 'legacy' CHECK (planning_mode IN ('legacy','mutual'))`,
      );
    }
    if (!activityColumns.has("version")) {
      ateneumRawDb.exec(
        `ALTER TABLE ateneum_activities ADD COLUMN version INTEGER NOT NULL DEFAULT 1`,
      );
    }
    if (!activityColumns.has("proposed_by")) {
      ateneumRawDb.exec(
        `ALTER TABLE ateneum_activities ADD COLUMN proposed_by TEXT REFERENCES ateneum_users(id) ON DELETE SET NULL`,
      );
    }
    if (!activityColumns.has("updated_by")) {
      ateneumRawDb.exec(
        `ALTER TABLE ateneum_activities ADD COLUMN updated_by TEXT REFERENCES ateneum_users(id) ON DELETE SET NULL`,
      );
    }
    if (!activityColumns.has("updated_at")) {
      ateneumRawDb.exec(
        `ALTER TABLE ateneum_activities ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0`,
      );
    }
    ateneumRawDb.exec(`
      UPDATE ateneum_activities
      SET proposed_by = COALESCE(proposed_by, created_by),
          updated_by = COALESCE(updated_by, created_by),
          updated_at = CASE WHEN updated_at = 0 THEN created_at ELSE updated_at END;

      CREATE TABLE IF NOT EXISTS ateneum_activity_acceptances (
        activity_id TEXT NOT NULL REFERENCES ateneum_activities(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES ateneum_users(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        accepted_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(activity_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_ateneum_activity_acceptances_user
        ON ateneum_activity_acceptances(user_id);
    `);

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

      CREATE TABLE IF NOT EXISTS ateneum_connection_cycles (
        cycle_key TEXT PRIMARY KEY,
        suggestion_ids TEXT NOT NULL DEFAULT '[]',
        committed_idea_id TEXT REFERENCES ateneum_ideas(id) ON DELETE SET NULL,
        activity_id TEXT REFERENCES ateneum_activities(id) ON DELETE SET NULL,
        completed_at INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE TABLE IF NOT EXISTS ateneum_connection_checkins (
        id TEXT PRIMARY KEY,
        cycle_key TEXT NOT NULL REFERENCES ateneum_connection_cycles(cycle_key) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES ateneum_users(id) ON DELETE CASCADE,
        energy TEXT NOT NULL CHECK (energy IN ('low','medium','high')),
        need TEXT NOT NULL CHECK (need IN ('rest','closeness','talk','play','adventure','practical_support','space')),
        capacity_min INTEGER NOT NULL CHECK (capacity_min IN (10,30,60,180)),
        togetherness TEXT NOT NULL CHECK (togetherness IN ('together','space','flexible')),
        note TEXT NOT NULL DEFAULT '',
        note_visibility TEXT NOT NULL DEFAULT 'private' CHECK (note_visibility IN ('private','shared')),
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(cycle_key, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_ateneum_connection_checkins_user
        ON ateneum_connection_checkins(user_id);
    `);

    const connectionCycleColumns = columnNames("ateneum_connection_cycles");
    if (!connectionCycleColumns.has("committed_idea_id")) {
      ateneumRawDb.exec(
        `ALTER TABLE ateneum_connection_cycles ADD COLUMN committed_idea_id TEXT REFERENCES ateneum_ideas(id) ON DELETE SET NULL`,
      );
    }
    if (!connectionCycleColumns.has("activity_id")) {
      ateneumRawDb.exec(
        `ALTER TABLE ateneum_connection_cycles ADD COLUMN activity_id TEXT REFERENCES ateneum_activities(id) ON DELETE SET NULL`,
      );
    }
    if (!connectionCycleColumns.has("completed_at")) {
      ateneumRawDb.exec(`ALTER TABLE ateneum_connection_cycles ADD COLUMN completed_at INTEGER`);
    }
    ateneumRawDb.exec(`
      CREATE TABLE IF NOT EXISTS ateneum_connection_commitments (
        id TEXT PRIMARY KEY,
        cycle_key TEXT NOT NULL REFERENCES ateneum_connection_cycles(cycle_key) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES ateneum_users(id) ON DELETE CASCADE,
        choice TEXT NOT NULL CHECK (choice IN ('choose','later')),
        idea_id TEXT REFERENCES ateneum_ideas(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        CHECK ((choice = 'later' AND idea_id IS NULL) OR (choice = 'choose' AND idea_id IS NOT NULL)),
        UNIQUE(cycle_key, user_id)
      );
      CREATE TABLE IF NOT EXISTS ateneum_connection_reflections (
        id TEXT PRIMARY KEY,
        cycle_key TEXT NOT NULL REFERENCES ateneum_connection_cycles(cycle_key) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES ateneum_users(id) ON DELETE CASCADE,
        impact TEXT NOT NULL CHECK (impact IN ('closer','same','farther')),
        note TEXT NOT NULL DEFAULT '',
        allow_learning INTEGER NOT NULL DEFAULT 0 CHECK (allow_learning IN (0,1)),
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(cycle_key, user_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ateneum_connection_cycles_activity
        ON ateneum_connection_cycles(activity_id) WHERE activity_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_ateneum_connection_commitments_user
        ON ateneum_connection_commitments(user_id);
      CREATE INDEX IF NOT EXISTS idx_ateneum_connection_reflections_user
        ON ateneum_connection_reflections(user_id);
    `);

    ateneumRawDb.exec(`
      CREATE TABLE IF NOT EXISTS ateneum_plans (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL REFERENCES ateneum_users(id) ON DELETE CASCADE,
        plan_type TEXT NOT NULL CHECK (plan_type IN ('trip','event','project','other')),
        latest_version INTEGER NOT NULL DEFAULT 1 CHECK (latest_version >= 1),
        accepted_version INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        CHECK (accepted_version IS NULL OR accepted_version >= 1)
      );
      CREATE TABLE IF NOT EXISTS ateneum_plan_revisions (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES ateneum_plans(id) ON DELETE CASCADE,
        version INTEGER NOT NULL CHECK (version >= 1),
        title TEXT NOT NULL,
        start_date TEXT,
        end_date TEXT,
        summary TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '{"sections":[]}',
        status TEXT NOT NULL CHECK (status IN ('draft','proposed','accepted','superseded')),
        drafted_by TEXT NOT NULL CHECK (drafted_by IN ('into','human')),
        created_by TEXT REFERENCES ateneum_users(id) ON DELETE SET NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(plan_id, version)
      );
      CREATE TABLE IF NOT EXISTS ateneum_plan_acceptances (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL REFERENCES ateneum_plans(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES ateneum_users(id) ON DELETE CASCADE,
        version INTEGER NOT NULL CHECK (version >= 1),
        accepted_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(plan_id, version, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_ateneum_plan_revisions_plan_status
        ON ateneum_plan_revisions(plan_id, status, version);
      CREATE INDEX IF NOT EXISTS idx_ateneum_plan_acceptances_user
        ON ateneum_plan_acceptances(user_id);
      CREATE TABLE IF NOT EXISTS ateneum_plan_requests (
        id TEXT PRIMARY KEY,
        requester_user_id TEXT NOT NULL REFERENCES ateneum_users(id) ON DELETE CASCADE,
        source_type TEXT NOT NULL DEFAULT 'idea' CHECK (source_type IN ('idea','activity')),
        idea_id TEXT REFERENCES ateneum_ideas(id) ON DELETE CASCADE,
        activity_id TEXT REFERENCES ateneum_activities(id) ON DELETE CASCADE,
        plan_type TEXT NOT NULL CHECK (plan_type IN ('trip','event','project','other')),
        brief TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        claim_key TEXT,
        available_at INTEGER NOT NULL DEFAULT (unixepoch()),
        claimed_at INTEGER,
        completed_at INTEGER,
        result_plan_id TEXT REFERENCES ateneum_plans(id) ON DELETE SET NULL,
        last_error TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        CHECK (
          (source_type = 'idea' AND idea_id IS NOT NULL AND activity_id IS NULL) OR
          (source_type = 'activity' AND activity_id IS NOT NULL AND idea_id IS NULL)
        )
      );
    `);

    const requestColumns = columnNames("ateneum_plan_requests");
    const requestIdeaColumn = columnInfo("ateneum_plan_requests").find((column) => column.name === "idea_id");
    if (!requestColumns.has("source_type") || !requestColumns.has("activity_id") || requestIdeaColumn?.notnull === 1) {
      const claimKeyExpression = requestColumns.has("claim_key") ? "claim_key" : "NULL";
      ateneumRawDb.exec(`
        DROP INDEX IF EXISTS idx_ateneum_plan_requests_status_created;
        DROP INDEX IF EXISTS idx_ateneum_plan_requests_claim_key;
        DROP INDEX IF EXISTS idx_ateneum_plan_requests_requester_idea;
        DROP INDEX IF EXISTS idx_ateneum_plan_requests_requester_activity;
        ALTER TABLE ateneum_plan_requests RENAME TO ateneum_plan_requests__legacy;
        CREATE TABLE ateneum_plan_requests (
          id TEXT PRIMARY KEY,
          requester_user_id TEXT NOT NULL REFERENCES ateneum_users(id) ON DELETE CASCADE,
          source_type TEXT NOT NULL DEFAULT 'idea' CHECK (source_type IN ('idea','activity')),
          idea_id TEXT REFERENCES ateneum_ideas(id) ON DELETE CASCADE,
          activity_id TEXT REFERENCES ateneum_activities(id) ON DELETE CASCADE,
          plan_type TEXT NOT NULL CHECK (plan_type IN ('trip','event','project','other')),
          brief TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
          attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
          claim_key TEXT,
          available_at INTEGER NOT NULL DEFAULT (unixepoch()),
          claimed_at INTEGER,
          completed_at INTEGER,
          result_plan_id TEXT REFERENCES ateneum_plans(id) ON DELETE SET NULL,
          last_error TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          CHECK (
            (source_type = 'idea' AND idea_id IS NOT NULL AND activity_id IS NULL) OR
            (source_type = 'activity' AND activity_id IS NOT NULL AND idea_id IS NULL)
          )
        );
        INSERT INTO ateneum_plan_requests
          (id, requester_user_id, source_type, idea_id, activity_id, plan_type, brief, status,
           attempt_count, claim_key, available_at, claimed_at, completed_at, result_plan_id,
           last_error, created_at, updated_at)
        SELECT id, requester_user_id, 'idea', idea_id, NULL, plan_type, brief, status,
               attempt_count, ${claimKeyExpression}, available_at, claimed_at, completed_at,
               result_plan_id, last_error, created_at, updated_at
        FROM ateneum_plan_requests__legacy;
        DROP TABLE ateneum_plan_requests__legacy;
      `);
    }
    ateneumRawDb.exec(`
      CREATE INDEX IF NOT EXISTS idx_ateneum_plan_requests_status_created
        ON ateneum_plan_requests(status, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ateneum_plan_requests_claim_key
        ON ateneum_plan_requests(claim_key) WHERE claim_key IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ateneum_plan_requests_requester_idea
        ON ateneum_plan_requests(requester_user_id, idea_id) WHERE source_type = 'idea';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ateneum_plan_requests_requester_activity
        ON ateneum_plan_requests(requester_user_id, activity_id) WHERE source_type = 'activity';
    `);

    const revisionCreatedBy = columnInfo("ateneum_plan_revisions").find(
      (column) => column.name === "created_by",
    );
    const revisionCreatedByForeignKey = (
      ateneumRawDb.pragma("foreign_key_list(ateneum_plan_revisions)") as Array<{
        from: string;
        on_delete: string;
      }>
    ).find((foreignKey) => foreignKey.from === "created_by");
    if (
      revisionCreatedBy?.notnull === 1 ||
      revisionCreatedByForeignKey?.on_delete.toUpperCase() !== "SET NULL"
    ) {
      ateneumRawDb.exec(`
        DROP TABLE IF EXISTS ateneum_plan_revisions__new;
        CREATE TABLE ateneum_plan_revisions__new (
          id TEXT PRIMARY KEY,
          plan_id TEXT NOT NULL REFERENCES ateneum_plans(id) ON DELETE CASCADE,
          version INTEGER NOT NULL CHECK (version >= 1),
          title TEXT NOT NULL,
          start_date TEXT,
          end_date TEXT,
          summary TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL DEFAULT '{"sections":[]}',
          status TEXT NOT NULL CHECK (status IN ('draft','proposed','accepted','superseded')),
          drafted_by TEXT NOT NULL CHECK (drafted_by IN ('into','human')),
          created_by TEXT REFERENCES ateneum_users(id) ON DELETE SET NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          UNIQUE(plan_id, version)
        );
        INSERT INTO ateneum_plan_revisions__new
          (id, plan_id, version, title, start_date, end_date, summary, content,
           status, drafted_by, created_by, created_at, updated_at)
        SELECT id, plan_id, version, title, start_date, end_date, summary, content,
               status, drafted_by, created_by, created_at, updated_at
        FROM ateneum_plan_revisions;
        DROP TABLE ateneum_plan_revisions;
        ALTER TABLE ateneum_plan_revisions__new RENAME TO ateneum_plan_revisions;
        CREATE INDEX idx_ateneum_plan_revisions_plan_status
          ON ateneum_plan_revisions(plan_id, status, version);
      `);
    }

    const tokenMigration = "api_token_scopes_v1";
    const migrationApplied = Boolean(
      ateneumRawDb
        .prepare("SELECT 1 FROM ateneum_schema_migrations WHERE name = ?")
        .get(tokenMigration),
    );
    const apiTokenColumns = columnNames("ateneum_api_tokens");
    if (
      migrationApplied &&
      (!apiTokenColumns.has("scopes") || !apiTokenColumns.has("revoked_at"))
    ) {
      throw new Error("api_token_scopes_v1 marker exists but required columns are missing");
    }
    if (!migrationApplied) {
      if (!apiTokenColumns.has("scopes")) {
        ateneumRawDb.exec(
          `ALTER TABLE ateneum_api_tokens ADD COLUMN scopes TEXT NOT NULL DEFAULT '["read"]'`,
        );
      }
      if (!apiTokenColumns.has("revoked_at")) {
        ateneumRawDb.exec(`ALTER TABLE ateneum_api_tokens ADD COLUMN revoked_at INTEGER`);
      }
      const revoked = ateneumRawDb
        .prepare("UPDATE ateneum_api_tokens SET revoked_at = unixepoch() WHERE revoked_at IS NULL")
        .run();
      if (revoked.changes > 0) {
        console.log(`[ateneum] revoked ${revoked.changes} legacy API tokens during scope migration`);
      }

      const expiresColumn = columnInfo("ateneum_api_tokens").find(
        (column) => column.name === "expires_at",
      );
      if (!expiresColumn?.notnull) {
        ateneumRawDb.exec(`
          CREATE TABLE ateneum_api_tokens__new (
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
          INSERT INTO ateneum_api_tokens__new
            (id, token_hash, user_id, name, scopes, expires_at, revoked_at, last_used_at, created_at)
          SELECT id, token_hash, user_id, name, scopes, COALESCE(expires_at, 0),
                 COALESCE(revoked_at, unixepoch()), last_used_at, created_at
          FROM ateneum_api_tokens;
          DROP TABLE ateneum_api_tokens;
          ALTER TABLE ateneum_api_tokens__new RENAME TO ateneum_api_tokens;
          CREATE INDEX idx_ateneum_api_tokens_hash ON ateneum_api_tokens(token_hash);
          CREATE INDEX idx_ateneum_api_tokens_user ON ateneum_api_tokens(user_id);
        `);
      }
      ateneumRawDb
        .prepare("INSERT INTO ateneum_schema_migrations (name) VALUES (?)")
        .run(tokenMigration);
    }
  });
  migrateAdditiveSchema();

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
    ateneumRawDb.pragma("foreign_keys = OFF");
    try {
      const migrateRoles = ateneumRawDb.transaction(() => {
        ateneumRawDb.exec(`
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
          CREATE UNIQUE INDEX IF NOT EXISTS idx_ateneum_users_email ON ateneum_users(email);
        `);
      });
      migrateRoles();
    } finally {
      ateneumRawDb.pragma("foreign_keys = ON");
    }
  }

  const requiredColumns: Record<string, string[]> = {
    ateneum_users: ["id", "username", "display_name", "password_hash", "email", "role"],
    ateneum_activities: [
      "id",
      "details",
      "status",
      "planning_mode",
      "version",
      "proposed_by",
      "updated_by",
      "updated_at",
    ],
    ateneum_activity_acceptances: ["activity_id", "user_id", "version", "accepted_at"],
    ateneum_plans: [
      "id",
      "owner_user_id",
      "plan_type",
      "latest_version",
      "accepted_version",
      "created_at",
      "updated_at",
    ],
    ateneum_plan_revisions: [
      "id",
      "plan_id",
      "version",
      "title",
      "start_date",
      "end_date",
      "summary",
      "content",
      "status",
      "drafted_by",
      "created_by",
      "created_at",
      "updated_at",
    ],
    ateneum_plan_acceptances: ["id", "plan_id", "user_id", "version", "accepted_at"],
    ateneum_plan_requests: [
      "id",
      "requester_user_id",
      "idea_id",
      "plan_type",
      "brief",
      "status",
      "attempt_count",
      "claim_key",
      "available_at",
      "claimed_at",
      "completed_at",
      "result_plan_id",
      "last_error",
      "created_at",
      "updated_at",
    ],
    ateneum_api_tokens: [
      "id",
      "token_hash",
      "user_id",
      "name",
      "scopes",
      "expires_at",
      "revoked_at",
    ],
    ateneum_email_tokens: ["id", "email", "token_hash", "purpose", "expires_at"],
    ateneum_email_claims: ["id", "to_email", "kind", "week_key", "status"],
    ateneum_weekly_suggestions: ["week_key", "idea_id"],
    ateneum_connection_cycles: [
      "cycle_key",
      "suggestion_ids",
      "committed_idea_id",
      "activity_id",
      "completed_at",
      "updated_at",
    ],
    ateneum_connection_checkins: [
      "id",
      "cycle_key",
      "user_id",
      "energy",
      "need",
      "capacity_min",
      "togetherness",
      "note",
      "note_visibility",
      "updated_at",
    ],
    ateneum_connection_commitments: [
      "id",
      "cycle_key",
      "user_id",
      "choice",
      "idea_id",
      "updated_at",
    ],
    ateneum_connection_reflections: [
      "id",
      "cycle_key",
      "user_id",
      "impact",
      "note",
      "allow_learning",
      "updated_at",
    ],
  };
  for (const [table, required] of Object.entries(requiredColumns)) {
    const actual = columnNames(table);
    const missing = required.filter((column) => !actual.has(column));
    if (missing.length > 0) {
      throw new Error(`Ateneum schema validation failed: ${table} missing ${missing.join(", ")}`);
    }
  }
  const connectionActivityIndex = ateneumRawDb
    .prepare(
      `SELECT 1 FROM sqlite_master
       WHERE type = 'index' AND name = 'idx_ateneum_connection_cycles_activity'`,
    )
    .get();
  if (!connectionActivityIndex) {
    throw new Error("Ateneum connection activity uniqueness index is missing");
  }
  for (const table of [
    "ateneum_connection_checkins",
    "ateneum_connection_commitments",
    "ateneum_connection_reflections",
  ]) {
    const tableSql = (
      ateneumRawDb
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(table) as { sql?: string } | undefined
    )?.sql ?? "";
    if (!/UNIQUE\s*\(cycle_key,\s*user_id\)/i.test(tableSql)) {
      throw new Error(`Ateneum connection uniqueness constraint is missing: ${table}`);
    }
  }
  const acceptanceTableSql = (
    ateneumRawDb
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ateneum_activity_acceptances'",
      )
      .get() as { sql?: string } | undefined
  )?.sql ?? "";
  if (!/UNIQUE\s*\(activity_id,\s*user_id\)/i.test(acceptanceTableSql)) {
    throw new Error("Ateneum activity acceptance uniqueness constraint is missing");
  }
  const planRevisionSql = (
    ateneumRawDb
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ateneum_plan_revisions'")
      .get() as { sql?: string } | undefined
  )?.sql ?? "";
  if (!/UNIQUE\s*\(plan_id,\s*version\)/i.test(planRevisionSql)) {
    throw new Error("Ateneum plan revision uniqueness constraint is missing");
  }
  const planRevisionCreatedBy = columnInfo("ateneum_plan_revisions").find(
    (column) => column.name === "created_by",
  );
  const planRevisionCreatedByForeignKey = (
    ateneumRawDb.pragma("foreign_key_list(ateneum_plan_revisions)") as Array<{
      from: string;
      on_delete: string;
    }>
  ).find((foreignKey) => foreignKey.from === "created_by");
  if (
    planRevisionCreatedBy?.notnull !== 0 ||
    planRevisionCreatedByForeignKey?.on_delete.toUpperCase() !== "SET NULL"
  ) {
    throw new Error("Ateneum plan revision creator retention constraint is invalid");
  }
  const planAcceptanceSql = (
    ateneumRawDb
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ateneum_plan_acceptances'")
      .get() as { sql?: string } | undefined
  )?.sql ?? "";
  if (!/UNIQUE\s*\(plan_id,\s*version,\s*user_id\)/i.test(planAcceptanceSql)) {
    throw new Error("Ateneum plan acceptance version uniqueness constraint is missing");
  }
  const tokenInfo = new Map(
    columnInfo("ateneum_api_tokens").map((column) => [column.name, column]),
  );
  for (const requiredNotNull of ["token_hash", "user_id", "name", "scopes", "expires_at"]) {
    if (tokenInfo.get(requiredNotNull)?.notnull !== 1) {
      throw new Error(`Ateneum token constraint validation failed: ${requiredNotNull} is nullable`);
    }
  }
  if (
    !ateneumRawDb
      .prepare("SELECT 1 FROM ateneum_schema_migrations WHERE name = ?")
      .get("api_token_scopes_v1")
  ) {
    throw new Error("Ateneum token migration marker is missing");
  }
  const finalUserSql = (
    ateneumRawDb
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ateneum_users'")
      .get() as { sql?: string } | undefined
  )?.sql ?? "";
  if (
    !finalUserSql.includes("'partner_a'") ||
    !finalUserSql.includes("'partner_b'") ||
    finalUserSql.includes("'juuso'") ||
    finalUserSql.includes("'wife'")
  ) {
    throw new Error("Ateneum role constraint validation failed");
  }
  if (ateneumRawDb.pragma("foreign_keys", { simple: true }) !== 1) {
    throw new Error("Ateneum foreign key enforcement is disabled");
  }
  const foreignKeyErrors = ateneumRawDb.pragma("foreign_key_check") as unknown[];
  if (foreignKeyErrors.length > 0) {
    throw new Error(`Ateneum foreign key validation failed: ${foreignKeyErrors.length} violation(s)`);
  }
  if (ateneumRawDb.pragma("quick_check", { simple: true }) !== "ok") {
    throw new Error("Ateneum SQLite quick_check failed");
  }
}
