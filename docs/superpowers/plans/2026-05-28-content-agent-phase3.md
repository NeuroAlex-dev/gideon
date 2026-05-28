# Контент-Агент — Фаза 3 (VK + YouTube) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline) или subagent-driven-development.

**Goal:** Добавить мониторинг VK и YouTube. Источники этих платформ участвуют в общем дайджесте «🔍 Найти информацию» вместе с Telegram, с метриками виральности (лайки/репосты/комменты/просмотры). Ввод ключей — через раздел Настройки в боте.

**Architecture:** Два новых плагин-коннектора в `lib/sources/` с единым интерфейсом (как `telegram.js`). Каждый ждёт свой ключ через `settings` (БД). При поиске сервис агрегирует только те платформы, у которых ключ задан и источники добавлены. HTTP-вызовы внешних API — простые fetch'и, без SDK. Бот получает в Настройках мастер ввода ключей с валидацией одним запросом к API.

**Tech Stack:** уже всё есть (Node 20 + express + native fetch). Зависимости не добавляются.

**Скоуп Фазы 3 / вне скоупа:**
- В скоупе: VK + YouTube коннекторы, ввод/валидация ключей, источники с платформой, агрегированный поиск
- Вне скоупа: vc.ru/dtf/Tenchat/IG (Фаза 6), авто-мониторинг по расписанию (отдельная фаза), контент-план (Фаза 4)

---

## File Structure

| Файл | Действие | Что |
|---|---|---|
| `lib/sources/vk.js` | Создать | VK API wall.get + чистые хелперы |
| `lib/sources/youtube.js` | Создать | YouTube Data API v3 + чистые хелперы |
| `server.js` | Изменить | Агрегация поиска по платформам, валидация ключей в PUT /settings |
| `.agent/bot/content-menu.js` | Изменить | Мастер ввода VK/YT ключей, выбор платформы при добавлении источника, отображение каналов с эмодзи платформы |
| `test/vk-source.test.js` | Создать | Юнит-тесты VK-коннектора |
| `test/youtube-source.test.js` | Создать | Юнит-тесты YouTube-коннектора |
| `test/server.phase3.test.js` | Создать | Агрегация платформ + валидация ключей |

---

## Task 1: VK-коннектор (lib/sources/vk.js)

**Files:** Create `projects/content-agent/lib/sources/vk.js` и `test/vk-source.test.js`.

- [ ] **Step 1: Тест чистых хелперов**

```javascript
// test/vk-source.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVkRef, buildVkUrl, normalizeVkPost, fetchVkWall } from "../lib/sources/vk.js";

test("parseVkRef разные форматы", () => {
  assert.equal(parseVkRef("durov"), "durov");
  assert.equal(parseVkRef("@durov"), "durov");
  assert.equal(parseVkRef("https://vk.com/durov"), "durov");
  assert.equal(parseVkRef("vk.com/club1"), "club1");
});

test("buildVkUrl", () => {
  assert.equal(buildVkUrl(1, 42), "https://vk.com/wall1_42");
  assert.equal(buildVkUrl(-1, 42), "https://vk.com/wall-1_42");
});

test("normalizeVkPost", () => {
  const post = { id: 5, owner_id: -100, text: "Привет\nмир", date: 1700000000, views: { count: 1000 }, likes: { count: 50 }, reposts: { count: 10 }, comments: { count: 3 } };
  const n = normalizeVkPost(post);
  assert.equal(n.platform, "vk");
  assert.equal(n.url, "https://vk.com/wall-100_5");
  assert.equal(n.title, "Привет");
  assert.equal(n.text, "Привет\nмир");
  assert.equal(n.metrics.views, 1000);
  assert.equal(n.metrics.reactions, 50);
  assert.equal(n.metrics.forwards, 10);
  assert.equal(n.metrics.comments, 3);
  assert.equal(n.date, 1700000000 * 1000);
  assert.ok(n.score > 0);
});

test("fetchVkWall: dependency injection (fakeFetch)", async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    if (url.includes("utils.resolveScreenName")) {
      return { json: async () => ({ response: { type: "group", object_id: 100 } }) };
    }
    return { json: async () => ({ response: { count: 1, items: [
      { id: 5, owner_id: -100, text: "пост о gpt", date: Math.floor(Date.now()/1000) - 10, views: { count: 500 }, likes: { count: 25 }, reposts: { count: 5 }, comments: { count: 2 } },
    ] } }) };
  };
  const posts = await fetchVkWall({ screenName: "durov", token: "TKN", count: 10, fetch: fakeFetch });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, "https://vk.com/wall-100_5");
  assert.ok(calls[0].includes("utils.resolveScreenName"));
  assert.ok(calls[1].includes("wall.get"));
  assert.ok(calls[1].includes("access_token=TKN"));
});
```

- [ ] **Step 2: Реализация**

