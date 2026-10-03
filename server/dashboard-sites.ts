/**
 * Kovakoodattu lista seurattavista kohteista.
 *
 * Dashboard ei voi olettaa, että jokainen kohde on verkkosivu ja GET / kertoo
 * kaiken. Tepon puolella on myös API-only-palveluja, Basic Auth -suojattuja
 * admin-pintoja, staattisia sivuja, aliaksia ja staging-kohteita.
 *
 * Malli on silti tietoisesti yksinkertainen: kovakoodattu lista + per-kohde
 * checks[]. Ei DB-migraatiota tässä vaiheessa.
 */

export type SiteCategory = "hostinger" | "teppo" | "kuukilab" | "other";

export type SiteKind =
  | "server"
  | "website"
  | "static-site"
  | "api-health"
  | "admin-auth"
  | "staging"
  | "investigate";

export type CheckMethod = "GET" | "HEAD" | "POST";
export type CheckSeverity = "critical" | "warn";

export interface HttpCheckDef {
  id: string;
  label: string;
  method?: CheckMethod;
  url: string;
  expected_status?: number | number[];
  expected_content_type?: string;
  json_path?: string;
  expected_json_value?: string | number | boolean;
  allow_redirects?: boolean;
  timeout_ms?: number;
  severity?: CheckSeverity;
}

export interface SiteDef {
  id: string;
  name: string;
  category: SiteCategory;
  kind: SiteKind;
  ssh_alias?: "hostinger" | "teppo-server" | "teppo-mystic" | "kuukilab";
  primary_url: string;
  health_url?: string; // legacy fallback; prefer checks[] for new targets
  checks?: HttpCheckDef[];
  aliases?: string[];
  notes?: string;
  /** false = näytetään dashboardissa, mutta ei nosta overall-tilaa/alerttia */
  affects_overall?: boolean;
  /** Vanhoja site_id:itä, joiden alertit kuitataan tämän kohteen uudella statuksella. */
  supersedes_ids?: string[];
}

