import type { SiteDef } from "./dashboard-sites";
import type { SiteCheckResult } from "./dashboard-checks";

const KIND_LABEL: Record<string, string> = {
  server: "Palvelin",
  website: "Verkkosivu",
  "static-site": "Staattinen sivu",
  "api-health": "API",
  "admin-auth": "Auth/admin",
  staging: "Staging",
  investigate: "Selvityskohde",
};

export function generateDashboardReport(
  site: SiteDef,
  result: SiteCheckResult,
): string {
  const lines: string[] = [];
  lines.push(`# ${site.name}`);
  lines.push("");
  lines.push(`**Tila:** \`${result.status}\``);
  lines.push(`**Tyyppi:** ${KIND_LABEL[site.kind] || site.kind}`);
  if (result.http_status !== undefined) {
    lines.push(`**Ensimmäisen checkin HTTP-status:** ${result.http_status}`);
  }
  if (site.affects_overall === false) {
    lines.push("**Huom:** Tämä kohde näytetään dashboardissa, mutta ei vaikuta kokonaisstatukseen.");
  }
  if (site.notes) {
    lines.push("");
    lines.push(`**Huomautukset:** ${site.notes}`);
  }

  if (site.aliases?.length) {
    lines.push("");
    lines.push("## Aliakset");
    for (const alias of site.aliases) lines.push(`- \`${alias}\``);
  }

  if (result.check_results?.length) {
    lines.push("");
    lines.push("## Tarkistukset");
    for (const c of result.check_results) {
      const ok = c.status === "pass" ? "OK" : "FAIL";
      lines.push(`- **${c.label}** — \`${ok}\` · ${c.method} \`${c.url}\` · HTTP ${c.http_status ?? 0} · ${c.duration_ms} ms`);
      for (const d of c.details) lines.push(`  - ${d}`);
    }
  }

  if (result.notes.length > 0) {
    lines.push("");
    lines.push("## Tarkistuslogi");
    for (const n of result.notes) {
      lines.push(`- ${n}`);
    }
  }

  lines.push("");
  lines.push("## Konfiguraatio");
  lines.push(`- Primary URL: \`${site.primary_url}\``);
  if (site.health_url) lines.push(`- Legacy health URL: \`${site.health_url}\``);
  if (site.ssh_alias) lines.push(`- SSH-alias: \`${site.ssh_alias}\``);
  lines.push(`- Kategoria: \`${site.category}\``);
  lines.push(`- Tyyppi: \`${site.kind}\``);
  lines.push(`- Vaikuttaa overall-statukseen: \`${site.affects_overall === false ? "ei" : "kyllä"}\``);
  lines.push("");
  lines.push("---");
  lines.push("*Dashboard v0.2: typed HTTP/API checks. SSH-bundle täydentää palvelinentryjä erillisessä vaiheessa.*");
  return lines.join("\n");
}
