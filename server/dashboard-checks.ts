import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sites, type HttpCheckDef, type SiteDef } from "./dashboard-sites";
import { dashboardDb, dashboardRawDb, newDashboardId } from "./dashboard-db";
import {
  dashboardSnapshots,
  dashboardSiteReports,
  dashboardAlerts,
} from "@shared/dashboard-schema";
import { generateDashboardReport } from "./dashboard-report";

/**
 * HTTP/API-checkit dashboardille.
 *
 * Vanha malli oli "GET primary_url ja päättele status". Se on liian karkea,
 * koska osa Tepon palveluista on API-only: GET / voi olla 404 vaikka API on
 * täysin terve. Uusi malli ajaa per-kohde checks[]-listan, jossa voidaan
 * odottaa statuskoodia, content-typeä ja yksinkertaista JSON-arvoa.
 *
 * Read-only: EI POST-testaa oikeita liidi-/lomake-endpointtejä ilman erillistä
 * testimoodia. Dashboard ei saa muuttua spämmirobotiksi.
 */

const REQUEST_TIMEOUT_MS = 8000;
const execFileAsync = promisify(execFile);
const CURL_MARKER = "\n__JAXXY_DASHBOARD_CURL_META__";

type Status = "up" | "down" | "degraded" | "auth-protected" | "unknown";

export interface SingleCheckResult {
  id: string;
  label: string;
  url: string;
  method: string;
  status: "pass" | "fail";
  http_status?: number;
  content_type?: string;
  duration_ms: number;
  severity: "critical" | "warn";
  error?: string;
  details: string[];
}

export interface SiteCheckResult {
  site_id: string;
  kind?: SiteDef["kind"];
  status: Status;
  http_status?: number;
  notes: string[];
  check_results: SingleCheckResult[];
}

async function fetchWithTimeout(
  check: HttpCheckDef,
): Promise<{
  status: number;
  contentType: string;
  bodyText: string;
  durationMs: number;
  error?: string;
}> {
  const timeoutMs = check.timeout_ms ?? REQUEST_TIMEOUT_MS;
  const method = check.method ?? "GET";
  const t0 = Date.now();
  const args = [
    "-sS",
    "-L",
    "--max-time",
    String(Math.max(1, Math.ceil(timeoutMs / 1000))),
    "--connect-timeout",
    String(Math.max(1, Math.ceil(timeoutMs / 1000))),
    "-A",
    "jaakkolaxyz-dashboard/0.2",
    "-X",
    method,
    "-w",
    `${CURL_MARKER}%{http_code}\t%{content_type}\t%{time_total}`,
    check.url,
  ];
  if (check.allow_redirects === false) {
    const idx = args.indexOf("-L");
    if (idx >= 0) args.splice(idx, 1);
  }

  let stdout = "";
  let stderr = "";
  let execError: string | undefined;
  try {
    const out = await execFileAsync("curl", args, {
      timeout: timeoutMs + 1500,
      maxBuffer: 2 * 1024 * 1024,
      encoding: "utf8",
    });
    stdout = out.stdout || "";
    stderr = out.stderr || "";
  } catch (err: any) {
    stdout = err?.stdout || "";
    stderr = err?.stderr || "";
    execError = err?.killed
      ? `timeout after ${timeoutMs}ms`
      : stderr.trim() || err?.message || String(err);
  }

  const markerIdx = stdout.lastIndexOf(CURL_MARKER);
  if (markerIdx === -1) {
    return {
      status: 0,
      contentType: "",
      bodyText: stdout,
      durationMs: Date.now() - t0,
      error: execError || stderr.trim() || "curl metadata marker missing",
    };
  }

  const bodyText = stdout.slice(0, markerIdx);
  const meta = stdout.slice(markerIdx + CURL_MARKER.length).trim().split("\t");
  const status = Number.parseInt(meta[0] || "0", 10) || 0;
  const contentType = meta[1] || "";
  const curlTimeSeconds = Number.parseFloat(meta[2] || "0");
  return {
    status,
    contentType,
    bodyText,
    durationMs: curlTimeSeconds > 0 ? Math.round(curlTimeSeconds * 1000) : Date.now() - t0,
    error: execError,
  };
}

