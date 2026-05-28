import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createServer } from "../server.js";
import { openDb, setSetting } from "../lib/db.js";
import { makeToken } from "../lib/auth.js";

function setup({ withVkToken = false } = {}) {
  const db = openDb(":memory:");
  if (withVkToken) setSetting(db, "vk_token", "VK-TKN");
  const password = "p", secret = "s";
  const styleDir = fs.mkdtempSync(path.join(os.tmpdir(), "p3-style-"));
  const runner = async (_a, payload) => JSON.stringify({ result: `OUT:${payload.slice(0, 12)}` });
  const tgFetch = async () => [
    { platform: "telegram", source_ref: "@a", url: "https://t.me/a/1", title: "TG про нейросети", text: "Пост про AI и нейросети", metrics: { views: 10, reactions: 1, comments: 0, forwards: 0 }, date: Date.now(), score: 1 },
    { platform: "telegram", source_ref: "@a", url: "https://t.me/a/2", title: "TG про спорт", text: "Совсем про другое — про футбол", metrics: { views: 5, reactions: 0, comments: 0, forwards: 0 }, date: Date.now(), score: 0.5 },
  ];
  const vkFetch = async () => [{ platform: "vk", source_ref: "durov", url: "https://vk.com/wall1_1", title: "VK", text: "VK body", metrics: { views: 100, reactions: 50, comments: 5, forwards: 3 }, date: Date.now(), score: 200 }];
  const vkValidate = async (t) => t === "VK-TKN";
  const ytValidate = async () => true;
  const app = createServer({ db, password, secret, styleDir, runner, model: "sonnet", tgFetch, vkFetch, vkValidate, ytValidate });
  const server = app.listen(0);
  const port = server.address().port;
  const token = makeToken(secret, password);
  const req = (m, p, b) => fetch(`http://127.0.0.1:${port}${p}`, { method: m, headers: { "content-type": "application/json", "x-auth-token": token }, body: b ? JSON.stringify(b) : undefined });
  return { req, close: () => server.close(), db };
}

test("PUT /api/settings vk_token валидирует через vkValidate", async () => {
  const { req, close } = setup();
  const bad = await req("PUT", "/api/settings", { key: "vk_token", value: "wrong" });
  assert.equal(bad.status, 400);
  const good = await req("PUT", "/api/settings", { key: "vk_token", value: "VK-TKN" });
  assert.equal(good.status, 200);
  close();
});

test("PUT /api/settings youtube_api_key больше не поддерживается (unknown key)", async () => {
  const { req, close } = setup();
  const r = await req("PUT", "/api/settings", { key: "youtube_api_key", value: "anything" });
  assert.equal(r.status, 400);
  close();
});

test("PUT /api/settings пустое значение очищает без валидации", async () => {
  const { req, close } = setup();
  const r = await req("PUT", "/api/settings", { key: "vk_token", value: "" });
  assert.equal(r.status, 200);
  close();
});

test("search: только TG когда VK-токена нет", async () => {
  const { req, close } = setup({ withVkToken: false });
  await req("POST", "/api/sources", { platform: "telegram", ref: "@a" });
  await req("POST", "/api/sources", { platform: "vk", ref: "durov" });
  const r = await (await req("POST", "/api/search", { period: "week", keywords: [] })).json();
  const platforms = new Set(r.items.map((i) => i.platform));
  assert.deepEqual([...platforms], ["telegram"]);
  close();
});

test("search: агрегирует TG+VK когда VK-токен задан", async () => {
  const { req, close } = setup({ withVkToken: true });
  await req("POST", "/api/sources", { platform: "telegram", ref: "@a" });
  await req("POST", "/api/sources", { platform: "vk", ref: "durov" });
  const r = await (await req("POST", "/api/search", { period: "week", keywords: [] })).json();
  const platforms = new Set(r.items.map((i) => i.platform));
  assert.deepEqual([...platforms].sort(), ["telegram", "vk"]);
  assert.equal(r.items[0].platform, "vk"); // VK выше по engagement (score=200)
  close();
});

test("per-source keywords: фильтр применяется к постам конкретного источника", async () => {
  const { req, close } = setup();
  // Источник @a с темой "нейросети" — из него только посты с этим словом
  const created = await (await req("POST", "/api/sources", { platform: "telegram", ref: "@a", keywords: ["нейросети"] })).json();
  assert.deepEqual(created.keywords, ["нейросети"]);
  const r = await (await req("POST", "/api/search", { period: "week", keywords: [] })).json();
  assert.equal(r.items.length, 1);
  assert.match(r.items[0].title, /нейросети/);
  close();
});

