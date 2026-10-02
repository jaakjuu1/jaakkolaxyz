import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "path";
import fs from "fs";
import * as schema from "@shared/dashboard-schema";

/**
 * Dashboardin tietokanta.
 *
 * - Paikallisesti:  data/dashboard.db
 * - Tuotannossa:    DASHBOARD_DB_PATH ympäristömuuttujalla (Teppo, sama levy kuin ateneum)
 *
 * Ei jaeta Tursoon — dashboardin snapshotit eivät ole tuotantodataa,
 * ja niiden palauttaminen Turson kautta lisäisi turhaa API-liikennettä.
 */

const DB_PATH =
  process.env.DASHBOARD_DB_PATH ||
  path.resolve(process.cwd(), "data", "dashboard.db");

const parentDir = path.dirname(DB_PATH);
if (!fs.existsSync(parentDir)) {
  fs.mkdirSync(parentDir, { recursive: true });
}

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const dashboardDb = drizzle(sqlite, { schema });
export const dashboardRawDb = sqlite;

export function newDashboardId(prefix = ""): string {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 10);
  return prefix ? `${prefix}_${ts}${rnd}` : `${ts}${rnd}`;
}

export function initDashboardSchema(): void {
  dashboardRawDb.exec(`
    CREATE TABLE IF NOT EXISTS dashboard_sites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      ssh_alias TEXT,
      primary_url TEXT NOT NULL,
      health_url TEXT,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS dashboard_snapshots (
      id TEXT PRIMARY KEY,
      taken_at INTEGER NOT NULL,
      source TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      overall_status TEXT NOT NULL,
      sites_checked INTEGER NOT NULL DEFAULT 0,
      sites_failed INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_dashboard_snapshots_taken_at
      ON dashboard_snapshots(taken_at);

    CREATE TABLE IF NOT EXISTS dashboard_site_reports (
      id TEXT PRIMARY KEY,
      snapshot_id TEXT NOT NULL REFERENCES dashboard_snapshots(id) ON DELETE CASCADE,
      site_id TEXT NOT NULL,
      status TEXT NOT NULL,
      http_status INTEGER,
      server_uptime TEXT,
      disk_free_pct INTEGER,
      memory_used_pct INTEGER,
      container_count INTEGER,
      notes_json TEXT NOT NULL DEFAULT '[]',
      report_markdown TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_dashboard_site_reports_snapshot
      ON dashboard_site_reports(snapshot_id);
    CREATE INDEX IF NOT EXISTS idx_dashboard_site_reports_site
      ON dashboard_site_reports(site_id);

    CREATE TABLE IF NOT EXISTS dashboard_alerts (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      snapshot_id TEXT REFERENCES dashboard_snapshots(id) ON DELETE SET NULL,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT 0,
      acknowledged INTEGER NOT NULL DEFAULT 0,
      delivered_telegram INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_dashboard_alerts_site
      ON dashboard_alerts(site_id);
    CREATE INDEX IF NOT EXISTS idx_dashboard_alerts_created
      ON dashboard_alerts(created_at);
  `);
}
