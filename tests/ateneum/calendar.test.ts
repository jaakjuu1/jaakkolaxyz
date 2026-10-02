import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";

const tempDir = mkdtempSync(path.join(os.tmpdir(), "ateneum-cal-"));
process.env.ATENEUM_DB_PATH = path.join(tempDir, "ateneum-test.db");
process.env.ATENEUM_JUUSO_PASSWORD = "test-juuso-password";
process.env.ATENEUM_HENNA_PASSWORD = "test-henna-password";
process.env.ATENEUM_BOT_PASSWORD = "test-bot-password";
process.env.ATENEUM_CALENDAR_BACKEND = "memory";
process.env.ATENEUM_PUBLIC_URL = "https://example.test";
process.env.NODE_ENV = "test";

let baseUrl = "";
let server: ReturnType<express.Express["listen"]>;
let rawDb: any;
let juusoCookie = "";
let hennaCookie = "";
let calendar: typeof import("../../server/ateneum-calendar");

async function request(
  pathname: string,
  options: {
    method?: string;
    cookie?: string;
    body?: unknown;
  } = {},
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
  assert.equal(response.status, 200, `login failed for ${username}`);
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie, `login did not set a cookie for ${username}`);
  return setCookie.split(";", 1)[0];
}

before(async () => {
  const db = await import("../../server/ateneum-db");
  const auth = await import("../../server/ateneum-auth");
  const schema = await import("../../shared/ateneum-schema");
  const routes = await import("../../server/ateneum-routes");
  calendar = await import("../../server/ateneum-calendar");

  db.initAteneumSchema();
  db.migrateAteneumSchema();
  rawDb = db.ateneumRawDb;
  calendar.__resetCalendarMemoryForTests();

  const juusoId = "usr_cal_juuso";
  const hennaId = "usr_cal_henna";
  await db.ateneumDb.insert(schema.ateneumUsers).values([
    {
      id: juusoId,
      username: "juuso",
      displayName: "Juuso",
      email: "juuso@example.test",
      role: "partner_a",
      passwordHash: await auth.hashPassword(process.env.ATENEUM_JUUSO_PASSWORD!),
    },
    {
      id: hennaId,
      username: "henna",
      displayName: "Henna",
      email: "henna@example.test",
      role: "partner_b",
      passwordHash: await auth.hashPassword(process.env.ATENEUM_HENNA_PASSWORD!),
    },
    {
      id: "usr_cal_bot",
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
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;

  juusoCookie = await login("juuso", process.env.ATENEUM_JUUSO_PASSWORD!);
  hennaCookie = await login("henna", process.env.ATENEUM_HENNA_PASSWORD!);
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

test("mutual accept writes calendar event once and stores googleEventId", async () => {
  calendar.__resetCalendarMemoryForTests();
  const scheduledFor = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const create = await request("/api/ateneum/activities", {
    method: "POST",
    cookie: juusoCookie,
    body: {
      title: "Yhteinen treeni",
      scheduledFor,
      durationMin: 60,
      notes: "Kevyt",
    },
  });
  assert.equal(create.status, 200);
  const created = (await create.json()) as any;
  assert.equal(created.activity.googleEventId, null);
  assert.equal(calendar.__getCalendarMemoryForTests().size, 0);

  const firstAcceptStillSolo = await request(
    `/api/ateneum/activities/${created.activity.id}/accept`,
    {
      method: "POST",
      cookie: juusoCookie,
      body: { expectedVersion: 1 },
    },
  );
  assert.equal(firstAcceptStillSolo.status, 200);
  const soloBody = (await firstAcceptStillSolo.json()) as any;
  assert.equal(soloBody.activity.planState, "proposed");
  assert.equal(soloBody.calendar, undefined);
  assert.equal(calendar.__getCalendarMemoryForTests().size, 0);

  const mutual = await request(`/api/ateneum/activities/${created.activity.id}/accept`, {
    method: "POST",
    cookie: hennaCookie,
    body: { expectedVersion: 1 },
  });
  assert.equal(mutual.status, 200);
  const body = (await mutual.json()) as any;
  assert.equal(body.activity.planState, "accepted");
  assert.equal(body.calendar?.ok, true);
  assert.equal(body.calendar?.backend, "memory");
  assert.ok(body.activity.googleEventId);
  assert.equal(body.activity.googleEventId, body.calendar.eventId);
  assert.equal(calendar.__getCalendarMemoryForTests().size, 1);
  const event = calendar.__getCalendarMemoryForTests().get(body.activity.googleEventId)!;
  assert.equal(event.summary, "Yhteinen treeni");
  assert.match(event.description, /Ateneum:/);
  assert.match(event.description, /Kevyt/);

  // Idempotent re-accept should upsert same id
  const again = await request(`/api/ateneum/activities/${created.activity.id}/accept`, {
    method: "POST",
    cookie: hennaCookie,
    body: { expectedVersion: 1 },
  });
  assert.equal(again.status, 200);
  const againBody = (await again.json()) as any;
  assert.equal(againBody.activity.googleEventId, body.activity.googleEventId);
  assert.equal(calendar.__getCalendarMemoryForTests().size, 1);
});

test("counterproposal clears calendar event until re-accepted", async () => {
  calendar.__resetCalendarMemoryForTests();
  const scheduledFor = new Date(Date.now() + 4 * 86_400_000).toISOString();
  const create = await request("/api/ateneum/activities", {
    method: "POST",
    cookie: juusoCookie,
    body: {
      title: "Kävely",
      scheduledFor,
      durationMin: 45,
    },
  });
  const created = (await create.json()) as any;
  const accepted = await request(`/api/ateneum/activities/${created.activity.id}/accept`, {
    method: "POST",
    cookie: hennaCookie,
    body: { expectedVersion: 1 },
  });
  const acceptedBody = (await accepted.json()) as any;
  const eventId = acceptedBody.activity.googleEventId as string;
  assert.ok(eventId);
  assert.equal(calendar.__getCalendarMemoryForTests().has(eventId), true);

  const counter = await request(`/api/ateneum/activities/${created.activity.id}`, {
    method: "PATCH",
    cookie: hennaCookie,
    body: {
      expectedVersion: 1,
      scheduledFor: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      notes: "Myöhemmin",
    },
  });
  assert.equal(counter.status, 200);
  const counterBody = (await counter.json()) as any;
  assert.equal(counterBody.activity.planState, "proposed");
  assert.equal(counterBody.activity.googleEventId, null);
  // memory delete is async fire-and-forget; give it a tick
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calendar.__getCalendarMemoryForTests().has(eventId), false);

  const reaccept = await request(`/api/ateneum/activities/${created.activity.id}/accept`, {
    method: "POST",
    cookie: juusoCookie,
    body: { expectedVersion: 2 },
  });
  assert.equal(reaccept.status, 200);
  const reBody = (await reaccept.json()) as any;
  assert.equal(reBody.activity.planState, "accepted");
  assert.ok(reBody.activity.googleEventId);
  assert.equal(calendar.__getCalendarMemoryForTests().size, 1);
});