test("search source_id: сужает поиск до одного источника", async () => {
  // Делаем фейк tgFetch который возвращает по 1 посту на каждый запрашиваемый канал —
  // тогда мы увидим сколько каналов реально запросили.
  const db = openDb(":memory:");
  const password = "p", secret = "s";
  const styleDir = fs.mkdtempSync(path.join(os.tmpdir(), "p3src-style-"));
  const runner = async (_a, payload) => JSON.stringify({ result: `OUT:${payload.slice(0, 12)}` });
  const tgCalls = [];
  const tgFetch = async ({ channels }) => {
    tgCalls.push(channels);
    return channels.map((ch) => ({
      platform: "telegram", source_ref: ch, url: `https://t.me/${ch}/1`,
      title: `T ${ch}`, text: "x", metrics: { views: 1, reactions: 0, comments: 0, forwards: 0 },
      date: Date.now(), score: 1,
    }));
  };
  const app = createServer({ db, password, secret, styleDir, runner, model: "sonnet", tgFetch, vkValidate: async () => true, ytValidate: async () => true });
  const server = app.listen(0);
  const port = server.address().port;
  const token = makeToken(secret, password);
  const req = (m, p, b) => fetch(`http://127.0.0.1:${port}${p}`, { method: m, headers: { "content-type": "application/json", "x-auth-token": token }, body: b ? JSON.stringify(b) : undefined });

  const a = await (await req("POST", "/api/sources", { platform: "telegram", ref: "@a" })).json();
  await req("POST", "/api/sources", { platform: "telegram", ref: "@b" });
  await req("POST", "/api/sources", { platform: "telegram", ref: "@c" });

  // Без source_id — все 3 канала
  const all = await (await req("POST", "/api/search", { period: "week" })).json();
  assert.equal(all.items.length, 3);
  assert.equal(tgCalls[0].length, 3);

  // С source_id — только @a
  const one = await (await req("POST", "/api/search", { period: "week", source_id: a.id })).json();
  assert.equal(one.items.length, 1);
  assert.equal(one.items[0].source_ref, "@a");
  assert.equal(tgCalls[1].length, 1);

  server.close();
});

test("browse: возвращает посты канала отсортированные новые-сверху, без фильтров", async () => {
  const db = openDb(":memory:");
  const password = "p", secret = "s";
  const styleDir = fs.mkdtempSync(path.join(os.tmpdir(), "p3br-style-"));
  const runner = async () => JSON.stringify({ result: `OUT` });
  const now = Date.now();
  // Возвращает 3 поста с разными датами
  const tgFetch = async () => ([
    { platform: "telegram", source_ref: "@a", url: "u1", title: "old", text: "x", metrics: { views: 1 }, date: now - 100000, score: 1 },
    { platform: "telegram", source_ref: "@a", url: "u3", title: "newest", text: "y", metrics: { views: 3 }, date: now, score: 3 },
    { platform: "telegram", source_ref: "@a", url: "u2", title: "mid", text: "z", metrics: { views: 2 }, date: now - 50000, score: 2 },
  ]);
  const app = createServer({ db, password, secret, styleDir, runner, model: "sonnet", tgFetch, vkValidate: async () => true, ytValidate: async () => true });
  const server = app.listen(0);
  const port = server.address().port;
  const token = makeToken(secret, password);
  const req = (m, p, b) => fetch(`http://127.0.0.1:${port}${p}`, { method: m, headers: { "content-type": "application/json", "x-auth-token": token }, body: b ? JSON.stringify(b) : undefined });

  const src = await (await req("POST", "/api/sources", { platform: "telegram", ref: "@a", keywords: ["должен_игнорироваться"] })).json();
  const r = await (await req("POST", `/api/sources/${src.id}/browse`, { limit: 10 })).json();
  assert.equal(r.count, 3);
  // Новые сверху
  assert.equal(r.items[0].title, "newest");
  assert.equal(r.items[1].title, "mid");
  assert.equal(r.items[2].title, "old");
  // published_at в ответе
  assert.ok(r.items[0].published_at > r.items[2].published_at);
  // Фильтры НЕ применяются — keyword "должен_игнорироваться" в источнике, но посты прошли
  server.close();
});

test("browse: 404 на несуществующий id источника", async () => {
  const db = openDb(":memory:");
  const password = "p", secret = "s";
  const styleDir = fs.mkdtempSync(path.join(os.tmpdir(), "p3br2-style-"));
  const runner = async () => JSON.stringify({ result: "OUT" });
  const app = createServer({ db, password, secret, styleDir, runner, model: "sonnet", vkValidate: async () => true, ytValidate: async () => true });
  const server = app.listen(0);
  const port = server.address().port;
  const token = makeToken(secret, password);
  const r = await fetch(`http://127.0.0.1:${port}/api/sources/9999/browse`, { method: "POST", headers: { "content-type": "application/json", "x-auth-token": token }, body: "{}" });
  assert.equal(r.status, 404);
  server.close();
});

test("PUT /api/sources/:id обновляет keywords", async () => {
  const { req, close } = setup();
  const created = await (await req("POST", "/api/sources", { platform: "telegram", ref: "@a" })).json();
  assert.deepEqual(created.keywords, []);
  const updated = await (await req("PUT", `/api/sources/${created.id}`, { keywords: ["AI", "gpt"] })).json();
  assert.deepEqual(updated.keywords, ["AI", "gpt"]);
  // Очистка
  const cleared = await (await req("PUT", `/api/sources/${created.id}`, { keywords: null })).json();
  assert.deepEqual(cleared.keywords, []);
  close();
});