function expectedStatusOk(got: number, expected?: number | number[]): boolean {
  if (expected === undefined) return got >= 200 && got < 400;
  if (Array.isArray(expected)) return expected.includes(got);
  return got === expected;
}

function expectedStatusText(expected?: number | number[]): string {
  if (expected === undefined) return "2xx/3xx";
  return Array.isArray(expected) ? expected.join("/") : String(expected);
}

function jsonPathValue(obj: any, path: string): unknown {
  // Riittää dashboardin tarpeisiin: $.status, $.data.status, jne.
  if (!path.startsWith("$.")) return undefined;
  return path
    .slice(2)
    .split(".")
    .reduce((acc: any, key) => (acc == null ? undefined : acc[key]), obj);
}

async function runHttpCheck(check: HttpCheckDef): Promise<SingleCheckResult> {
  const method = check.method ?? "GET";
  const severity = check.severity ?? "critical";
  const res = await fetchWithTimeout(check);
  const details: string[] = [];

  const statusOk = expectedStatusOk(res.status, check.expected_status);
  if (!statusOk) {
    details.push(`HTTP ${res.status || 0}, expected ${expectedStatusText(check.expected_status)}`);
  }

  let contentOk = true;
  if (check.expected_content_type) {
    contentOk = res.contentType.toLowerCase().includes(check.expected_content_type.toLowerCase());
    if (!contentOk) {
      details.push(`content-type ${res.contentType || "(empty)"}, expected ${check.expected_content_type}`);
    }
  }

  let jsonOk = true;
  if (check.json_path) {
    try {
      const parsed = JSON.parse(res.bodyText || "null");
      const got = jsonPathValue(parsed, check.json_path);
      jsonOk = got === check.expected_json_value;
      if (!jsonOk) {
        details.push(`${check.json_path}=${JSON.stringify(got)}, expected ${JSON.stringify(check.expected_json_value)}`);
      }
    } catch (err: any) {
      jsonOk = false;
      details.push(`JSON parse failed: ${err?.message || String(err)}`);
    }
  }

  if (res.error) details.push(res.error);

  const passed = !res.error && statusOk && contentOk && jsonOk;
  if (passed) {
    const extra = check.json_path ? `, ${check.json_path}=${JSON.stringify(check.expected_json_value)}` : "";
    details.push(`ok: HTTP ${res.status}${extra}`);
  }

  return {
    id: check.id,
    label: check.label,
    url: check.url,
    method,
    status: passed ? "pass" : "fail",
    http_status: res.status || undefined,
    content_type: res.contentType || undefined,
    duration_ms: res.durationMs,
    severity,
    error: res.error,
    details,
  };
}

function checksForSite(site: SiteDef): HttpCheckDef[] {
  if (site.checks && site.checks.length > 0) return site.checks;
  if (site.health_url && site.health_url !== site.primary_url) {
    return [
      {
        id: "primary",
        label: "Primary URL",
        url: site.primary_url,
      },
      {
        id: "health",
        label: "Health URL",
        url: site.health_url,
        severity: "warn",
      },
    ];
  }
  return [
    {
      id: "primary",
      label: "Primary URL",
      url: site.primary_url,
    },
  ];
}

function classifySite(site: SiteDef, checks: SingleCheckResult[]): Status {
  if (checks.length === 0) return "unknown";
  const failed = checks.filter((c) => c.status === "fail");
  if (failed.length === 0) return "up";

  const criticalFailures = failed.filter((c) => c.severity !== "warn");
  if (criticalFailures.length > 0) {
    // Legacy fallback: jos ainoa ongelma on 401/403 eikä kohteelle määritelty
    // tarkkaa expected_statusia, se on todennäköisesti auth-suojattu.
    if (
      site.kind === "admin-auth" ||
      criticalFailures.every((c) => c.http_status === 401 || c.http_status === 403)
    ) {
      return "auth-protected";
    }
    return "down";
  }
  return "degraded";
}

