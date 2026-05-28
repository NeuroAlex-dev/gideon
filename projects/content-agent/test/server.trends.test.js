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
  const styleDir = fs.mkdtempSync(path.join(os.tmpdir(), "trends-style-"));
  const runner = async () => JSON.stringify({ result: `OUT` });
  const gtFetch = async ({ niche }) => ([
    { platform: "google_trends", source_ref: niche, url: "https://trends.google.com/?q=ai+agents", title: "AI agents", text: "rising +800%", metrics: { views: 0, reactions: 800, comments: 0, forwards: 0 }, date: Date.now(), score: 800, growth_label: "+800%" },
  ]);
  const redditFetch = async ({ niche }) => ([
    { platform: "reddit", source_ref: niche, url: "https://reddit.com/r/MachineLearning/x", title: "AI breakthrough", text: "длинный пост про AI", metrics: { views: 0, reactions: 5000, comments: 200, forwards: 0 }, date: Date.now(), score: 5600, subreddit: "MachineLearning" },
  ]);
  const vkValidate = async () => true;
  const ytValidate = async () => true;
  const app = createServer({ db, password, secret, styleDir, runner, model: "sonnet", gtFetch, redditFetch, vkValidate, ytValidate });
  const server = app.listen(0);
  const port = server.address().port;
  const token = makeToken(secret, password);
  const req = (m, p, b) => fetch(`http://127.0.0.1:${port}${p}`, { method: m, headers: { "content-type": "application/json", "x-auth-token": token }, body: b ? JSON.stringify(b) : undefined });
  return { req, close: () => server.close(), db };
}

test("POST /api/trends: нужна ниша", async () => {
  const { req, close } = setup();
  const r = await req("POST", "/api/trends", {});
  assert.equal(r.status, 400);
  close();
});

test("POST /api/trends: дефолтно дёргает оба источника", async () => {
  const { req, close } = setup();
  const r = await (await req("POST", "/api/trends", { niche: "нейросети", period: "week" })).json();
  assert.equal(r.count, 2);
  const platforms = new Set(r.items.map((i) => i.platform));
  assert.deepEqual([...platforms].sort(), ["google_trends", "reddit"]);
  // sortByEngagement: reddit (score 5600) выше gt (800)
  assert.equal(r.items[0].platform, "reddit");
  close();
});

test("POST /api/trends: можно выбрать только один источник", async () => {
  const { req, close } = setup();
  const r = await (await req("POST", "/api/trends", { niche: "нейросети", sources: ["google_trends"] })).json();
  assert.equal(r.count, 1);
  assert.equal(r.items[0].platform, "google_trends");
  close();
});

test("POST /api/trends: ошибка одного источника не валит весь поиск", async () => {
  const db = openDb(":memory:");
  const password = "p", secret = "s";
  const styleDir = fs.mkdtempSync(path.join(os.tmpdir(), "trends-style2-"));
  const runner = async () => JSON.stringify({ result: "OUT" });
  const gtFetch = async () => { throw new Error("api flaky"); };
  const redditFetch = async ({ niche }) => ([
    { platform: "reddit", source_ref: niche, url: "u", title: "T", text: "x", metrics: { views: 0, reactions: 100, comments: 5, forwards: 0 }, date: Date.now(), score: 115 },
  ]);
  const app = createServer({ db, password, secret, styleDir, runner, model: "sonnet", gtFetch, redditFetch, vkValidate: async () => true, ytValidate: async () => true });
  const server = app.listen(0);
  const port = server.address().port;
  const token = makeToken(secret, password);
  const r = await (await fetch(`http://127.0.0.1:${port}/api/trends`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-auth-token": token },
    body: JSON.stringify({ niche: "X" }),
  })).json();
  assert.equal(r.count, 1);
  assert.equal(r.items[0].platform, "reddit");
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].source, "google_trends");
  server.close();
});

test("POST /api/posts {origin:digest_item} работает с trend-item (переиспользует поток)", async () => {
  const { req, close } = setup();
  const t = await (await req("POST", "/api/trends", { niche: "AI" })).json();
  const itemId = t.items[0].id;
  const post = await (await req("POST", "/api/posts", { origin: "digest_item", digest_item_id: itemId })).json();
  assert.equal(post.draft_text, "OUT");
  close();
});
