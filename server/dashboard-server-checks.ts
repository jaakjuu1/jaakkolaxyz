import fs from "fs";
import path from "path";
import { spawn } from "node:child_process";
import { runSshBundle, type SshTarget } from "./dashboard-ssh";
import { sites, type SiteDef } from "./dashboard-sites";
import { dashboardDb, dashboardRawDb, newDashboardId } from "./dashboard-db";
import {
  dashboardSnapshots,
  dashboardSiteReports,
  dashboardAlerts,
} from "@shared/dashboard-schema";
import { generateDashboardReport } from "./dashboard-report";

/**
 * Vaihe 1 -tason server-checkit. SSH-bundle ajetaan jokaiselle
 * palvelin-kategorian entrylle (hostinger-server, teppo-server),
 * ja saatu data tallennetaan dashboard_site_reports-riviin.
 *
 * Vaiheessa 0 HTTP-tarkistukset vastasivat kaikista entryistä.
 * Nyt server-entryt saavat erillisen SSH-tarkistuksen, ja niille
 * generoituu myös laajempi markdown-raportti.
 *
 * SSH-ajo onnistuu kunhan node-moduulit on asennettu (ssh2).
 * SSH-key löytyy automaattisesti ~/.ssh/-hakemistosta.
 */

const SCRIPT_PATH = path.resolve(
  process.cwd(),
  "server",
  "check-server.sh",
);

function localServerAliases(): Set<string> {
  return new Set(
    (process.env.DASHBOARD_LOCAL_SERVER_ALIASES || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function shouldRunLocally(site: SiteDef): boolean {
  return !!site.ssh_alias && localServerAliases().has(site.ssh_alias);
}

function parseBundleFromStdout(rawStdout: string, label: string): any {
  const marker = "JAXXY_BUNDLE_V1";
  const lines = rawStdout.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.startsWith(marker));
  if (idx === -1) {
    throw new Error(
      `Bundle marker not found for ${label}. Got ${rawStdout.length} bytes. First 200: ${rawStdout.slice(0, 200)}`,
    );
  }
  for (let i = idx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    return JSON.parse(line);
  }
  throw new Error(`Bundle JSON not found after marker for ${label}`);
}

async function runLocalBundle(script: string, label: string, timeoutMs = 30_000): Promise<{ bundle: any; rawStdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-s"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`local resource check timeout after ${timeoutMs}ms for ${label}`));
    }, timeoutMs);

    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf-8")));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf-8")));
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`local resource check exited ${code}; stderr=${stderr.slice(0, 300)}`));
        return;
      }
      try {
        resolve({ bundle: parseBundleFromStdout(stdout, label), rawStdout: stdout, stderr });
      } catch (err) {
        reject(err);
      }
    });
    child.stdin.write(script);
    child.stdin.end();
  });
}

function sshTargetForSite(site: SiteDef): SshTarget | null {
  if (!site.ssh_alias) return null;
  // Aliasten host+user tiedot tulevat ~/.ssh/configista ssh2:n toimesta.
  // Tässä vaiheessa luotamme siihen, että kaikki tarvittavat hostit ovat
  // config-tiedostossa.
  // Ylikirjoitettavat keyt voidaan antaa halutessa myöhemmin.
  // Port: oletus 22, mutta jksaumaus-hosting käyttää 5757 — emme kuitenkaan
  // seuraa sitä vielä SSH:n yli.
  return {
    alias: site.ssh_alias,
  };
}

export interface ServerCheckResult {
  site_id: string;
  ok: boolean;
  bundle?: any;
  rawStdout?: string;
  error?: string;
  duration_ms: number;
}

/**
 * Aja SSH-bundle yhdelle palvelimelle.
 */
