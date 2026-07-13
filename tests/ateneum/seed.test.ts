import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";

const ENV_NAMES = [
  "ATENEUM_PARTNER_A_USERNAME",
  "ATENEUM_PARTNER_A_DISPLAY_NAME",
  "ATENEUM_PARTNER_A_EMAIL",
  "ATENEUM_PARTNER_A_PASSWORD",
  "ATENEUM_PARTNER_B_USERNAME",
  "ATENEUM_PARTNER_B_DISPLAY_NAME",
  "ATENEUM_PARTNER_B_EMAIL",
  "ATENEUM_PARTNER_B_PASSWORD",
] as const;

test("seed is validated, transactional, idempotent and repairs partial data", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ateneum-seed-"));
  const dbPath = path.join(tempDir, "seed.db");
  process.env.ATENEUM_DB_PATH = dbPath;
  for (const name of ENV_NAMES) delete process.env[name];

  const db = await import("../../server/ateneum-db");
  db.initAteneumSchema();
  db.migrateAteneumSchema();
  const { seedAteneum } = await import("../../server/ateneum-seed");
  const { SEED_IDEAS } = await import("../../server/ateneum-seed-data");

  const count = (table: string) =>
    (db.ateneumRawDb.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number })
      .count;

  try {
    await assert.rejects(seedAteneum(), /ATENEUM_PARTNER_A_USERNAME/);
    assert.equal(count("ateneum_users"), 0);
    assert.equal(count("ateneum_preferences"), 0);
    assert.equal(count("ateneum_ideas"), 0);

    db.ateneumRawDb
      .prepare(
        `INSERT INTO ateneum_users
          (id, username, display_name, password_hash, email, role)
         VALUES (?, ?, ?, ?, ?, 'bot')`,
      )
      .run("usr_test_bot", "ateneum-bot", "Ateneum", "test-only", "conflict@example.test");

    Object.assign(process.env, {
      ATENEUM_PARTNER_A_USERNAME: "partner-a",
      ATENEUM_PARTNER_A_DISPLAY_NAME: "Partner A",
      ATENEUM_PARTNER_A_EMAIL: "partner-a@example.test",
      ATENEUM_PARTNER_A_PASSWORD: "partner-a-test-password",
      ATENEUM_PARTNER_B_USERNAME: "partner-b",
      ATENEUM_PARTNER_B_DISPLAY_NAME: "Partner B",
      ATENEUM_PARTNER_B_EMAIL: "conflict@example.test",
      ATENEUM_PARTNER_B_PASSWORD: "partner-b-test-password",
      ATENEUM_BOT_EMAIL: "bot@example.test",
    });

    await assert.rejects(seedAteneum(), /UNIQUE constraint failed/);
    assert.equal(count("ateneum_users"), 1, "first human insert must roll back");
    assert.equal(count("ateneum_preferences"), 0);
    assert.equal(count("ateneum_ideas"), 0);

    db.ateneumRawDb
      .prepare("UPDATE ateneum_users SET email = ? WHERE role = 'bot'")
      .run("bot@example.test");
    process.env.ATENEUM_PARTNER_B_EMAIL = "partner-b@example.test";

    const first = await seedAteneum();
    assert.equal(first.seeded, true);
    assert.equal(count("ateneum_users"), 3);
    assert.equal(count("ateneum_preferences"), 2);
    assert.equal(count("ateneum_ideas"), SEED_IDEAS.length);

    const second = await seedAteneum();
    assert.deepEqual(second, { seeded: false, summary: "already seeded" });

    const removedIdea = db.ateneumRawDb
      .prepare("SELECT id FROM ateneum_ideas WHERE id LIKE 'idea_seed_%' LIMIT 1")
      .get() as { id: string };
    db.ateneumRawDb.prepare("DELETE FROM ateneum_preferences WHERE user_id = ?").run(
      db.ateneumRawDb.prepare("SELECT id FROM ateneum_users WHERE role = 'partner_b'").pluck().get(),
    );
    db.ateneumRawDb.prepare("DELETE FROM ateneum_ideas WHERE id = ?").run(removedIdea.id);

    const repaired = await seedAteneum();
    assert.equal(repaired.seeded, true);
    assert.equal(count("ateneum_preferences"), 2);
    assert.equal(count("ateneum_ideas"), SEED_IDEAS.length);
  } finally {
    db.ateneumRawDb.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.ATENEUM_DB_PATH;
  }
});

