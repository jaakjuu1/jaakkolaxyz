import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";

// The dashboard was once lost from production because its wiring lived only in
// the server's copy of server/index.ts. These tests keep it in the repo.

const tempDir = mkdtempSync(path.join(os.tmpdir(), "dashboard-wiring-"));
process.env.DASHBOARD_DB_PATH = path.join(tempDir, "dashboard-test.db");
delete process.env.DASHBOARD_API_TOKEN;
process.env.NODE_ENV = "test";

let baseUrl = "";
let server: ReturnType<express.Express["listen"]>;

before(async () => {
  const { initDashboardSchema } = await import("../../server/dashboard-db");
  const { registerDashboardRoutes } = await import("../../server/dashboard-routes");
  initDashboardSchema();
  const app = express();
  registerDashboardRoutes(app);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test("production entrypoint initialises the dashboard and registers its routes before the SPA fallback", () => {
  const serverIndex = readFileSync(path.resolve("server/index.ts"), "utf8");
  assert.match(serverIndex, /import\s*\{\s*initDashboardSchema\s*\}\s*from\s*["']\.\/dashboard-db["']/);
  assert.match(serverIndex, /import\s*\{\s*registerDashboardRoutes\s*\}\s*from\s*["']\.\/dashboard-routes["']/);
  const init = serverIndex.indexOf("initDashboardSchema();");
  const register = serverIndex.indexOf("registerDashboardRoutes(app);");
  const spaFallback = serverIndex.indexOf("serveStatic(app)");
  assert.ok(init >= 0, "initDashboardSchema() must be called");
  assert.ok(register > init, "registerDashboardRoutes(app) must follow the schema init");
  assert.ok(spaFallback > register, "the SPA fallback must not swallow /api/dashboard/*");
});

test("dashboard failures cannot stop the site from starting", () => {
  const serverIndex = readFileSync(path.resolve("server/index.ts"), "utf8");
  const tryStart = serverIndex.lastIndexOf("try {", serverIndex.indexOf("initDashboardSchema();"));
  const catchStart = serverIndex.indexOf("catch", serverIndex.indexOf("registerDashboardRoutes(app);"));
  assert.ok(tryStart >= 0 && catchStart > tryStart, "dashboard init must sit inside try/catch");
});

test("GET /api/dashboard/sites lists the monitored sites", async () => {
  const res = await fetch(`${baseUrl}/api/dashboard/sites`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { sites: Array<{ id: string; category: string }> };
  assert.ok(Array.isArray(body.sites) && body.sites.length > 0);
  const categories = new Set(body.sites.map((s) => s.category));
  assert.ok(categories.has("teppo") && categories.has("hostinger"));
});

test("GET /api/dashboard/snapshot answers with an empty snapshot on a fresh database", async () => {
  const res = await fetch(`${baseUrl}/api/dashboard/snapshot`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { snapshot: unknown };
  assert.equal(body.snapshot, null);
});

test("the token gate applies when DASHBOARD_API_TOKEN is set", async () => {
  process.env.DASHBOARD_API_TOKEN = "secret-for-test";
  try {
    const denied = await fetch(`${baseUrl}/api/dashboard/snapshot`);
    assert.equal(denied.status, 401);
    const allowed = await fetch(`${baseUrl}/api/dashboard/snapshot`, {
      headers: { "x-dashboard-token": "secret-for-test" },
    });
    assert.equal(allowed.status, 200);
  } finally {
    delete process.env.DASHBOARD_API_TOKEN;
  }
});
