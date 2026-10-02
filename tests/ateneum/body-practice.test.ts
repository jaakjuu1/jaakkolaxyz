import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";

const tempDir = mkdtempSync(path.join(os.tmpdir(), "ateneum-body-"));
process.env.ATENEUM_DB_PATH = path.join(tempDir, "ateneum-test.db");
process.env.ATENEUM_JUUSO_PASSWORD = "test-juuso-password";
process.env.ATENEUM_HENNA_PASSWORD = "test-henna-password";
process.env.ATENEUM_BOT_PASSWORD = "test-bot-password";
process.env.ATENEUM_CALENDAR_BACKEND = "off";
process.env.NODE_ENV = "test";
// No AWS → emails skip send but functions still return skipped/false without throw
delete process.env.AWS_ACCESS_KEY_ID;
delete process.env.AWS_SECRET_ACCESS_KEY;

let baseUrl = "";
let server: ReturnType<express.Express["listen"]>;
let rawDb: any;
let juusoCookie = "";
let hennaCookie = "";
let botCookie = "";

async function request(
  pathname: string,
  options: { method?: string; cookie?: string; body?: unknown } = {},
) {
  return fetch(baseUrl + pathname, {
    method: options.method ?? "GET",
    headers: {
      Accept: "application/json",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: "manual",
  });
}

async function login(username: string, password: string) {
  const response = await request("/api/ateneum/auth/login", {
    method: "POST",
    body: { username, password },
  });
  assert.equal(response.status, 200);
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie);
  return setCookie.split(";", 1)[0];
}

before(async () => {
  const db = await import("../../server/ateneum-db");
  const auth = await import("../../server/ateneum-auth");
  const schema = await import("../../shared/ateneum-schema");
  const routes = await import("../../server/ateneum-routes");

  db.initAteneumSchema();
  db.migrateAteneumSchema();
  rawDb = db.ateneumRawDb;

  await db.ateneumDb.insert(schema.ateneumUsers).values([
    {
      id: "usr_body_juuso",
      username: "juuso",
      displayName: "Juuso",
      email: "juuso@example.test",
      role: "partner_a",
      passwordHash: await auth.hashPassword(process.env.ATENEUM_JUUSO_PASSWORD!),
    },
    {
      id: "usr_body_henna",
      username: "henna",
      displayName: "Henna",
      email: "henna@example.test",
      role: "partner_b",
      passwordHash: await auth.hashPassword(process.env.ATENEUM_HENNA_PASSWORD!),
    },
    {
      id: "usr_body_bot",
      username: "ateneum-bot",
      displayName: "Into",
      email: "bot@example.test",
      role: "bot",
      passwordHash: await auth.hashPassword(process.env.ATENEUM_BOT_PASSWORD!),
    },
  ]);

  const app = express();
  app.set("trust proxy", "loopback");
  app.use(express.json());
  app.use(cookieParser());
  routes.registerAteneumRoutes(app);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  juusoCookie = await login("juuso", process.env.ATENEUM_JUUSO_PASSWORD!);
  hennaCookie = await login("henna", process.env.ATENEUM_HENNA_PASSWORD!);
  botCookie = await login("ateneum-bot", process.env.ATENEUM_BOT_PASSWORD!);
});

after(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
  rawDb?.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test("body library lists training and recovery items", async () => {
  const res = await request("/api/ateneum/body-practice/library", {
    cookie: juusoCookie,
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { items: Array<{ kind: string; instructions: string }> };
  assert.ok(body.items.length >= 8);
  assert.ok(body.items.some((i) => i.kind === "training"));
  assert.ok(body.items.some((i) => i.kind === "recovery"));
  assert.ok(body.items.every((i) => i.instructions.length > 10));
});

test("propose creates mutual training+recovery activities and is idempotent", async () => {
  const first = await request("/api/ateneum/body-practice/propose", {
    method: "POST",
    cookie: juusoCookie,
    body: { sendEmail: true },
  });
  assert.equal(first.status, 200);
  const a = (await first.json()) as any;
  assert.ok(a.weekKey);
  assert.equal(a.reused, false);
  assert.ok(a.activities.length >= 4);
  const kinds = new Set(a.activities.map((x: any) => x.kind));
  assert.ok(kinds.has("training"));
  assert.ok(kinds.has("recovery"));
  assert.ok(a.activities.every((x: any) => x.instructions));
  assert.ok(Array.isArray(a.email));
  assert.equal(a.email.length, 2);

  // Proposer auto-accepted; partner has not
  const actId = a.activities[0].id as string;
  const asHenna = await request(`/api/ateneum/activities/${actId}`, {
    cookie: hennaCookie,
  });
  assert.equal(asHenna.status, 200);
  const hennaView = (await asHenna.json()) as any;
  assert.equal(hennaView.activity.planningMode, "mutual");
  assert.equal(hennaView.activity.planState, "proposed");
  assert.equal(hennaView.activity.acceptedByPartner, true);
  assert.equal(hennaView.activity.acceptedByMe, false);
  assert.ok(hennaView.activity.details?.instructions || hennaView.activity.details?.kind);

  const second = await request("/api/ateneum/body-practice/propose", {
    method: "POST",
    cookie: juusoCookie,
    body: { sendEmail: true },
  });
  assert.equal(second.status, 200);
  const b = (await second.json()) as any;
  assert.equal(b.reused, true);
  assert.equal(b.activities.length, a.activities.length);
  assert.deepEqual(
    b.activities.map((x: any) => x.id).sort(),
    a.activities.map((x: any) => x.id).sort(),
  );
});

test("bot cannot propose body practice week", async () => {
  const res = await request("/api/ateneum/body-practice/propose", {
    method: "POST",
    cookie: botCookie,
    body: {},
  });
  assert.equal(res.status, 403);
});

test("library rotation is deterministic for a week key", async () => {
  const { planBodyWeek } = await import("../../server/ateneum-body-program");
  const a = planBodyWeek({ weekKey: "2026-W32" });
  const b = planBodyWeek({ weekKey: "2026-W32" });
  const c = planBodyWeek({ weekKey: "2026-W33" });
  assert.deepEqual(
    a.map((x) => x.item.id),
    b.map((x) => x.item.id),
  );
  // Different week should usually rotate (not guaranteed if tiny lib, but with our sizes yes)
  assert.ok(a.length >= 4);
  assert.ok(c.length >= 4);
});