export async function checkSite(site: SiteDef): Promise<SiteCheckResult> {
  const checkDefs = checksForSite(site);
  const check_results = await Promise.all(checkDefs.map(runHttpCheck));
  const status = classifySite(site, check_results);
  const primary = check_results[0];

  const notes: string[] = [];
  notes.push(`kind=${site.kind || "website"}`);
  if (site.affects_overall === false) notes.push("excluded from overall status");
  for (const c of check_results) {
    const prefix = c.status === "pass" ? "PASS" : "FAIL";
    notes.push(`${prefix} ${c.label}: ${c.details.join("; ")} (${c.duration_ms}ms)`);
  }

  return {
    site_id: site.id,
    kind: site.kind,
    status,
    http_status: primary?.http_status,
    notes,
    check_results,
  };
}

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = next++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

function acknowledgePreviousAlerts(site: SiteDef): void {
  const ids = [site.id, ...(site.supersedes_ids || [])];
  const stmt = dashboardRawDb.prepare(
    "UPDATE dashboard_alerts SET acknowledged = 1 WHERE acknowledged = 0 AND site_id = ?",
  );
  const tx = dashboardRawDb.transaction((siteIds: string[]) => {
    for (const id of siteIds) stmt.run(id);
  });
  tx(ids);
}

/**
 * Aja kaikki sivustot läpi, tallenna snapshot ja palauta.
 */
export async function runFullCheck(
  source: "manual" | "cron" | "page-load",
): Promise<{ snapshot_id: string; duration_ms: number; overall: "OK" | "WARN" | "CRITICAL" }> {
  const t0 = Date.now();
  const snapshot_id = newDashboardId("snap");

  const results: SiteCheckResult[] = await mapWithLimit(
    sites,
    Number.parseInt(process.env.DASHBOARD_HTTP_CONCURRENCY || "1", 10),
    async (s) => {
      try {
        return await checkSite(s);
      } catch (err: any) {
        return {
          site_id: s.id,
          kind: s.kind,
          status: "unknown" as const,
          notes: [`checkSite threw: ${err?.message || String(err)}`],
          check_results: [],
        };
      }
    },
  );

  const overallResults = results.filter((r) => {
    const site = sites.find((s) => s.id === r.site_id);
    return site?.affects_overall !== false;
  });
  const failed = overallResults.filter((r) => r.status === "down" || r.status === "unknown").length;
  const degraded = overallResults.filter((r) => r.status === "degraded").length;
  const overall: "OK" | "WARN" | "CRITICAL" =
    failed > 0 ? "CRITICAL" : degraded > 0 ? "WARN" : "OK";

  const duration_ms = Date.now() - t0;

  await dashboardDb.insert(dashboardSnapshots).values({
    id: snapshot_id,
    taken_at: Math.floor(t0 / 1000),
    source,
    duration_ms,
    overall_status: overall,
    sites_checked: results.length,
    sites_failed: failed,
  } as any);

  for (const r of results) {
    const site = sites.find((s) => s.id === r.site_id);
    if (!site) continue;

    const markdown = generateDashboardReport(site, r);

    await dashboardDb.insert(dashboardSiteReports).values({
      id: newDashboardId("rep"),
      snapshot_id,
      site_id: r.site_id,
      status: r.status,
      http_status: r.http_status ?? null,
      server_uptime: null,
      disk_free_pct: null,
      memory_used_pct: null,
      container_count: null,
      notes_json: JSON.stringify(r.notes),
      report_markdown: markdown,
    } as any);

    acknowledgePreviousAlerts(site);

    if (site.affects_overall === false) continue;

    if (r.status === "down" || r.status === "unknown") {
      await dashboardDb.insert(dashboardAlerts).values({
        id: newDashboardId("alert"),
        site_id: r.site_id,
        snapshot_id,
        severity: "CRITICAL",
        message: `${site.name} ei vastaa odotetusti (HTTP ${r.http_status ?? "0"})`,
        created_at: Math.floor(Date.now() / 1000),
        acknowledged: 0,
        delivered_telegram: 0,
      } as any);
    } else if (r.status === "degraded") {
      await dashboardDb.insert(dashboardAlerts).values({
        id: newDashboardId("alert"),
        site_id: r.site_id,
        snapshot_id,
        severity: "WARN",
        message: `${site.name} on tilassa ${r.status}: ${r.notes.join("; ")}`,
        created_at: Math.floor(Date.now() / 1000),
        acknowledged: 0,
        delivered_telegram: 0,
      } as any);
    }
  }

  return { snapshot_id, duration_ms, overall };
}