export const sites: SiteDef[] = [
  // ============ TEPPO: server / infra ============
  {
    id: "teppo-server",
    name: "Teppo-palvelin",
    category: "teppo",
    kind: "server",
    ssh_alias: "teppo-server",
    primary_url: "https://jaakkola.xyz",
    notes: "Itse palvelin: uptime, levytila, muisti, Docker. SSH-bundle täydentää tämän.",
    checks: [
      {
        id: "main-site-reachable",
        label: "jaakkola.xyz reachable",
        url: "https://jaakkola.xyz/",
        expected_status: 200,
        expected_content_type: "text/html",
      },
    ],
  },
  {
    id: "teppo-admin",
    name: "teppo.jaakkola.xyz",
    category: "teppo",
    kind: "admin-auth",
    ssh_alias: "teppo-server",
    primary_url: "https://teppo.jaakkola.xyz",
    notes: "Basic Auth -suojattu admin/työkalupinta. 401 ilman tunnuksia on terve tila.",
    checks: [
      {
        id: "basic-auth-wall",
        label: "Basic Auth wall",
        url: "https://teppo.jaakkola.xyz/",
        expected_status: 401,
      },
    ],
  },

  // ============ TEPPO: varsinaiset verkkosivut ============
  {
    id: "hpsp",
    name: "hpsp.fi",
    category: "teppo",
    kind: "website",
    ssh_alias: "teppo-server",
    primary_url: "https://hpsp.fi",
    aliases: ["https://www.hpsp.fi", "https://hpsp.jaakkola.xyz"],
    notes: "Staattinen HPSP-sivusto. Lead-API kulkee Hermes/FastAPI-prosessin kautta; sitä ei POST-testata ilman testimoodia.",
    checks: [
      {
        id: "homepage",
        label: "Etusivu",
        url: "https://hpsp.fi/",
        expected_status: 200,
        expected_content_type: "text/html",
      },
      {
        id: "www-alias",
        label: "www-alias",
        url: "https://www.hpsp.fi/",
        expected_status: 200,
        expected_content_type: "text/html",
        severity: "warn",
      },
      {
        id: "jaakkola-alias",
        label: "jaakkola-alias",
        url: "https://hpsp.jaakkola.xyz/",
        expected_status: 200,
        expected_content_type: "text/html",
        severity: "warn",
      },
    ],
  },
  {
    id: "mysticmasterpieces",
    name: "mysticmasterpieces.com",
    category: "teppo",
    kind: "website",
    ssh_alias: "teppo-server",
    primary_url: "https://mysticmasterpieces.com",
    affects_overall: false,
    notes: "WordPress 6.x + WooCommerce + MariaDB. Domain on .com, ei .fi. WP-kontti pysäytetty 2026-09-15 OOM-myrskyn (apache2 ~450 MB/prosessi) jälkeen; jatko päätettävä. www-osoitteella ei ole DNS-tietuetta.",
    checks: [
      {
        id: "homepage",
        label: "Etusivu",
        url: "https://mysticmasterpieces.com/",
        expected_status: 200,
        expected_content_type: "text/html",
      },
    ],
  },
  {
    id: "lahituottajatori",
    name: "lahituottajatori.fi",
    category: "hostinger",
    kind: "website",
    ssh_alias: "hostinger",
    primary_url: "https://lahituottajatori.fi",
    aliases: ["https://www.lahituottajatori.fi"],
    notes: "Siirretty Hostingerille (DNS osoittaa 62.72.20.134); Teppon Caddy-lohko poistettiin 2026-10-03.",
    checks: [
      { id: "homepage", label: "Etusivu", url: "https://lahituottajatori.fi/", expected_status: 200, expected_content_type: "text/html" },
      { id: "www-alias", label: "www-alias", url: "https://www.lahituottajatori.fi/", expected_status: 200, expected_content_type: "text/html", severity: "warn" },
    ],
  },
  {
    id: "ordops",
    name: "ordops.jaakkola.xyz",
    category: "teppo",
    kind: "website",
    ssh_alias: "teppo-server",
    primary_url: "https://ordops.jaakkola.xyz",
    notes: "Staattinen ordops-sivu. Sovellus (app.ordops) arkistoitiin 2026-10-03: sillä ei ollut DNS-tietuetta eikä ajossa olevaa upstreamia.",
    checks: [
      { id: "public-site", label: "Public site", url: "https://ordops.jaakkola.xyz/", expected_status: 200, expected_content_type: "text/html" },
    ],
  },
  {
    id: "siteforge",
    name: "siteforge.jaakkola.xyz",
    category: "teppo",
    kind: "static-site",
    ssh_alias: "teppo-server",
    primary_url: "https://siteforge.jaakkola.xyz",
    checks: [
      { id: "homepage", label: "Etusivu", url: "https://siteforge.jaakkola.xyz/", expected_status: 200, expected_content_type: "text/html" },
    ],
  },
  {
    id: "mc",
    name: "mc.jaakkola.xyz",
    category: "teppo",
    kind: "static-site",
    ssh_alias: "teppo-server",
    primary_url: "https://mc.jaakkola.xyz",
    notes: "Mission Control -staattinen pinta.",
    checks: [
      { id: "homepage", label: "Etusivu", url: "https://mc.jaakkola.xyz/", expected_status: 200, expected_content_type: "text/html" },
    ],
  },
  {
    id: "guide",
    name: "guide.jaakkola.xyz",
    category: "teppo",
    kind: "static-site",
    ssh_alias: "teppo-server",
    primary_url: "https://guide.jaakkola.xyz",
    checks: [
      { id: "homepage", label: "Etusivu", url: "https://guide.jaakkola.xyz/", expected_status: 200, expected_content_type: "text/html" },
    ],
  },
  {
    id: "bid",
    name: "bid.jaakkola.xyz",
    category: "teppo",
    kind: "website",
    ssh_alias: "teppo-server",
    primary_url: "https://bid.jaakkola.xyz",
    checks: [
      { id: "homepage", label: "Etusivu", url: "https://bid.jaakkola.xyz/", expected_status: 200, expected_content_type: "text/html" },
    ],
  },
  {
    id: "valve",
    name: "valve.jaakkola.xyz",
    category: "teppo",
    kind: "website",
    ssh_alias: "teppo-server",
    primary_url: "https://valve.jaakkola.xyz",
    checks: [
      { id: "homepage", label: "Etusivu", url: "https://valve.jaakkola.xyz/", expected_status: 200, expected_content_type: "text/html" },
    ],
  },
  {
    id: "ufo-jaakkola",
    name: "ufo.jaakkola.xyz",
    category: "teppo",
    kind: "website",
    ssh_alias: "teppo-server",
    primary_url: "https://ufo.jaakkola.xyz",
    notes: "Tepon ufo-sightings-sovellus (eri kuin Hostingerin staging).",
    checks: [
      { id: "homepage", label: "Etusivu", url: "https://ufo.jaakkola.xyz/", expected_status: 200, expected_content_type: "text/html" },
    ],
  },

  // ============ TEPPO: API-only / API-first ============
  {
    id: "aro-api",
    name: "AI Revenue Operator API",
    category: "teppo",
    kind: "api-health",
    ssh_alias: "teppo-server",
    primary_url: "https://aro.jaakkola.xyz",
    notes: "API-only-palvelu. GET / palauttaa 404 eikä se ole vika; health on /api/v1/health.",
    supersedes_ids: ["aro"],
    checks: [
      {
        id: "health",
        label: "API health",
        url: "https://aro.jaakkola.xyz/api/v1/health",
        expected_status: 200,
        expected_content_type: "application/json",
        json_path: "$.status",
        expected_json_value: "ok",
      },
    ],
  },
  {
    id: "verify-api",
    name: "verify.jaakkola.xyz",
    category: "teppo",
    kind: "api-health",
    ssh_alias: "teppo-server",
    primary_url: "https://verify.jaakkola.xyz",
    notes: "ContentVerify API; root palauttaa HTML-dokumentaatiopinnan.",
    checks: [
      { id: "root", label: "API root/docs", url: "https://verify.jaakkola.xyz/", expected_status: 200, expected_content_type: "text/html" },
    ],
  },

  // ============ TEPPO: staging / selvitystä vaativat ============
  {
    id: "siteforge-staging-toejoki",
    name: "toejoki.staging.siteforge.jaakkola.xyz",
    category: "teppo",
    kind: "staging",
    ssh_alias: "teppo-server",
    primary_url: "https://toejoki.staging.siteforge.jaakkola.xyz",
    affects_overall: false,
    checks: [
      { id: "homepage", label: "Staging homepage", url: "https://toejoki.staging.siteforge.jaakkola.xyz/", expected_status: 200, expected_content_type: "text/html" },
    ],
  },

  // ============ HOSTINGER (production) ============
  {
    id: "hostinger-server",
    name: "Hostinger-palvelin",
    category: "hostinger",
    kind: "server",
    ssh_alias: "hostinger",
    primary_url: "https://posti.arvobitti.fi",
    notes: "Itse palvelin: uptime, levytila, muisti, Docker. SSH-bundle täydentää tämän.",
    checks: [
      { id: "primary-app", label: "Primary app reachable", url: "https://posti.arvobitti.fi/", expected_status: 200, expected_content_type: "text/html" },
    ],
  },
  {
    id: "posti-arvobitti",
    name: "posti.arvobitti.fi",
    category: "hostinger",
    kind: "website",
    ssh_alias: "hostinger",
    primary_url: "https://posti.arvobitti.fi",
    notes: "Cold email / outreach -sovellus. Backend API: api.arvobitti.fi",
    checks: [
      { id: "frontend", label: "Frontend", url: "https://posti.arvobitti.fi/", expected_status: 200, expected_content_type: "text/html" },
      { id: "api-health", label: "API health", url: "https://api.arvobitti.fi/health", expected_status: 200, expected_content_type: "application/json", severity: "warn" },
    ],
  },
  {
    id: "huoletonarki360",
    name: "huoletonarki360.fi",
    category: "hostinger",
    kind: "website",
    ssh_alias: "hostinger",
    primary_url: "https://huoletonarki360.fi",
    checks: [
      { id: "homepage", label: "Etusivu", url: "https://huoletonarki360.fi/", expected_status: 200, expected_content_type: "text/html" },
    ],
  },
  {
    id: "jksaumaukset",
    name: "jksaumaukset.fi",
    category: "hostinger",
    kind: "website",
    ssh_alias: "hostinger",
    primary_url: "https://jksaumaukset.fi",
    notes: "Sisältää app.jksaumaukset.fi ja viestit.jksaumaukset.fi",
    checks: [
      { id: "homepage", label: "Etusivu", url: "https://jksaumaukset.fi/", expected_status: 200, expected_content_type: "text/html" },
    ],
  },
  {
    id: "streams-records",
    name: "cam.arvobitti.fi",
    category: "hostinger",
    kind: "website",
    ssh_alias: "hostinger",
    primary_url: "https://cam.arvobitti.fi",
    notes: "react-web-stream / streams-records",
    checks: [
      { id: "homepage", label: "Etusivu", url: "https://cam.arvobitti.fi/", expected_status: 200, expected_content_type: "text/html" },
    ],
  },
  {
    id: "etherconnect",
    name: "o.valuebit.net",
    category: "hostinger",
    kind: "website",
    ssh_alias: "hostinger",
    primary_url: "https://o.valuebit.net",
    notes: "Serene Soundscapes / etherconnect",
    checks: [
      { id: "homepage", label: "Etusivu", url: "https://o.valuebit.net/", expected_status: 200, expected_content_type: "text/html" },
    ],
  },
  {
    id: "jks-manager",
    name: "jks-manager (staging-jks-manager.arvobitti.fi)",
    category: "hostinger",
    kind: "staging",
    ssh_alias: "hostinger",
    primary_url: "https://staging-jks-manager.arvobitti.fi",
    affects_overall: false,
    notes: "Seurataan staging-domainia, koska tuotanto ei ole vielä julkinen.",
    checks: [
      { id: "homepage", label: "Staging homepage / auth wall", url: "https://staging-jks-manager.arvobitti.fi/", expected_status: [200, 401] },
    ],
  },
];

export function siteById(id: string): SiteDef | undefined {
  return sites.find((s) => s.id === id);
}
