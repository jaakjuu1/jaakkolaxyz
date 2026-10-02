import type { Express, Request, Response } from "express";
import { eq, desc, sql, and, gte } from "drizzle-orm";
import { dashboardDb, dashboardRawDb } from "./dashboard-db";
import {
  dashboardSnapshots,
  dashboardSiteReports,
  dashboardAlerts,
} from "@shared/dashboard-schema";
import { runFullCheck } from "./dashboard-checks";
import { runAllServerChecks } from "./dashboard-server-checks";
import { sites } from "./dashboard-sites";

/**
 * Vaihe 0 -tasoiset API-reitit. Auth on tarkoitus hoitaa Caddyn Basic Auth -tasolla
 * (proxy välittää Authorization-headerin, mutta emme pakota sitä tässä).
 * Jätetään kuitenkin yksinkertainen token-tarkistus jos DASHBOARD_API_TOKEN on asetettu.
 */

const FRESHNESS_SECONDS = 24 * 60 * 60; // 24h

function maybeRequireToken(req: Request, res: Response): boolean {
  const expected = process.env.DASHBOARD_API_TOKEN;
  if (!expected) return true; // ei pakollista
  const got = req.headers["x-dashboard-token"] || req.query.token;
  if (got !== expected) {
    res.status(401).json({ error: "invalid token" });
    return false;
  }
  return true;
}

type DashboardOverall = "OK" | "WARN" | "CRITICAL";

function recomputeSnapshotOverall(snapshotId: string, durationMs: number): {
  overall: DashboardOverall;
  sites_failed: number;
  sites_degraded: number;
} {
  const rows = dashboardRawDb
    .prepare("SELECT site_id, status FROM dashboard_site_reports WHERE snapshot_id = ?")
    .all(snapshotId) as Array<{ site_id: string; status: string }>;
  const bySite = new Map(rows.map((r) => [r.site_id, r.status]));

  let failed = 0;
  let degraded = 0;
  for (const site of sites) {
    if (site.affects_overall === false) continue;
    const status = bySite.get(site.id) || "unknown";
    if (status === "down" || status === "unknown") failed += 1;
    else if (status === "degraded") degraded += 1;
  }

  const overall: DashboardOverall = failed > 0 ? "CRITICAL" : degraded > 0 ? "WARN" : "OK";
  dashboardRawDb
    .prepare("UPDATE dashboard_snapshots SET overall_status = ?, sites_failed = ?, duration_ms = ? WHERE id = ?")
    .run(overall, failed, durationMs, snapshotId);
  return { overall, sites_failed: failed, sites_degraded: degraded };
}

async function runDashboardRefresh(source: "manual" | "cron" | "page-load") {
  const t0 = Date.now();
  const http = await runFullCheck(source);
  const server = await runAllServerChecks(http.snapshot_id);
  const final = recomputeSnapshotOverall(http.snapshot_id, Date.now() - t0);
  return {
    ...http,
    overall: final.overall,
    duration_ms: Date.now() - t0,
    sites_failed: final.sites_failed,
    sites_degraded: final.sites_degraded,
    server_checks: {
      checked: server.results.length,
      failed: server.failed,
      degraded: server.degraded,
    },
  };
}

export function registerDashboardRoutes(app: Express) {
  // Lista kohteista (kovakoodattu)
  app.get("/api/dashboard/sites", async (_req, res) => {
    res.json({ sites });
  });

  // Uusin snapshot (tai tyhjä)
  app.get("/api/dashboard/snapshot", async (req, res) => {
    if (!maybeRequireToken(req, res)) return;
    const latest = await dashboardDb
      .select()
      .from(dashboardSnapshots)
      .orderBy(desc(dashboardSnapshots.taken_at))
      .limit(1);

    if (latest.length === 0) {
      res.json({
        snapshot: null,
        sites,
        message: "Ei snapshotteja. Aja POST /api/dashboard/refresh.",
      });
      return;
    }

    const snap = latest[0];
    const reports = await dashboardDb
      .select()
      .from(dashboardSiteReports)
      .where(eq(dashboardSiteReports.snapshot_id, snap.id));

    const takenAt = snap.taken_at * 1000;
    const isStale = Date.now() - takenAt > FRESHNESS_SECONDS * 1000;

    res.json({
      snapshot: snap,
      sites,
      reports: reports.reduce<Record<string, unknown>>((acc, r) => {
        acc[r.site_id] = r;
        return acc;
      }, {}),
      is_stale: isStale,
    });
  });

  // Manuaalinen triggeri
  app.post("/api/dashboard/refresh", async (req, res) => {
    if (!maybeRequireToken(req, res)) return;
    try {
      const result = await runDashboardRefresh("manual");
      res.json({ ok: true, ...result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // Avoimet alertit
  app.get("/api/dashboard/alerts", async (req, res) => {
    if (!maybeRequireToken(req, res)) return;
    const since = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60; // 7 pv
    const rows = await dashboardDb
      .select()
      .from(dashboardAlerts)
      .where(
        and(
          eq(dashboardAlerts.acknowledged, 0),
          gte(dashboardAlerts.created_at, since),
        ),
      )
      .orderBy(desc(dashboardAlerts.created_at))
      .limit(50);
    res.json({ alerts: rows });
  });

  // Ack-alert
  app.post("/api/dashboard/alerts/:id/ack", async (req, res) => {
    if (!maybeRequireToken(req, res)) return;
    await dashboardDb
      .update(dashboardAlerts)
      .set({ acknowledged: 1 } as any)
      .where(eq(dashboardAlerts.id, req.params.id));
    res.json({ ok: true });
  });

  // Markdown-raportti yhdestä sivustosta (uusin)
  app.get("/api/dashboard/report/:siteId", async (req, res) => {
    if (!maybeRequireToken(req, res)) return;
    const rows = await dashboardDb
      .select()
      .from(dashboardSiteReports)
      .where(eq(dashboardSiteReports.site_id, req.params.siteId))
      .orderBy(desc(dashboardSiteReports.id))
      .limit(1);

    if (rows.length === 0) {
      res.status(404).type("text/markdown").send(
        `# Raporttia ei löytynyt\n\nSivusto \`${req.params.siteId}\` ei ole vielä tarkistettu. Aja ensin POST /api/dashboard/refresh.`,
      );
      return;
    }
    res.type("text/markdown").send(rows[0].report_markdown);
  });
}
