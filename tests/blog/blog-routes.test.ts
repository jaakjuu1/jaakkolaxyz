import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { registerRoutes } from "../../server/routes";

let server: Server;
let base: string;

before(async () => {
  const app = express();
  server = createServer(app);
  await registerRoutes(server, app);
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const get = (pathAndQuery: string) => fetch(base + pathAndQuery);

test("lists and reads posts for a known language", async () => {
  const list = await get("/api/blog/posts?lang=fi");
  assert.equal(list.status, 200);
  const { data } = (await list.json()) as { data: { slug: string }[] };
  assert.ok(data.length > 0);

  const post = await get(`/api/blog/posts/${data[0].slug}?lang=fi`);
  assert.equal(post.status, 200);
});

test("rejects a lang that is not fi or en", async () => {
  for (const lang of ["../../docs", "../..", "de", ""]) {
    const res = await get(`/api/blog/posts?lang=${encodeURIComponent(lang)}`);
    assert.equal(res.status, 400, `lang=${lang}`);
  }
  const res = await get("/api/blog/posts/deploy?lang=../../docs");
  assert.equal(res.status, 404);
});

test("rejects a slug that leaves the blog folder", async () => {
  const res = await get(`/api/blog/posts/${encodeURIComponent("../../../docs/deploy")}?lang=fi`);
  assert.equal(res.status, 404);
});