```javascript
// lib/sources/vk.js
const VK_API = "https://api.vk.com/method";
const VK_VERSION = "5.199";

export function parseVkRef(input) {
  let s = String(input || "").trim();
  s = s.replace(/^https?:\/\/(?:www\.)?vk\.com\//i, "");
  s = s.replace(/^@/, "");
  s = s.split(/[/?#]/)[0];
  return s;
}

export function buildVkUrl(ownerId, postId) {
  return `https://vk.com/wall${ownerId}_${postId}`;
}

export function normalizeVkPost(post) {
  const text = post.text || "";
  const firstLine = text.split("\n").find((l) => l.trim()) || "(без текста)";
  const metrics = {
    views: post.views?.count || 0,
    reactions: post.likes?.count || 0,
    forwards: post.reposts?.count || 0,
    comments: post.comments?.count || 0,
  };
  return {
    platform: "vk",
    url: buildVkUrl(post.owner_id, post.id),
    title: firstLine.slice(0, 120),
    text,
    metrics,
    date: post.date ? post.date * 1000 : null,
    score: metrics.views * 0.01 + metrics.reactions * 2 + metrics.comments * 5 + metrics.forwards * 3,
  };
}

async function vkCall(method, params, fetchImpl, token) {
  const qs = new URLSearchParams({ ...params, v: VK_VERSION, access_token: token }).toString();
  const res = await fetchImpl(`${VK_API}/${method}?${qs}`);
  const data = await res.json();
  if (data.error) {
    throw new Error(`vk.${method}: ${data.error.error_msg || data.error.code}`);
  }
  return data.response;
}

export async function fetchVkWall({ screenName, token, count = 50, sinceTs = 0, fetch: fetchImpl = globalThis.fetch }) {
  if (!token) throw new Error("VK токен не задан");
  const screen = parseVkRef(screenName);
  // Резолвим screen name → owner_id
  const resolved = await vkCall("utils.resolveScreenName", { screen_name: screen }, fetchImpl, token);
  if (!resolved?.object_id) throw new Error(`vk: не нашёл "${screen}"`);
  const ownerId = resolved.type === "group" ? -resolved.object_id : resolved.object_id;
  // Читаем стену
  const wall = await vkCall("wall.get", { owner_id: ownerId, count }, fetchImpl, token);
  const out = [];
  for (const p of wall.items || []) {
    if (p.date && p.date * 1000 < sinceTs) continue;
    if (!p.text) continue;
    out.push({ ...normalizeVkPost(p), source_ref: screenName });
  }
  return out;
}

// Лёгкая проверка токена — возвращает true/false без выброса
export async function validateVkToken(token, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(`${VK_API}/users.get?${new URLSearchParams({ v: VK_VERSION, access_token: token })}`);
    const data = await res.json();
    return !data.error;
  } catch { return false; }
}
```

- [ ] **Step 3: Прогон тестов**

`npm test` → vk-source.test.js зелёные + все старые проходят.

- [ ] **Step 4: Commit**

```bash
git add projects/content-agent/lib/sources/vk.js projects/content-agent/test/vk-source.test.js
git commit -m "feat(content-agent): VK-коннектор (wall.get + метрики, инъекция fetch)"
```

---

## Task 2: YouTube-коннектор (lib/sources/youtube.js)

**Files:** Create `projects/content-agent/lib/sources/youtube.js` и `test/youtube-source.test.js`.

- [ ] **Step 1: Тест**

```javascript
// test/youtube-source.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYtRef, buildYtUrl, normalizeYtVideo, fetchYouTubeChannel } from "../lib/sources/youtube.js";

test("parseYtRef разные форматы", () => {
  assert.deepEqual(parseYtRef("@MKBHD"), { handle: "@MKBHD", id: null });
  assert.deepEqual(parseYtRef("MKBHD"), { handle: "@MKBHD", id: null });
  assert.deepEqual(parseYtRef("https://www.youtube.com/@MKBHD"), { handle: "@MKBHD", id: null });
  assert.deepEqual(parseYtRef("UCBJycsmduvYEL83R_U4JriQ"), { handle: null, id: "UCBJycsmduvYEL83R_U4JriQ" });
  assert.deepEqual(parseYtRef("https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ"), { handle: null, id: "UCBJycsmduvYEL83R_U4JriQ" });
});

test("buildYtUrl", () => {
  assert.equal(buildYtUrl("abc123"), "https://youtu.be/abc123");
});

test("normalizeYtVideo", () => {
  const item = {
    id: "vid1",
    snippet: { title: "Заголовок", description: "описание", publishedAt: "2024-01-15T12:00:00Z" },
    statistics: { viewCount: "10000", likeCount: "500", commentCount: "30" },
  };
  const n = normalizeYtVideo(item);
  assert.equal(n.platform, "youtube");
  assert.equal(n.url, "https://youtu.be/vid1");
  assert.equal(n.title, "Заголовок");
  assert.equal(n.metrics.views, 10000);
  assert.equal(n.metrics.reactions, 500);
  assert.equal(n.metrics.comments, 30);
  assert.equal(n.metrics.forwards, 0);
  assert.ok(n.date > 0);
});

