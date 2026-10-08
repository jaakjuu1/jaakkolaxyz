import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import { registerRoutes } from "../../server/routes";
import { serveStatic } from "../../server/static";

// After the cutover Caddy sends only Ateneum, the dashboard and /api/contact to this app.
// Everything else (/, /blog, /learn, ...) is the EmDash site in cms/, so Express must
// not answer those paths, not even with an SPA index.html.

const tempDir = mkdtempSync(path.join(os.tmpdir(), "express-split-"));
const distPublic = path.join(tempDir, "dist", "public");
process.env.CONTACT_DB_PATH = path.join(tempDir, "contact-test.db");
delete process.env.RESEND_API_KEY;
delete process.env.CONTACT_TO_EMAIL;
process.env.NODE_ENV = "test";

// A stale SPA index.html at the root must not be served either.
const SPA_MARKER = "SPA-SHELL-MUST-NOT-BE-SERVED";
const ATENEUM_MARKER = "ateneum-static-page";
const DASHBOARD_MARKER = "dashboard-static-page";

let server: Server;
let baseUrl = "";

before(async () => {
  mkdirSync(path.join(distPublic, "ateneum"), { recursive: true });
  mkdirSync(path.join(distPublic, "dashboard"), { recursive: true });
  writeFileSync(path.join(distPublic, "index.html"), `<!doctype html><title>${SPA_MARKER}</title>`);
  writeFileSync(path.join(distPublic, "ateneum", "index.html"), `<!doctype html><title>${ATENEUM_MARKER}</title>`);
  writeFileSync(path.join(distPublic, "dashboard", "index.html"), `<!doctype html><title>${DASHBOARD_MARKER}</title>`);

  // Same order as server/index.ts: body parsers, routes, static pages, 404 by Express.
  const app = express();
  const httpServer = createServer(app);
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  await registerRoutes(httpServer, app);
  serveStatic(app, distPublic);

  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server?.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test("GET / is not served by Express (no SPA index.html)", async () => {
  const res = await fetch(`${baseUrl}/`);
  const body = await res.text();
  assert.equal(res.status, 404);
  assert.ok(!body.includes(SPA_MARKER), "the root index.html must not be served");
});

test("GET /some/unknown returns Express's 404", async () => {
  const res = await fetch(`${baseUrl}/some/unknown`);
  const body = await res.text();
  assert.equal(res.status, 404);
  assert.ok(!body.includes(SPA_MARKER));
});

test("the removed blog API answers 404", async () => {
  for (const url of ["/api/blog/posts", "/api/blog/posts/some-slug"]) {
    const res = await fetch(`${baseUrl}${url}`);
    assert.equal(res.status, 404, url);
  }
});

test("the public site paths that moved to EmDash answer 404", async () => {
  for (const url of ["/blog", "/privacy", "/learn/", "/reports/age-pressure-finland/"]) {
    const res = await fetch(`${baseUrl}${url}`);
    assert.equal(res.status, 404, url);
  }
});

test("GET /ateneum/ serves the Ateneum page from dist/public", async () => {
  const res = await fetch(`${baseUrl}/ateneum/`);
  assert.equal(res.status, 200);
  assert.ok((await res.text()).includes(ATENEUM_MARKER));
});

test("GET /ateneum (no slash) redirects to /ateneum/", async () => {
  const res = await fetch(`${baseUrl}/ateneum`, { redirect: "manual" });
  assert.equal(res.status, 301);
  assert.equal(new URL(res.headers.get("location") ?? "", baseUrl).pathname, "/ateneum/");
});

test("GET /dashboard/ serves the dashboard page from dist/public", async () => {
  const res = await fetch(`${baseUrl}/dashboard/`);
  assert.equal(res.status, 200);
  assert.ok((await res.text()).includes(DASHBOARD_MARKER));
});

test("POST /api/contact is still registered (empty body is rejected with 400, not 404)", async () => {
  const res = await fetch(`${baseUrl}/api/contact`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { success: boolean }).success, false);
});

test("the production entrypoint wires Express the same way the test does", () => {
  const serverIndex = readFileSync(path.resolve("server/index.ts"), "utf8");
  assert.doesNotMatch(serverIndex, /["']\/learn["']/, "/learn is served by the Astro site");
  assert.match(serverIndex, /serveStatic\(app\);/);
  assert.match(serverIndex, /registerRoutes\(httpServer, app\);/);
});

test("the server keeps no blog API and no SPA catch-all", () => {
  const routes = readFileSync(path.resolve("server/routes.ts"), "utf8");
  assert.ok(!routes.includes("/api/blog"), "the blog API is gone");
  assert.ok(!/gray-matter|marked|highlight\.js/.test(routes), "blog helpers are gone");
  const staticSource = readFileSync(path.resolve("server/static.ts"), "utf8");
  assert.doesNotMatch(staticSource, /["'`][^"'`\n]*index\.html["'`]/, "no index.html is served by name");
  assert.ok(!/app\.use\(\s*["']\*["']/.test(staticSource), "no catch-all route");
});

test("the build copies the static pages and no longer builds the React client", () => {
  const build = readFileSync(path.resolve("script/build.ts"), "utf8");
  assert.match(build, /copyDirectoryContents\(\s*["']public-static["']\s*,\s*["']dist\/public["']\s*\)/);
  assert.doesNotMatch(build, /viteBuild|from "vite"/);
});