export async function checkServer(site: SiteDef): Promise<ServerCheckResult> {
  const t0 = Date.now();
  const target = sshTargetForSite(site);
  if (!target) {
    return {
      site_id: site.id,
      ok: false,
      error: "no ssh_alias",
      duration_ms: Date.now() - t0,
    };
  }

  let script: string;
  try {
    script = fs.readFileSync(SCRIPT_PATH, "utf-8");
  } catch (e: any) {
    return {
      site_id: site.id,
      ok: false,
      error: `cannot read ${SCRIPT_PATH}: ${e?.message}`,
      duration_ms: Date.now() - t0,
    };
  }

  try {
    if (shouldRunLocally(site)) {
      const { bundle, rawStdout } = await runLocalBundle(
        script,
        site.ssh_alias || site.id,
        30_000,
      );
      return {
        site_id: site.id,
        ok: true,
        bundle,
        rawStdout,
        duration_ms: Date.now() - t0,
      };
    }

    const { bundle, rawStdout } = await runSshBundle(
      target,
      script,
      { timeoutMs: 30_000 },
    );
    return {
      site_id: site.id,
      ok: true,
      bundle,
      rawStdout,
      duration_ms: Date.now() - t0,
    };
  } catch (e: any) {
    return {
      site_id: site.id,
      ok: false,
      error: e?.message || String(e),
      duration_ms: Date.now() - t0,
    };
  }
}

/**
 * Aja kaikkien palvelin-entryiden SSH-checkit, generoi raportit, ja
 * tallentaa dashboard_site_reports-tauluun. Tämä ajetaan HTTP-checkien
 * rinnalla — ei korvaa niitä, vaan täydentää niitä server-entryeille.
 */
export async function runAllServerChecks(
  snapshotId: string,
): Promise<{ results: ServerCheckResult[]; failed: number; degraded: number }> {
  const serverEntries = sites.filter(
    (s) => s.ssh_alias && s.id.endsWith("-server"),
  );

  const results = await Promise.all(
    serverEntries.map(async (s) => {
      const result = await checkServer(s);
      try {
        await persistServerReport(snapshotId, s, result);
      } catch (e: any) {
        console.error(
          `[dashboard-server-checks] persist failed for ${s.id}: ${e?.message || e}`,
        );
      }
      return result;
    }),
  );

  const failed = results.filter((r) => !r.ok).length;
  const degraded = results.filter((r) => {
    const b = r.bundle || {};
    return r.ok && (
      (typeof b.disk_used_pct === "number" && b.disk_used_pct > 90) ||
      (typeof b.memory_used_pct === "number" && b.memory_used_pct > 95) ||
      (typeof b.failed_services_count === "number" && b.failed_services_count > 0) ||
      (Array.isArray(b.restart_loops) && b.restart_loops.length > 0)
    );
  }).length;
  return { results, failed, degraded };
}

