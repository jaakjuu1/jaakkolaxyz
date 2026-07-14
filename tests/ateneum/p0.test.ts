import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";

const tempDir = mkdtempSync(path.join(os.tmpdir(), "ateneum-p0-"));
process.env.ATENEUM_DB_PATH = path.join(tempDir, "ateneum-test.db");
process.env.ATENEUM_JUUSO_PASSWORD = "test-juuso-password";
process.env.ATENEUM_HENNA_PASSWORD = "test-henna-password";
process.env.ATENEUM_BOT_PASSWORD = "test-bot-password";
process.env.NODE_ENV = "test";

let baseUrl = "";
let server: ReturnType<express.Express["listen"]>;
let rawDb: any;
let juusoCookie = "";
let hennaCookie = "";
let botCookie = "";

async function request(
  pathname: string,
  options: {
    method?: string;
    cookie?: string;
    bearer?: string;
    forwardedFor?: string;
    body?: unknown;
  } = {},
) {
  return fetch(baseUrl + pathname, {
    method: options.method ?? "GET",
    headers: {
      Accept: "application/json",
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.bearer ? { Authorization: `Bearer ${options.bearer}` } : {}),
      ...(options.forwardedFor ? { "X-Forwarded-For": options.forwardedFor } : {}),
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

  db.initAteneumSchema();
  db.migrateAteneumSchema();
  rawDb = db.ateneumRawDb;

  const juusoId = "usr_test_juuso";
  const hennaId = "usr_test_henna";
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
      id: "usr_test_bot",
      username: "ateneum-bot",
      displayName: "Into",
      email: "bot@example.test",
      role: "bot",
      passwordHash: await auth.hashPassword(process.env.ATENEUM_BOT_PASSWORD!),
    },
  ]);
  await db.ateneumDb.insert(schema.ateneumPreferences).values([
    { userId: juusoId, likedTags: '["yhdessä"]', dislikedTags: "[]" },
    { userId: hennaId, likedTags: '["yhdessä"]', dislikedTags: "[]" },
  ]);
  await db.ateneumDb.insert(schema.ateneumIdeas).values(
    [0, 1, 2, 3].map((index) => ({
      id: `idea_test_${index}`,
      title: `Testi-idea ${index}`,
      description: "Yhteinen testi-idea",
      category: "indoor",
      tags: '["yhdessä"]',
      energyCost: index === 0 ? ("low" as const) : ("medium" as const),
      budgetCost: "moderate" as const,
      socialMode: "together" as const,
      durationMin: index === 0 ? 10 : 60,
      isActive: true,
      createdBy: juusoId,
    })),
  );

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
  botCookie = await login("ateneum-bot", process.env.ATENEUM_BOT_PASSWORD!);
});

after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  rawDb?.close();
  rmSync(tempDir, { recursive: true, force: true });
});

test("private wish is visible only to its author", async () => {
  const marker = `private-${Date.now()}`;
  const create = await request("/api/ateneum/wishes", {
    method: "POST",
    cookie: hennaCookie,
    body: { body: marker, mood: "tender", visibility: "private" },
  });
  assert.equal(create.status, 200);

  const asHenna = await request("/api/ateneum/wishes?all=1", { cookie: hennaCookie });
  assert.equal(asHenna.status, 200);
  const hennaBody = (await asHenna.json()) as { wishes: Array<{ body: string }> };
  assert.ok(hennaBody.wishes.some((wish) => wish.body === marker));

  const asJuuso = await request("/api/ateneum/wishes?all=1", { cookie: juusoCookie });
  assert.equal(asJuuso.status, 200);
  const juusoBody = (await asJuuso.json()) as { wishes: Array<{ body: string }> };
  assert.ok(!juusoBody.wishes.some((wish) => wish.body === marker));

  const asBot = await request("/api/ateneum/wishes?all=1", { cookie: botCookie });
  assert.equal(asBot.status, 200);
  const botBody = (await asBot.json()) as { wishes: Array<{ body: string }> };
  assert.ok(!botBody.wishes.some((wish) => wish.body === marker));
});

test("bot may read shared wishes but never owns a human wish", async () => {
  const marker = `shared-for-agent-${Date.now()}`;
  const create = await request("/api/ateneum/wishes", {
    method: "POST",
    cookie: juusoCookie,
    body: { body: marker, mood: "tender", visibility: "shared" },
  });
  assert.equal(create.status, 200);
  const created = (await create.json()) as { wish: { id: string } };

  const asBot = await request("/api/ateneum/wishes?all=1", { cookie: botCookie });
  assert.equal(asBot.status, 200);
  const botBody = (await asBot.json()) as { wishes: Array<{ body: string }> };
  assert.ok(botBody.wishes.some((wish) => wish.body === marker));

  const forbidden = await request(`/api/ateneum/wishes/${created.wish.id}/fulfill`, {
    method: "POST",
    cookie: botCookie,
  });
  assert.equal(forbidden.status, 403);
});

test("bot is read-only across every shared-data mutation", async () => {
  const mutations = [
    { method: "POST", path: "/api/ateneum/ideas", body: {} },
    { method: "PATCH", path: "/api/ateneum/ideas/missing", body: {} },
    { method: "DELETE", path: "/api/ateneum/ideas/missing" },
    { method: "POST", path: "/api/ateneum/activities", body: {} },
    { method: "PATCH", path: "/api/ateneum/activities/missing", body: {} },
    { method: "POST", path: "/api/ateneum/activities/missing/accept", body: { expectedVersion: 1 } },
    { method: "DELETE", path: "/api/ateneum/activities/missing" },
    { method: "POST", path: "/api/ateneum/wishes", body: {} },
    { method: "PATCH", path: "/api/ateneum/wishes/missing", body: {} },
    { method: "POST", path: "/api/ateneum/wishes/missing/fulfill" },
    { method: "DELETE", path: "/api/ateneum/wishes/missing" },
    { method: "POST", path: "/api/ateneum/suggestions/weekly/rotate" },
    { method: "POST", path: "/api/ateneum/suggestions/weekly/select" },
    { method: "POST", path: "/api/ateneum/suggestions/weekly/send" },
    { method: "PATCH", path: "/api/ateneum/notification-prefs", body: {} },
    { method: "PUT", path: "/api/ateneum/preferences", body: {} },
  ];

  for (const mutation of mutations) {
    const response = await request(mutation.path, {
      method: mutation.method,
      cookie: botCookie,
      body: mutation.body,
    });
    assert.equal(response.status, 403, `${mutation.method} ${mutation.path}`);
  }
});

test("read endpoints do not create preferences or weekly suggestions", async () => {
  const count = (sql: string, userId?: string): number =>
    (userId ? rawDb.prepare(sql).get(userId) : rawDb.prepare(sql).get()).count;
  const before = {
    preferences: count(
      "SELECT count(*) AS count FROM ateneum_preferences WHERE user_id = ?",
      "usr_test_bot",
    ),
    notifications: count(
      "SELECT count(*) AS count FROM ateneum_notification_prefs WHERE user_id = ?",
      "usr_test_bot",
    ),
    weekly: count("SELECT count(*) AS count FROM ateneum_weekly_suggestions"),
  };

  assert.equal((await request("/api/ateneum/preferences", { cookie: botCookie })).status, 200);
  assert.equal((await request("/api/ateneum/notification-prefs", { cookie: botCookie })).status, 200);
  assert.equal((await request("/api/ateneum/suggestions/weekly", { cookie: botCookie })).status, 200);

  const after = {
    preferences: count(
      "SELECT count(*) AS count FROM ateneum_preferences WHERE user_id = ?",
      "usr_test_bot",
    ),
    notifications: count(
      "SELECT count(*) AS count FROM ateneum_notification_prefs WHERE user_id = ?",
      "usr_test_bot",
    ),
    weekly: count("SELECT count(*) AS count FROM ateneum_weekly_suggestions"),
  };
  assert.deepEqual(after, before);
});

test("only the wish author can mark a wish fulfilled", async () => {
  const create = await request("/api/ateneum/wishes", {
    method: "POST",
    cookie: hennaCookie,
    body: { body: `ownership-${Date.now()}`, mood: "tender", visibility: "private" },
  });
  assert.equal(create.status, 200);
  const created = (await create.json()) as { wish: { id: string } };

  const forbidden = await request(`/api/ateneum/wishes/${created.wish.id}/fulfill`, {
    method: "POST",
    cookie: juusoCookie,
  });
  assert.equal(forbidden.status, 403);

  const forbiddenPatch = await request(`/api/ateneum/wishes/${created.wish.id}`, {
    method: "PATCH",
    cookie: juusoCookie,
    body: { body: "must not change" },
  });
  assert.equal(forbiddenPatch.status, 403);

  const forbiddenDelete = await request(`/api/ateneum/wishes/${created.wish.id}`, {
    method: "DELETE",
    cookie: juusoCookie,
  });
  assert.equal(forbiddenDelete.status, 403);

  const allowed = await request(`/api/ateneum/wishes/${created.wish.id}/fulfill`, {
    method: "POST",
    cookie: hennaCookie,
  });
  assert.equal(allowed.status, 200);
});