test("migration neutralizes legacy roles and removes raw sessions", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ateneum-migration-"));
  const dbPath = path.join(tempDir, "legacy.db");
  const script = `
    import Database from "better-sqlite3";
    const raw = new Database(process.env.ATENEUM_DB_PATH);
    raw.exec(\`
      CREATE TABLE ateneum_users (
        id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL, password_hash TEXT NOT NULL,
        email TEXT UNIQUE, role TEXT NOT NULL CHECK (role IN ('juuso','wife','bot')),
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE TABLE ateneum_sessions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE TABLE ateneum_api_tokens (
        id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL, name TEXT NOT NULL, expires_at INTEGER,
        last_used_at INTEGER, created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT INTO ateneum_users (id,username,display_name,password_hash,email,role) VALUES
        ('legacy-a','legacy-a','Legacy A','x','a@example.test','juuso'),
        ('legacy-b','legacy-b','Legacy B','x','b@example.test','wife'),
        ('legacy-bot','legacy-bot','Bot','x','bot@example.test','bot');
      INSERT INTO ateneum_sessions (id,user_id,expires_at) VALUES
        ('sess_predictable','legacy-a',4102444800000),
        ('sessh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','legacy-b',4102444800000);
      INSERT INTO ateneum_api_tokens (id,token_hash,user_id,name,expires_at) VALUES
        ('legacy-token','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
         'legacy-a','Legacy persistent token',NULL);
    \`);
    raw.close();
    (async () => {
      const db = await import("./server/ateneum-db");
      db.migrateAteneumSchema();
      db.ateneumRawDb.close();
    })().catch(error => { console.error(error); process.exit(1); });
  `;

  try {
    const child = spawnSync(path.resolve("node_modules/.bin/tsx"), ["-e", script], {
      cwd: path.resolve("."),
      env: { ...process.env, ATENEUM_DB_PATH: dbPath },
      encoding: "utf8",
    });
    assert.equal(child.status, 0, child.stderr || child.stdout);

    const migrated = new Database(dbPath, { readonly: true });
    const roles = migrated
      .prepare("SELECT role FROM ateneum_users ORDER BY id")
      .pluck()
      .all();
    const sessionIds = migrated
      .prepare("SELECT id FROM ateneum_sessions ORDER BY id")
      .pluck()
      .all();
    const schemaSql = migrated
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ateneum_users'")
      .pluck()
      .get() as string;
    const legacyToken = migrated
      .prepare("SELECT scopes, revoked_at FROM ateneum_api_tokens WHERE id = 'legacy-token'")
      .get() as { scopes: string; revoked_at: number | null };
    migrated.close();

    assert.deepEqual(roles, ["partner_a", "partner_b", "bot"]);
    assert.deepEqual(sessionIds, [
      "sessh_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ]);
    assert.match(schemaSql, /partner_a/);
    assert.match(schemaSql, /partner_b/);
    assert.doesNotMatch(schemaSql, /'juuso'|'wife'/);
    assert.deepEqual(JSON.parse(legacyToken.scopes), ["read"]);
    assert.ok(legacyToken.revoked_at, "legacy API token must be revoked during migration");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("production entrypoint fails fast before listening when Ateneum seed is invalid", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ateneum-entrypoint-"));
  const childEnv = { ...process.env };
  for (const name of ENV_NAMES) delete childEnv[name];

  try {
    const child = spawnSync(path.resolve("node_modules/.bin/tsx"), ["server/index.ts"], {
      cwd: path.resolve("."),
      env: {
        ...childEnv,
        ATENEUM_DB_PATH: path.join(tempDir, "entrypoint.db"),
        NODE_ENV: "production",
        PORT: "0",
      },
      encoding: "utf8",
      timeout: 15_000,
    });
    const output = `${child.stdout ?? ""}\n${child.stderr ?? ""}`;

    assert.notEqual(child.status, 0, output);
    assert.match(output, /startup failed: Error Missing ATENEUM_PARTNER_A_USERNAME/);
    assert.doesNotMatch(output, /serving on port/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