async function persistServerReport(
  snapshotId: string,
  site: SiteDef,
  result: ServerCheckResult,
): Promise<void> {
  const bundle = result.bundle || {};
  const httpStatus = result.ok ? 200 : null; // SSH/local resource check succeeded = effective 200

  // Status-kenttä: jos SSH epäonnistui, se on "down". Muuten "up" ellei
  // kriittisiä indikaattoreita.
  let status: "up" | "down" | "degraded" = "up";
  const notes: string[] = [];

  if (!result.ok) {
    status = "down";
    notes.push(`SSH failed: ${result.error}`);
  } else {
    // Disk-over-90% → degraded
    if (typeof bundle.disk_used_pct === "number" && bundle.disk_used_pct > 90) {
      status = "degraded";
      notes.push(`disk used ${bundle.disk_used_pct}%`);
    }
    // Memory over 95% → degraded
    if (
      typeof bundle.memory_used_pct === "number" &&
      bundle.memory_used_pct > 95
    ) {
      status = "degraded";
      notes.push(`memory used ${bundle.memory_used_pct}%`);
    }
    // Failed systemd services → degraded
    if (
      typeof bundle.failed_services_count === "number" &&
      bundle.failed_services_count > 0
    ) {
      status = "degraded";
      notes.push(`${bundle.failed_services_count} failed systemd units`);
    }
    // Restart-loops → degraded
    if (
      Array.isArray(bundle.restart_loops) &&
      bundle.restart_loops.length > 0
    ) {
      status = "degraded";
      notes.push(
        `${bundle.restart_loops.length} containers in restart loop`,
      );
    }
  }

  // Luo markdown-raportti — laajempi kuin vaihe 0.
  const report = generateServerReport(site, result, bundle, notes, status);

  // HTTP-check loi samalle snapshotille server-entryn perusraportin. Korvaa se
  // resource-raportilla, jotta snapshot API:ssa on täsmälleen yksi raportti per site_id.
  dashboardRawDb
    .prepare("DELETE FROM dashboard_site_reports WHERE snapshot_id = ? AND site_id = ?")
    .run(snapshotId, site.id);
  dashboardRawDb
    .prepare("UPDATE dashboard_alerts SET acknowledged = 1 WHERE acknowledged = 0 AND site_id = ?")
    .run(site.id);

  await dashboardDb.insert(dashboardSiteReports).values({
    id: newDashboardId("rep"),
    snapshot_id: snapshotId,
    site_id: site.id,
    status,
    http_status: httpStatus,
    server_uptime: bundle.uptime || null,
    disk_free_pct:
      typeof bundle.disk_free_pct === "number"
        ? bundle.disk_free_pct
        : typeof bundle.disk_used_pct === "number"
          ? 100 - bundle.disk_used_pct
          : null,
    memory_used_pct:
      typeof bundle.memory_used_pct === "number"
        ? bundle.memory_used_pct
        : null,
    container_count:
      typeof bundle.container_count === "number" ? bundle.container_count : null,
    notes_json: JSON.stringify(notes),
    report_markdown: report,
  } as any);

  // Alertit
  if (status === "down") {
    await dashboardDb.insert(dashboardAlerts).values({
      id: newDashboardId("alert"),
      site_id: site.id,
      snapshot_id: snapshotId,
      severity: "CRITICAL",
      message: `${site.name}: SSH-check epäonnistui — ${result.error || "unknown error"}`,
      created_at: Math.floor(Date.now() / 1000),
      acknowledged: 0,
      delivered_telegram: 0,
    } as any);
  } else if (status === "degraded") {
    await dashboardDb.insert(dashboardAlerts).values({
      id: newDashboardId("alert"),
      site_id: site.id,
      snapshot_id: snapshotId,
      severity: "WARN",
      message: `${site.name}: ${notes.join("; ")}`,
      created_at: Math.floor(Date.now() / 1000),
      acknowledged: 0,
      delivered_telegram: 0,
    } as any);
  }
}

