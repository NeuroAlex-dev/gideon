# Контент-Агент — Фаза 2 (TG-мониторинг + дайджест) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) или subagent-driven-development. Шаги — чекбоксы `- [ ]`.

**Goal:** Добавить в Контент-Агента мониторинг Telegram-каналов конкурентов: управление списком источников и ключевиков, on-demand поиск «🔍 Найти информацию» по каналам с метриками вовлечённости, структурированный дайджест с кнопками (короче/детальнее/сохранить/✍ пост из новости → Фаза 1).

**Architecture:** Расширяем существующий сервис `projects/content-agent/` (Фаза 1). TG-чтение через GramJS, **connect-on-demand** на общей сессии аккаунта (читаем `../parser/data/sessions`, как sales-manager; не держим постоянное соединение и НЕ перезаписываем файл сессии — чтобы не мешать парсеру/sales). Поиск синхронный по HTTP (как генерация в Фазе 1): бот показывает «ищу…», сервис фетчит каналы + строит дайджест. Фоновый воркер НЕ нужен (он для будущего авто-мониторинга по расписанию).

**Tech Stack:** Node.js v20 (ESM), better-sqlite3, express, **telegram (GramJS)**; тесты — `node:test`.

**Scope (Фаза 2):** источники TG (add/remove), ключевики (add/remove), on-demand поиск по TG, дайджест, «пост из новости». **Вне Фазы 2:** VK/YouTube (Фаза 3), авто-мониторинг по расписанию + воркер (позже), хрупкие источники (Фаза 6).

**Гигиена общей сессии (критично):** content-agent открывает GramJS-клиент только на время поиска и сразу отключается. НИКОГДА не вызывает `session.save()` (чтение не должно перезаписать файл сессии, которым владеет парсер). API_ID/HASH — из `parser/.env`.

---

## File Structure

| Файл | Ответственность | Действие |
|---|---|---|
| `lib/sessions-manager.js` | Чтение активной TG-сессии парсера (`../parser/data/sessions`) | Создать (копия sales) |
| `lib/sources/telegram.js` | Чистые хелперы (нормализация, фильтр, период, score) + `fetchFromChannels` (connect-on-demand) | Создать |
| `lib/digest.js` | Экстрактивное саммари по постам + AI-reshape (короче/детальнее) | Создать |
| `lib/db.js` | + таблицы sources, keywords, digests, digest_items + хелперы | Изменить |
| `server.js` | + эндпоинты sources/keywords/search/digests + origin=digest_item в /posts | Изменить |
| `.agent/bot/content-menu.js` | + «📡 Источники», «🔍 Найти информацию», рендер дайджеста, «✍ пост из новости» | Изменить |
| `package.json` | + зависимость `telegram` | Изменить |
| `test/*.test.js` | Юнит/интеграционные тесты | Создать |

---

## Task 1: Зависимость GramJS + копия sessions-manager

**Files:**
- Modify: `projects/content-agent/package.json`
- Create: `projects/content-agent/lib/sessions-manager.js`
- Test: `projects/content-agent/test/sessions-manager.test.js`

- [ ] **Step 1: Добавить `telegram` в зависимости package.json**

В блок `"dependencies"` добавить строку (после `"express"`):
```json
    "telegram": "^2.26.16",
```

- [ ] **Step 2: Установить**

Run: `powershell -Command '$env:PATH = "C:\Users\Administrator\nodejs;" + $env:PATH; cd "C:\Users\Administrator\Documents\Projects\gideon\projects\content-agent"; npm install'`
Expected: `telegram` добавлен в node_modules.

- [ ] **Step 3: Создать lib/sessions-manager.js (читает сессию парсера, read-only)**

```javascript
// lib/sessions-manager.js
import fs from "node:fs";
import path from "node:path";

const PARSER_DATA_DIR = path.resolve("../parser/data");
const META_PATH = path.join(PARSER_DATA_DIR, "sessions", "_meta.json");
const LEGACY_SESSION_PATH = path.join(PARSER_DATA_DIR, "session.txt");

export function listAccounts() {
  if (fs.existsSync(META_PATH)) {
    try {
      const meta = JSON.parse(fs.readFileSync(META_PATH, "utf8"));
      const active = meta.activeId;
      return (meta.sessions || []).map((s) => ({
        id: s.id, label: s.label || s.id, username: s.username || null, isActive: s.id === active,
      }));
    } catch { return []; }
  }
  if (fs.existsSync(LEGACY_SESSION_PATH)) {
    return [{ id: "legacy", label: "Мой аккаунт (legacy)", username: null, isActive: true }];
  }
  return [];
}

export function getActiveAccountId() {
  if (fs.existsSync(META_PATH)) {
    try { return JSON.parse(fs.readFileSync(META_PATH, "utf8")).activeId || null; } catch { return null; }
  }
  return fs.existsSync(LEGACY_SESSION_PATH) ? "legacy" : null;
}

export function getSessionString(id) {
  if (!id || id === "active") {
    id = getActiveAccountId();
  }
  if (id === "legacy") {
    if (!fs.existsSync(LEGACY_SESSION_PATH)) throw new Error(`session: legacy ${LEGACY_SESSION_PATH} не найден`);
    return fs.readFileSync(LEGACY_SESSION_PATH, "utf8").trim();
  }
  const sessionFile = path.join(PARSER_DATA_DIR, "sessions", `${id}.txt`);
  if (!fs.existsSync(sessionFile)) throw new Error(`session: ${id} (${sessionFile}) не найден`);
  return fs.readFileSync(sessionFile, "utf8").trim();
}

// API_ID/HASH из env или parser/.env
export function getApiCredentials() {
  let apiId = Number(process.env.TG_API_ID || process.env.API_ID);
  let apiHash = process.env.TG_API_HASH || process.env.API_HASH;
  if (!apiId || !apiHash) {
    const envPath = path.resolve("../parser/.env");
    if (fs.existsSync(envPath)) {
      const env = {};
      for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
        if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
      apiId = apiId || Number(env.TG_API_ID || env.API_ID);
      apiHash = apiHash || env.TG_API_HASH || env.API_HASH;
    }
  }
  if (!apiId || !apiHash) throw new Error("TG_API_ID/TG_API_HASH не заданы (ни в env, ни в parser/.env)");
  return { apiId, apiHash };
}
```

