import { Client, type ClientChannel } from "ssh2";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * dashboard-ssh.ts — ssh2.Client -wrapperi dashboardin SSH-bundlea varten.
 *
 * Yksi wrapper-API: `runSshBundle(alias, script)` → palauttaa bundlen.
 * Sisäisesti hallitsee yhteyden elinkaaren (connect → exec → end) ja aikakatkaisun.
 *
 * ssh2 EI lue natiivisesti ~/.ssh/config-tiedostoa, joten luemme sen itse
 * (vain tarvittavat kentät: HostName, User, Port, IdentityFile). Tämä
 * mahdollistaa myös aliakset kuten "teppo-server" ja "hostinger".
 *
 * Jos aliasta ei löydy configista eikä hostnamea/useria anneta suoraan,
 * yhteys epäonnistuu selkeästi (ei arvauksia).
 */

export interface SshTarget {
  /** SSH-config-alias, esim. "teppo-server" tai "hostinger". */
  alias: string;
  /** Ylikirjoitettava user */
  username?: string;
  /** Ylikirjoitettava hostname */
  hostname?: string;
  /** Ylikirjoitettava port */
  port?: number;
  /** Polku private keyyn */
  privateKeyPath?: string;
}

export interface SshBundleOptions {
  /** Aikakatkaisu yhteydelle + execille (ms). Oletus 30s. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT = 30_000;
const SSH_CONFIG_PATH =
  process.env.SSH_CONFIG_PATH ||
  path.join(os.homedir(), ".ssh", "config");
const DEFAULT_KEY_HINTS = [
  "~/.ssh/id_ed25519",
  "~/.ssh/id_rsa",
  "~/.ssh/teppo_hetzner",
  "~/.ssh/teppo_mystic",
];

function expandHome(p: string): string {
  if (!p) return p;
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  if (p === "~") return os.homedir();
  return p;
}

// Yksinkertainen SSH-config-jäsennin. Tukee 'Host' -lohkoja, ei tue
// Match-asetusta eikä Include-lauseita (koko /etc/ssh/ssh_config jätetään).
interface SshConfigEntry {
  patterns: string[]; // Host-patternit
  hostname?: string;
  user?: string;
  port?: number;
  identityFiles: string[];
  options: Record<string, string>;
}

function parseSshConfig(content: string): SshConfigEntry[] {
  const entries: SshConfigEntry[] = [];
  let current: SshConfigEntry | null = null;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    const key = parts[0];
    const value = parts.slice(1).join(" ").replace(/^"(.*)"$/, "$1");
    if (key.toLowerCase() === "host") {
      if (current) entries.push(current);
      current = { patterns: parts.slice(1), identityFiles: [], options: {} };
    } else if (current) {
      const k = key.toLowerCase();
      if (k === "hostname") current.hostname = value;
      else if (k === "user") current.user = value;
      else if (k === "port") current.port = parseInt(value, 10);
      else if (k === "identityfile") current.identityFiles.push(value);
      else current.options[k] = value;
    }
  }
  if (current) entries.push(current);
  return entries;
}

let _configCache: SshConfigEntry[] | null = null;
let _configMtime = 0;

function loadSshConfig(): SshConfigEntry[] {
  try {
    const stat = fs.statSync(SSH_CONFIG_PATH);
    if (_configCache && stat.mtimeMs === _configMtime) return _configCache;
    const content = fs.readFileSync(SSH_CONFIG_PATH, "utf-8");
    _configCache = parseSshConfig(content);
    _configMtime = stat.mtimeMs;
    return _configCache;
  } catch {
    _configCache = [];
    _configMtime = 0;
    return _configCache;
  }
}

function patternMatch(pattern: string, alias: string): boolean {
  // OpenSSH-pattern: '*' ja '?' jokerimerkkeinä, '!' negaationa
  if (pattern === alias) return true;
  if (pattern === "*") return true;
  // Muutetaan glob OpenSSH-säännön mukaisesti regex-muotoon
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${regex}$`).test(alias);
}

function lookupSshConfig(
  alias: string,
): { hostname: string; user: string; port: number; identityFile: string | null } | null {
  const config = loadSshConfig();
  let bestEntry: SshConfigEntry | null = null;
  for (const entry of config) {
    for (const p of entry.patterns) {
      if (p.startsWith("!")) continue;
      if (patternMatch(p, alias)) {
        // OpenSSH: tarkempi (epäspesifimpi) pattern voittaa
        if (!bestEntry || p.length > bestEntry.patterns[0].length) {
          bestEntry = entry;
        }
      }
    }
  }
  if (!bestEntry) return null;
  return {
    hostname: bestEntry.hostname || alias,
    user: bestEntry.user || os.userInfo().username,
    port: bestEntry.port || 22,
    identityFile:
      bestEntry.identityFiles.length > 0
        ? expandHome(bestEntry.identityFiles[0])
        : null,
  };
}

function pickKeyFile(forced?: string): string | null {
  const candidates = forced
    ? [expandHome(forced)]
    : DEFAULT_KEY_HINTS.map(expandHome);
  for (const p of candidates) {
    try {
      const st = fs.lstatSync(p);
      if (st.isFile()) return p;
    } catch {
      /* skip */
    }
  }
  return null;
}