function generateServerReport(
  site: SiteDef,
  result: ServerCheckResult,
  bundle: any,
  notes: string[],
  status: string,
): string {
  const lines: string[] = [];
  lines.push(`# ${site.name} — SSH-check`);
  lines.push("");
  lines.push(`**Tila:** \`${status}\``);
  lines.push(
    `**Aika:** ${new Date((bundle?.ts || Date.now() / 1000) * 1000).toISOString()}`,
  );
  lines.push(`**SSH-alias:** \`${site.ssh_alias}\``);
  lines.push(`**Kesto:** ${result.duration_ms} ms`);
  lines.push("");
  lines.push("## Järjestelmä");
  if (bundle.kernel) lines.push(`- **Kernel:** \`${bundle.kernel}\``);
  if (bundle.os) lines.push(`- **OS:** \`${bundle.os}\``);
  if (bundle.uptime) lines.push(`- **Uptime:** \`${bundle.uptime}\``);
  if (bundle.loadavg) lines.push(`- **Load avg:** \`${bundle.loadavg}\``);
  lines.push("");
  lines.push("## Resurssit");
  if (typeof bundle.disk_used_pct === "number") {
    lines.push(
      `- **Levy (juuri):** ${bundle.disk_used_pct}% käytössä (${100 - bundle.disk_used_pct}% vapaana)`,
    );
  }
  if (typeof bundle.memory_used_pct === "number") {
    lines.push(`- **Muisti:** ${bundle.memory_used_pct}% käytössä`);
  }
  lines.push("");
  lines.push("## Docker-kontit");
  if (typeof bundle.container_count === "number") {
    lines.push(`- **Juoksevia:** ${bundle.container_count}`);
  }
  if (Array.isArray(bundle.containers) && bundle.containers.length > 0) {
    lines.push("");
    lines.push("| Nimi | Tila | Image |");
    lines.push("|---|---|---|");
    for (const c of bundle.containers) {
      lines.push(`| ${c.name} | ${c.state} | \`${c.image}\` |`);
    }
  }
  if (
    Array.isArray(bundle.restart_loops) &&
    bundle.restart_loops.length > 0
  ) {
    lines.push("");
    lines.push("## ⚠ Restart-loops");
    lines.push("| Kontti | Restart count | Tila |");
    lines.push("|---|---|---|");
    for (const r of bundle.restart_loops) {
      lines.push(
        `| ${r.name} | ${r.restart_count} | ${r.status} |`,
      );
    }
  }
  if (typeof bundle.failed_services_count === "number") {
    lines.push("");
    lines.push(`## Systemd: ${bundle.failed_services_count} epäonnistunutta yksikköä`);
  }
  if (notes.length > 0) {
    lines.push("");
    lines.push("## Huomiot");
    for (const n of notes) lines.push(`- ${n}`);
  }
  if (!result.ok && result.error) {
    lines.push("");
    lines.push("## Virhe");
    lines.push("```");
    lines.push(result.error);
    lines.push("```");
  }
  return lines.join("\n");
}

/**
 * CLI-kutsu: aja checkit kerran, tulosta yhteenveto.
 * Käyttö: tsx server/dashboard-server-checks.ts run-once
 */
if (
  typeof process !== "undefined" &&
  process.argv[1]?.endsWith("dashboard-server-checks.ts")
) {
  (async () => {
    const { initDashboardSchema } = await import("./dashboard-db");
    initDashboardSchema();

    console.log(`[dashboard-server-checks] running SSH bundle checks...`);
    const snapId = newDashboardId("snap");
    const t0 = Date.now();
    await dashboardDb.insert(dashboardSnapshots).values({
      id: snapId,
      taken_at: Math.floor(t0 / 1000),
      source: "cli",
      duration_ms: 0,
      overall_status: "OK",
      sites_checked: 0,
      sites_failed: 0,
    } as any);
    const { results, failed } = await runAllServerChecks(snapId);
    const duration_ms = Date.now() - t0;
    const overall =
      failed > 0 ? "CRITICAL" : results.some((r) => r.bundle?.failed_services_count > 0) ? "WARN" : "OK";
    await dashboardDb
      .update(dashboardSnapshots)
      .set({ duration_ms, overall_status: overall, sites_checked: results.length, sites_failed: failed } as any)
      .where(eq_(dashboardSnapshots.id, snapId));
    console.log(
      `[dashboard-server-checks] ${results.length} palvelinta, ${failed} epäonnistui, kesto ${duration_ms} ms, overall=${overall}`,
    );
    for (const r of results) {
      if (r.ok && r.bundle) {
        console.log(
          `  ✓ ${r.site_id}: uptime=${r.bundle.uptime}, disk_used=${r.bundle.disk_used_pct}%, mem=${r.bundle.memory_used_pct}%, containers=${r.bundle.container_count}`,
        );
      } else {
        console.log(`  ✗ ${r.site_id}: ${r.error}`);
      }
    }
    process.exit(failed > 0 ? 1 : 0);
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

import { eq } from "drizzle-orm";
function eq_(a: any, b: any) {
  return eq(a, b);
}