- [ ] **Step 4: Тест (читает реальный _meta.json парсера, не падает)**

```javascript
// test/sessions-manager.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { listAccounts, getActiveAccountId } from "../lib/sessions-manager.js";

test("listAccounts возвращает массив (из parser/data или пусто)", () => {
  const acc = listAccounts();
  assert.ok(Array.isArray(acc));
});

test("getActiveAccountId возвращает строку или null", () => {
  const id = getActiveAccountId();
  assert.ok(id === null || typeof id === "string");
});
```

> Примечание: тест запускается из `projects/content-agent/`, поэтому `../parser/data` резолвится в реальную папку парсера. Если активная сессия есть — getActiveAccountId вернёт её id.

- [ ] **Step 5: Прогнать тест**

Run: `npm test` (с PATH-префиксом)
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add projects/content-agent/package.json projects/content-agent/package-lock.json projects/content-agent/lib/sessions-manager.js projects/content-agent/test/sessions-manager.test.js
git commit -m "feat(content-agent): чтение общей TG-сессии парсера (Фаза 2)"
```

---

## Task 2: TG-коннектор — чистые хелперы + fetchFromChannels

**Files:**
- Create: `projects/content-agent/lib/sources/telegram.js`
- Test: `projects/content-agent/test/tg-source.test.js`

- [ ] **Step 1: Написать падающий тест на чистые хелперы**

```javascript
// test/tg-source.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { periodToSinceTs, matchesKeywords, extractMetrics, normalizeMessage, engagementScore } from "../lib/sources/telegram.js";

test("periodToSinceTs", () => {
  const now = 1_000_000_000_000;
  assert.equal(periodToSinceTs("week", now), now - 7 * 86400_000);
  assert.equal(periodToSinceTs("3days", now), now - 3 * 86400_000);
  assert.equal(periodToSinceTs("month", now), now - 30 * 86400_000);
  assert.ok(periodToSinceTs("today", now) <= now && periodToSinceTs("today", now) > now - 86400_000);
});

test("matchesKeywords: include/exclude, регистронезависимо", () => {
  assert.equal(matchesKeywords("Новая модель GPT", { include: ["gpt"], exclude: [] }), true);
  assert.equal(matchesKeywords("Про котиков", { include: ["gpt"], exclude: [] }), false);
  assert.equal(matchesKeywords("GPT и реклама", { include: ["gpt"], exclude: ["реклама"] }), false);
  assert.equal(matchesKeywords("что угодно", { include: [], exclude: [] }), true);
});

test("extractMetrics из сообщения GramJS", () => {
  const msg = {
    views: 1200, forwards: 8,
    reactions: { results: [{ count: 10 }, { count: 5 }] },
    replies: { replies: 3 },
  };
  const m = extractMetrics(msg);
  assert.equal(m.views, 1200);
  assert.equal(m.forwards, 8);
  assert.equal(m.reactions, 15);
  assert.equal(m.comments, 3);
});

test("normalizeMessage строит url и title", () => {
  const msg = { id: 42, message: "Первая строка заголовок\nостальной текст", date: 1700000000, views: 100, reactions: null, replies: null, forwards: 0 };
  const n = normalizeMessage(msg, "durov");
  assert.equal(n.platform, "telegram");
  assert.equal(n.url, "https://t.me/durov/42");
  assert.equal(n.title, "Первая строка заголовок");
  assert.ok(n.text.includes("остальной текст"));
  assert.equal(n.date, 1700000000 * 1000);
});

test("engagementScore растёт с метриками", () => {
  const lo = engagementScore({ views: 100, reactions: 1, comments: 0, forwards: 0 });
  const hi = engagementScore({ views: 100, reactions: 50, comments: 20, forwards: 10 });
  assert.ok(hi > lo);
});
```

- [ ] **Step 2: Запустить — упадёт (нет модуля)**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/sources/telegram.js'`.

- [ ] **Step 3: Реализовать lib/sources/telegram.js**

```javascript
// lib/sources/telegram.js
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { getSessionString, getApiCredentials } from "../sessions-manager.js";

const DAY = 86400_000;

export function periodToSinceTs(period, now = Date.now()) {
  switch (period) {
    case "today": { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); }
    case "3days": return now - 3 * DAY;
    case "week": return now - 7 * DAY;
    case "month": return now - 30 * DAY;
    default: return now - 7 * DAY;
  }
}

export function matchesKeywords(text, { include = [], exclude = [] } = {}) {
  const t = (text || "").toLowerCase();
  for (const ex of exclude) { if (ex && t.includes(ex.toLowerCase())) return false; }
  if (!include.length) return true;
  return include.some((kw) => kw && t.includes(kw.toLowerCase()));
}

export function extractMetrics(msg) {
  const reactions = (msg.reactions?.results || []).reduce((s, r) => s + (r.count || 0), 0);
  return {
    views: msg.views || 0,
    forwards: msg.forwards || 0,
    reactions,
    comments: msg.replies?.replies || 0,
  };
}

export function engagementScore(m) {
  // Комментарии и репосты весомее простых просмотров.
  return (m.views || 0) * 0.01 + (m.reactions || 0) * 2 + (m.comments || 0) * 5 + (m.forwards || 0) * 3;
}

export function normalizeMessage(msg, channelUsername) {
  const text = msg.message || "";
  const firstLine = text.split("\n").find((l) => l.trim()) || "(без текста)";
  const metrics = extractMetrics(msg);
  return {
    platform: "telegram",
    url: channelUsername ? `https://t.me/${channelUsername}/${msg.id}` : null,
    title: firstLine.slice(0, 120),
    text,
    metrics,
    date: msg.date ? msg.date * 1000 : null,
    score: engagementScore(metrics),
  };
}