async function runExec(
  conn: Client,
  command: string,
  stdinPayload: string | null,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          conn.end();
        } catch {
          /* ignore */
        }
        reject(new Error(`SSH exec timeout after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    conn.exec(command, (err: Error | undefined, channel: ClientChannel) => {
      if (err) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          return reject(err);
        }
        return;
      }
      if (stdinPayload) {
        channel.stdin.write(stdinPayload);
        channel.stdin.end();
      }

      channel.on("data", (data: Buffer) => {
        stdout += data.toString("utf-8");
      });
      channel.stderr.on("data", (data: Buffer) => {
        stderr += data.toString("utf-8");
      });
      channel.on("close", (code: number) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve({ stdout, stderr, code });
        }
      });
      channel.on("error", (e: Error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(e);
        }
      });
    });
  });
}

/**
 * Ajaa SSH:n yli skriptin. Palauttaa koko stdoutin.
 */
export async function sshExec(
  target: SshTarget,
  command: string,
  stdinPayload: string | null,
  opts: SshBundleOptions = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;

  // Selvitä käyttäjä, hostname, port, key joko configista tai suoraan annetuista
  let username = target.username;
  let hostname = target.hostname;
  let port = target.port;
  let keyPath = target.privateKeyPath ? expandHome(target.privateKeyPath) : null;

  if (!hostname || !username) {
    const cfg = lookupSshConfig(target.alias);
    if (cfg) {
      hostname = hostname || cfg.hostname;
      username = username || cfg.user;
      port = port || cfg.port;
      if (!keyPath) keyPath = cfg.identityFile;
    }
  }

  if (!hostname || !username) {
    const hint = process.env.DASHBOARD_LOCAL_SERVER_ALIASES
      ? `DASHBOARD_LOCAL_SERVER_ALIASES on asetettu, mutta alias \"${target.alias}\" ei ole siinä — lisää se`
      : `alias \"${target.alias}\" ei löydy ~/.ssh/configista; jos tämä on sama palvelin jolla dashboard pyörii, aseta DASHBOARD_LOCAL_SERVER_ALIASES=${target.alias} service-tiedostoon)`;
    throw new Error(hint);
  }

  if (!keyPath) {
    const picked = pickKeyFile();
    if (picked) keyPath = picked;
  }

  const connParams: Record<string, unknown> = {
    host: hostname,
    port: port || 22,
    username,
    readyTimeout: timeoutMs,
  };
  if (keyPath) {
    connParams.privateKey = fs.readFileSync(keyPath);
  }

  const conn = new Client();
  return new Promise((resolve, reject) => {
    let resolved = false;
    const connectTimer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try {
          conn.end();
        } catch {
          /* ignore */
        }
        reject(
          new Error(`SSH connect timeout after ${timeoutMs}ms (${username}@${hostname})`),
        );
      }
    }, timeoutMs);

    conn.on("error", (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(connectTimer);
        reject(err);
      }
    });

    conn.on("ready", () => {
      clearTimeout(connectTimer);
      runExec(conn, command, stdinPayload, timeoutMs)
        .then((res) => {
          try {
            conn.end();
          } catch {
            /* ignore */
          }
          if (!resolved) {
            resolved = true;
            resolve(res);
          }
        })
        .catch((err) => {
          try {
            conn.end();
          } catch {
            /* ignore */
          }
          if (!resolved) {
            resolved = true;
            reject(err);
          }
        });
    });

    conn.connect(connParams);
  });
}

/**
 * Ajaa check-server.sh:n SSH:n yli stdin:stä ja parsii JSON-bundlen.
 */
export async function runSshBundle(
  target: SshTarget,
  scriptContent: string,
  opts: SshBundleOptions = {},
): Promise<{ bundle: any; rawStdout: string; stderr: string }> {
  const res = await sshExec(target, "bash -s", scriptContent, opts);
  const rawStdout = res.stdout;

  const MARKER = "JAXXY_BUNDLE_V1";
  const lines = rawStdout.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.startsWith(MARKER));
  if (idx === -1) {
    throw new Error(
      `Bundle marker not found for ${target.alias}. Got ${rawStdout.length} bytes. First 200: ${rawStdout.slice(0, 200)}`,
    );
  }

  let jsonLine: string | null = null;
  for (let i = idx + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l) {
      jsonLine = l;
      break;
    }
  }
  if (!jsonLine) {
    throw new Error(
      `Bundle JSON not found after marker for ${target.alias}. Marker at line ${idx}, total ${lines.length}.`,
    );
  }

  let bundle: any;
  try {
    bundle = JSON.parse(jsonLine);
  } catch (e: any) {
    throw new Error(
      `Bundle JSON parse failed for ${target.alias}: ${e?.message}. Line: ${jsonLine.slice(0, 300)}`,
    );
  }

  return { bundle, rawStdout, stderr: res.stderr };
}
