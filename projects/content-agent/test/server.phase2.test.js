import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createServer } from "../server.js";
import { openDb } from "../lib/db.js";
import { makeToken } from "../lib/auth.js";

function setup() {
  const db = openDb(":memory:");
  const password = "p", secret = "s";
  const styleDir = fs.mkdtempSync(path.join(os.tmpdir(), "p2-style-"));
  const runner = async (_a, payload) => JSON.stringify({ result: `OUT:${payload.slice(0, 15)}` });
  const tgFetch = async ({ channels }) => ([
    { platform: "telegram", source_ref: channels[0], url: "https://t.me/a/1", title: "Новость A", text: "Полный текст A. Второе.", metrics: { views: 100, reactions: 20, comments: 5, forwards: 2 }, date: Date.now(), score: 50 },
    { platform: "telegram", source_ref: channels[0], url: "https://t.me/a/2", title: "Новость B", text: "Текст B.", metrics: { views: 10, reactions: 1, comments: 0, forwards: 0 }, date: Date.now(), score: 5 },
  ]);
  const vkValidate = async () => true;
  const ytValidate = async () => true;
  const app = createServer({ db, password, secret, styleDir, runner, model: "sonnet", tgFetch, vkValidate, ytValidate });
  const server = app.listen(0);
  const port = server.address().port;
  const token = makeToken(secret, password);
  const req = (m, p, b) => fetch(`http://127.0.0.1:${port}${p}`, {
    method: m, headers: { "content-type": "application/json", "x-auth-token": token },
    body: b ? JSON.stringify(b) : undefined,
  });
  return { req, close: () => server.close(), db };
}

test("sources: add, list, delete", async () => {
  const { req, close } = setup();
  const a = await (await req("POST", "/api/sources", { platform: "telegram", ref: "@durov" })).json();
  assert.ok(a.id);
  const list = await (await req("GET", "/api/sources")).json();
  assert.equal(list.length, 1);
  await req("DELETE", `/api/sources/${a.id}`);
  assert.equal((await (await req("GET", "/api/sources")).json()).length, 0);
  close();
});

test("keywords: add, list, delete", async () => {
  const { req, close } = setup();
  const k = await (await req("POST", "/api/keywords", { term: "gpt", scope: "include" })).json();
  assert.equal((await (await req("GET", "/api/keywords")).json()).length, 1);
  await req("DELETE", `/api/keywords/${k.id}`);
  assert.equal((await (await req("GET", "/api/keywords")).json()).length, 0);
  close();
});

test("search строит дайджест, сортирует по engagement", async () => {
  const { req, close } = setup();
  await req("POST", "/api/sources", { platform: "telegram", ref: "@a" });
  const res = await req("POST", "/api/search", { platforms: ["telegram"], period: "week", keywords: [] });
  assert.equal(res.status, 201);
  const d = await res.json();
  assert.ok(d.digest_id);
  assert.equal(d.items.length, 2);
  assert.equal(d.items[0].title, "Новость A");
  assert.ok(d.items[0].summary.length > 0);
  close();
});

test("digest reshape и save", async () => {
  const { req, close } = setup();
  await req("POST", "/api/sources", { platform: "telegram", ref: "@a" });
  const d = await (await req("POST", "/api/search", { platforms: ["telegram"], period: "week", keywords: [] })).json();
  const rs = await (await req("POST", `/api/digests/${d.digest_id}/reshape`, { mode: "shorter" })).json();
  assert.ok(rs.rendered_text.startsWith("OUT:"));
  const sv = await (await req("POST", `/api/digests/${d.digest_id}/save`)).json();
  assert.equal(sv.ok, true);
  close();
});

test("пост из новости: origin=digest_item", async () => {
  const { req, close } = setup();
  await req("POST", "/api/sources", { platform: "telegram", ref: "@a" });
  const d = await (await req("POST", "/api/search", { platforms: ["telegram"], period: "week", keywords: [] })).json();
  const itemId = d.items[0].id;
  const post = await (await req("POST", "/api/posts", { origin: "digest_item", digest_item_id: itemId })).json();
  assert.equal(post.draft_text.startsWith("OUT:"), true);
  close();
});