test("private wishes do not leak through partner statistics", async () => {
  const beforeJuuso = (await (await request("/api/ateneum/stats", { cookie: juusoCookie })).json()) as {
    stats: { unfulfilledWishes: number };
  };
  const beforeHenna = (await (await request("/api/ateneum/stats", { cookie: hennaCookie })).json()) as {
    stats: { unfulfilledWishes: number };
  };

  const create = await request("/api/ateneum/wishes", {
    method: "POST",
    cookie: hennaCookie,
    body: { body: `stats-private-${Date.now()}`, mood: "tender", visibility: "private" },
  });
  assert.equal(create.status, 200);

  const afterJuuso = (await (await request("/api/ateneum/stats", { cookie: juusoCookie })).json()) as {
    stats: { unfulfilledWishes: number };
  };
  const afterHenna = (await (await request("/api/ateneum/stats", { cookie: hennaCookie })).json()) as {
    stats: { unfulfilledWishes: number };
  };

  assert.equal(afterJuuso.stats.unfulfilledWishes, beforeJuuso.stats.unfulfilledWishes);
  assert.equal(afterHenna.stats.unfulfilledWishes, beforeHenna.stats.unfulfilledWishes + 1);
});

test("weekly suggestion is stable across reloads and both partners", async () => {
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    const first = await request("/api/ateneum/suggestions/weekly", { cookie: juusoCookie });
    assert.equal(first.status, 200);
    const firstBody = (await first.json()) as { suggestion: { id: string } };

    Math.random = () => 0.999999;
    const reload = await request("/api/ateneum/suggestions/weekly", { cookie: juusoCookie });
    assert.equal(reload.status, 200);
    const reloadBody = (await reload.json()) as { suggestion: { id: string } };

    const partner = await request("/api/ateneum/suggestions/weekly", { cookie: hennaCookie });
    assert.equal(partner.status, 200);
    const partnerBody = (await partner.json()) as { suggestion: { id: string } };

    assert.equal(reloadBody.suggestion.id, firstBody.suggestion.id);
    assert.equal(partnerBody.suggestion.id, firstBody.suggestion.id);
  } finally {
    Math.random = originalRandom;
  }
});

test("stored weekly suggestion survives planning and idea deactivation", async () => {
  const before = (await (
    await request("/api/ateneum/suggestions/weekly/select", {
      method: "POST",
      cookie: juusoCookie,
    })
  ).json()) as { suggestion: { id: string; title: string } };

  const planned = await request("/api/ateneum/activities", {
    method: "POST",
    cookie: juusoCookie,
    body: {
      ideaId: before.suggestion.id,
      title: before.suggestion.title,
      scheduledFor: new Date(Date.now() + 86_400_000).toISOString(),
      durationMin: 60,
    },
  });
  assert.equal(planned.status, 200);

  const deactivated = await request(`/api/ateneum/ideas/${before.suggestion.id}`, {
    method: "PATCH",
    cookie: hennaCookie,
    body: { isActive: false },
  });
  assert.equal(deactivated.status, 200);

  const asJuuso = (await (
    await request("/api/ateneum/suggestions/weekly", { cookie: juusoCookie })
  ).json()) as { suggestion: { id: string } };
  const asHenna = (await (
    await request("/api/ateneum/suggestions/weekly", { cookie: hennaCookie })
  ).json()) as { suggestion: { id: string } };
  assert.equal(asJuuso.suggestion.id, before.suggestion.id);
  assert.equal(asHenna.suggestion.id, before.suggestion.id);
});

test("explicit weekly rotation becomes the new shared stable suggestion", async () => {
  const before = (await (
    await request("/api/ateneum/suggestions/weekly/select", {
      method: "POST",
      cookie: juusoCookie,
    })
  ).json()) as { suggestion: { id: string }; weekKey: string };

  const rotate = await request("/api/ateneum/suggestions/weekly/rotate", {
    method: "POST",
    cookie: hennaCookie,
  });
  assert.equal(rotate.status, 200);
  const rotated = (await rotate.json()) as { suggestion: { id: string }; weekKey: string };
  assert.ok(rotated.suggestion?.id);
  assert.notEqual(rotated.suggestion.id, before.suggestion.id);
  assert.equal(rotated.weekKey, before.weekKey);

  const asJuuso = (await (
    await request("/api/ateneum/suggestions/weekly", { cookie: juusoCookie })
  ).json()) as { suggestion: { id: string } };
  const asHenna = (await (
    await request("/api/ateneum/suggestions/weekly", { cookie: hennaCookie })
  ).json()) as { suggestion: { id: string } };

  assert.equal(asJuuso.suggestion.id, rotated.suggestion.id);
  assert.equal(asHenna.suggestion.id, rotated.suggestion.id);
});

