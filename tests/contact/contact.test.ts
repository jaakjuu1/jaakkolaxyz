import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import Database from "better-sqlite3";
import {
  buildContactEmail,
  createContactHandler,
  createDefaultContactDeps,
  createRateLimiter,
  createResendSender,
  extractContactMeta,
  hashIp,
  type ContactDeps,
  type ContactEmail,
  type ContactInput,
} from "../../server/contact";
import { openContactStore } from "../../server/contact-db";

const tempDir = mkdtempSync(path.join(os.tmpdir(), "contact-test-"));
after(() => rmSync(tempDir, { recursive: true, force: true }));

const emailConfig = { from: "Site <site@example.test>", to: "owner@example.test" };

interface Harness {
  url: string;
  saved: ContactInput[];
  sent: ContactEmail[];
  logs: string[];
  close: () => void;
}

async function start(overrides: Partial<ContactDeps> = {}): Promise<Harness> {
  const saved: ContactInput[] = [];
  const sent: ContactEmail[] = [];
  const logs: string[] = [];
  const deps: ContactDeps = {
    store: { save: (input) => (saved.push(input), saved.length) },
    send: async (email) => void sent.push(email),
    emailConfig,
    log: (message) => logs.push(message),
    ...overrides,
  };
  const app = express();
  app.use(express.json());
  app.post("/api/contact", createContactHandler(deps));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/contact`,
    saved,
    sent,
    logs,
    close: () => server.close(),
  };
}

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const valid = {
  name: "Matti Meikäläinen",
  email: "matti@yritys.fi",
  company: "Yritys Oy",
  message: "Tarvitsen apua.",
  budget: "5-10k",
};

test("a valid submission is stored, emailed and answered with 201 without echoing data", async () => {
  const h = await start();
  try {
    const res = await post(h.url, valid);
    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.equal("data" in res.body, false);
    assert.equal(h.saved.length, 1);
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].to, "owner@example.test");
    assert.equal(h.sent[0].replyTo, "matti@yritys.fi");
  } finally {
    h.close();
  }
});

test("invalid input is rejected with 400 and nothing is stored or sent", async () => {
  const h = await start();
  try {
    const cases: unknown[] = [
      {},
      { ...valid, name: "" },
      { ...valid, email: "not-an-email" },
      { ...valid, message: "x".repeat(5001) },
      { ...valid, name: "n".repeat(201) },
      { ...valid, budget: "b".repeat(101) },
      { ...valid, name: 42 },
    ];
    for (const body of cases) {
      const res = await post(h.url, body);
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 60));
      assert.equal(res.body.success, false);
    }
    assert.equal(h.saved.length + h.sent.length, 0);
  } finally {
    h.close();
  }
});

test("company and budget are optional", async () => {
  const h = await start();
  try {
    const res = await post(h.url, { name: "A", email: "a@b.fi", message: "hei" });
    assert.equal(res.status, 201);
    assert.equal(h.saved[0].company, "");
  } finally {
    h.close();
  }
});

test("user input is HTML-escaped in the email body", () => {
  const email = buildContactEmail(
    {
      name: `<script>alert(1)</script>`,
      email: "x@y.fi",
      company: `"><img src=x onerror=alert(2)>`,
      message: "rivi 1\n<b>rivi 2</b> & lisää",
      budget: "'; drop table",
    },
    emailConfig,
  );
  assert.ok(!email.html.includes("<script>"), "raw <script> must not survive");
  assert.ok(!email.html.includes("<img"), "raw <img> must not survive");
  assert.ok(!email.html.includes("<b>rivi 2"), "raw markup in the message must not survive");
  assert.ok(email.html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(email.html.includes("rivi 1<br>"), "line breaks are kept");
  assert.ok(email.text.includes("<b>rivi 2</b> & lisää"), "the plain-text part stays literal");
});

test("the subject cannot carry header injection or exceed 150 characters", () => {
  const email = buildContactEmail(
    { name: "Eve\r\nBcc: victim@example.test", email: "e@e.fi", company: "A\u2028B", message: "m" },
    emailConfig,
  );
  assert.ok(!/[\r\n\u2028\u2029]/.test(email.subject));
  const long = buildContactEmail({ name: "n".repeat(200), email: "e@e.fi", company: "", message: "m" }, emailConfig);
  assert.ok(long.subject.length <= 150);
});

test("storage failure still delivers by email; email failure still keeps the stored copy", async () => {
  const noStore = await start({ store: { save: () => { throw new Error("disk full"); } } });
  const noMail = await start({ send: async () => { throw new Error("quota"); } });
  try {
    assert.equal((await post(noStore.url, valid)).status, 201);
    assert.equal(noStore.sent.length, 1);
    assert.equal((await post(noMail.url, valid)).status, 201);
    assert.equal(noMail.saved.length, 1);
  } finally {
    noStore.close();
    noMail.close();
  }
});