test("fetchYouTubeChannel: fake fetch, последовательность вызовов", async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    if (url.includes("channels?")) {
      return { json: async () => ({ items: [{ contentDetails: { relatedPlaylists: { uploads: "UU_uploads_123" } } }] }) };
    }
    if (url.includes("playlistItems?")) {
      return { json: async () => ({ items: [
        { snippet: { resourceId: { videoId: "vid1" }, publishedAt: new Date().toISOString() } },
        { snippet: { resourceId: { videoId: "vid2" }, publishedAt: new Date().toISOString() } },
      ] }) };
    }
    if (url.includes("videos?")) {
      return { json: async () => ({ items: [
        { id: "vid1", snippet: { title: "T1", description: "d", publishedAt: new Date().toISOString() }, statistics: { viewCount: "100", likeCount: "10", commentCount: "1" } },
      ] }) };
    }
    return { json: async () => ({}) };
  };
  const posts = await fetchYouTubeChannel({ ref: "@MKBHD", apiKey: "KEY", maxResults: 5, fetch: fakeFetch });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, "https://youtu.be/vid1");
  assert.ok(calls[0].includes("forHandle=%40MKBHD"));
  assert.ok(calls[1].includes("playlistId=UU_uploads_123"));
  assert.ok(calls[2].includes("videos?"));
});
```

- [ ] **Step 2: Реализация**

```javascript
// lib/sources/youtube.js
const YT_API = "https://www.googleapis.com/youtube/v3";