// Реальное TG-чтение: connect-on-demand, без session.save().
export async function fetchFromChannels({ channels, sinceTs, keywords = {}, perChannelLimit = 80, clientFactory = defaultClientFactory }) {
  const client = clientFactory();
  await client.connect();
  const out = [];
  try {
    for (const ref of channels) {
      try {
        const entity = await client.getEntity(ref);
        const username = entity.username || null;
        const messages = await client.getMessages(entity, { limit: perChannelLimit });
        for (const msg of messages) {
          const ts = msg.date ? msg.date * 1000 : 0;
          if (ts < sinceTs) continue;
          if (!msg.message) continue;
          if (!matchesKeywords(msg.message, keywords)) continue;
          out.push({ ...normalizeMessage(msg, username), source_ref: ref });
        }
      } catch (e) {
        out.push({ platform: "telegram", source_ref: ref, error: String(e.message).slice(0, 150) });
      }
    }
  } finally {
    try { await client.disconnect(); } catch {}
  }
  return out;
}

function defaultClientFactory() {
  const { apiId, apiHash } = getApiCredentials();
  const sessionString = getSessionString("active");
  return new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
    connectionRetries: 2,
    useWSS: true,
  });
}
```

- [ ] **Step 4: Прогнать тест (только чистые хелперы — реальный TG не дёргается)**

Run: `npm test`
Expected: PASS — tg-source.test.js зелёные.

- [ ] **Step 5: Commit**

```bash
git add projects/content-agent/lib/sources/telegram.js projects/content-agent/test/tg-source.test.js
git commit -m "feat(content-agent): TG-коннектор (метрики, фильтры, fetchFromChannels)"
```

---

## Task 3: Дайджест — экстрактивное саммари + AI-reshape

**Files:**
- Create: `projects/content-agent/lib/digest.js`
- Test: `projects/content-agent/test/digest.test.js`

- [ ] **Step 1: Написать падающий тест**

```javascript
// test/digest.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractiveSummary, sortByEngagement, reshapeDigest } from "../lib/digest.js";

test("extractiveSummary берёт первые предложения и режет длину", () => {
  const s = extractiveSummary("Первое предложение. Второе предложение. Третье. Четвёртое.", 2);
  assert.ok(s.includes("Первое предложение"));
  assert.ok(s.includes("Второе предложение"));
  assert.ok(!s.includes("Четвёртое"));
});

test("sortByEngagement сортирует по score убыв", () => {
  const items = [{ score: 1 }, { score: 9 }, { score: 5 }];
  const sorted = sortByEngagement(items);
  assert.deepEqual(sorted.map((i) => i.score), [9, 5, 1]);
});

test("reshapeDigest зовёт runner с режимом и текущим текстом", async () => {
  let captured = null;
  const fakeRunner = async (_a, payload) => { captured = payload; return JSON.stringify({ result: "новый дайджест" }); };
  const r = await reshapeDigest({ currentText: "СТАРЫЙ", mode: "shorter", runner: fakeRunner });
  assert.equal(r, "новый дайджест");
  assert.ok(captured.includes("СТАРЫЙ"));
  assert.match(captured, /коротк/i);
});
```

- [ ] **Step 2: Запустить — упадёт**

Run: `npm test`
Expected: FAIL — нет модуля.

- [ ] **Step 3: Реализовать lib/digest.js**

```javascript
// lib/digest.js
import { generate } from "./ai.js";

export function extractiveSummary(text, maxSentences = 2, maxChars = 280) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "(без текста)";
  const sentences = clean.match(/[^.!?]+[.!?]+/g) || [clean];
  let s = sentences.slice(0, maxSentences).join(" ").trim();
  if (s.length > maxChars) s = s.slice(0, maxChars) + "…";
  return s;
}

export function sortByEngagement(items) {
  return [...items].sort((a, b) => (b.score || 0) - (a.score || 0));
}

const RESHAPE = {
  shorter: "Сделай дайджест заметно короче: оставь только суть по каждой новости, убери детали.",
  detailed: "Раскрой дайджест подробнее: добавь контекст и почему это важно по каждой новости.",
};

export async function reshapeDigest({ currentText, mode, runner, model }) {
  const instruction = RESHAPE[mode] || RESHAPE.shorter;
  const system = "Ты редактируешь дайджест AI-новостей по-русски. Сохрани структуру (платформа, заголовки, ссылки), измени только подачу. Возвращай только готовый текст дайджеста.";
  const { text } = await generate({
    systemPrompt: system,
    userMessage: `${instruction}\n\nТекущий дайджест:\n${currentText}`,
    runner, model,
  });
  return (text || "").trim();
}
```

- [ ] **Step 4: Прогнать тест**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add projects/content-agent/lib/digest.js projects/content-agent/test/digest.test.js
git commit -m "feat(content-agent): дайджест — экстрактивное саммари + AI-reshape"
```

---

## Task 4: БД — sources, keywords, digests, digest_items

**Files:**
- Modify: `projects/content-agent/lib/db.js`
- Test: `projects/content-agent/test/db.phase2.test.js`

- [ ] **Step 1: Написать падающий тест**

```javascript
// test/db.phase2.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  openDb, addSource, listSources, removeSource,
  addKeyword, listKeywords, removeKeyword,
  createDigest, addDigestItems, getDigest, listDigestItems, getDigestItem, saveDigest,
} from "../lib/db.js";

test("sources CRUD", () => {
  const db = openDb(":memory:");
  const id = addSource(db, { platform: "telegram", ref: "@durov", title: "Durov" });
  assert.equal(listSources(db).length, 1);
  assert.equal(listSources(db, { platform: "telegram" })[0].ref, "@durov");
  removeSource(db, id);
  assert.equal(listSources(db).length, 0);
});

test("keywords CRUD", () => {
  const db = openDb(":memory:");
  const id = addKeyword(db, { term: "gpt", scope: "include" });
  assert.equal(listKeywords(db).length, 1);
  removeKeyword(db, id);
  assert.equal(listKeywords(db).length, 0);
});

test("digest + items + save + getItem", () => {
  const db = openDb(":memory:");
  const dId = createDigest(db, { period: "week", keywords: ["gpt"], platforms: ["telegram"] });
  addDigestItems(db, dId, [
    { platform: "telegram", url: "https://t.me/x/1", title: "T1", summary: "S1", text: "full1", metrics: { views: 10 } },
    { platform: "telegram", url: "https://t.me/x/2", title: "T2", summary: "S2", text: "full2", metrics: { views: 20 } },
  ]);
  assert.equal(listDigestItems(db, dId).length, 2);
  const item = listDigestItems(db, dId)[0];
  assert.equal(getDigestItem(db, item.id).title, "T1");
  assert.equal(getDigest(db, dId).saved, 0);
  saveDigest(db, dId);
  assert.equal(getDigest(db, dId).saved, 1);
});
```

