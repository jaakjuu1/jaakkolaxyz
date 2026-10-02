import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

/**
 * Dashboard-skeema: read-only operatiivinen näkymä tuotantosovelluksiin.
 *
 * Ei ole käyttäjädataa, ei ole transaktioita — vain snapshotteja ja
 * varoituksia. Kaikki taulut ovat IDEMPOTENTIN initin kautta luotuja.
 *
 *  - sites        : kovakoodattu lista (aloitus), jatkossa ehkä DB:stä
 *  - snapshots    : yhden tarkistuskierroksen tulos
 *  - site_reports : yhden kohteen tarkistus yhdessä snapshotissa
 *  - alerts       : nousevat varoitukset (WARN/CRITICAL)
 */

export const dashboardSites = sqliteTable("dashboard_sites", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(), // 'hostinger' | 'teppo' | 'kuukilab' | 'other'
  ssh_alias: text("ssh_alias"),         // 'hostinger' | 'teppo-server' | 'teppo-mystic' | 'kuukilab' | null
  primary_url: text("primary_url").notNull(),
  health_url: text("health_url"),
  notes: text("notes"),
  is_active: integer("is_active").notNull().default(1),
  created_at: integer("created_at").notNull().default(0),
});

export const dashboardSnapshots = sqliteTable(
  "dashboard_snapshots",
  {
    id: text("id").primaryKey(),
    taken_at: integer("taken_at").notNull(),
    source: text("source").notNull(), // 'manual' | 'cron' | 'page-load'
    duration_ms: integer("duration_ms").notNull().default(0),
    overall_status: text("overall_status").notNull(), // 'OK' | 'WARN' | 'CRITICAL'
    sites_checked: integer("sites_checked").notNull().default(0),
    sites_failed: integer("sites_failed").notNull().default(0),
  },
  (t) => ({
    idxTakenAt: index("idx_dashboard_snapshots_taken_at").on(t.taken_at),
  }),
);

export const dashboardSiteReports = sqliteTable(
  "dashboard_site_reports",
  {
    id: text("id").primaryKey(),
    snapshot_id: text("snapshot_id")
      .notNull()
      .references(() => dashboardSnapshots.id, { onDelete: "cascade" }),
    site_id: text("site_id").notNull(),
    status: text("status").notNull(), // 'up' | 'down' | 'degraded' | 'auth-protected' | 'unknown'
    http_status: integer("http_status"),
    server_uptime: text("server_uptime"),
    disk_free_pct: integer("disk_free_pct"),
    memory_used_pct: integer("memory_used_pct"),
    container_count: integer("container_count"),
    notes_json: text("notes_json").notNull().default("[]"),
    report_markdown: text("report_markdown").notNull().default(""),
  },
  (t) => ({
    idxSnapshot: index("idx_dashboard_site_reports_snapshot").on(t.snapshot_id),
    idxSite: index("idx_dashboard_site_reports_site").on(t.site_id),
  }),
);

export const dashboardAlerts = sqliteTable(
  "dashboard_alerts",
  {
    id: text("id").primaryKey(),
    site_id: text("site_id").notNull(),
    snapshot_id: text("snapshot_id").references(() => dashboardSnapshots.id, {
      onDelete: "set null",
    }),
    severity: text("severity").notNull(), // 'WARN' | 'CRITICAL'
    message: text("message").notNull(),
    created_at: integer("created_at").notNull().default(0),
    acknowledged: integer("acknowledged").notNull().default(0),
    delivered_telegram: integer("delivered_telegram").notNull().default(0),
  },
  (t) => ({
    idxSite: index("idx_dashboard_alerts_site").on(t.site_id),
    idxCreated: index("idx_dashboard_alerts_created").on(t.created_at),
  }),
);

export type DashboardSite = typeof dashboardSites.$inferSelect;
export type DashboardSnapshot = typeof dashboardSnapshots.$inferSelect;
export type DashboardSiteReport = typeof dashboardSiteReports.$inferSelect;
export type DashboardAlert = typeof dashboardAlerts.$inferSelect;