export function parseYtRef(input) {
  let s = String(input || "").trim();
  s = s.replace(/^https?:\/\/(?:www\.)?youtube\.com\//i, "");
  if (s.startsWith("channel/")) return { handle: null, id: s.slice("channel/".length).split(/[/?#]/)[0] };
  if (s.startsWith("UC") && /^UC[\w-]{20,}$/.test(s)) return { handle: null, id: s };
  s = s.replace(/^@/, "");
  s = s.split(/[/?#]/)[0];
  return { handle: "@" + s, id: null };
}

export function buildYtUrl(videoId) { return `https://youtu.be/${videoId}`; }

export function normalizeYtVideo(item) {
  const sn = item.snippet || {};
  const st = item.statistics || {};
  return {
    platform: "youtube",
    url: buildYtUrl(item.id),
    title: (sn.title || "(без названия)").slice(0, 120),
    text: sn.title + (sn.description ? "\n\n" + sn.description : ""),
    metrics: {
      views: Number(st.viewCount) || 0,
      reactions: Number(st.likeCount) || 0,
      comments: Number(st.commentCount) || 0,
      forwards: 0,
    },
    date: sn.publishedAt ? new Date(sn.publishedAt).getTime() : null,
    score: (Number(st.viewCount) || 0) * 0.001 + (Number(st.likeCount) || 0) * 2 + (Number(st.commentCount) || 0) * 5,
  };
}

async function ytGet(path, params, apiKey, fetchImpl) {
  const qs = new URLSearchParams({ ...params, key: apiKey }).toString();
  const res = await fetchImpl(`${YT_API}/${path}?${qs}`);
  const data = await res.json();
  if (data.error) throw new Error(`youtube.${path}: ${data.error.message || data.error.code}`);
  return data;
}

export async function fetchYouTubeChannel({ ref, apiKey, maxResults = 25, sinceTs = 0, fetch: fetchImpl = globalThis.fetch }) {
  if (!apiKey) throw new Error("YouTube API ключ не задан");
  const parsed = parseYtRef(ref);
  // 1) Получаем uploads playlist id
  const chParams = parsed.id ? { id: parsed.id, part: "contentDetails" } : { forHandle: parsed.handle, part: "contentDetails" };
  const chData = await ytGet("channels", chParams, apiKey, fetchImpl);
  const uploads = chData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error(`youtube: канал "${ref}" не найден`);
  // 2) Берём последние видео
  const itemsData = await ytGet("playlistItems", { playlistId: uploads, part: "snippet", maxResults }, apiKey, fetchImpl);
  const videoIds = (itemsData.items || [])
    .filter((it) => {
      const ts = it.snippet?.publishedAt ? new Date(it.snippet.publishedAt).getTime() : 0;
      return ts >= sinceTs;
    })
    .map((it) => it.snippet?.resourceId?.videoId)
    .filter(Boolean);
  if (!videoIds.length) return [];
  // 3) Статистика
  const statsData = await ytGet("videos", { id: videoIds.join(","), part: "snippet,statistics" }, apiKey, fetchImpl);
  return (statsData.items || []).map((v) => ({ ...normalizeYtVideo(v), source_ref: ref }));
}

export async function validateYtKey(apiKey, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(`${YT_API}/channels?part=id&forHandle=%40YouTube&key=${encodeURIComponent(apiKey)}`);
    const data = await res.json();
    return !data.error;
  } catch { return false; }
}
```

- [ ] **Step 3: Тесты + commit**

`npm test` → зелёные. Commit:
```bash
git add projects/content-agent/lib/sources/youtube.js projects/content-agent/test/youtube-source.test.js
git commit -m "feat(content-agent): YouTube-коннектор (uploads playlist + statistics)"
```

---

## Task 3: Сервер — агрегация платформ + валидация ключей

**Files:** `projects/content-agent/server.js` + `test/server.phase3.test.js`.

- [ ] **Step 1: Тест**

```javascript
// test/server.phase3.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createServer } from "../server.js";
import { openDb, setSetting } from "../lib/db.js";
import { makeToken } from "../lib/auth.js";

function setup({ withVkToken = false, withYtKey = false } = {}) {
  const db = openDb(":memory:");
  if (withVkToken) setSetting(db, "vk_token", "VK-TKN");
  if (withYtKey) setSetting(db, "youtube_api_key", "YT-KEY");
  const password = "p", secret = "s";
  const styleDir = fs.mkdtempSync(path.join(os.tmpdir(), "p3-style-"));
  const runner = async (_a, payload) => JSON.stringify({ result: `OUT:${payload.slice(0, 12)}` });
  const tgFetch = async () => [{ platform: "telegram", source_ref: "@a", url: "https://t.me/a/1", title: "TG", text: "TG body", metrics: { views: 10, reactions: 1, comments: 0, forwards: 0 }, date: Date.now(), score: 1 }];
  const vkFetch = async () => [{ platform: "vk", source_ref: "durov", url: "https://vk.com/wall1_1", title: "VK", text: "VK body", metrics: { views: 100, reactions: 50, comments: 5, forwards: 3 }, date: Date.now(), score: 200 }];
  const ytFetch = async () => [{ platform: "youtube", source_ref: "@MKBHD", url: "https://youtu.be/x", title: "YT", text: "YT body", metrics: { views: 1000, reactions: 100, comments: 10, forwards: 0 }, date: Date.now(), score: 50 }];
  const vkValidate = async (t) => t === "VK-TKN";
  const ytValidate = async (k) => k === "YT-KEY";
  const app = createServer({ db, password, secret, styleDir, runner, model: "sonnet", tgFetch, vkFetch, ytFetch, vkValidate, ytValidate });
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

test("search учитывает только платформы с ключами", async () => {
  // только TG ключа не нужно — TG всегда доступен
  const { req, close } = setup({ withVkToken: false, withYtKey: false });
  await req("POST", "/api/sources", { platform: "telegram", ref: "@a" });
  await req("POST", "/api/sources", { platform: "vk", ref: "durov" });
  await req("POST", "/api/sources", { platform: "youtube", ref: "@MKBHD" });
  const r = await (await req("POST", "/api/search", { period: "week", keywords: [] })).json();
  assert.equal(r.items.length, 1); // только TG
  assert.equal(r.items[0].platform, "telegram");
  close();
});

test("search агрегирует TG+VK+YT когда ключи заданы", async () => {
  const { req, close } = setup({ withVkToken: true, withYtKey: true });
  await req("POST", "/api/sources", { platform: "telegram", ref: "@a" });
  await req("POST", "/api/sources", { platform: "vk", ref: "durov" });
  await req("POST", "/api/sources", { platform: "youtube", ref: "@MKBHD" });
  const r = await (await req("POST", "/api/search", { period: "week", keywords: [] })).json();
  const platforms = new Set(r.items.map((i) => i.platform));
  assert.deepEqual([...platforms].sort(), ["telegram", "vk", "youtube"]);
  // отсортировано по engagement: VK score=200 первым
  assert.equal(r.items[0].platform, "vk");
  close();
});
```

- [ ] **Step 2: Изменения в server.js**

(a) Импорты — добавить:
```javascript
import { fetchVkWall, validateVkToken } from "./lib/sources/vk.js";
import { fetchYouTubeChannel, validateYtKey } from "./lib/sources/youtube.js";
```

(b) Расширить сигнатуру createServer:
```javascript
export function createServer({ db, password, secret, styleDir, runner, model, tgFetch, vkFetch, ytFetch, vkValidate, ytValidate }) {
  ...
  const doTgFetch = tgFetch || (({ channels, sinceTs, keywords }) => fetchFromChannels({ channels, sinceTs, keywords }));
  const doVkFetch = vkFetch || (async ({ refs, token, sinceTs }) => {
    const out = [];
    for (const ref of refs) {
      try { out.push(...await fetchVkWall({ screenName: ref, token, sinceTs })); }
      catch (e) { out.push({ platform: "vk", source_ref: ref, error: e.message }); }
    }
    return out;
  });
  const doYtFetch = ytFetch || (async ({ refs, apiKey, sinceTs }) => {
    const out = [];
    for (const ref of refs) {
      try { out.push(...await fetchYouTubeChannel({ ref, apiKey, sinceTs })); }
      catch (e) { out.push({ platform: "youtube", source_ref: ref, error: e.message }); }
    }
    return out;
  });
  const doVkValidate = vkValidate || validateVkToken;
  const doYtValidate = ytValidate || validateYtKey;
```

(c) В обработчике `app.post("/api/search", ...)` после блока с telegram добавить:
```javascript
      if (listSources(db, { platform: "vk" }).length) {
        const vkToken = getSetting(db, "vk_token");
        if (vkToken) {
          const refs = listSources(db, { platform: "vk" }).map((s) => s.ref);
          const sinceTs = periodToSinceTs(period);
          const fetched = await doVkFetch({ refs, token: vkToken, sinceTs });
          items.push(...fetched.filter((x) => !x.error && matchesText(x, include, exclude)));
        }
      }
      if (listSources(db, { platform: "youtube" }).length) {
        const ytKey = getSetting(db, "youtube_api_key");
        if (ytKey) {
          const refs = listSources(db, { platform: "youtube" }).map((s) => s.ref);
          const sinceTs = periodToSinceTs(period);
          const fetched = await doYtFetch({ refs, apiKey: ytKey, sinceTs });
          items.push(...fetched.filter((x) => !x.error && matchesText(x, include, exclude)));
        }
      }
```

И в начало того же обработчика — заменить условие `if (platforms.includes("telegram"))` на просто `if (listSources(db, { platform: "telegram" }).length)` (платформы больше не передаются — поиск идёт по всем добавленным источникам).

(d) Заменить обработчик `app.put("/api/settings", ...)` на версию с валидацией:
```javascript
  app.put("/api/settings", async (req, res) => {
    const { key, value } = req.body || {};
    if (!SETTING_KEYS.includes(key)) return res.status(400).json({ error: "unknown key" });
    const v = String(value ?? "");
    if (v) {
      if (key === "vk_token") {
        const ok = await doVkValidate(v);
        if (!ok) return res.status(400).json({ error: "VK токен не работает (проверь scope=wall и валидность)" });
      }
      if (key === "youtube_api_key") {
        const ok = await doYtValidate(v);
        if (!ok) return res.status(400).json({ error: "YouTube API ключ не работает (проверь YouTube Data API v3 включён в проекте)" });
      }
    }
    setSetting(db, key, v);
    res.json({ ok: true });
  });
```

(e) Добавить функцию-хелпер `matchesText` в server.js (модульный уровень):
```javascript
function matchesText(item, include, exclude) {
  const t = ((item.title || "") + " " + (item.text || "")).toLowerCase();
  for (const ex of exclude) if (ex && t.includes(String(ex).toLowerCase())) return false;
  if (!include.length) return true;
  return include.some((k) => k && t.includes(String(k).toLowerCase()));
}
```

(VK/YT коннекторы возвращают raw posts без фильтра по ключевикам; фильтр делаем на агрегаторе в сервере, чтобы единая логика.)

- [ ] **Step 3: Тесты + commit**

`npm test`. Commit:
```bash
git add projects/content-agent/server.js projects/content-agent/test/server.phase3.test.js
git commit -m "feat(content-agent): агрегация TG+VK+YT в поиске + валидация ключей в settings"
```

---

## Task 4: Бот — настройки, источники с платформой, эмодзи платформ

**Files:** `.agent/bot/content-menu.js` (изменить).

- [ ] **Step 1: Заменить экран «⚙ Настройки» на интерактивный**

Найти текущий `ca:settings` обработчик и заменить на:
```javascript
  bot.callbackQuery(/^ca:settings$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    try {
      const s = await api("GET", "/settings");
      await ctx.answerCallbackQuery();
      const kb = new InlineKeyboard()
        .text(s.vk_token ? "🔄 Заменить VK токен" : "➕ Задать VK токен", "ca:set-vk").row()
        .text(s.youtube_api_key ? "🔄 Заменить YouTube ключ" : "➕ Задать YouTube ключ", "ca:set-yt").row();
      if (s.vk_token) kb.text("🗑 Очистить VK", "ca:clear-vk").row();
      if (s.youtube_api_key) kb.text("🗑 Очистить YouTube", "ca:clear-yt").row();
      kb.text("🏠 Меню", "ca:menu");
      await ctx.reply(
        `⚙ <b>Настройки</b>\n\n` +
        `VK токен: ${s.vk_token ? "✅ задан" : "—"}\n` +
        `YouTube ключ: ${s.youtube_api_key ? "✅ задан" : "—"}\n\n` +
        `<i>Где взять:</i>\n` +
        `• VK: vk.com/apps?act=manage → Создать app → Standalone → «Сервисный ключ» с правами wall\n` +
        `• YouTube: console.cloud.google.com → New project → APIs → YouTube Data API v3 → Credentials → API key`,
        { parse_mode: "HTML", reply_markup: kb },
      );
    } catch (e) {
      await ctx.answerCallbackQuery({ text: "Сервис недоступен" });
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  });

  bot.callbackQuery(/^ca:set-(vk|yt)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const which = ctx.match[1];
    wizards.set(ctx.chat.id, { mode: "set_key", which });
    await ctx.answerCallbackQuery();
    await ctx.reply(
      which === "vk"
        ? "Пришли VK токен (длинная строка, никому не показывай). Я проверю его одним запросом, потом сохраню."
        : "Пришли YouTube API ключ. Я проверю его одним запросом, потом сохраню.",
      { reply_markup: new InlineKeyboard().text("🏠 Меню", "ca:menu") },
    );
  });

  bot.callbackQuery(/^ca:clear-(vk|yt)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const which = ctx.match[1];
    const key = which === "vk" ? "vk_token" : "youtube_api_key";
    try {
      await api("PUT", "/settings", { key, value: "" });
      await ctx.answerCallbackQuery({ text: "Очищено" });
      ctx.message = { ...ctx.message, text: "/content" }; // быстро вернуться к настройкам
      await ctx.reply("🗑 Удалено.", { reply_markup: new InlineKeyboard().text("⚙ Настройки", "ca:settings").row().text("🏠 Меню", "ca:menu") });
    } catch (e) {
      await ctx.answerCallbackQuery({ text: "Ошибка" });
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  });
```

И добавить обработчик ввода ключа в общий поток текста (внутри `registerContentHandlers` или в отдельной функции `registerSettingsHandlers`). Для простоты добавим прямо в существующее меню (рядом с set/clear):
```javascript
  bot.on("message:text", async (ctx, next) => {
    if (!isOwner(ctx)) return next();
    const w = wizards.get(ctx.chat.id);
    if (!w || w.mode !== "set_key") return next();
    const value = ctx.message.text.trim();
    const key = w.which === "vk" ? "vk_token" : "youtube_api_key";
    const wait = await ctx.reply("Проверяю ключ... ⏳");
    try {
      await api("PUT", "/settings", { key, value });
      wizards.delete(ctx.chat.id);
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      await ctx.reply(`✅ ${w.which === "vk" ? "VK токен" : "YouTube ключ"} сохранён и проверен.`,
        { reply_markup: new InlineKeyboard().text("📡 Источники", "ca:sources").text("🔍 Найти инфо", "ca:find").row().text("⚙ Настройки", "ca:settings").row().text("🏠 Меню", "ca:menu") });
    } catch (e) {
      // оставляем wizard активным — пусть пробует ещё раз
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      await ctx.reply(`⚠️ ${esc(e.message)}\n\nПришли ключ ещё раз или нажми Меню.`,
        { reply_markup: new InlineKeyboard().text("🏠 Меню", "ca:menu") });
    }
  });
```

- [ ] **Step 2: Источники — добавление с выбором платформы**

Заменить кнопку «➕ Добавить TG-канал» на меню платформ. В `showSources`:
- если в списке есть смешанные платформы, отображать с эмодзи: 📨 (TG), 🅥 (VK), ▶ (YouTube).
- одна кнопка «➕ Добавить источник» → выбор платформы.

```javascript
  async function showSources(ctx) {
    let sources = [];
    try { sources = await api("GET", "/sources"); } catch (e) {
      await ctx.reply(`⚠️ ${esc(e.message)}`); return;
    }
    const ICON = { telegram: "📨", vk: "🅥", youtube: "▶" };
    const lines = ["📡 <b>Источники мониторинга</b>", "", `Всего источников: ${sources.length}`];
    for (const s of sources) lines.push(`${ICON[s.platform] || "•"} ${esc(s.ref)}${s.title ? " — " + esc(s.title) : ""}`);
    if (!sources.length) lines.push("<i>пока пусто</i>");
    const kb = new InlineKeyboard().text("➕ Добавить источник", "ca:src-platform").row();
    for (const s of sources) kb.text(`❌ ${ICON[s.platform] || ""} ${s.ref}`, `ca:src-del:${s.id}`).row();
    if (sources.length) kb.text("🔍 Найти информацию", "ca:find").row();
    kb.text("🏠 Меню", "ca:menu");
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML", reply_markup: kb });
  }

  bot.callbackQuery(/^ca:src-platform$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    let s;
    try { s = await api("GET", "/settings"); } catch { s = {}; }
    const kb = new InlineKeyboard()
      .text("📨 Telegram", "ca:src-add:telegram").row();
    kb.text(s.vk_token ? "🅥 VK" : "🅥 VK (нет токена)", s.vk_token ? "ca:src-add:vk" : "ca:set-vk").row();
    kb.text(s.youtube_api_key ? "▶ YouTube" : "▶ YouTube (нет ключа)", s.youtube_api_key ? "ca:src-add:youtube" : "ca:set-yt").row();
    kb.text("🏠 Меню", "ca:menu");
    await ctx.reply("Какая платформа?", { reply_markup: kb });
  });

  bot.callbackQuery(/^ca:src-add:(\w+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const platform = ctx.match[1];
    await ctx.answerCallbackQuery();
    wizards.set(ctx.chat.id, { mode: "src_add", platform });
    const prompt = platform === "telegram"
      ? "Пришли @username канала или ссылку (<code>@durov</code> или <code>https://t.me/durov</code>):"
      : platform === "vk"
        ? "Пришли короткое имя группы/паблика или ссылку (<code>durov</code> или <code>https://vk.com/durov</code>):"
        : "Пришли @handle канала или ссылку (<code>@MKBHD</code> или <code>https://www.youtube.com/@MKBHD</code>):";
    await ctx.reply(prompt, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("🏠 Меню", "ca:menu") });
  });
```

И в существующем `bot.on("message:text")` (src_add) — нормализация ref по платформе, отправка с platform из wizard:
```javascript
  bot.on("message:text", async (ctx, next) => {
    if (!isOwner(ctx)) return next();
    const w = wizards.get(ctx.chat.id);
    if (!w || w.mode !== "src_add") return next();
    let ref = ctx.message.text.trim();
    // нормализация по платформе
    if (w.platform === "telegram") {
      const m = ref.match(/t\.me\/(@?[\w\d_]+)/i);
      if (m) ref = m[1];
      if (!ref.startsWith("@") && !/^[\w\d_]+$/.test(ref)) {
        await ctx.reply("Не похоже на TG-канал. Пришли @username или ссылку t.me/...", { reply_markup: new InlineKeyboard().text("🏠 Меню", "ca:menu") });
        return;
      }
      if (!ref.startsWith("@")) ref = "@" + ref;
    } else if (w.platform === "vk") {
      ref = ref.replace(/^https?:\/\/(?:www\.)?vk\.com\//i, "").replace(/^@/, "").split(/[/?#]/)[0];
      if (!/^[\w\d_.-]+$/.test(ref)) {
        await ctx.reply("Не похоже на VK-сообщество. Пришли короткое имя (например <code>durov</code>) или ссылку.", { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("🏠 Меню", "ca:menu") });
        return;
      }
    } else if (w.platform === "youtube") {
      // ref оставляем как есть — нормализацию делает коннектор. Проверим что не пусто.
      if (!ref.length) { await ctx.reply("Пусто. Пришли @handle или ссылку.", { reply_markup: new InlineKeyboard().text("🏠 Меню", "ca:menu") }); return; }
    }
    wizards.delete(ctx.chat.id);
    try {
      await api("POST", "/sources", { platform: w.platform, ref });
      const ICON = { telegram: "📨", vk: "🅥", youtube: "▶" };
      await ctx.reply(`✅ Источник ${ICON[w.platform]} ${esc(ref)} добавлен.`,
        { reply_markup: new InlineKeyboard().text("🔍 Найти информацию", "ca:find").text("📡 Источники", "ca:sources").row().text("➕ Ещё источник", "ca:src-platform").row().text("🏠 Меню", "ca:menu") });
    } catch (e) {
      await ctx.reply(`⚠️ ${esc(e.message)}`, { reply_markup: new InlineKeyboard().text("➕ Попробовать ещё", "ca:src-platform").row().text("🏠 Меню", "ca:menu") });
    }
  });
```

- [ ] **Step 3: «🔍 Найти информацию» — счётчик по платформам**

В `ca:find` показываем разбивку: «📨 N · 🅥 M · ▶ K каналов». Меняем подсчёт:
```javascript
  bot.callbackQuery(/^ca:find$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    wizards.set(ctx.chat.id, { mode: "find" });
    let counts = { telegram: 0, vk: 0, youtube: 0 };
    try {
      const all = await api("GET", "/sources");
      for (const s of all) counts[s.platform] = (counts[s.platform] || 0) + 1;
    } catch {}
    const totalChannels = counts.telegram + counts.vk + counts.youtube;
    const kb = new InlineKeyboard().text("➕ Добавить источник", "ca:src-platform").row();
    for (const [label, val] of PERIODS) kb.text(label, `ca:find-period:${val}`);
    kb.row().text("🏠 Меню", "ca:menu");
    const breakdown = `📨 ${counts.telegram} · 🅥 ${counts.vk} · ▶ ${counts.youtube}`;
    const head = totalChannels
      ? `🔍 <b>Найти информацию</b>\n\nИсточников: ${breakdown}. За какой период искать?`
      : `🔍 <b>Найти информацию</b>\n\n<i>Пока нет источников.</i> Сначала добавь — потом выбери период.`;
    await ctx.reply(head, { parse_mode: "HTML", reply_markup: kb });
  });
```

- [ ] **Step 4: Дайджест — показывать эмодзи платформы рядом с заголовком**

В `sendDigest`:
```javascript
  async function sendDigest(ctx, digestId, items) {
    const ICON = { telegram: "📨", vk: "🅥", youtube: "▶" };
    await ctx.reply(`📰 <b>Дайджест</b> — найдено ${items.length}`, { parse_mode: "HTML" });
    for (const it of items) {
      const m = it.metrics || {};
      const ic = ICON[it.platform] || "•";
      const text = `${ic} <b>${esc(it.title)}</b>\n${esc(it.summary || "")}\n\n` +
        `👁 ${m.views || 0} · ❤️ ${m.reactions || 0} · 💬 ${m.comments || 0} · 🔁 ${m.forwards || 0}` +
        (it.url ? `\n${esc(it.url)}` : "");
      const kb = new InlineKeyboard().text("✍ Пост из этой новости", `ca:news-post:${it.id}`);
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
    }
    const kb = new InlineKeyboard()
      .text("✂️ Короче", `ca:dig-reshape:${digestId}:shorter`).text("➕ Детальнее", `ca:dig-reshape:${digestId}:detailed`).row()
      .text("💾 Сохранить дайджест", `ca:dig-save:${digestId}`).row()
      .text("🔍 Новый поиск", "ca:find").text("🏠 Меню", "ca:menu");
    await ctx.reply("Действия с дайджестом:", { reply_markup: kb });
  }
```

- [ ] **Step 5: Главное меню — кнопка «📡 Источники» теперь видна как «📡 Источники» (без изменений), но `INSTRUCTION` подправить (источники работают, не «в следующих фазах»)**

Найти текст `INSTRUCTION` и заменить упоминание «📡 Источники» в перечне ожидаемых:
```
<b>🔍 Найти информацию</b>, <b>📆 Дайджест</b>, <b>📖 Контент-план</b>, <b>📡 Источники</b> — появятся в следующих фазах.
```
на:
```
<b>📡 Источники</b> — добавь каналы конкурентов в Telegram, VK, YouTube (для VK/YT нужны бесплатные ключи — заведи в ⚙ Настройках).
<b>🔍 Найти информацию</b> — собираю дайджест по твоим источникам с метриками виральности.

<b>📆 Дайджест</b>, <b>📖 Контент-план</b> — появятся в следующих фазах.
```

- [ ] **Step 6: Синтаксис + sync + restart + commit**

```
node --check .agent/bot/content-menu.js
cp .agent/bot/content-menu.js C:\Users\Administrator\.agent\bot\content-menu.js
pm2 restart agent-bot
git add .agent/bot/content-menu.js
git commit -m "feat(bot): Фаза 3 UI — Настройки с ключами, источники с платформой, эмодзи в дайджесте"
```

---

## Task 5: Деплой + smoke

- [ ] **Step 1: Полный прогон тестов** `npm test` — все зелёные.
- [ ] **Step 2: Рестарт сервиса** `pm2 restart agent-content-server`.
- [ ] **Step 3: Smoke с фейками** — все TG-функции продолжают работать (Phase 2 не сломалась).
- [ ] **Step 4: Когда Александр пришлёт VK-токен и YT-ключ** — задать в /settings, добавить VK/YT источник, прогнать поиск. (Этот шаг на стороне Александра.)

---

## Self-Review

**Spec coverage (Фаза 3 из §9):**
- VK API + метрики (likes/reposts/comments/views) — Task 1 ✓
- YouTube Data API + метрики (views/likes/comments) — Task 2 ✓
- Источники с указанием платформы (TG/VK/YT), валидация ключей перед сохранением — Task 3+4 ✓
- Поиск агрегирует только платформы с настроенными ключами — Task 3 ✓
- UX-принцип «действия на экране где нужны» соблюдается (Меню + связанные кнопки добавлены в новые экраны) — Task 4 ✓

**Placeholder scan:** код полный.

**Type consistency:** fetchVkWall/fetchYouTubeChannel/validateVkToken/validateYtKey/parseVkRef/parseYtRef/buildVkUrl/buildYtUrl/normalizeVkPost/normalizeYtVideo; createServer({...vkFetch, ytFetch, vkValidate, ytValidate}); SETTING_KEYS остаётся `["vk_token", "youtube_api_key", "publish_targets"]` (из Фазы 1, проверить что не дублируется).

**Ambiguity:**
- Без VK-токена или YT-ключа коннектор пропускается в поиске тихо (просто 0 постов с этой платформы). Если у Александра 0 источников VK и есть токен — VK тоже скипается (нечего читать).
- Валидация VK = `users.get`, валидация YT = `channels?forHandle=@YouTube` (минимальные запросы).
- Лимиты API: VK 5 запросов/сек на токен — для 1-5 источников не проблема. YouTube 10k единиц/день, наш запрос ~3 единицы на канал — тоже хватает.