- [ ] **Step 2: Запустить — упадёт**

Run: `npm test`
Expected: FAIL — функции не экспортированы.

- [ ] **Step 3: Добавить в lib/db.js (в SCHEMA — новые таблицы; в конец файла — хелперы)**

В константу `SCHEMA` дописать (перед закрывающим `` ` ``):
```sql

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY,
  platform TEXT NOT NULL,
  ref TEXT NOT NULL,
  title TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS keywords (
  id INTEGER PRIMARY KEY,
  term TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'include',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS digests (
  id INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL,
  period TEXT,
  keywords_json TEXT,
  platforms_json TEXT,
  rendered_text TEXT,
  saved INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS digest_items (
  id INTEGER PRIMARY KEY,
  digest_id INTEGER NOT NULL,
  platform TEXT,
  source_ref TEXT,
  url TEXT,
  title TEXT,
  summary TEXT,
  raw_text TEXT,
  metrics_json TEXT,
  published_at INTEGER
);
```

В конец файла добавить хелперы:
```javascript

// ── Sources ──
export function addSource(db, { platform, ref, title = null }) {
  return db.prepare("INSERT INTO sources (platform, ref, title, created_at) VALUES (?, ?, ?, ?)")
    .run(platform, ref, title, Date.now()).lastInsertRowid;
}
export function listSources(db, { platform = null } = {}) {
  return platform
    ? db.prepare("SELECT * FROM sources WHERE active = 1 AND platform = ? ORDER BY id").all(platform)
    : db.prepare("SELECT * FROM sources WHERE active = 1 ORDER BY id").all();
}
export function removeSource(db, id) {
  return db.prepare("DELETE FROM sources WHERE id = ?").run(id).changes;
}

// ── Keywords ──
export function addKeyword(db, { term, scope = "include" }) {
  return db.prepare("INSERT INTO keywords (term, scope, created_at) VALUES (?, ?, ?)")
    .run(term, scope, Date.now()).lastInsertRowid;
}
export function listKeywords(db) {
  return db.prepare("SELECT * FROM keywords ORDER BY id").all();
}
export function removeKeyword(db, id) {
  return db.prepare("DELETE FROM keywords WHERE id = ?").run(id).changes;
}

// ── Digests ──
export function createDigest(db, { period, keywords = [], platforms = [] }) {
  return db.prepare("INSERT INTO digests (created_at, period, keywords_json, platforms_json) VALUES (?, ?, ?, ?)")
    .run(Date.now(), period, JSON.stringify(keywords), JSON.stringify(platforms)).lastInsertRowid;
}
export function addDigestItems(db, digestId, items) {
  const stmt = db.prepare(`INSERT INTO digest_items
    (digest_id, platform, source_ref, url, title, summary, raw_text, metrics_json, published_at)
    VALUES (@digest_id, @platform, @source_ref, @url, @title, @summary, @raw_text, @metrics_json, @published_at)`);
  const tx = db.transaction((rows) => {
    for (const r of rows) {
      stmt.run({
        digest_id: digestId,
        platform: r.platform ?? "telegram",
        source_ref: r.source_ref ?? null,
        url: r.url ?? null,
        title: r.title ?? null,
        summary: r.summary ?? null,
        raw_text: r.text ?? r.raw_text ?? null,
        metrics_json: JSON.stringify(r.metrics ?? {}),
        published_at: r.date ?? r.published_at ?? null,
      });
    }
  });
  tx(items);
}
export function getDigest(db, id) {
  return db.prepare("SELECT * FROM digests WHERE id = ?").get(id);
}
export function listDigestItems(db, digestId) {
  return db.prepare("SELECT * FROM digest_items WHERE digest_id = ? ORDER BY id").all(digestId);
}
export function getDigestItem(db, id) {
  return db.prepare("SELECT * FROM digest_items WHERE id = ?").get(id);
}
export function setDigestRendered(db, id, text) {
  db.prepare("UPDATE digests SET rendered_text = ? WHERE id = ?").run(text, id);
}
export function saveDigest(db, id) {
  db.prepare("UPDATE digests SET saved = 1 WHERE id = ?").run(id);
}
```

- [ ] **Step 4: Прогнать тест**

Run: `npm test`
Expected: PASS — db.phase2.test.js + старые db.test.js зелёные.

- [ ] **Step 5: Commit**

```bash
git add projects/content-agent/lib/db.js projects/content-agent/test/db.phase2.test.js
git commit -m "feat(content-agent): БД Фазы 2 (sources, keywords, digests, digest_items)"
```

---

## Task 5: Сервер — sources/keywords/search/digests + пост из новости

**Files:**
- Modify: `projects/content-agent/server.js`
- Test: `projects/content-agent/test/server.phase2.test.js`

- [ ] **Step 1: Написать падающий тест (TG-фетч инъектируется фейком)**

```javascript
// test/server.phase2.test.js
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
  // фейковый TG-фетч: возвращает 2 поста
  const tgFetch = async ({ channels }) => ([
    { platform: "telegram", source_ref: channels[0], url: "https://t.me/a/1", title: "Новость A", text: "Полный текст A. Второе.", metrics: { views: 100, reactions: 20, comments: 5, forwards: 2 }, date: Date.now(), score: 50 },
    { platform: "telegram", source_ref: channels[0], url: "https://t.me/a/2", title: "Новость B", text: "Текст B.", metrics: { views: 10, reactions: 1, comments: 0, forwards: 0 }, date: Date.now(), score: 5 },
  ]);
  const app = createServer({ db, password, secret, styleDir, runner, model: "sonnet", tgFetch });
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
  assert.equal(d.items[0].title, "Новость A"); // выше по engagement
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
```

- [ ] **Step 2: Запустить — упадёт**

Run: `npm test`
Expected: FAIL (нет эндпоинтов / tgFetch).

- [ ] **Step 3: Изменить server.js**

3a. Расширить импорты из db.js — добавить к существующему импорту:
```javascript
import {
  getSetting, setSetting,
  createInterview, getInterview, getActiveInterview,
  addInterviewAnswer, addInterviewMaterial, finishInterview,
  createPost, getPost, updatePostDraft, setPostStatus,
  addSource, listSources, removeSource,
  addKeyword, listKeywords, removeKeyword,
  createDigest, addDigestItems, getDigest, listDigestItems, getDigestItem, setDigestRendered, saveDigest,
} from "./lib/db.js";
```

3b. Добавить импорты дайджеста и дефолтного TG-фетча (после импорта writer):
```javascript
import { extractiveSummary, sortByEngagement, reshapeDigest } from "./lib/digest.js";
import { fetchFromChannels, periodToSinceTs } from "./lib/sources/telegram.js";
```

3c. Сигнатуру фабрики расширить tgFetch (дефолт — реальный коннектор):
```javascript
export function createServer({ db, password, secret, styleDir, runner, model, tgFetch }) {
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  const doTgFetch = tgFetch || (({ channels, sinceTs, keywords }) => fetchFromChannels({ channels, sinceTs, keywords }));
```

3d. Добавить `app.use("/api/sources", auth);`, `app.use("/api/keywords", auth);`, `app.use("/api/search", auth);`, `app.use("/api/digests", auth);` рядом с существующими `app.use(... auth)`.

3e. Добавить эндпоинты (перед `return app;`):
```javascript
  // ── Источники ──
  app.get("/api/sources", (req, res) => res.json(listSources(db, { platform: req.query.platform || null })));
  app.post("/api/sources", (req, res) => {
    const { platform, ref, title } = req.body || {};
    if (!platform || !ref) return res.status(400).json({ error: "platform и ref обязательны" });
    const id = addSource(db, { platform, ref, title: title || null });
    res.status(201).json({ id, ...listSources(db).find((s) => s.id === id) });
  });
  app.delete("/api/sources/:id", (req, res) => {
    removeSource(db, Number(req.params.id));
    res.json({ ok: true });
  });

  // ── Ключевики ──
  app.get("/api/keywords", (_req, res) => res.json(listKeywords(db)));
  app.post("/api/keywords", (req, res) => {
    const term = String(req.body?.term || "").trim();
    const scope = req.body?.scope === "exclude" ? "exclude" : "include";
    if (!term) return res.status(400).json({ error: "term обязателен" });
    const id = addKeyword(db, { term, scope });
    res.status(201).json({ id, term, scope });
  });
  app.delete("/api/keywords/:id", (req, res) => {
    removeKeyword(db, Number(req.params.id));
    res.json({ ok: true });
  });

  // ── Поиск → дайджест ──
  app.post("/api/search", async (req, res) => {
    const platforms = req.body?.platforms || ["telegram"];
    const period = req.body?.period || "week";
    const adHoc = Array.isArray(req.body?.keywords) ? req.body.keywords : [];
    try {
      // ключевики: ad-hoc + сохранённые
      const saved = listKeywords(db);
      const include = [...adHoc, ...saved.filter((k) => k.scope === "include").map((k) => k.term)];
      const exclude = saved.filter((k) => k.scope === "exclude").map((k) => k.term);

      let items = [];
      if (platforms.includes("telegram")) {
        const channels = listSources(db, { platform: "telegram" }).map((s) => s.ref);
        if (channels.length) {
          const sinceTs = periodToSinceTs(period);
          const fetched = await doTgFetch({ channels, sinceTs, keywords: { include, exclude } });
          items = fetched.filter((x) => !x.error);
        }
      }
      items = sortByEngagement(items).slice(0, 20);
      for (const it of items) it.summary = extractiveSummary(it.text);

      const digestId = createDigest(db, { period, keywords: include, platforms });
      addDigestItems(db, digestId, items);
      const stored = listDigestItems(db, digestId);
      res.status(201).json({ digest_id: digestId, count: stored.length, items: stored.map(mapItem) });
    } catch (e) {
      res.status(500).json({ error: String(e.message) });
    }
  });

  app.get("/api/digests/:id", (req, res) => {
    const d = getDigest(db, Number(req.params.id));
    if (!d) return res.status(404).json({ error: "not found" });
    res.json({ ...d, items: listDigestItems(db, d.id).map(mapItem) });
  });

  app.post("/api/digests/:id/reshape", async (req, res) => {
    const d = getDigest(db, Number(req.params.id));
    if (!d) return res.status(404).json({ error: "not found" });
    const mode = req.body?.mode === "detailed" ? "detailed" : "shorter";
    try {
      const base = d.rendered_text || renderDigestText(d, listDigestItems(db, d.id));
      const text = await reshapeDigest({ currentText: base, mode, runner, model });
      setDigestRendered(db, d.id, text);
      res.json({ digest_id: d.id, rendered_text: text });
    } catch (e) {
      res.status(500).json({ error: String(e.message) });
    }
  });

  app.post("/api/digests/:id/save", (req, res) => {
    if (!getDigest(db, Number(req.params.id))) return res.status(404).json({ error: "not found" });
    saveDigest(db, Number(req.params.id));
    res.json({ ok: true });
  });
```

3f. Заменить существующий обработчик `app.post("/api/posts", ...)` на версию, поддерживающую `origin=digest_item`:
```javascript
  app.post("/api/posts", async (req, res) => {
    const origin = req.body?.origin === "digest_item" ? "digest_item" : "prompt";
    let userPrompt;
    if (origin === "digest_item") {
      const item = getDigestItem(db, Number(req.body?.digest_item_id));
      if (!item) return res.status(404).json({ error: "digest_item не найден" });
      userPrompt = `Сделай рерайт этой новости в моём стиле как авторский пост (не копируй дословно, добавь свой экспертный взгляд).\n\nЗаголовок: ${item.title}\nТекст: ${item.raw_text}\nИсточник: ${item.url || "—"}`;
    } else {
      userPrompt = String(req.body?.user_prompt || "").trim();
      if (!userPrompt) return res.status(400).json({ error: "user_prompt required" });
    }
    const id = createPost(db, { origin, user_prompt: userPrompt });
    try {
      const styleText = loadStyleProfile(styleDir).text;
      const text = await generatePost({ styleText, userPrompt, runner, model });
      updatePostDraft(db, id, text);
      res.status(201).json({ id, draft_text: text });
    } catch (e) {
      res.status(500).json({ error: String(e.message), id });
    }
  });
```

3g. Добавить вспомогательные функции (в конце файла, после `createServer`, на уровне модуля):
```javascript
function mapItem(row) {
  let metrics = {};
  try { metrics = JSON.parse(row.metrics_json || "{}"); } catch {}
  return {
    id: row.id, platform: row.platform, url: row.url, title: row.title,
    summary: row.summary, metrics, source_ref: row.source_ref,
  };
}

export function renderDigestText(digest, items) {
  const lines = [`📰 Дайджест (${items.length} новостей)`, ""];
  let n = 1;
  for (const it of items) {
    let m = {}; try { m = JSON.parse(it.metrics_json || "{}"); } catch {}
    lines.push(`${n}. ${it.title}`);
    if (it.summary) lines.push(it.summary);
    lines.push(`👁 ${m.views || 0} · ❤️ ${m.reactions || 0} · 💬 ${m.comments || 0} · 🔁 ${m.forwards || 0}`);
    if (it.url) lines.push(it.url);
    lines.push("");
    n++;
  }
  return lines.join("\n");
}
```

> Примечание: `renderDigestText` экспортируется и используется и сервером (reshape fallback), и может пригодиться. `mapItem` приватная.

- [ ] **Step 4: Прогнать тест**

Run: `npm test`
Expected: PASS — server.phase2.test.js + все старые тесты зелёные.

- [ ] **Step 5: Commit**

```bash
git add projects/content-agent/server.js projects/content-agent/test/server.phase2.test.js
git commit -m "feat(content-agent): API Фазы 2 (источники, ключевики, поиск, дайджест, пост из новости)"
```

---

## Task 6: Бот — «📡 Источники» (add/remove TG-каналы)

**Files:**
- Modify: `.agent/bot/content-menu.js`

- [ ] **Step 1: Заменить заглушку «📡 Источники» на рабочий обработчик**

В `showMainMenu` кнопка «📡 Источники» сейчас ведёт на `ca:soon`. Заменить её callback на `ca:sources`:
Найти:
```javascript
      .text("📖 Контент-план", "ca:soon").text("📡 Источники", "ca:soon").row()
```
Заменить на:
```javascript
      .text("📖 Контент-план", "ca:soon").text("📡 Источники", "ca:sources").row()
```

- [ ] **Step 2: Добавить функцию registerSourcesHandlers и её вызов**

В `registerContentHandlers` добавить вызов рядом с остальными:
```javascript
  registerSourcesHandlers(bot, isOwner, { api, wizards, esc });
```

В конец файла добавить:
```javascript
// === «📡 Источники» (Фаза 2) ===
function registerSourcesHandlers(bot, isOwner, { api, wizards, esc }) {
  async function showSources(ctx) {
    let sources = [];
    try { sources = await api("GET", "/sources"); } catch (e) {
      await ctx.reply(`⚠️ ${esc(e.message)}`); return;
    }
    const tg = sources.filter((s) => s.platform === "telegram");
    const lines = ["📡 <b>Источники мониторинга</b>", "", `Telegram-каналы (${tg.length}):`];
    for (const s of tg) lines.push(`• ${esc(s.ref)}${s.title ? " — " + esc(s.title) : ""}`);
    if (!tg.length) lines.push("<i>пока пусто</i>");
    const kb = new InlineKeyboard()
      .text("➕ Добавить TG-канал", "ca:src-add").row();
    for (const s of tg) kb.text(`❌ ${s.ref}`, `ca:src-del:${s.id}`).row();
    kb.text("🏠 Меню", "ca:menu");
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML", reply_markup: kb });
  }

  bot.callbackQuery(/^ca:sources$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    await showSources(ctx);
  });

  bot.callbackQuery(/^ca:src-add$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    wizards.set(ctx.chat.id, { mode: "src_add" });
    await ctx.reply("Пришли @username канала или ссылку (например <code>@durov</code> или <code>https://t.me/durov</code>):", { parse_mode: "HTML" });
  });

  bot.callbackQuery(/^ca:src-del:(\d+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const id = ctx.match[1];
    try {
      await api("DELETE", `/sources/${id}`);
      await ctx.answerCallbackQuery({ text: "Удалён" });
      await showSources(ctx);
    } catch (e) {
      await ctx.answerCallbackQuery({ text: "Ошибка" });
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  });

  bot.on("message:text", async (ctx, next) => {
    if (!isOwner(ctx)) return next();
    const w = wizards.get(ctx.chat.id);
    if (!w || w.mode !== "src_add") return next();
    wizards.delete(ctx.chat.id);
    let ref = ctx.message.text.trim();
    const m = ref.match(/t\.me\/(@?[\w\d_]+)/i);
    if (m) ref = m[1];
    if (!ref.startsWith("@") && !/^[\w\d_]+$/.test(ref)) {
      await ctx.reply("Не похоже на канал. Пришли @username или ссылку t.me/...");
      return;
    }
    if (!ref.startsWith("@")) ref = "@" + ref;
    try {
      await api("POST", "/sources", { platform: "telegram", ref });
      await ctx.reply(`✅ Канал ${esc(ref)} добавлен в мониторинг.`,
        { reply_markup: new InlineKeyboard().text("📡 К источникам", "ca:sources").row().text("🏠 Меню", "ca:menu") });
    } catch (e) {
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  });
}
```

- [ ] **Step 3: Проверка синтаксиса**

Run: `node --check .agent/bot/content-menu.js` (через PowerShell PATH).
Expected: без ошибок.

- [ ] **Step 4: Commit**

```bash
git add .agent/bot/content-menu.js
git commit -m "feat(bot): раздел Источники — добавление/удаление TG-каналов"
```

---

## Task 7: Бот — «🔍 Найти информацию» + рендер дайджеста + кнопки

**Files:**
- Modify: `.agent/bot/content-menu.js`

- [ ] **Step 1: Перевести кнопку «🔍 Найти информацию» с заглушки на `ca:find`**

Найти в `showMainMenu`:
```javascript
      .text("🔍 Найти информацию", "ca:soon").text("📆 Дайджест", "ca:soon").row()
```
Заменить на:
```javascript
      .text("🔍 Найти информацию", "ca:find").text("📆 Дайджест", "ca:soon").row()
```

- [ ] **Step 2: Добавить registerFindHandlers + вызов**

В `registerContentHandlers`:
```javascript
  registerFindHandlers(bot, isOwner, { api, wizards, esc });
```

В конец файла:
```javascript
// === «🔍 Найти информацию» + дайджест (Фаза 2) ===
function registerFindHandlers(bot, isOwner, { api, wizards, esc }) {
  const PERIODS = [["Сегодня", "today"], ["3 дня", "3days"], ["Неделя", "week"], ["Месяц", "month"]];

  bot.callbackQuery(/^ca:find$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    // Фаза 2: только Telegram. Сразу спрашиваем период.
    wizards.set(ctx.chat.id, { mode: "find", platforms: ["telegram"] });
    const kb = new InlineKeyboard();
    for (const [label, val] of PERIODS) kb.text(label, `ca:find-period:${val}`);
    kb.row().text("🏠 Меню", "ca:menu");
    await ctx.reply("🔍 <b>Найти информацию</b> (Telegram)\n\nЗа какой период искать?", { parse_mode: "HTML", reply_markup: kb });
  });

  bot.callbackQuery(/^ca:find-period:(\w+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const period = ctx.match[1];
    const w = wizards.get(ctx.chat.id) || { mode: "find", platforms: ["telegram"] };
    w.period = period;
    w.mode = "find_keywords";
    wizards.set(ctx.chat.id, w);
    await ctx.answerCallbackQuery();
    await ctx.reply("Ключевые слова через запятую (или «-» чтобы искать по сохранённым/всем):", {
      reply_markup: new InlineKeyboard().text("Искать по всем", "ca:find-go:all"),
    });
  });

  bot.callbackQuery(/^ca:find-go:all$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    const w = wizards.get(ctx.chat.id);
    if (!w) return;
    await runSearch(ctx, w, []);
  });

  async function runSearch(ctx, w, keywords) {
    wizards.delete(ctx.chat.id);
    const wait = await ctx.reply("Ищу по каналам... 🔍 (до минуты)");
    try {
      const r = await api("POST", "/search", { platforms: w.platforms || ["telegram"], period: w.period || "week", keywords });
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      if (!r.count) {
        await ctx.reply("Ничего не нашёл по заданным условиям. Проверь список источников (📡) и ключевые слова.",
          { reply_markup: new InlineKeyboard().text("📡 Источники", "ca:sources").row().text("🏠 Меню", "ca:menu") });
        return;
      }
      await sendDigest(ctx, r.digest_id, r.items);
    } catch (e) {
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  }

  async function sendDigest(ctx, digestId, items) {
    await ctx.reply(`📰 <b>Дайджест</b> — найдено ${items.length}`, { parse_mode: "HTML" });
    for (const it of items) {
      const m = it.metrics || {};
      const text = `<b>${esc(it.title)}</b>\n${esc(it.summary || "")}\n\n` +
        `👁 ${m.views || 0} · ❤️ ${m.reactions || 0} · 💬 ${m.comments || 0} · 🔁 ${m.forwards || 0}` +
        (it.url ? `\n${esc(it.url)}` : "");
      const kb = new InlineKeyboard().text("✍ Пост из этой новости", `ca:news-post:${it.id}`);
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
    }
    const kb = new InlineKeyboard()
      .text("✂️ Короче", `ca:dig-reshape:${digestId}:shorter`).text("➕ Детальнее", `ca:dig-reshape:${digestId}:detailed`).row()
      .text("💾 Сохранить дайджест", `ca:dig-save:${digestId}`).row()
      .text("🏠 Меню", "ca:menu");
    await ctx.reply("Действия с дайджестом:", { reply_markup: kb });
  }

  bot.callbackQuery(/^ca:dig-reshape:(\d+):(\w+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const [, id, mode] = ctx.match;
    await ctx.answerCallbackQuery({ text: "Переписываю..." });
    const wait = await ctx.reply("Переписываю дайджест... ✍️");
    try {
      const r = await api("POST", `/digests/${id}/reshape`, { mode });
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      const kb = new InlineKeyboard()
        .text("✂️ Короче", `ca:dig-reshape:${id}:shorter`).text("➕ Детальнее", `ca:dig-reshape:${id}:detailed`).row()
        .text("💾 Сохранить", `ca:dig-save:${id}`).text("🏠 Меню", "ca:menu");
      const body = (r.rendered_text || "(пусто)").slice(0, 3800);
      await ctx.reply(body, { reply_markup: kb });
    } catch (e) {
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  });

  bot.callbackQuery(/^ca:dig-save:(\d+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const id = ctx.match[1];
    try {
      await api("POST", `/digests/${id}/save`);
      await ctx.answerCallbackQuery({ text: "Сохранено" });
      await ctx.reply("💾 Дайджест сохранён.");
    } catch (e) {
      await ctx.answerCallbackQuery({ text: "Ошибка" });
    }
  });

  bot.on("message:text", async (ctx, next) => {
    if (!isOwner(ctx)) return next();
    const w = wizards.get(ctx.chat.id);
    if (!w || w.mode !== "find_keywords") return next();
    const raw = ctx.message.text.trim();
    const keywords = raw === "-" ? [] : raw.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
    await runSearch(ctx, w, keywords);
  });
}
```

- [ ] **Step 3: Добавить обработчик «✍ пост из новости» (Task 8 — отдельно ниже).**

- [ ] **Step 4: Проверка синтаксиса**

Run: `node --check .agent/bot/content-menu.js`
Expected: без ошибок.

- [ ] **Step 5: Commit**

```bash
git add .agent/bot/content-menu.js
git commit -m "feat(bot): Найти информацию — поиск, дайджест, reshape, сохранение"
```

---

## Task 8: Бот — «✍ пост из новости» (связка дайджест → писатель Фазы 1)

**Files:**
- Modify: `.agent/bot/content-menu.js`

- [ ] **Step 1: Добавить обработчик ca:news-post в registerWriteHandlers**

В функции `registerWriteHandlers` (Фаза 1) добавить новый callbackQuery (рядом с `ca:post-var`):
```javascript
  bot.callbackQuery(/^ca:news-post:(\d+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const itemId = ctx.match[1];
    await ctx.answerCallbackQuery({ text: "Пишу пост..." });
    const wait = await ctx.reply("Пишу пост по новости в твоём стиле... ✍️ (до минуты)");
    try {
      const r = await api("POST", "/posts", { origin: "digest_item", digest_item_id: Number(itemId) });
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      await ctx.reply(r.draft_text || "(пусто)", { reply_markup: postKeyboard(r.id) });
    } catch (e) {
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  });
```

> `postKeyboard` уже определена в registerWriteHandlers (Фаза 1) — переиспользуем те же кнопки вариантов под постом из новости.

- [ ] **Step 2: Проверка синтаксиса**

Run: `node --check .agent/bot/content-menu.js`
Expected: без ошибок.

- [ ] **Step 3: Commit**

```bash
git add .agent/bot/content-menu.js
git commit -m "feat(bot): пост из новости дайджеста (связка с писателем Фазы 1)"
```

---

## Task 9: Деплой + сквозная проверка

**Files:** нет (деплой + проверка)

- [ ] **Step 1: Полный прогон тестов сервиса**

Run: `npm test` (PATH-префикс) в `projects/content-agent`.
Expected: все тесты (Фаза 1 + Фаза 2) зелёные.

- [ ] **Step 2: Синхронизация и рестарт**

```
# сервис уже из этой папки — рестарт подхватит новый код
powershell -Command '$env:PATH = "C:\Users\Administrator\nodejs;" + $env:PATH; pm2 restart agent-content-server'
# бот: синхронизировать content-menu.js в рабочую копию и рестартнуть
cp .agent/bot/content-menu.js C:\Users\Administrator\.agent\bot\content-menu.js   (через корень репозитория)
powershell -Command '$env:PATH = "C:\Users\Administrator\nodejs;" + $env:PATH; pm2 restart agent-bot'
```
> Важно: `index.js` в Фазе 2 НЕ менялся — синхронизировать нужно только `content-menu.js`.

- [ ] **Step 3: Реальный поиск через API (smoke с настоящим TG)**

Сначала добавить тестовый канал и выполнить поиск напрямую (node-скрипт с токеном `change-me`):
- POST /api/sources {platform:telegram, ref:"@durov"}
- POST /api/search {platforms:["telegram"], period:"week", keywords:[]}
Expected: status 201, count>0, items с метриками и url. Проверяет реальный GramJS-фетч на общей сессии.

- [ ] **Step 4: E2E в Telegram (с Александром)**

«✍ Контент» → «📡 Источники» → добавить пару каналов конкурентов → «🔍 Найти информацию» → период → дайджест с метриками → «✍ Пост из этой новости» → пост в стиле. Проверить «Короче/Детальнее/Сохранить».

- [ ] **Step 5: Commit (если правки по итогам)**

```bash
git add -A && git commit -m "test(content-agent): сквозная проверка Фазы 2 — мониторинг TG + дайджест"
```

---

## Self-Review

**Spec coverage (Фаза 2 из §9):**
- Источники TG (add/remove) — Task 6 ✓
- Ключевики (add/remove) — API Task 5 ✓ (UI ключевиков в боте — минимально: ad-hoc в поиске; отдельное меню ключевиков можно добавить позже, сохранённые поддержаны в API/поиске)
- «🔍 Найти информацию» (платформы=TG, период, ключевые слова) — Task 7 ✓
- Дайджест (формат платформа/N/ссылка/заголовок/саммари) + кнопки (короче/детальнее/сохранить/пост из новости) — Task 5+7 ✓
- Метрики виральности (views/reactions/comments/forwards), сортировка по engagement — Task 2+5 ✓
- «Пост из новости» → писатель Фазы 1 — Task 5(origin)+8 ✓

**Placeholder scan:** код приведён целиком; нет TBD.

**Type consistency:** db-хелперы (addSource/listSources/removeSource, addKeyword/listKeywords/removeKeyword, createDigest/addDigestItems/getDigest/listDigestItems/getDigestItem/setDigestRendered/saveDigest); коннектор (fetchFromChannels/periodToSinceTs/matchesKeywords/extractMetrics/normalizeMessage/engagementScore); digest (extractiveSummary/sortByEngagement/reshapeDigest); server tgFetch-инъекция; callback-неймспейс ca:sources/ca:src-*/ca:find/ca:find-period/ca:find-go/ca:dig-reshape/ca:dig-save/ca:news-post. Сходится.

**Ambiguity / заметки:**
- Поиск синхронный (как генерация Фазы 1). Несколько каналов × getMessages может занять 20-60с — бот показывает «ищу…». Приемлемо для 1 юзера.
- Гигиена сессии: коннектор только connect→read→disconnect, без save(). Не мешает парсеру/sales.
- Отдельное меню управления ключевиками в боте не делаем в Фазе 2 (API готов, в поиске можно вводить ad-hoc; сохранённые ключевики учитываются). Полноценное меню — при необходимости позже.
- Авто-мониторинг по расписанию (воркер) — НЕ в Фазе 2.