test("when neither storage nor email works the client gets 500", async () => {
  const both = await start({
    store: { save: () => { throw new Error("disk full"); } },
    send: async () => { throw new Error("quota"); },
  });
  const none = await start({ store: undefined, send: undefined });
  try {
    assert.equal((await post(both.url, valid)).status, 500);
    assert.equal((await post(none.url, valid)).status, 500);
  } finally {
    both.close();
    none.close();
  }
});

test("logs never contain the visitor's data", async () => {
  const secret = { ...valid, message: "SALAINEN-VIESTI-12345", email: "salainen@yritys.fi", name: "Salainen Nimi" };
  const h = await start({ send: async () => { throw new Error("provider said no"); } });
  try {
    await post(h.url, secret);
    const log = h.logs.join("\n");
    assert.ok(log.includes("provider said no"));
    for (const value of [secret.message, secret.email, secret.name]) {
      assert.ok(!log.includes(value), `log leaked ${value}`);
    }
  } finally {
    h.close();
  }
});

test("the SQLite store persists submissions across handles", () => {
  const file = path.join(tempDir, "contact.db");
  const first = openContactStore(file);
  const id = first.save({ name: "A", email: "a@b.fi", company: "", message: "hei", budget: undefined });
  first.close();
  assert.equal(id, 1);
  const db = new Database(file, { readonly: true });
  const row = db.prepare("SELECT name, email, company, message, budget, created_at FROM contact_submissions").get() as any;
  db.close();
  assert.deepEqual({ ...row, created_at: typeof row.created_at }, {
    name: "A", email: "a@b.fi", company: "", message: "hei", budget: null, created_at: "number",
  });
  const again = openContactStore(file);
  assert.equal(again.save({ name: "B", email: "b@b.fi", company: "", message: "hei2" }), 2);
  again.close();
});

test("the Resend sender throws when the API reports an error and resolves on success", async () => {
  const realFetch = globalThis.fetch;
  const email = buildContactEmail(valid, emailConfig);
  try {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ name: "validation_error", message: "bad from", statusCode: 422 }), {
        status: 422,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    await assert.rejects(createResendSender("re_test")(email), /validation_error: bad from/);

    let requestBody = "";
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      requestBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ id: "abc" }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    await createResendSender("re_test")(email);
    assert.ok(requestBody.includes("matti@yritys.fi"), "reply_to is sent");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("rate limiter: 429 after the limit, per client, and resets after the window", () => {
  let now = 1_000_000;
  const limiter = createRateLimiter({ windowMs: 60_000, max: 2, now: () => now });
  const call = (ip: string) => {
    let status = 200;
    const res: any = { status(code: number) { status = code; return res; }, json() { return res; } };
    limiter({ ip } as any, res, () => {});
    return status;
  };
  assert.deepEqual([call("1.1.1.1"), call("1.1.1.1"), call("1.1.1.1")], [200, 200, 429]);
  assert.equal(call("2.2.2.2"), 200, "another client is unaffected");
  now += 61_000;
  assert.equal(call("1.1.1.1"), 200, "the window has passed");
});

test("default deps: email only when both RESEND_API_KEY and CONTACT_TO_EMAIL are set", () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(createDefaultContactDeps({}).send, undefined);
    assert.equal(createDefaultContactDeps({ RESEND_API_KEY: "re_x" }).send, undefined);
    assert.equal(createDefaultContactDeps({ CONTACT_TO_EMAIL: "a@b.fi" }).send, undefined);
    const ready = createDefaultContactDeps({ RESEND_API_KEY: "re_x", CONTACT_TO_EMAIL: "a@b.fi" });
    assert.equal(typeof ready.send, "function");
    assert.equal(ready.emailConfig?.to, "a@b.fi");
    assert.match(ready.emailConfig!.from, /onboarding@resend\.dev/);
    assert.ok(createDefaultContactDeps({}).store, "storage is always on");
  } finally {
    console.warn = warn;
  }
});

