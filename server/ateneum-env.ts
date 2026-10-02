/**
 * Minimal .env loader (no dotenv dependency).
 * Loads KEY=VALUE from files if the key is not already set in process.env.
 */
import fs from "fs";
import path from "path";

function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const cleaned = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = cleaned.indexOf("=");
    if (eq <= 0) continue;
    const key = cleaned.slice(0, eq).trim();
    let value = cleaned.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadAteneumEnvFiles(cwd = process.cwd()): string[] {
  const files = [".env", ".env.local", ".env.google"];
  const loaded: string[] = [];
  for (const name of files) {
    const full = path.resolve(cwd, name);
    if (!fs.existsSync(full)) continue;
    try {
      const parsed = parseEnvFile(fs.readFileSync(full, "utf8"));
      for (const [key, value] of Object.entries(parsed)) {
        if (process.env[key] === undefined || process.env[key] === "") {
          process.env[key] = value;
        }
      }
      loaded.push(full);
    } catch (err) {
      console.warn(`[ateneum] failed to load env file ${full}:`, err);
    }
  }
  return loaded;
}