test("weekly email uses one atomic claim across concurrent and later requests", async () => {
  const email = await import("../../server/ateneum-email");
  const weekKey = email.isoWeekKey();
  const [first, second] = await Promise.all([
    request("/api/ateneum/suggestions/weekly/send", {
      method: "POST",
      cookie: hennaCookie,
    }),
    request("/api/ateneum/suggestions/weekly/send", {
      method: "POST",
      cookie: hennaCookie,
    }),
  ]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const bodies = [await first.json(), await second.json()] as Array<{
    skipped?: boolean;
    reason?: string;
    sent?: boolean;
  }>;
  assert.equal(bodies.filter((body) => body.reason === "already-sent-this-week").length, 1);

  const claims = rawDb
    .prepare(
      `SELECT status, week_key, error FROM ateneum_email_claims
       WHERE to_email = ? AND kind = 'weekly_suggestion' AND week_key = ?`,
    )
    .all("henna@example.test", weekKey) as Array<{
    status: string;
    week_key: string;
    error: string | null;
  }>;
  assert.equal(claims.length, 1);
  assert.ok(["sent", "failed"].includes(claims[0].status));
  assert.equal(claims[0].week_key, weekKey);
  assert.equal(
    await email.alreadySentThisWeek({
      toEmail: "henna@example.test",
      kind: "weekly_suggestion",
      isoWeekKey: weekKey,
    }),
    true,
  );

  const later = await request("/api/ateneum/suggestions/weekly/send", {
    method: "POST",
    cookie: hennaCookie,
  });
  assert.equal(later.status, 200);
  assert.equal((await later.json()).reason, "already-sent-this-week");

  const log = rawDb
    .prepare(
      `SELECT meta FROM ateneum_email_log
       WHERE to_email = ? AND kind = 'weekly_suggestion'
       ORDER BY sent_at DESC LIMIT 1`,
    )
    .get("henna@example.test") as { meta: string };
  assert.equal(JSON.parse(log.meta).weekKey, weekKey);
});

test("human partner selection never chooses the bot", async () => {
  const { selectHumanPartner } = await import("../../server/ateneum-routes");
  const users = [
    { id: "bot", role: "bot" },
    { id: "partner-b", role: "partner_b" },
    { id: "partner-a", role: "partner_a" },
  ];
  assert.equal(selectHumanPartner(users, users[2])?.id, "partner-b");
  assert.equal(selectHumanPartner(users, users[1])?.id, "partner-a");
  assert.equal(selectHumanPartner(users, users[0]), null);
});

function declaredFunctions(html: string) {
  const names: string[] = [];
  const pattern = /(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) names.push(match[1]);
  return names;
}

test("frontend has no duplicate function declarations", () => {
  const html = readFileSync(path.resolve("public-static/ateneum/index.html"), "utf8");
  const counts = new Map<string, number>();
  for (const name of declaredFunctions(html)) counts.set(name, (counts.get(name) ?? 0) + 1);
  const duplicates: Array<[string, number]> = [];
  counts.forEach((count, name) => {
    if (count > 1) duplicates.push([name, count]);
  });
  assert.deepEqual(duplicates, []);
});

test("frontend defines every Ateneum action it invokes", () => {
  const html = readFileSync(path.resolve("public-static/ateneum/index.html"), "utf8");
  const declarations = new Set(declaredFunctions(html));
  for (const required of ["loadIdeas", "rotateWeeklySuggestion"]) {
    assert.ok(declarations.has(required), `${required} is invoked but not defined`);
  }
  assert.match(
    html,
    /const\s+CONNECTION_NEEDS\s*=\s*\{/,
    "the personal check-in must define its need labels without exposing them in shared synthesis",
  );
});

test("frontend exposes user-created ideas and explicit editable activity plans", () => {
  const html = readFileSync(path.resolve("public-static/ateneum/index.html"), "utf8");

  for (const marker of [
    'id="idea-form"',
    'id="if-title"',
    'id="if-description"',
    'id="if-category"',
    'id="if-duration"',
    'id="if-energy"',
    'id="if-budget"',
    'class="pp-date"',
    'class="pp-time"',
    'class="pp-duration"',
    'class="pp-notes"',
    "Jaa uusi idea",
    "Tulevat aikaehdotukset ja yhteiset suunnitelmat",
    "Aiemmat aktiviteetit",
  ]) {
    assert.match(html, new RegExp(marker));
  }

  for (const functionName of [
    "showIdeaForm",
    "hideIdeaForm",
    "submitIdea",
    "continueBrowsingIdeas",
    "openActivityEditor",
    "saveActivityEdit",
  ]) {
    assert.match(html, new RegExp(`(?:async\\s+)?function\\s+${functionName}\\s*\\(`));
  }

  assert.match(
    html,
    /async function submitIdea[\s\S]*?api\(["']\/ideas["']\s*,\s*\{[\s\S]*?method:\s*["']POST["']/,
  );
  assert.match(
    html,
    /async function saveActivityEdit[\s\S]*?api\(`\/activities\/\$\{id\}`\s*,\s*\{[\s\S]*?method:\s*["']PATCH["']/,
  );
});

test("frontend API contracts and activity detail DOM stay aligned", () => {
  const index = readFileSync(path.resolve("public-static/ateneum/index.html"), "utf8");
  const detail = readFileSync(path.resolve("public-static/ateneum/activity.html"), "utf8");
  const combined = `${index}\n${detail}`;

  assert.doesNotMatch(combined, /\/activities\/\$\{[^}]+\}\/(?:status|feedback)/);
  assert.doesNotMatch(detail, /api\(["']\/auth\/login["']/);
  assert.doesNotMatch(detail, /\/auth\/magic\//);
  assert.doesNotMatch(index, /api\(["']\/auth\/unsubscribe["']/);
  assert.doesNotMatch(index, /value=["']hopeful["']/);
  assert.match(index, /w\.userId\s*===\s*currentUser\.id/);
  assert.match(index, /const\s+isConnectionMoment\s*=\s*a\.details\?\.source\s*===\s*'connection'/);
  assert.match(index, /const\s+isAccepted\s*=\s*isMutual\s*&&\s*a\.status\s*===\s*'planned'/);
  assert.match(index, /\/activities\/\$\{id\}\/accept/);
  assert.match(index, /expectedVersion:\s*version/);
  assert.match(detail, /const\s+isConnectionMoment\s*=\s*d\.source\s*===\s*"connection"/);
  assert.match(detail, /const\s+isAccepted\s*=\s*isMutual\s*&&\s*a\.planState\s*===\s*"accepted"/);
  assert.match(detail, /\/activities\/\$\{a\.id\}\/accept/);
  assert.match(detail, /expectedVersion:\s*a\.version/);
  assert.match(detail, /me\.role\s*!==\s*"bot"/);
  assert.match(detail, /id="hero-delete"/);
  assert.match(detail, /api\(`\/activities\/\$\{a\.id\}`\s*,\s*\{\s*method:\s*"DELETE"/);
  assert.match(detail, /else if \(canWrite\(\) && !isMutual\)[\s\S]*?if \(isPlanned\)[\s\S]*?hero-delete/);
  assert.match(detail, /else if \(isDone \|\| isSkipped\)[\s\S]*?hero-undo/);
  assert.match(detail, /editActivity=\$\{encodeURIComponent\(a\.id\)\}/);
  assert.doesNotMatch(detail, /view=activities/);
  assert.match(detail, /activityLoadGeneration/);
  assert.match(detail, /addEventListener\("focus", queueActivityRefresh\)/);
  assert.match(detail, /min-width:\s*44px;\s*min-height:\s*44px/);
  assert.match(index, /openDeepLinkedActivity\(activities\)/);
  assert.match(index, /const generation = beginLoad\('ideas'\)/);
  assert.match(index, /const generation = beginLoad\('wishes'\)/);
  assert.match(index, /const generation = beginLoad\('settings'\)/);
  assert.match(index, /data-suggestion="\$\{escapeHtml\(JSON\.stringify\(suggestion\)\)\}"/);
  assert.match(index, /Odottaa toisen kumppanin vastausta/);
  assert.match(index, /isDone \|\| isSkipped\)[\s\S]*?markPlanned\([^\n]+mutual/);
  assert.match(detail, /Tila ja reflektio käsitellään päivän yhteysnäkymässä/);
  assert.equal((detail.match(/id=["']content["']/g) ?? []).length, 1);
});

test("activity proposal email describes a proposal instead of a shared agreement", () => {
  const source = readFileSync(path.resolve("server/ateneum-email.ts"), "utf8");
  const start = source.indexOf("export async function sendActivityPlanned");
  const end = source.indexOf("export async function", start + 1);
  assert.ok(start >= 0 && end > start, "activity email function boundaries missing");
  const activityEmail = source.slice(start, end);
  for (const marker of [
    "Aikaehdotus:",
    "Uusi aikaehdotus",
    "ehdotti yhteistä aikaa",
    "Katso aikaehdotus",
  ]) {
    assert.ok(activityEmail.includes(marker), `activity email missing: ${marker}`);
  }
  assert.match(activityEmail, /\/ateneum\/activity\.html\?id=\$\{encodeURIComponent\(opts\.activity\.id\)\}/);
  assert.doesNotMatch(activityEmail, /view=activities|Suunnitelma on nyt tallennettu|Aktiviteetti suunniteltu/);
});

test("mutual activity proposals require reciprocal acceptance and optimistic versions", async () => {
  const scheduledFor = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const create = await request("/api/ateneum/activities", {
    method: "POST",
    cookie: juusoCookie,
    body: {
      title: "Kahden yön retki",
      scheduledFor,
      durationMin: 2_880,
      notes: "Lähtö perjantaina",
    },
  });
  assert.equal(create.status, 200);
  const created = (await create.json()) as any;
  assert.equal(created.activity.planningMode, "mutual");
  assert.equal(created.activity.planState, "proposed");
  assert.equal(created.activity.version, 1);
  assert.equal(created.activity.durationMin, 2_880);
  assert.equal(created.activity.acceptedByMe, true);
  assert.equal(created.activity.acceptedByPartner, false);
  assert.equal(created.activity.proposedBy.displayName, "Juuso");

  const asHenna = await request(`/api/ateneum/activities/${created.activity.id}`, {
    cookie: hennaCookie,
  });
  assert.equal(asHenna.status, 200);
  const hennaView = (await asHenna.json()) as any;
  assert.equal(hennaView.activity.acceptedByMe, false);
  assert.equal(hennaView.activity.acceptedByPartner, true);
  assert.equal(hennaView.activity.proposedBy.displayName, "Juuso");

  const prematureDone = await request(`/api/ateneum/activities/${created.activity.id}`, {
    method: "PATCH",
    cookie: juusoCookie,
    body: { status: "done", expectedVersion: 1 },
  });
  assert.equal(prematureDone.status, 409);

  const botAccept = await request(`/api/ateneum/activities/${created.activity.id}/accept`, {
    method: "POST",
    cookie: botCookie,
    body: { expectedVersion: 1 },
  });
  assert.equal(botAccept.status, 403);

  const accepted = await request(`/api/ateneum/activities/${created.activity.id}/accept`, {
    method: "POST",
    cookie: hennaCookie,
    body: { expectedVersion: 1 },
  });
  assert.equal(accepted.status, 200);
  const acceptedBody = (await accepted.json()) as any;
  assert.equal(acceptedBody.activity.planState, "accepted");
  assert.equal(acceptedBody.activity.acceptedByMe, true);
  assert.equal(acceptedBody.activity.acceptedByPartner, true);

  const counterproposal = await request(`/api/ateneum/activities/${created.activity.id}`, {
    method: "PATCH",
    cookie: hennaCookie,
    body: {
      expectedVersion: 1,
      scheduledFor: new Date(Date.now() + 8 * 86_400_000).toISOString(),
      notes: "Lähtö lauantaina",
    },
  });
  assert.equal(counterproposal.status, 200);
  const counterBody = (await counterproposal.json()) as any;
  assert.equal(counterBody.activity.version, 2);
  assert.equal(counterBody.activity.planState, "proposed");
  assert.equal(counterBody.activity.acceptedByMe, true);
  assert.equal(counterBody.activity.acceptedByPartner, false);
  assert.equal(counterBody.activity.proposedBy.displayName, "Henna");
  assert.equal(counterBody.activity.durationMin, 2_880);

  const staleOverwrite = await request(`/api/ateneum/activities/${created.activity.id}`, {
    method: "PATCH",
    cookie: juusoCookie,
    body: { expectedVersion: 1, notes: "Vanha välilehti" },
  });
  assert.equal(staleOverwrite.status, 409);

  const doneBeforeCounterproposalAcceptance = await request(
    `/api/ateneum/activities/${created.activity.id}`,
    {
      method: "PATCH",
      cookie: hennaCookie,
      body: { status: "done", expectedVersion: 2 },
    },
  );
  assert.equal(doneBeforeCounterproposalAcceptance.status, 409);

  const counterAccepted = await request(`/api/ateneum/activities/${created.activity.id}/accept`, {
    method: "POST",
    cookie: juusoCookie,
    body: { expectedVersion: 2 },
  });
  assert.equal(counterAccepted.status, 200);
  assert.equal(((await counterAccepted.json()) as any).activity.planState, "accepted");

  const done = await request(`/api/ateneum/activities/${created.activity.id}`, {
    method: "PATCH",
    cookie: hennaCookie,
    body: { status: "done", expectedVersion: 2 },
  });
  assert.equal(done.status, 200);
  const doneBody = (await done.json()) as any;
  assert.equal(doneBody.activity.status, "done");
  assert.equal(doneBody.activity.planState, "accepted");
  assert.equal(doneBody.activity.version, 3);
  assert.equal(doneBody.activity.updatedBy.displayName, "Henna");

  const reopened = await request(`/api/ateneum/activities/${created.activity.id}`, {
    method: "PATCH",
    cookie: juusoCookie,
    body: { status: "planned", expectedVersion: 3 },
  });
  assert.equal(reopened.status, 200);
  const reopenedBody = (await reopened.json()) as any;
  assert.equal(reopenedBody.activity.status, "planned");
  assert.equal(reopenedBody.activity.version, 4);
  assert.equal(reopenedBody.activity.planState, "proposed");
  assert.equal(reopenedBody.activity.acceptedByMe, true);
  assert.equal(reopenedBody.activity.acceptedByPartner, false);
  assert.equal(reopenedBody.activity.proposedBy.displayName, "Juuso");

  const reopenedDone = await request(`/api/ateneum/activities/${created.activity.id}`, {
    method: "PATCH",
    cookie: juusoCookie,
    body: { status: "done", expectedVersion: 4 },
  });
  assert.equal(reopenedDone.status, 409);
});

test("legacy activity status and rating keep the shared PATCH contract", async () => {
  const activityId = `act_legacy_patch_${Date.now()}`;
  rawDb
    .prepare(
      `INSERT INTO ateneum_activities
        (id, title, scheduled_for, duration_min, status, notes, created_by,
         planning_mode, version, proposed_by, updated_by, updated_at)
       VALUES (?, 'Patch contract test', ?, 45, 'planned', '', 'usr_test_juuso',
               'legacy', 1, 'usr_test_juuso', 'usr_test_juuso', unixepoch())`,
    )
    .run(activityId, Math.floor((Date.now() + 172_800_000) / 1000));

  const done = await request(`/api/ateneum/activities/${activityId}`, {
    method: "PATCH",
    cookie: hennaCookie,
    body: { status: "done" },
  });
  assert.equal(done.status, 200);
  assert.equal(((await done.json()) as any).activity.status, "done");

  const rated = await request(`/api/ateneum/activities/${activityId}`, {
    method: "PATCH",
    cookie: juusoCookie,
    body: { rating: 5 },
  });
  assert.equal(rated.status, 200);
  const ratedBody = (await rated.json()) as { activity: { status: string; rating: number } };
  assert.equal(ratedBody.activity.status, "done");
  assert.equal(ratedBody.activity.rating, 5);

  const invalidStatus = await request(`/api/ateneum/activities/${activityId}`, {
    method: "PATCH",
    cookie: juusoCookie,
    body: { status: '<img src=x onerror="alert(1)">' },
  });
  assert.equal(invalidStatus.status, 400);
  assert.equal(
    rawDb.prepare("SELECT status FROM ateneum_activities WHERE id = ?").pluck().get(activityId),
    "done",
  );
});

test("wish PATCH rejects unknown enum values without changing the row", async () => {
  const create = await request("/api/ateneum/wishes", {
    method: "POST",
    cookie: juusoCookie,
    body: { body: "Enum regression", mood: "tender", visibility: "shared" },
  });
  assert.equal(create.status, 200);
  const id = ((await create.json()) as { wish: { id: string } }).wish.id;
  const invalid = await request(`/api/ateneum/wishes/${id}`, {
    method: "PATCH",
    cookie: juusoCookie,
    body: { mood: '<svg onload="alert(1)">' },
  });
  assert.equal(invalid.status, 400);
  assert.equal(
    rawDb.prepare("SELECT mood FROM ateneum_wishes WHERE id = ?").pluck().get(id),
    "tender",
  );
});

test("unsubscribe GET is side-effect free and POST consumes the token", async () => {
  const email = await import("../../server/ateneum-email");
  const rawToken = `unsubscribe_${"a".repeat(43)}`;
  const tokenHash = email.sha256(rawToken);

  rawDb
    .prepare(
      `INSERT INTO ateneum_notification_prefs (
        user_id, weekly_suggestion, wish_added, wish_fulfilled,
        activity_planned, inactivity_reminder, updated_at
      ) VALUES (?, 1, 1, 1, 1, 1, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        weekly_suggestion=1, wish_added=1, wish_fulfilled=1,
        activity_planned=1, inactivity_reminder=1, updated_at=excluded.updated_at`,
    )
    .run("usr_test_juuso", Date.now());
  await email.recordEmailToken({
    email: "juuso@example.test",
    tokenHash,
    purpose: "unsubscribe",
    ttlMs: 60_000,
  });

  const confirmation = await request(
    `/api/ateneum/auth/unsubscribe?token=${encodeURIComponent(rawToken)}`,
  );
  assert.equal(confirmation.status, 200);
  assert.equal(confirmation.headers.get("cache-control"), "no-store");
  assert.equal(confirmation.headers.get("referrer-policy"), "no-referrer");
  assert.match(await confirmation.text(), /<form[^>]+method="post"/i);
  assert.equal(
    rawDb
      .prepare("SELECT used_at FROM ateneum_email_tokens WHERE token_hash = ?")
      .pluck()
      .get(tokenHash),
    null,
  );
  const before = rawDb
    .prepare(
      `SELECT weekly_suggestion, wish_added, wish_fulfilled,
        activity_planned, inactivity_reminder
       FROM ateneum_notification_prefs WHERE user_id = ?`,
    )
    .get("usr_test_juuso");
  assert.deepEqual(before, {
    weekly_suggestion: 1,
    wish_added: 1,
    wish_fulfilled: 1,
    activity_planned: 1,
    inactivity_reminder: 1,
  });

  const unsubscribe = await request("/api/ateneum/auth/unsubscribe", {
    method: "POST",
    body: { token: rawToken },
  });
  assert.equal(unsubscribe.status, 200);
  assert.ok(
    rawDb
      .prepare("SELECT used_at FROM ateneum_email_tokens WHERE token_hash = ?")
      .pluck()
      .get(tokenHash),
  );
  const after = rawDb
    .prepare(
      `SELECT weekly_suggestion, wish_added, wish_fulfilled,
        activity_planned, inactivity_reminder
       FROM ateneum_notification_prefs WHERE user_id = ?`,
    )
    .get("usr_test_juuso");
  assert.deepEqual(after, {
    weekly_suggestion: 0,
    wish_added: 0,
    wish_fulfilled: 0,
    activity_planned: 0,
    inactivity_reminder: 0,
  });
  rawDb
    .prepare("DELETE FROM ateneum_notification_prefs WHERE user_id = ?")
    .run("usr_test_juuso");
});

test("idea POST and PATCH reject invalid enums and unknown fields without mutation", async () => {
  const base = {
    title: "Strict idea validation",
    description: "Regression fixture",
    category: "indoor",
    tags: ["together"],
    energyCost: "medium",
    budgetCost: "cheap",
    socialMode: "together",
    durationMin: 60,
  };
  const invalidFields = [
    ["category", '<svg onload="alert(1)">'],
    ["energyCost", "unlimited"],
    ["budgetCost", "priceless"],
    ["socialMode", "everyone"],
  ] as const;
  const countBefore = rawDb.prepare("SELECT count(*) FROM ateneum_ideas").pluck().get();
  for (const [field, value] of invalidFields) {
    const response = await request("/api/ateneum/ideas", {
      method: "POST",
      cookie: juusoCookie,
      body: { ...base, [field]: value },
    });
    assert.equal(response.status, 400, `POST accepted invalid ${field}`);
  }
  assert.equal(
    (
      await request("/api/ateneum/ideas", {
        method: "POST",
        cookie: juusoCookie,
        body: { ...base, unexpected: true },
      })
    ).status,
    400,
  );
  assert.equal(rawDb.prepare("SELECT count(*) FROM ateneum_ideas").pluck().get(), countBefore);

  const createdResponse = await request("/api/ateneum/ideas", {
    method: "POST",
    cookie: juusoCookie,
    body: base,
  });
  assert.equal(createdResponse.status, 200);
  const id = ((await createdResponse.json()) as { idea: { id: string } }).idea.id;
  const readRow = () =>
    rawDb
      .prepare(
        `SELECT title, description, category, tags, energy_cost,
          budget_cost, social_mode, duration_min, is_active
         FROM ateneum_ideas WHERE id = ?`,
      )
      .get(id);
  const unchanged = readRow();

  for (const [field, value] of invalidFields) {
    const response = await request(`/api/ateneum/ideas/${id}`, {
      method: "PATCH",
      cookie: hennaCookie,
      body: { [field]: value },
    });
    assert.equal(response.status, 400, `PATCH accepted invalid ${field}`);
    assert.deepEqual(readRow(), unchanged);
  }
  for (const body of [{}, { unexpected: true }]) {
    const response = await request(`/api/ateneum/ideas/${id}`, {
      method: "PATCH",
      cookie: juusoCookie,
      body,
    });
    assert.equal(response.status, 400);
    assert.deepEqual(readRow(), unchanged);
  }

  const valid = await request(`/api/ateneum/ideas/${id}`, {
    method: "PATCH",
    cookie: hennaCookie,
    body: {
      category: "outdoor",
      energyCost: "high",
      budgetCost: "moderate",
      socialMode: "with-friends",
    },
  });
  assert.equal(valid.status, 200);
});

test("authenticated user can disable every notification preference", async () => {
  const disabled = {
    weeklySuggestion: false,
    wishAdded: false,
    wishFulfilled: false,
    activityPlanned: false,
    inactivityReminder: false,
  };
  const update = await request("/api/ateneum/notification-prefs", {
    method: "PATCH",
    cookie: hennaCookie,
    body: disabled,
  });
  assert.equal(update.status, 200);

  const read = await request("/api/ateneum/notification-prefs", { cookie: hennaCookie });
  assert.equal(read.status, 200);
  assert.deepEqual(((await read.json()) as { prefs: typeof disabled }).prefs, disabled);
});

test("connection check-ins stay private while both partners receive one shared synthesis", async () => {
  const countCheckIns = () =>
    rawDb.prepare("SELECT count(*) FROM ateneum_connection_checkins").pluck().get();

  const initial = await request("/api/ateneum/connection/today", {
    cookie: juusoCookie,
  });
  assert.equal(initial.status, 200);
  assert.equal(countCheckIns(), 0, "connection GET must be side-effect free");

  const botWrite = await request("/api/ateneum/connection/check-in", {
    method: "POST",
    cookie: botCookie,
    body: {
      energy: "medium",
      need: "closeness",
      capacityMin: 60,
      togetherness: "together",
      note: "must not be stored",
      noteVisibility: "private",
    },
  });
  assert.equal(botWrite.status, 403);
  assert.equal(countCheckIns(), 0);

  const unknownField = await request("/api/ateneum/connection/check-in", {
    method: "POST",
    cookie: juusoCookie,
    body: {
      energy: "medium",
      need: "closeness",
      capacityMin: 60,
      togetherness: "together",
      note: "",
      noteVisibility: "private",
      unexpected: true,
    },
  });
  assert.equal(unknownField.status, 400);

  const juusoSubmit = await request("/api/ateneum/connection/check-in", {
    method: "POST",
    cookie: juusoCookie,
    body: {
      energy: "high",
      need: "closeness",
      capacityMin: 180,
      togetherness: "together",
      note: "Juuson yksityinen huomio",
      noteVisibility: "private",
    },
  });
  assert.equal(juusoSubmit.status, 200);

  const hennaWaiting = await request("/api/ateneum/connection/today", {
    cookie: hennaCookie,
  });
  assert.equal(hennaWaiting.status, 200);
  const hennaWaitingText = await hennaWaiting.text();
  assert.doesNotMatch(hennaWaitingText, /Juuson yksityinen huomio/);
  const hennaWaitingBody = JSON.parse(hennaWaitingText);
  assert.equal(hennaWaitingBody.ownCheckIn, null);
  assert.equal(hennaWaitingBody.partnerResponded, true);
  assert.equal(hennaWaitingBody.synthesis, null);

  const hennaSubmit = await request("/api/ateneum/connection/check-in", {
    method: "POST",
    cookie: hennaCookie,
    body: {
      energy: "low",
      need: "talk",
      capacityMin: 10,
      togetherness: "flexible",
      note: "Hennan yksityinen huomio",
      noteVisibility: "private",
    },
  });
  assert.equal(hennaSubmit.status, 200);
  assert.equal(countCheckIns(), 2);

  const [asJuusoResponse, asHennaResponse, asBotResponse] = await Promise.all([
    request("/api/ateneum/connection/today", { cookie: juusoCookie }),
    request("/api/ateneum/connection/today", { cookie: hennaCookie }),
    request("/api/ateneum/connection/today", { cookie: botCookie }),
  ]);
  const asJuusoText = await asJuusoResponse.text();
  const asHennaText = await asHennaResponse.text();
  const asBotText = await asBotResponse.text();
  assert.doesNotMatch(asJuusoText, /Hennan yksityinen huomio/);
  assert.doesNotMatch(asHennaText, /Juuson yksityinen huomio/);
  assert.doesNotMatch(asBotText, /yksityinen huomio/);

  const asJuuso = JSON.parse(asJuusoText);
  const asHenna = JSON.parse(asHennaText);
  const asBot = JSON.parse(asBotText);
  assert.equal(asJuuso.ownCheckIn.need, "closeness");
  assert.equal(asHenna.ownCheckIn.need, "talk");
  assert.equal(asBot.ownCheckIn, null);
  assert.deepEqual(asJuuso.synthesis, asHenna.synthesis);
  assert.deepEqual(asJuuso.synthesis, asBot.synthesis);
  assert.deepEqual(Object.keys(asJuuso.synthesis).sort(), ["message", "mode"]);
  assert.doesNotMatch(
    JSON.stringify(asJuuso.synthesis),
    /high|low|180|10|closeness|talk/,
    "the shared synthesis must not expose invertible personal values",
  );
  assert.deepEqual(
    asJuuso.suggestions.map((idea: { id: string }) => idea.id),
    asHenna.suggestions.map((idea: { id: string }) => idea.id),
  );
  assert.ok(asJuuso.suggestions.length > 0);
  assert.ok(
    asJuuso.suggestions.every(
      (idea: { durationMin: number; energyCost: string }) =>
        idea.durationMin <= 10 && idea.energyCost === "low",
    ),
    "shared suggestions must come only from the non-invertible universal safe set",
  );

  const safeIdeaId = asJuuso.suggestions[0].id as string;
  const mutateSafeIdea = rawDb.prepare(
    `UPDATE ateneum_ideas
     SET is_active = ?, social_mode = ?, energy_cost = ?, duration_min = ?
     WHERE id = ?`,
  );
  const unsafeVariants: Array<[number, string, string, number]> = [
    [0, "together", "low", 10],
    [1, "solo", "low", 10],
    [1, "together", "high", 10],
    [1, "together", "low", 60],
  ];
  try {
    for (const [active, socialMode, energyCost, durationMin] of unsafeVariants) {
      mutateSafeIdea.run(active, socialMode, energyCost, durationMin, safeIdeaId);
      const filteredState = await (
        await request("/api/ateneum/connection/today", { cookie: juusoCookie })
      ).json();
      assert.deepEqual(
        filteredState.suggestions,
        [],
        "stored suggestion ids must be revalidated against the universal safe set on read",
      );
    }
  } finally {
    mutateSafeIdea.run(1, "together", "low", 10, safeIdeaId);
  }

  const concurrentUpdates = await Promise.all([
    request("/api/ateneum/connection/check-in", {
      method: "POST",
      cookie: juusoCookie,
      body: {
        energy: "high",
        need: "adventure",
        capacityMin: 180,
        togetherness: "together",
        note: "",
        noteVisibility: "private",
      },
    }),
    request("/api/ateneum/connection/check-in", {
      method: "POST",
      cookie: juusoCookie,
      body: {
        energy: "low",
        need: "rest",
        capacityMin: 10,
        togetherness: "flexible",
        note: "",
        noteVisibility: "private",
      },
    }),
  ]);
  assert.deepEqual(concurrentUpdates.map((response) => response.status), [200, 200]);
  const afterConcurrent = await (
    await request("/api/ateneum/connection/today", { cookie: juusoCookie })
  ).json();
  assert.equal(afterConcurrent.respondedCount, 2);
  assert.ok(
    afterConcurrent.suggestions.every(
      (idea: { durationMin: number; energyCost: string }) =>
        idea.durationMin <= 10 && idea.energyCost === "low",
    ),
    "concurrent upserts must not leave stale unsafe suggestions",
  );

  const requestSpace = await request("/api/ateneum/connection/check-in", {
    method: "POST",
    cookie: juusoCookie,
    body: {
      energy: "low",
      need: "space",
      capacityMin: 10,
      togetherness: "space",
      note: "",
      noteVisibility: "private",
    },
  });
  assert.equal(requestSpace.status, 200);
  const spaceState = await requestSpace.json();
  assert.equal(spaceState.synthesis.mode, "space");
  assert.deepEqual(spaceState.suggestions, []);
  assert.equal(countCheckIns(), 2, "same-day check-in must upsert instead of duplicate");
});

test("connection choices create one mutual commitment and keep reflections personal", async () => {
  rawDb
    .prepare(
      `INSERT OR IGNORE INTO ateneum_ideas
        (id, title, description, category, tags, energy_cost, budget_cost, social_mode, duration_min, is_active, created_by)
       VALUES (?, ?, ?, 'wellness', '["yhdessä"]', 'low', 'free', 'together', 5, 1, ?)`,
    )
    .run(
      "idea_test_safe_alt",
      "Viiden minuutin pysähdys",
      "Olkaa hetki vierekkäin ilman tavoitetta.",
      "usr_test_juuso",
    );

  const connectBody = {
    energy: "medium",
    need: "closeness",
    capacityMin: 30,
    togetherness: "together",
    note: "",
    noteVisibility: "private",
  };
  for (const cookie of [juusoCookie, hennaCookie]) {
    const response = await request("/api/ateneum/connection/check-in", {
      method: "POST",
      cookie,
      body: connectBody,
    });
    assert.equal(response.status, 200);
  }

  const ready = await (
    await request("/api/ateneum/connection/today", { cookie: juusoCookie })
  ).json();
  assert.ok(ready.suggestions.length >= 2, "adjustment needs at least two safe choices");
  const [firstIdea, secondIdea] = ready.suggestions as Array<{ id: string }>;

  const botWrite = await request("/api/ateneum/connection/commitment", {
    method: "POST",
    cookie: botCookie,
    body: { choice: "choose", ideaId: firstIdea.id },
  });
  assert.equal(botWrite.status, 403);

  const invalidChoice = await request("/api/ateneum/connection/commitment", {
    method: "POST",
    cookie: juusoCookie,
    body: { choice: "choose", ideaId: "idea_not_in_cycle", unexpected: true },
  });
  assert.equal(invalidChoice.status, 400);

  const juusoChoice = await request("/api/ateneum/connection/commitment", {
    method: "POST",
    cookie: juusoCookie,
    body: { choice: "choose", ideaId: firstIdea.id },
  });
  assert.equal(juusoChoice.status, 200);
  const waiting = await juusoChoice.json();
  assert.equal(waiting.commitment.status, "waiting");
  assert.equal(waiting.commitment.ownChoice.ideaId, firstIdea.id);
  assert.equal(waiting.commitment.partnerResponded, false);

  const hennaAdjustment = await request("/api/ateneum/connection/commitment", {
    method: "POST",
    cookie: hennaCookie,
    body: { choice: "choose", ideaId: secondIdea.id },
  });
  assert.equal(hennaAdjustment.status, 200);
  const adjusting = await hennaAdjustment.json();
  assert.equal(adjusting.commitment.status, "adjusting");
  assert.equal(adjusting.commitment.ownChoice.ideaId, secondIdea.id);
  assert.equal(adjusting.commitment.partnerChoice.ideaId, firstIdea.id);
  assert.equal(adjusting.commitment.activity, null);

  const aligned = await Promise.all([
    request("/api/ateneum/connection/commitment", {
      method: "POST",
      cookie: juusoCookie,
      body: { choice: "choose", ideaId: secondIdea.id },
    }),
    request("/api/ateneum/connection/commitment", {
      method: "POST",
      cookie: hennaCookie,
      body: { choice: "choose", ideaId: secondIdea.id },
    }),
  ]);
  assert.deepEqual(aligned.map((response) => response.status), [200, 200]);

  const committed = await (
    await request("/api/ateneum/connection/today", { cookie: juusoCookie })
  ).json();
  assert.equal(committed.commitment.status, "committed");
  assert.equal(committed.commitment.agreedIdea.id, secondIdea.id);
  assert.equal(committed.commitment.activity.status, "planned");
  assert.equal(
    rawDb
      .prepare("SELECT count(*) FROM ateneum_activities WHERE id = ?")
      .pluck()
      .get(committed.commitment.activity.id),
    1,
    "concurrent alignment must create exactly one activity",
  );

  const genericConnectionPatch = await request(
    `/api/ateneum/activities/${committed.commitment.activity.id}`,
    {
      method: "PATCH",
      cookie: juusoCookie,
      body: { status: "done" },
    },
  );
  assert.equal(
    genericConnectionPatch.status,
    409,
    "connection activity status must change only through the connection transition",
  );
  const genericConnectionDelete = await request(
    `/api/ateneum/activities/${committed.commitment.activity.id}`,
    { method: "DELETE", cookie: juusoCookie },
  );
  assert.equal(genericConnectionDelete.status, 409);
  assert.equal(
    rawDb
      .prepare("SELECT status FROM ateneum_activities WHERE id = ?")
      .pluck()
      .get(committed.commitment.activity.id),
    "planned",
  );

  const lockedCheckIn = await request("/api/ateneum/connection/check-in", {
    method: "POST",
    cookie: juusoCookie,
    body: { ...connectBody, need: "space", togetherness: "space" },
  });
  assert.equal(lockedCheckIn.status, 409, "a committed moment must not be invalidated by editing check-in");

  const completed = await Promise.all([
    request("/api/ateneum/connection/complete", {
      method: "POST",
      cookie: juusoCookie,
      body: {},
    }),
    request("/api/ateneum/connection/complete", {
      method: "POST",
      cookie: hennaCookie,
      body: {},
    }),
  ]);
  assert.deepEqual(completed.map((response) => response.status), [200, 200]);
  const completedState = await completed[0].json();
  assert.equal(completedState.commitment.status, "completed");
  assert.equal(completedState.commitment.activity.status, "done");

  const invalidReflection = await request("/api/ateneum/connection/reflection", {
    method: "POST",
    cookie: juusoCookie,
    body: { impact: "closer", note: "", allowLearning: true, unexpected: true },
  });
  assert.equal(invalidReflection.status, 400);

  const juusoReflection = await request("/api/ateneum/connection/reflection", {
    method: "POST",
    cookie: juusoCookie,
    body: {
      impact: "closer",
      note: "Juuson henkilökohtainen reflektio",
      allowLearning: true,
    },
  });
  assert.equal(juusoReflection.status, 200);

  const hennaBeforeReflectionText = await (
    await request("/api/ateneum/connection/today", { cookie: hennaCookie })
  ).text();
  assert.doesNotMatch(hennaBeforeReflectionText, /Juuson henkilökohtainen reflektio/);
  const hennaBeforeReflection = JSON.parse(hennaBeforeReflectionText);
  assert.equal(hennaBeforeReflection.reflection.own, null);
  assert.equal(hennaBeforeReflection.reflection.partnerResponded, true);
  assert.equal(hennaBeforeReflection.reflection.sharedImpact, null);

  const hennaReflection = await request("/api/ateneum/connection/reflection", {
    method: "POST",
    cookie: hennaCookie,
    body: {
      impact: "same",
      note: "Hennan henkilökohtainen reflektio",
      allowLearning: false,
    },
  });
  assert.equal(hennaReflection.status, 200);

  const [juusoFinalResponse, hennaFinalResponse, botFinalResponse] = await Promise.all([
    request("/api/ateneum/connection/today", { cookie: juusoCookie }),
    request("/api/ateneum/connection/today", { cookie: hennaCookie }),
    request("/api/ateneum/connection/today", { cookie: botCookie }),
  ]);
  const juusoFinalText = await juusoFinalResponse.text();
  const hennaFinalText = await hennaFinalResponse.text();
  const botFinalText = await botFinalResponse.text();
  assert.doesNotMatch(juusoFinalText, /Hennan henkilökohtainen reflektio/);
  assert.doesNotMatch(hennaFinalText, /Juuson henkilökohtainen reflektio/);
  assert.doesNotMatch(botFinalText, /henkilökohtainen reflektio/);
  const juusoFinal = JSON.parse(juusoFinalText);
  const hennaFinal = JSON.parse(hennaFinalText);
  const botFinal = JSON.parse(botFinalText);
  assert.equal(juusoFinal.reflection.own.note, "Juuson henkilökohtainen reflektio");
  assert.equal(hennaFinal.reflection.own.note, "Hennan henkilökohtainen reflektio");
  assert.equal(botFinal.reflection.own, null);
  assert.deepEqual(juusoFinal.reflection.sharedImpact, hennaFinal.reflection.sharedImpact);
  assert.equal(botFinal.reflection.sharedImpact, null);
  assert.equal(juusoFinal.reflection.sharedImpact.status, "mixed");
  assert.equal(juusoFinal.reflection.learningEligible, false);
  assert.equal(botFinal.reflection.learningEligible, false);

  const confirmedLearning = await request("/api/ateneum/connection/reflection", {
    method: "POST",
    cookie: hennaCookie,
    body: {
      impact: "closer",
      note: "Hennan henkilökohtainen reflektio",
      allowLearning: true,
    },
  });
  assert.equal(confirmedLearning.status, 200);
  const learnedState = await confirmedLearning.json();
  assert.equal(learnedState.reflection.sharedImpact.status, "closer");
  assert.equal(learnedState.reflection.learningEligible, true);
  const botLearnedState = await (
    await request("/api/ateneum/connection/today", { cookie: botCookie })
  ).json();
  assert.equal(botLearnedState.reflection.sharedImpact.status, "closer");
  assert.equal(botLearnedState.reflection.learningEligible, true);
  assert.equal(
    rawDb.prepare("SELECT count(*) FROM ateneum_connection_reflections").pluck().get(),
    2,
    "reflection updates must upsert instead of duplicate",
  );
});

test("seed source contains no hardcoded personal credentials", () => {
  const seed = readFileSync(path.resolve("server/ateneum-seed-data.ts"), "utf8");
  assert.doesNotMatch(seed, /password\s*:\s*["'][^"']+["']/i);
  assert.doesNotMatch(seed, /email\s*:\s*["'][^"']+["']/i);
  assert.doesNotMatch(seed, /@jaakkola\.xyz/i);
});

test("session cookies use 256-bit randomness and only hashes are stored", () => {
  const rawSessionId = decodeURIComponent(juusoCookie.split("=", 2)[1]);
  assert.match(rawSessionId, /^sess_[A-Za-z0-9_-]{43}$/);

  const stored = rawDb.prepare("SELECT id FROM ateneum_sessions").all() as Array<{ id: string }>;
  assert.ok(stored.length >= 2);
  assert.ok(stored.every((row) => /^sessh_[a-f0-9]{64}$/.test(row.id)));
  assert.ok(!stored.some((row) => row.id === rawSessionId));
});

test("schema migration purges legacy raw sessions without deleting hashed sessions", async () => {
  rawDb.prepare(
    "INSERT INTO ateneum_sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
  ).run("sess_legacy_plaintext", "usr_test_juuso", Date.now() + 60_000);

  const db = await import("../../server/ateneum-db");
  db.migrateAteneumSchema();

  const legacy = rawDb
    .prepare("SELECT id FROM ateneum_sessions WHERE id = ?")
    .get("sess_legacy_plaintext");
  const hashedCount = rawDb
    .prepare("SELECT count(*) AS count FROM ateneum_sessions WHERE id LIKE 'sessh_%'")
    .get() as { count: number };
  assert.equal(legacy, undefined);
  assert.ok(hashedCount.count >= 2);
});

test("raw legacy session ids are rejected by authentication", async () => {
  const legacyId = "sess_predictable_after_migration";
  rawDb.prepare(
    "INSERT INTO ateneum_sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
  ).run(legacyId, "usr_test_juuso", Date.now() + 60_000);

  try {
    const response = await request("/api/ateneum/auth/me", {
      cookie: `ateneum_session=${legacyId}`,
    });
    assert.equal(response.status, 401);
  } finally {
    rawDb.prepare("DELETE FROM ateneum_sessions WHERE id = ?").run(legacyId);
  }
});

test("API tokens are session-minted, scoped, expiring, listable and revocable", async () => {
  const withoutExpiry = await request("/api/ateneum/auth/api-token", {
    method: "POST",
    cookie: juusoCookie,
    body: {
      name: "missing-expiry",
      password: process.env.ATENEUM_JUUSO_PASSWORD,
      scopes: ["read"],
    },
  });
  assert.equal(withoutExpiry.status, 400);

  const wrongPassword = await request("/api/ateneum/auth/api-token", {
    method: "POST",
    cookie: juusoCookie,
    body: { name: "wrong-password", password: "wrong", expiresInDays: 7, scopes: ["read"] },
  });
  assert.equal(wrongPassword.status, 403);

  const issue = await request("/api/ateneum/auth/api-token", {
    method: "POST",
    cookie: juusoCookie,
    body: {
      name: "read-only-test",
      password: process.env.ATENEUM_JUUSO_PASSWORD,
      expiresInDays: 7,
      scopes: ["read"],
    },
  });
  assert.equal(issue.status, 200);
  const issued = (await issue.json()) as { token: string; id: string; expires_at: string };
  assert.match(issued.token, /^atn_[A-Za-z0-9_-]{43}$/);
  assert.ok(Date.parse(issued.expires_at) > Date.now());

  const stored = rawDb
    .prepare("SELECT token_hash, scopes, expires_at, revoked_at FROM ateneum_api_tokens WHERE id = ?")
    .get(issued.id) as {
    token_hash: string;
    scopes: string;
    expires_at: number;
    revoked_at: number | null;
  };
  assert.match(stored.token_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(stored.token_hash, issued.token);
  assert.deepEqual(JSON.parse(stored.scopes), ["read"]);
  assert.ok(stored.expires_at);
  assert.equal(stored.revoked_at, null);

  const readable = await request("/api/ateneum/ideas", { bearer: issued.token });
  assert.equal(readable.status, 200);
  const tokenConnection = await request("/api/ateneum/connection/today", {
    bearer: issued.token,
  });
  assert.equal(tokenConnection.status, 200);
  const tokenConnectionText = await tokenConnection.text();
  assert.doesNotMatch(tokenConnectionText, /yksityinen huomio|juuso-private-reflection|henna-private-reflection/);
  const tokenConnectionBody = JSON.parse(tokenConnectionText);
  assert.equal(tokenConnectionBody.ownCheckIn, null);
  assert.equal(tokenConnectionBody.commitment.ownChoice, null);
  assert.equal(tokenConnectionBody.commitment.partnerChoice, null);
  assert.equal(tokenConnectionBody.reflection.own, null);
  for (const [path, body] of [
    ["/api/ateneum/connection/commitment", { choice: "later" }],
    ["/api/ateneum/connection/complete", {}],
    [
      "/api/ateneum/connection/reflection",
      { impact: "closer", note: "must not be written", allowLearning: true },
    ],
  ] as const) {
    const deniedConnectionWrite = await request(path, {
      method: "POST",
      bearer: issued.token,
      body,
    });
    assert.equal(deniedConnectionWrite.status, 403);
  }
  const deniedWrite = await request("/api/ateneum/wishes", {
    method: "POST",
    bearer: issued.token,
    body: { body: "must not be written", mood: "tender", visibility: "shared" },
  });
  assert.equal(deniedWrite.status, 403);

  const preferencesBefore = rawDb
    .prepare("SELECT * FROM ateneum_preferences WHERE user_id = ?")
    .get("usr_test_juuso");
  const notificationCountBefore = (
    rawDb
      .prepare("SELECT count(*) AS count FROM ateneum_notification_prefs WHERE user_id = ?")
      .get("usr_test_juuso") as { count: number }
  ).count;
  assert.equal(
    (
      await request("/api/ateneum/preferences", {
        method: "PUT",
        bearer: issued.token,
        body: { notes: "must not change" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/api/ateneum/notification-prefs", {
        method: "PATCH",
        bearer: issued.token,
        body: { weeklySuggestion: false },
      })
    ).status,
    403,
  );
  assert.deepEqual(
    rawDb.prepare("SELECT * FROM ateneum_preferences WHERE user_id = ?").get("usr_test_juuso"),
    preferencesBefore,
  );
  assert.equal(
    (
      rawDb
        .prepare("SELECT count(*) AS count FROM ateneum_notification_prefs WHERE user_id = ?")
        .get("usr_test_juuso") as { count: number }
    ).count,
    notificationCountBefore,
  );

  const deniedNotification = await request("/api/ateneum/notifications", {
    method: "POST",
    bearer: issued.token,
    body: {
      to: "henna",
      kind: "custom_message",
      payload: { subject: "No", body: "No" },
    },
  });
  assert.equal(deniedNotification.status, 403);

  const bearerMint = await request("/api/ateneum/auth/api-token", {
    method: "POST",
    bearer: issued.token,
    body: {
      name: "escalation",
      password: process.env.ATENEUM_JUUSO_PASSWORD,
      expiresInDays: 7,
      scopes: ["read"],
    },
  });
  assert.equal(bearerMint.status, 403);
  assert.equal(
    (await request("/api/ateneum/auth/api-tokens", { bearer: issued.token })).status,
    403,
  );

  const partnerBTokenIssue = await request("/api/ateneum/auth/api-token", {
    method: "POST",
    cookie: hennaCookie,
    body: {
      name: "partner-b-owned",
      password: process.env.ATENEUM_HENNA_PASSWORD,
      expiresInDays: 1,
      scopes: ["read"],
    },
  });
  assert.equal(partnerBTokenIssue.status, 200);
  const partnerBToken = (await partnerBTokenIssue.json()) as { id: string };
  const partnerBNotification = await request("/api/ateneum/notifications", {
    method: "POST",
    cookie: hennaCookie,
    body: {
      to: "juuso",
      kind: "custom_message",
      payload: { subject: "Symmetric access", body: "Test" },
    },
  });
  assert.equal(partnerBNotification.status, 200);
  assert.equal(
    (
      await request(`/api/ateneum/auth/api-tokens/${partnerBToken.id}`, {
        method: "DELETE",
        cookie: hennaCookie,
        body: { password: process.env.ATENEUM_HENNA_PASSWORD },
      })
    ).status,
    200,
  );

  const notificationIssue = await request("/api/ateneum/auth/api-token", {
    method: "POST",
    cookie: juusoCookie,
    body: {
      name: "notification-test",
      password: process.env.ATENEUM_JUUSO_PASSWORD,
      expiresInDays: 1,
      scopes: ["read", "notifications:send"],
    },
  });
  assert.equal(notificationIssue.status, 200);
  const notificationToken = (await notificationIssue.json()) as { token: string; id: string };
  const externalAttempt = () =>
    request("/api/ateneum/notifications", {
      method: "POST",
      bearer: notificationToken.token,
      body: {
        to: "external@example.test",
        kind: "custom_message",
        payload: { subject: "Bounded", body: "Must stay internal" },
      },
    });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await externalAttempt()).status, 404);
  }
  const rateLimited = await externalAttempt();
  assert.equal(rateLimited.status, 429);
  assert.ok(rateLimited.headers.get("retry-after"));

  const list = await request("/api/ateneum/auth/api-tokens", { cookie: juusoCookie });
  assert.equal(list.status, 200);
  const listedText = await list.text();
  assert.doesNotMatch(listedText, /token_hash|tokenHash|atn_/);
  const listed = JSON.parse(listedText) as { tokens: Array<{ id: string; scopes: string[] }> };
  assert.deepEqual(
    listed.tokens.find((token) => token.id === issued.id)?.scopes,
    ["read"],
  );

  const wrongRevoke = await request(`/api/ateneum/auth/api-tokens/${issued.id}`, {
    method: "DELETE",
    cookie: juusoCookie,
    body: { password: "wrong" },
  });
  assert.equal(wrongRevoke.status, 403);
  for (const id of [issued.id, notificationToken.id]) {
    const revoked = await request(`/api/ateneum/auth/api-tokens/${id}`, {
      method: "DELETE",
      cookie: juusoCookie,
      body: { password: process.env.ATENEUM_JUUSO_PASSWORD },
    });
    assert.equal(revoked.status, 200);
  }
  assert.equal((await request("/api/ateneum/ideas", { bearer: issued.token })).status, 401);
});

test("magic link token can be consumed only once under concurrent requests", async () => {
  const email = await import("../../server/ateneum-email");
  const token = email.generateToken();
  await email.recordEmailToken({
    email: "juuso@example.test",
    tokenHash: token.hash,
    purpose: "magic_link",
    ttlMs: 60_000,
  });

  const [first, second] = await Promise.all([
    request("/api/ateneum/auth/magic-link/verify", {
      method: "POST",
      body: { token: token.raw },
    }),
    request("/api/ateneum/auth/magic-link/verify", {
      method: "POST",
      body: { token: token.raw },
    }),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 400]);
});

test("magic-link request and verify limits are layered and memory bounded", async () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await request("/api/ateneum/auth/magic-link/request", {
      method: "POST",
      forwardedFor: "198.51.100.10",
      body: { email: `unknown-${attempt}@example.test` },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  }
  const requestBlocked = await request("/api/ateneum/auth/magic-link/request", {
    method: "POST",
    forwardedFor: "198.51.100.10",
    body: { email: "unknown-blocked@example.test" },
  });
  assert.equal(requestBlocked.status, 429);
  assert.ok(requestBlocked.headers.get("retry-after"));

  const isolatedClient = await request("/api/ateneum/auth/magic-link/request", {
    method: "POST",
    forwardedFor: "198.51.100.11",
    body: { email: "unknown-isolated@example.test" },
  });
  assert.equal(isolatedClient.status, 200);

  let verifyBlocked: Response | null = null;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const response = await request("/api/ateneum/auth/magic-link/verify", {
      method: "POST",
      forwardedFor: "198.51.100.20",
      body: { token: "x".repeat(43) },
    });
    if (response.status === 429) {
      verifyBlocked = response;
      break;
    }
    assert.equal(response.status, 400);
  }
  assert.ok(verifyBlocked, "verify endpoint never reached its IP limit");
  assert.ok(verifyBlocked.headers.get("retry-after"));

  const email = await import("../../server/ateneum-email");
  for (let key = 0; key < 3000; key += 1) {
    email.checkRateLimit(`capacity-test:${key}`, 10_000);
  }
  assert.ok(email.rateLimitEntryCount() <= 2048);
});

test("production entrypoint mounts the learning workspace before the SPA fallback", () => {
  const serverIndex = readFileSync(path.resolve("server/index.ts"), "utf8");
  assert.match(
    serverIndex,
    /app\.use\(\s*["']\/learn["']\s*,\s*express\.static\(\s*path\.resolve\(process\.cwd\(\),\s*["']data\/learn["']\)\s*,\s*\{\s*fallthrough:\s*false,?\s*\}\s*\),?\s*\)/s,
  );
  const learnMount = serverIndex.indexOf('"/learn"');
  const spaFallback = serverIndex.indexOf("serveStatic(app)");
  assert.ok(learnMount >= 0 && spaFallback > learnMount, "the SPA fallback must not swallow /learn/*");
});

test("Ateneum API response bodies are excluded from request logs", () => {
  const serverIndex = readFileSync(path.resolve("server/index.ts"), "utf8");
  assert.match(
    serverIndex,
    /mayLogResponseBody\s*=\s*!path\.startsWith\(["']\/api\/ateneum["']\)/,
  );
});

test("Ateneum console logs exclude recipient email addresses", () => {
  const emailSource = readFileSync(path.resolve("server/ateneum-email.ts"), "utf8");
  const consoleCalls = emailSource.match(/console\.(?:log|warn|error)\([^\n]*/g) ?? [];
  for (const call of consoleCalls) {
    assert.doesNotMatch(call, /opts\.to|toEmail|user\.email/);
  }
});

test("legacy password login is rate limited after repeated failures", async () => {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const failed = await request("/api/ateneum/auth/login", {
      method: "POST",
      body: { username: "juuso", password: `wrong-${attempt}` },
    });
    assert.equal(failed.status, 401);
  }

  const blocked = await request("/api/ateneum/auth/login", {
    method: "POST",
    body: { username: "juuso", password: "still-wrong" },
  });
  assert.equal(blocked.status, 429);
});
