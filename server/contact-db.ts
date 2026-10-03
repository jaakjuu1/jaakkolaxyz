import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import type { ContactInput, ContactMeta } from "./contact";

export interface ContactStore {
  /** Persists one submission and returns its row id. Throws on failure. */
  save(input: ContactInput, meta?: ContactMeta): number;
  close(): void;
}

/**
 * Durable copy of every contact-form submission (SQLite, same data/ directory
 * as the Ateneum and dashboard databases). Opened lazily on first use so that
 * importing this module never creates files.
 */
export function openContactStore(
  dbPath: string = process.env.CONTACT_DB_PATH || path.resolve(process.cwd(), "data", "contact.db"),
): ContactStore {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS contact_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      company TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL,
      budget TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      user_agent TEXT,
      referer TEXT,
      accept_language TEXT,
      ip_hash TEXT
    )
  `);
  // Databases created before the source columns existed get them added in place.
  const existing = new Set(
    (db.prepare("PRAGMA table_info(contact_submissions)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  for (const column of ["user_agent", "referer", "accept_language", "ip_hash"]) {
    if (!existing.has(column)) db.exec(`ALTER TABLE contact_submissions ADD COLUMN ${column} TEXT`);
  }
  const insert = db.prepare(
    "INSERT INTO contact_submissions (name, email, company, message, budget, user_agent, referer, accept_language, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  return {
    save(input, meta) {
      const result = insert.run(
        input.name,
        input.email,
        input.company,
        input.message,
        input.budget ?? null,
        meta?.userAgent ?? null,
        meta?.referer ?? null,
        meta?.acceptLanguage ?? null,
        meta?.ipHash ?? null,
      );
      return Number(result.lastInsertRowid);
    },
    close() {
      db.close();
    },
  };
}