test("routes: /api/contact is rate limited and the public submissions listing is gone", () => {
  const routes = readFileSync(path.resolve("server/routes.ts"), "utf8");
  assert.match(routes, /app\.post\(\s*["']\/api\/contact["']\s*,\s*createRateLimiter\(/);
  assert.ok(!routes.includes("/api/contact/submissions"), "submissions must not be publicly listed");
  assert.ok(!/re_[A-Za-z0-9]{16,}|@gmail\.com/.test(routes + readFileSync(path.resolve("server/contact.ts"), "utf8")), "no API keys or personal addresses in code");
});

test("resend is bundled by the production build", () => {
  assert.match(readFileSync(path.resolve("script/build.ts"), "utf8"), /allowlist\s*=\s*\[[^\]]*"resend"/s);
});

test("source metadata: hashed IP only, cleaned headers, referer without query string", () => {
  const headers: Record<string, string> = {
    "user-agent": "Mozilla/5.0 (X11; Linux) Test\u0007Agent " + "x".repeat(400),
    referer: "https://jaakkola.xyz/blog/post?token=SECRET&email=a@b.fi#frag",
    "accept-language": "fi-FI,fi;q=0.9",
  };
  const req: any = { ip: "203.0.113.77", get: (name: string) => headers[name.toLowerCase()] };
  const meta = extractContactMeta(req, "key-one");
  assert.equal(meta.referer, "https://jaakkola.xyz/blog/post");
  assert.equal(meta.acceptLanguage, "fi-FI,fi;q=0.9");
  assert.ok(meta.userAgent && meta.userAgent.length <= 300 && !meta.userAgent.includes("\u0007"));
  assert.match(meta.ipHash ?? "", /^[0-9a-f]{16}$/);
  assert.ok(!JSON.stringify(meta).includes("203.0.113.77"), "the raw IP must not appear");
  assert.equal(hashIp("203.0.113.77", "key-one"), meta.ipHash, "same IP and key give the same hash");
  assert.notEqual(hashIp("203.0.113.77", "key-two"), meta.ipHash, "another key gives another hash");
  assert.notEqual(hashIp("203.0.113.78", "key-one"), meta.ipHash);
  const empty = extractContactMeta({ ip: undefined, get: () => undefined } as any, "k");
  assert.deepEqual(empty, { userAgent: null, referer: null, acceptLanguage: null, ipHash: null });
  assert.equal(extractContactMeta({ ip: "1.1.1.1", get: () => "not a url" } as any, "k").referer, null);
});

test("the handler passes the source metadata to the store and into the email, escaped", async () => {
  let savedMeta: any;
  const h = await start({
    store: { save: (input, meta) => ((savedMeta = meta), 1) },
    ipHashSecret: "test-secret",
  });
  try {
    const res = await fetch(h.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "<b>EvilBot</b>/1.0",
        referer: "https://example.test/landing?utm=1",
        "accept-language": "de",
      },
      body: JSON.stringify(valid),
    });
    assert.equal(res.status, 201);
    assert.equal(savedMeta.userAgent, "<b>EvilBot</b>/1.0");
    assert.equal(savedMeta.referer, "https://example.test/landing");
    assert.match(savedMeta.ipHash, /^[0-9a-f]{16}$/);
    const mail = h.sent[0];
    assert.ok(mail.text.includes("Selain: <b>EvilBot</b>/1.0"));
    assert.ok(mail.html.includes("Selain: &lt;b&gt;EvilBot&lt;/b&gt;/1.0"));
    assert.ok(!mail.html.includes("<b>EvilBot"));
    assert.ok(!mail.text.includes(savedMeta.ipHash) && !mail.html.includes(savedMeta.ipHash), "the hash stays out of the email");
  } finally {
    h.close();
  }
});

test("lost-submission and rejection logs carry the hash and agent but never the message", async () => {
  const h = await start({
    store: { save: () => { throw new Error("disk full"); } },
    send: async () => { throw new Error("quota"); },
    ipHashSecret: "test-secret",
  });
  try {
    const secretMessage = "GEHEIM-VIESTI-98765";
    await fetch(h.url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "TestAgent/9" },
      body: JSON.stringify({ ...valid, message: secretMessage }),
    });
    await fetch(h.url, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "TestAgent/9" },
      body: JSON.stringify({ name: "" }),
    });
    const log = h.logs.join("\n");
    assert.match(log, /submission lost: .*ip=[0-9a-f]{16} ua=TestAgent\/9/);
    assert.match(log, /rejected invalid input ip=[0-9a-f]{16} ua=TestAgent\/9/);
    assert.ok(!log.includes(secretMessage) && !log.includes(valid.email));
  } finally {
    h.close();
  }
});

test("the store saves source metadata and upgrades a database created before the columns existed", () => {
  const file = path.join(tempDir, "contact-old.db");
  const old = new Database(file);
  old.exec(`CREATE TABLE contact_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL,
    company TEXT NOT NULL DEFAULT '', message TEXT NOT NULL, budget TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()))`);
  old.prepare("INSERT INTO contact_submissions (name, email, message) VALUES ('Vanha', 'v@v.fi', 'ennen')").run();
  old.close();

  const store = openContactStore(file);
  const id = store.save(
    { name: "Uusi", email: "u@u.fi", company: "", message: "nyt" },
    { userAgent: "UA/1", referer: "https://x.test/p", acceptLanguage: "fi", ipHash: "0123456789abcdef" },
  );
  store.close();

  const db = new Database(file, { readonly: true });
  const rows = db.prepare("SELECT id, name, user_agent, referer, accept_language, ip_hash FROM contact_submissions ORDER BY id").all() as any[];
  db.close();
  assert.equal(id, 2);
  assert.deepEqual(rows[0], { id: 1, name: "Vanha", user_agent: null, referer: null, accept_language: null, ip_hash: null });
  assert.deepEqual(rows[1], { id: 2, name: "Uusi", user_agent: "UA/1", referer: "https://x.test/p", accept_language: "fi", ip_hash: "0123456789abcdef" });
});
