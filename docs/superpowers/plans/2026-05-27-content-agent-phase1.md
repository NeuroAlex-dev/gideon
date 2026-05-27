# Контент-Агент — Фаза 1 (Мозг: стиль + посты) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Поднять сервис `projects/content-agent/` и раздел «✍ Контент» в @flash_gideon_bot, который обучается стилю Александра (интервью 10 вопросов голосом → 5 md-профилей) и пишет посты в этом стиле с кнопками вариантов.

**Architecture:** Отдельный Node.js-сервис (Express HTTP API на :3002 + SQLite) по образцу `projects/sales-manager/`. Генерация — синхронные вызовы Claude CLI по подписке (request-response, не фон). Профиль стиля — 5 md-файлов в `data/style/`, подгружаются в промпт при каждой генерации. Бот общается с сервисом по HTTP с self-contained HMAC-токеном. Воркер и фоновые задачи не нужны в Фазе 1 (появятся в Фазе 2 — мониторинг).

**Tech Stack:** Node.js v20 (ESM), better-sqlite3, express, dotenv; тесты — встроенный `node:test` + `node:assert/strict`; бот — grammY (модуль в `.agent/bot/`); AI — Claude Code CLI.

**Важно про окружение:** Node лежит в `C:\Users\Administrator\nodejs\` и НЕ в системном PATH. Для `npm install` с нативными пакетами (better-sqlite3) использовать PowerShell с временным PATH:
`powershell -Command '$env:PATH = "C:\Users\Administrator\nodejs;" + $env:PATH; cd <dir>; npm install'`

**Отклонение от спеки (осознанное, YAGNI):** воркер и `ecosystem`-приложение `agent-content-worker` НЕ создаются в Фазе 1 — в этой фазе нет фоновых задач. Появятся в Фазе 2.

---

## File Structure

| Файл | Ответственность |
|---|---|
| `projects/content-agent/package.json` | Манифест, зависимости, скрипт `test` |
| `projects/content-agent/.gitignore` | Исключить `node_modules/`, `data/` |
| `projects/content-agent/.env.example` | Шаблон env (порт, пароль, секрет, путь к claude) |
| `projects/content-agent/lib/db.js` | SQLite: схема Фазы 1 (settings, style_interview, posts) + query-хелперы |
| `projects/content-agent/lib/auth.js` | `makeToken` + `authMiddleware` (self-contained HMAC) |
| `projects/content-agent/lib/ai.js` | Обёртка над claude CLI (`generate`, `extractJson`), runner инъектируется |
| `projects/content-agent/lib/style.js` | 10 вопросов интервью, 5 промпт-билдеров профиля, `generateStyleProfile` |
| `projects/content-agent/lib/writer.js` | Загрузка профиля, билд промпта поста, `generatePost` + варианты |
| `projects/content-agent/server.js` | `createServer({db,password,secret,styleDir,runner,model})` — HTTP API |
| `projects/content-agent/bin/start-server.js` | PM2 entry: открыть БД, поднять сервер |
| `projects/content-agent/ecosystem.config.cjs` | PM2-конфиг (только server) |
| `projects/content-agent/README.md` | Запуск, env, эндпоинты |
| `projects/content-agent/test/*.test.js` | Юнит/интеграционные тесты |
| `.agent/bot/content-menu.js` | `registerContentHandlers(bot, isOwner)`: меню, мастер стиля, мастер поста |
| `.agent/bot/index.js` | Подключение модуля + кнопка «✍ Контент» + `/content` + export `transcribeVoice`/`downloadTgFile` |

---

## Task 1: Скаффолд проекта (package.json, .gitignore, .env.example)

**Files:**
- Create: `projects/content-agent/package.json`
- Create: `projects/content-agent/.gitignore`
- Create: `projects/content-agent/.env.example`

- [ ] **Step 1: Создать package.json**

```json
{
  "name": "agent-content-agent",
  "version": "0.1.0",
  "type": "module",
  "description": "Личный Контент-Агент — обучение стилю и написание постов (Фаза 1)",
  "main": "server.js",
  "scripts": {
    "start:server": "node server.js",
    "dev:server": "node --watch server.js",
    "test": "node --test test/"
  },
  "dependencies": {
    "better-sqlite3": "^11.3.0",
    "dotenv": "^16.4.7",
    "express": "^4.21.2"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 2: Создать .gitignore**

```
node_modules/
data/
.env
```

- [ ] **Step 3: Создать .env.example**

```
# HTTP
CA_PORT=3002
# Авторизация (self-contained HMAC). Для единого логина задай те же значения,
# что у парсера/sales (пароль один на все веб-сервисы).
CA_PASSWORD=change-me
CA_SECRET=change-me-secret
# Claude CLI: путь к бинарю и HOME для OAuth-сессии подписки
CLAUDE_CLI_PATH=C:\\Users\\Administrator\\.agent\\bot\\claude.cmd
AGENT_HOME=C:\\Users\\Administrator
# Модель генерации (sonnet/opus/haiku)
CA_MODEL=sonnet
# Путь к БД и профилю стиля (по умолчанию ./data/...)
CA_DB_PATH=./data/content-agent.db
CA_STYLE_DIR=./data/style
```

- [ ] **Step 4: Установить зависимости**

Run (PowerShell, временный PATH для нативной сборки better-sqlite3):
```
powershell -Command '$env:PATH = "C:\Users\Administrator\nodejs;" + $env:PATH; cd "C:\Users\Administrator\Documents\Projects\gideon\projects\content-agent"; npm install'
```
Expected: `node_modules/` создан, better-sqlite3 собрался без ошибок.

- [ ] **Step 5: Commit**

```bash
git add projects/content-agent/package.json projects/content-agent/.gitignore projects/content-agent/.env.example
git commit -m "feat(content-agent): скаффолд проекта Фазы 1"
```

---

## Task 2: БД — схема Фазы 1 + хелперы (lib/db.js)

**Files:**
- Create: `projects/content-agent/lib/db.js`
- Test: `projects/content-agent/test/db.test.js`

- [ ] **Step 1: Написать падающий тест**

```javascript
// test/db.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  openDb, getSetting, setSetting,
  createInterview, getInterview, getActiveInterview,
  addInterviewAnswer, addInterviewMaterial, finishInterview,
  createPost, getPost, updatePostDraft, setPostStatus,
} from "../lib/db.js";

test("settings: set и get", () => {
  const db = openDb(":memory:");
  setSetting(db, "vk_token", "abc");
  assert.equal(getSetting(db, "vk_token"), "abc");
  assert.equal(getSetting(db, "missing"), null);
});

test("interview: создание, ответы, материалы, активная сессия", () => {
  const db = openDb(":memory:");
  const id = createInterview(db);
  const iv = getInterview(db, id);
  assert.equal(iv.status, "in_progress");
  assert.deepEqual(JSON.parse(iv.answers_json), []);

  addInterviewAnswer(db, id, "Вопрос 1", "Мой ответ");
  addInterviewMaterial(db, id, "transcript", "текст транскрипта");
  const iv2 = getInterview(db, id);
  assert.equal(JSON.parse(iv2.answers_json).length, 1);
  assert.equal(JSON.parse(iv2.answers_json)[0].transcript, "Мой ответ");
  assert.equal(JSON.parse(iv2.materials_json).length, 1);

  assert.equal(getActiveInterview(db).id, id);
  finishInterview(db, id);
  assert.equal(getInterview(db, id).status, "done");
  assert.equal(getActiveInterview(db), null);
});

test("posts: создание, обновление драфта, статус", () => {
  const db = openDb(":memory:");
  const id = createPost(db, { origin: "prompt", user_prompt: "про выбор нейросети" });
  assert.equal(getPost(db, id).status, "draft");
  updatePostDraft(db, id, "Готовый текст поста");
  assert.equal(getPost(db, id).draft_text, "Готовый текст поста");
  setPostStatus(db, id, "approved");
  const p = getPost(db, id);
  assert.equal(p.status, "approved");
  assert.ok(p.approved_at > 0);
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `powershell -Command '$env:PATH = "C:\Users\Administrator\nodejs;" + $env:PATH; cd "C:\Users\Administrator\Documents\Projects\gideon\projects\content-agent"; npm test'`
Expected: FAIL — `Cannot find module '../lib/db.js'`.

- [ ] **Step 3: Реализовать lib/db.js**

```javascript
// lib/db.js
import Database from "better-sqlite3";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS style_interview (
  id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'in_progress',
  step INTEGER NOT NULL DEFAULT 0,
  answers_json TEXT NOT NULL DEFAULT '[]',
  materials_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  origin TEXT NOT NULL,
  user_prompt TEXT,
  draft_text TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at INTEGER NOT NULL,
  approved_at INTEGER
);
`;

export function openDb(path = "./data/content-agent.db") {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

export function getSetting(db, key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : null;
}

export function setSetting(db, key, value) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

export function createInterview(db) {
  return db.prepare("INSERT INTO style_interview (created_at) VALUES (?)").run(Date.now()).lastInsertRowid;
}

export function getInterview(db, id) {
  return db.prepare("SELECT * FROM style_interview WHERE id = ?").get(id);
}

export function getActiveInterview(db) {
  return db.prepare("SELECT * FROM style_interview WHERE status = 'in_progress' ORDER BY id DESC LIMIT 1").get() ?? null;
}

export function addInterviewAnswer(db, id, question, transcript) {
  const iv = getInterview(db, id);
  const answers = JSON.parse(iv.answers_json);
  answers.push({ q: question, transcript });
  db.prepare("UPDATE style_interview SET answers_json = ?, step = ? WHERE id = ?")
    .run(JSON.stringify(answers), answers.length, id);
  return answers.length;
}

export function addInterviewMaterial(db, id, type, text) {
  const iv = getInterview(db, id);
  const materials = JSON.parse(iv.materials_json);
  materials.push({ type, text });
  db.prepare("UPDATE style_interview SET materials_json = ? WHERE id = ?")
    .run(JSON.stringify(materials), id);
  return materials.length;
}

export function finishInterview(db, id) {
  db.prepare("UPDATE style_interview SET status = 'done', finished_at = ? WHERE id = ?").run(Date.now(), id);
}

export function createPost(db, { origin, user_prompt = null }) {
  return db.prepare("INSERT INTO posts (origin, user_prompt, status, created_at) VALUES (?, ?, 'draft', ?)")
    .run(origin, user_prompt, Date.now()).lastInsertRowid;
}

export function getPost(db, id) {
  return db.prepare("SELECT * FROM posts WHERE id = ?").get(id);
}

export function updatePostDraft(db, id, draftText) {
  db.prepare("UPDATE posts SET draft_text = ? WHERE id = ?").run(draftText, id);
}

export function setPostStatus(db, id, status) {
  if (status === "approved") {
    db.prepare("UPDATE posts SET status = ?, approved_at = ? WHERE id = ?").run(status, Date.now(), id);
  } else {
    db.prepare("UPDATE posts SET status = ? WHERE id = ?").run(status, id);
  }
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `npm test` (с PATH-префиксом как выше)
Expected: PASS — 3 теста db.test.js зелёные.

- [ ] **Step 5: Commit**

```bash
git add projects/content-agent/lib/db.js projects/content-agent/test/db.test.js
git commit -m "feat(content-agent): БД Фазы 1 (settings, style_interview, posts)"
```

---

## Task 3: Авторизация (lib/auth.js)

**Files:**
- Create: `projects/content-agent/lib/auth.js`
- Test: `projects/content-agent/test/auth.test.js`

- [ ] **Step 1: Написать падающий тест**

```javascript
// test/auth.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeToken, authMiddleware } from "../lib/auth.js";

test("makeToken детерминирован и зависит от секрета и пароля", () => {
  const a = makeToken("s", "p");
  assert.equal(a, makeToken("s", "p"));
  assert.notEqual(a, makeToken("s2", "p"));
  assert.notEqual(a, makeToken("s", "p2"));
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("authMiddleware пускает с верным токеном, отбивает без", () => {
  const mw = authMiddleware({ password: "p", secret: "s" });
  const token = makeToken("s", "p");

  function run(headers) {
    let statusCode = null, nexted = false;
    const req = { headers };
    const res = { status(c) { statusCode = c; return { json() {} }; } };
    mw(req, res, () => { nexted = true; });
    return { statusCode, nexted };
  }

  assert.equal(run({ "x-auth-token": token }).nexted, true);
  assert.equal(run({}).statusCode, 401);
  assert.equal(run({ "x-auth-token": "wrong" }).statusCode, 401);
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/auth.js'`.

- [ ] **Step 3: Реализовать lib/auth.js**

```javascript
// lib/auth.js
import { createHmac, timingSafeEqual } from "node:crypto";

export function makeToken(secret, password) {
  return createHmac("sha256", secret).update(password).digest("hex");
}

function extractToken(req) {
  const auth = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return m[1].trim();
  if (req.headers["x-auth-token"]) return String(req.headers["x-auth-token"]).trim();
  return null;
}

function safeEqual(a, b) {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function authMiddleware({ password, secret }) {
  const expected = makeToken(secret, password);
  return (req, res, next) => {
    const token = extractToken(req);
    if (token && safeEqual(token, expected)) return next();
    return res.status(401).json({ error: "unauthorized" });
  };
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `npm test`
Expected: PASS — auth.test.js зелёные.

- [ ] **Step 5: Commit**

```bash
git add projects/content-agent/lib/auth.js projects/content-agent/test/auth.test.js
git commit -m "feat(content-agent): self-contained HMAC-авторизация"
```

---

## Task 4: AI-обёртка над claude CLI (lib/ai.js)

**Files:**
- Create: `projects/content-agent/lib/ai.js`
- Test: `projects/content-agent/test/ai.test.js`

- [ ] **Step 1: Написать падающий тест**

```javascript
// test/ai.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { generate, extractJson } from "../lib/ai.js";

test("generate собирает payload и парсит JSON-ответ CLI", async () => {
  let captured = null;
  const fakeRunner = async (args, payload) => {
    captured = { args, payload };
    return JSON.stringify({ result: "готовый текст" });
  };
  const res = await generate({
    systemPrompt: "Ты пишешь в стиле Александра",
    userMessage: "напиши пост про нейросети",
    runner: fakeRunner,
    model: "sonnet",
  });
  assert.equal(res.text, "готовый текст");
  assert.ok(captured.payload.includes("Ты пишешь в стиле Александра"));
  assert.ok(captured.payload.includes("напиши пост про нейросети"));
  assert.ok(captured.args.includes("--model"));
  assert.ok(captured.args.includes("sonnet"));
});

test("generate бросает понятную ошибку на мусор от CLI", async () => {
  const badRunner = async () => "не-json";
  await assert.rejects(
    () => generate({ systemPrompt: "x", userMessage: "y", runner: badRunner }),
    /парсинг/i,
  );
});

test("extractJson снимает markdown-обёртку", () => {
  assert.equal(extractJson('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(extractJson('{"a":1}'), '{"a":1}');
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/ai.js'`.

- [ ] **Step 3: Реализовать lib/ai.js**

```javascript
// lib/ai.js
import { spawn } from "node:child_process";

function getClaudePath() {
  return process.env.CLAUDE_CLI_PATH || process.env.CLAUDE_CODE_EXECPATH || "claude";
}

export function extractJson(text) {
  if (!text) return text;
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenced) return fenced[1].trim();
  return text.trim();
}

export async function generate({ systemPrompt, userMessage, runner = defaultRunner, model = process.env.CA_MODEL || "sonnet" }) {
  const payload = `${systemPrompt}\n\n${userMessage}`;
  const stdout = await runner(["-p", "--output-format", "json", "--model", model], payload);
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (e) {
    throw new Error(`AI: парсинг ответа CLI провален: ${e.message}; raw: ${String(stdout).slice(0, 200)}`);
  }
  return { text: parsed.result ?? parsed.text ?? "", raw: parsed };
}

function defaultRunner(args, stdinPayload) {
  return new Promise((resolve, reject) => {
    const claudePath = getClaudePath();
    const child = spawn(claudePath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, HOME: process.env.AGENT_HOME || process.env.HOME },
      timeout: 300000,
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => reject(new Error(`claude CLI spawn failed (path=${claudePath}): ${err.message}`)));
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`claude CLI exit ${code}: ${stderr.slice(0, 500)}`));
      resolve(stdout);
    });
    child.stdin.write(stdinPayload);
    child.stdin.end();
  });
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `npm test`
Expected: PASS — ai.test.js зелёные.

- [ ] **Step 5: Commit**

```bash
git add projects/content-agent/lib/ai.js projects/content-agent/test/ai.test.js
git commit -m "feat(content-agent): обёртка над claude CLI (generate)"
```

---

## Task 5: Стиль — вопросы интервью + 5 промпт-билдеров + генерация профиля (lib/style.js)

**Files:**
- Create: `projects/content-agent/lib/style.js`
- Test: `projects/content-agent/test/style.test.js`

- [ ] **Step 1: Написать падающий тест**

```javascript
// test/style.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { INTERVIEW_QUESTIONS, STYLE_DOCS, buildCorpus, generateStyleProfile } from "../lib/style.js";

test("10 вопросов интервью", () => {
  assert.equal(INTERVIEW_QUESTIONS.length, 10);
  for (const q of INTERVIEW_QUESTIONS) assert.ok(q.length > 10);
});

test("5 документов профиля с уникальными именами", () => {
  assert.equal(STYLE_DOCS.length, 5);
  const names = STYLE_DOCS.map((d) => d.filename);
  assert.deepEqual(new Set(names).size, 5);
  assert.ok(names.includes("tone-of-voice.md"));
  assert.ok(names.includes("brand-code.md"));
  assert.ok(names.includes("content-system.md"));
  assert.ok(names.includes("personal-phrasebook.md"));
  assert.ok(names.includes("ideal-post-structure.md"));
});

test("buildCorpus собирает ответы и материалы в текст", () => {
  const corpus = buildCorpus({
    answers: [{ q: "Вопрос?", transcript: "Ответ голосом" }],
    materials: [{ type: "transcript", text: "доп текст" }],
  });
  assert.ok(corpus.includes("Вопрос?"));
  assert.ok(corpus.includes("Ответ голосом"));
  assert.ok(corpus.includes("доп текст"));
});

test("generateStyleProfile пишет 5 файлов, в промпт попадает корпус", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "style-"));
  const prompts = [];
  const fakeRunner = async (_args, payload) => {
    prompts.push(payload);
    return JSON.stringify({ result: "# Сгенерированный md\nсодержимое" });
  };
  const files = await generateStyleProfile({
    corpus: "КОРПУС-МАРКЕР",
    styleDir: dir,
    runner: fakeRunner,
  });
  assert.equal(files.length, 5);
  for (const f of STYLE_DOCS.map((d) => d.filename)) {
    assert.ok(fs.existsSync(path.join(dir, f)), `нет файла ${f}`);
  }
  assert.equal(prompts.length, 5);
  assert.ok(prompts.every((p) => p.includes("КОРПУС-МАРКЕР")));
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/style.js'`.

- [ ] **Step 3: Реализовать lib/style.js**

```javascript
// lib/style.js
import fs from "node:fs";
import path from "node:path";
import { generate } from "./ai.js";

export const INTERVIEW_QUESTIONS = [
  "Расскажи о моменте, когда ты впервые понял, что нейросети — это твоё. Что именно зацепило?",
  "Если бы тебе запретили слово «нейросеть», как бы ты объяснил другу, чем занимаешься?",
  "Какое самое спорное мнение про AI ты готов отстаивать, даже когда большинство против?",
  "Опиши свой типичный провал в работе с AI — что пошло не так и что ты из этого вынес?",
  "Когда объясняешь сложную штуку новичку — с чего начинаешь? Приведи живой пример.",
  "Что тебя реально бесит в том, как другие говорят про нейросети?",
  "Какую свою победу в вайб-кодинге вспоминаешь с гордостью? Расскажи, как это было.",
  "Если бы от всего твоего контента осталась одна фраза-визитка — что бы это было?",
  "За кем из экспертов следишь и что в их подаче нравится, а что раздражает?",
  "Кому ты на самом деле пишешь свои посты? Опиши этого человека: его страхи и желания.",
];

export function buildCorpus({ answers = [], materials = [] }) {
  const parts = ["# Ответы на интервью\n"];
  for (const a of answers) {
    parts.push(`## ${a.q}`);
    parts.push(a.transcript || "(нет ответа)");
    parts.push("");
  }
  if (materials.length) {
    parts.push("# Дополнительные материалы\n");
    for (const m of materials) {
      parts.push(`## [${m.type}]`);
      parts.push(m.text || "");
      parts.push("");
    }
  }
  return parts.join("\n");
}

const SYSTEM = "Ты — эксперт-лингвист и контент-стратег. Анализируешь речь и стиль человека по его ответам и материалам. Пиши по-русски, конкретно, без воды. Возвращай ТОЛЬКО готовый markdown-документ без преамбул и без markdown-обёртки ```.";

export const STYLE_DOCS = [
  {
    filename: "tone-of-voice.md",
    buildPrompt: (corpus) => `${corpus}\n\n---\nНа основе материалов выше составь документ Tone of Voice по структуре:\n\n1. ЛЕКСИКА — какие слова использует чаще всего, слова-паразиты, повторяющиеся обороты\n2. РИТМ РЕЧИ — длинные/короткие предложения, плавно/рублено, паузы («ну», «значит», «вот»)\n3. СПОСОБ ОБЪЯСНЯТЬ — через аналогии / примеры / цифры / истории\n4. ЭМОЦИОНАЛЬНЫЙ ТОНУС — сдержан/экспрессивен, уверен/сомневается вслух\n5. ОТНОШЕНИЕ К ЧИТАТЕЛЮ — как обращается: учит / делится / рассуждает вместе\n\nЗатем добавь:\n- Описание Tone of Voice (5–7 предложений)\n- 5 правил написания текстов в этом стиле\n- 3 пары примеров: «я бы НЕ написал так» vs «я бы написал вот так»`,
  },
  {
    filename: "brand-code.md",
    buildPrompt: (corpus) => `${corpus}\n\n---\nНа основе материалов выше составь Личный Бренд-Код:\n\n1. Три ключевые ценности бренда\n2. Уникальный тон голоса (с примерами характерных фраз и оборотов)\n3. Авторский стиль повествования\n4. Пять тем, в которых раскрывается экспертность\n5. Три психологических триггера, работающих с аудиторией\n6. «Большой Вопрос» — глобальная проблема, которую он помогает решить\n7. «Большое Обещание» — что получает аудитория от его контента`,
  },
  {
    filename: "content-system.md",
    buildPrompt: (corpus) => `${corpus}\n\n---\nНа основе материалов выше составь Систему Производства Контента:\n\n1. Шаблон генерации идей контента на основе ключевых тем\n2. Структура идеального поста для соцсетей, усиливающая ценности и сообщение\n3. Формула создания заголовков в этом стиле, вызывающих интерес\n4. Критерии проверки любого контента на соответствие бренду\n5. Список из 10 «фирменных фишек», которые должны быть в контенте\n\nСистема должна быть настолько чёткой, чтобы любой человек, не знающий автора лично, мог создавать контент, узнаваемый как его.`,
  },
  {
    filename: "personal-phrasebook.md",
    buildPrompt: (corpus) => `${corpus}\n\n---\nВыступи как лингвист-эксперт по речевым паттернам. На основе материалов выше составь персональный «Разговорник эксперта»:\n\n1. 10 «фирменных» способов начинать предложения или абзацы\n2. 7 характерных переходных фраз между мыслями\n3. 5 любимых метафор или аналогий для объяснения сложного\n4. 8 типичных способов завершать мысль с эмоциональным воздействием\n5. 6 языковых конструкций, отражающих уникальный стиль мышления\n6. 3 «коронных» способа обращаться к аудитории\n\nЭто должен быть учебник его языка — чтобы любой текст звучал именно как он.`,
  },
  {
    filename: "ideal-post-structure.md",
    buildPrompt: (corpus) => `${corpus}\n\n---\nВыступи как эксперт по вирусным вовлекающим постам. На основе материалов выше составь Структуру Идеального Поста:\n\n1. Цель поста (доверие / кейс / продажа / объяснение идеи / экспертность)\n2. Целевая аудитория (кратко)\n3. Платформа (Telegram, VK и т.п.)\n4. Стиль (деловой / лёгкий / эмоциональный / провокационный / сторителлинг)\n5. Структура блоками: Заголовок · Первое предложение · Проблема · Ошибка/ложное решение · Новое решение · Кейсы/доказательства · Выгоды · Призыв к действию\n\nДобавь элементы форматирования: эмодзи, абзацы, капслок, подзаголовки — как их использовать в его стиле.`,
  },
];

export async function generateStyleProfile({ corpus, styleDir, runner, model }) {
  fs.mkdirSync(styleDir, { recursive: true });
  const written = [];
  for (const doc of STYLE_DOCS) {
    const { text } = await generate({
      systemPrompt: SYSTEM,
      userMessage: doc.buildPrompt(corpus),
      runner,
      model,
    });
    fs.writeFileSync(path.join(styleDir, doc.filename), (text || "").trim() + "\n", "utf8");
    written.push(doc.filename);
  }
  return written;
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `npm test`
Expected: PASS — style.test.js зелёные.

- [ ] **Step 5: Commit**

```bash
git add projects/content-agent/lib/style.js projects/content-agent/test/style.test.js
git commit -m "feat(content-agent): интервью стиля + генерация 5 md-профилей"
```

---

## Task 6: Писатель постов (lib/writer.js)

**Files:**
- Create: `projects/content-agent/lib/writer.js`
- Test: `projects/content-agent/test/writer.test.js`

- [ ] **Step 1: Написать падающий тест**

```javascript
// test/writer.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { loadStyleProfile, buildPostPrompt, VARIANTS, generatePost } from "../lib/writer.js";

test("loadStyleProfile: пусто если файлов нет, иначе склейка", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "w-empty-"));
  assert.equal(loadStyleProfile(empty).present, false);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "w-full-"));
  fs.writeFileSync(path.join(dir, "tone-of-voice.md"), "ТОН-МАРКЕР");
  const loaded = loadStyleProfile(dir);
  assert.equal(loaded.present, true);
  assert.ok(loaded.text.includes("ТОН-МАРКЕР"));
});

test("buildPostPrompt включает стиль, запрос и инструкцию варианта", () => {
  const p = buildPostPrompt({ styleText: "СТИЛЬ-X", userPrompt: "пост про RAG", variantMode: "humor" });
  assert.ok(p.includes("СТИЛЬ-X"));
  assert.ok(p.includes("пост про RAG"));
  assert.ok(p.includes(VARIANTS.humor));
});

test("buildPostPrompt без стиля помечает, что стиль не обучен", () => {
  const p = buildPostPrompt({ styleText: "", userPrompt: "пост" });
  assert.match(p, /стиль не обучен|без профиля/i);
});

test("generatePost возвращает текст от runner", async () => {
  const fakeRunner = async () => JSON.stringify({ result: "текст поста" });
  const res = await generatePost({ styleText: "S", userPrompt: "тема", runner: fakeRunner });
  assert.equal(res, "текст поста");
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/writer.js'`.

- [ ] **Step 3: Реализовать lib/writer.js**

```javascript
// lib/writer.js
import fs from "node:fs";
import path from "node:path";
import { generate } from "./ai.js";

const STYLE_FILES = [
  "tone-of-voice.md", "brand-code.md", "content-system.md",
  "personal-phrasebook.md", "ideal-post-structure.md",
];

export function loadStyleProfile(styleDir) {
  const parts = [];
  for (const f of STYLE_FILES) {
    const p = path.join(styleDir, f);
    if (fs.existsSync(p)) {
      parts.push(`--- ${f} ---\n${fs.readFileSync(p, "utf8")}`);
    }
  }
  return { present: parts.length > 0, text: parts.join("\n\n") };
}

export const VARIANTS = {
  expert: "Сделай заметно экспертнее: больше глубины, точные формулировки, профессиональная лексика.",
  simpler: "Сделай проще и доступнее: короче предложения, меньше терминов, объясняй на пальцах.",
  humor: "Добавь больше юмора и лёгкого стёба, сохраняя смысл и пользу.",
  cta: "Усиль призыв к действию в конце: чёткий, мотивирующий, без впаривания.",
  shorter: "Сократи в 1.5–2 раза, оставь только самое сильное.",
  rewrite: "Перепиши иначе — другой заход и структура, та же тема и стиль.",
};

const SYSTEM = "Ты пишешь посты от лица автора, строго в его стиле (профиль ниже). Пиши по-русски. Готовый пост для соцсети: заголовок, основная часть, вывод/призыв. Возвращай ТОЛЬКО текст поста без преамбул и без markdown-обёртки ```.";

export function buildPostPrompt({ styleText, userPrompt, variantMode = null }) {
  const styleBlock = styleText
    ? `# Профиль стиля автора\n${styleText}`
    : "# Профиль стиля\n(стиль не обучен — пиши живо, экспертно и по-человечески, без канцелярита)";
  const variantBlock = variantMode && VARIANTS[variantMode]
    ? `\n\n# Доп. инструкция к этому варианту\n${VARIANTS[variantMode]}`
    : "";
  return `${styleBlock}\n\n# Задача\nНапиши пост на тему: ${userPrompt}${variantBlock}`;
}

export async function generatePost({ styleText, userPrompt, variantMode = null, runner, model }) {
  const { text } = await generate({
    systemPrompt: SYSTEM,
    userMessage: buildPostPrompt({ styleText, userPrompt, variantMode }),
    runner,
    model,
  });
  return (text || "").trim();
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `npm test`
Expected: PASS — writer.test.js зелёные.

- [ ] **Step 5: Commit**

```bash
git add projects/content-agent/lib/writer.js projects/content-agent/test/writer.test.js
git commit -m "feat(content-agent): писатель постов по профилю стиля + варианты"
```

---

## Task 7: HTTP-сервер (server.js)

**Files:**
- Create: `projects/content-agent/server.js`
- Test: `projects/content-agent/test/server.test.js`

- [ ] **Step 1: Написать падающий тест**

```javascript
// test/server.test.js
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
  const styleDir = fs.mkdtempSync(path.join(os.tmpdir(), "srv-style-"));
  // runner возвращает разный текст в зависимости от запроса, чтобы проверить поток
  const runner = async (_args, payload) => JSON.stringify({ result: `OUT:${payload.slice(0, 20)}` });
  const app = createServer({ db, password, secret, styleDir, runner, model: "sonnet" });
  const server = app.listen(0);
  const port = server.address().port;
  const token = makeToken(secret, password);
  const req = (method, p, body, opts = {}) => fetch(`http://127.0.0.1:${port}${p}`, {
    method,
    headers: { "content-type": "application/json", ...(opts.noAuth ? {} : { "x-auth-token": token }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { req, close: () => server.close(), db, styleDir };
}

test("GET /api/health без авторизации", async () => {
  const { req, close } = setup();
  const res = await req("GET", "/api/health", null, { noAuth: true });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
  close();
});

test("защищённый эндпоинт без токена → 401", async () => {
  const { req, close } = setup();
  const res = await req("GET", "/api/style/status", null, { noAuth: true });
  assert.equal(res.status, 401);
  close();
});

test("POST /api/auth с верным паролем → токен", async () => {
  const { req, close } = setup();
  const r = await req("POST", "/api/auth", { password: "p" }, { noAuth: true });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).token, makeToken("s", "p"));
  close();
});

test("интервью: start → 10 ответов → finish пишет 5 файлов", async () => {
  const { req, close, styleDir } = setup();
  const start = await (await req("POST", "/api/style/interview/start")).json();
  assert.equal(start.step, 0);
  assert.ok(start.question.length > 0);
  assert.equal(start.total, 10);

  let last;
  for (let i = 0; i < 10; i++) {
    last = await (await req("POST", "/api/style/interview/answer", { transcript: `ответ ${i}` })).json();
  }
  assert.equal(last.questions_done, true);

  const fin = await (await req("POST", "/api/style/interview/finish")).json();
  assert.equal(fin.files.length, 5);
  assert.ok(fs.existsSync(path.join(styleDir, "tone-of-voice.md")));

  const status = await (await req("GET", "/api/style/status")).json();
  assert.equal(status.present, true);
  close();
});

test("посты: создать драфт, вариант, одобрить", async () => {
  const { req, close } = setup();
  const created = await (await req("POST", "/api/posts", { user_prompt: "про RAG" })).json();
  assert.ok(created.id);
  assert.ok(created.draft_text.startsWith("OUT:"));

  const variant = await (await req("POST", `/api/posts/${created.id}/variant`, { mode: "humor" })).json();
  assert.ok(variant.draft_text.startsWith("OUT:"));

  const appr = await (await req("POST", `/api/posts/${created.id}/approve`)).json();
  assert.equal(appr.ok, true);
  close();
});

test("settings: PUT и GET", async () => {
  const { req, close } = setup();
  await req("PUT", "/api/settings", { key: "vk_token", value: "xyz" });
  const got = await (await req("GET", "/api/settings")).json();
  assert.equal(got.vk_token, "xyz");
  close();
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npm test`
Expected: FAIL — `Cannot find module '../server.js'`.

- [ ] **Step 3: Реализовать server.js**

```javascript
// server.js
import express from "express";
import path from "node:path";
import { authMiddleware, makeToken } from "./lib/auth.js";
import {
  getSetting, setSetting,
  createInterview, getInterview, getActiveInterview,
  addInterviewAnswer, addInterviewMaterial, finishInterview,
  createPost, getPost, updatePostDraft, setPostStatus,
} from "./lib/db.js";
import { INTERVIEW_QUESTIONS, buildCorpus, generateStyleProfile, STYLE_DOCS } from "./lib/style.js";
import { loadStyleProfile, generatePost } from "./lib/writer.js";

const SETTING_KEYS = ["vk_token", "youtube_api_key", "publish_targets"];

export function createServer({ db, password, secret, styleDir, runner, model }) {
  const app = express();
  app.use(express.json({ limit: "5mb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.post("/api/auth", (req, res) => {
    if (String(req.body?.password || "") === password) {
      return res.json({ token: makeToken(secret, password) });
    }
    return res.status(401).json({ error: "wrong password" });
  });

  const auth = authMiddleware({ password, secret });
  app.use("/api/style", auth);
  app.use("/api/posts", auth);
  app.use("/api/settings", auth);

  // ── Стиль ──────────────────────────────────────────────
  app.get("/api/style/status", (_req, res) => {
    const profile = loadStyleProfile(styleDir);
    const active = getActiveInterview(db);
    res.json({
      present: profile.present,
      files: STYLE_DOCS.map((d) => d.filename),
      interview_active: active ? active.id : null,
      interview_step: active ? active.step : 0,
    });
  });

  app.post("/api/style/interview/start", (_req, res) => {
    const id = createInterview(db);
    res.json({ id, step: 0, total: INTERVIEW_QUESTIONS.length, question: INTERVIEW_QUESTIONS[0] });
  });

  app.post("/api/style/interview/answer", (req, res) => {
    const iv = getActiveInterview(db);
    if (!iv) return res.status(404).json({ error: "нет активного интервью" });
    const transcript = String(req.body?.transcript || "").trim();
    if (!transcript) return res.status(400).json({ error: "transcript required" });
    const question = INTERVIEW_QUESTIONS[iv.step];
    const count = addInterviewAnswer(db, iv.id, question, transcript);
    if (count < INTERVIEW_QUESTIONS.length) {
      return res.json({ step: count, total: INTERVIEW_QUESTIONS.length, question: INTERVIEW_QUESTIONS[count] });
    }
    res.json({ questions_done: true });
  });

  app.post("/api/style/interview/material", (req, res) => {
    const iv = getActiveInterview(db);
    if (!iv) return res.status(404).json({ error: "нет активного интервью" });
    const type = String(req.body?.type || "text");
    const text = String(req.body?.text || "").trim();
    if (!text) return res.status(400).json({ error: "text required" });
    const count = addInterviewMaterial(db, iv.id, type, text);
    res.json({ materials: count });
  });

  app.post("/api/style/interview/finish", async (req, res) => {
    const iv = getActiveInterview(db);
    if (!iv) return res.status(404).json({ error: "нет активного интервью" });
    try {
      const corpus = buildCorpus({
        answers: JSON.parse(iv.answers_json),
        materials: JSON.parse(iv.materials_json),
      });
      const files = await generateStyleProfile({ corpus, styleDir, runner, model });
      finishInterview(db, iv.id);
      res.json({ files });
    } catch (e) {
      res.status(500).json({ error: String(e.message) });
    }
  });

  app.post("/api/style/retrain", (_req, res) => {
    const id = createInterview(db);
    res.json({ id, step: 0, total: INTERVIEW_QUESTIONS.length, question: INTERVIEW_QUESTIONS[0] });
  });

  // ── Посты ──────────────────────────────────────────────
  app.post("/api/posts", async (req, res) => {
    const userPrompt = String(req.body?.user_prompt || "").trim();
    if (!userPrompt) return res.status(400).json({ error: "user_prompt required" });
    const id = createPost(db, { origin: "prompt", user_prompt: userPrompt });
    try {
      const styleText = loadStyleProfile(styleDir).text;
      const text = await generatePost({ styleText, userPrompt, runner, model });
      updatePostDraft(db, id, text);
      res.status(201).json({ id, draft_text: text });
    } catch (e) {
      res.status(500).json({ error: String(e.message), id });
    }
  });

  app.post("/api/posts/:id/variant", async (req, res) => {
    const id = Number(req.params.id);
    const post = getPost(db, id);
    if (!post) return res.status(404).json({ error: "not found" });
    const mode = String(req.body?.mode || "rewrite");
    try {
      const styleText = loadStyleProfile(styleDir).text;
      const text = await generatePost({ styleText, userPrompt: post.user_prompt, variantMode: mode, runner, model });
      updatePostDraft(db, id, text);
      res.json({ id, draft_text: text });
    } catch (e) {
      res.status(500).json({ error: String(e.message) });
    }
  });

  app.get("/api/posts/:id", (req, res) => {
    const post = getPost(db, Number(req.params.id));
    if (!post) return res.status(404).json({ error: "not found" });
    res.json(post);
  });

  app.post("/api/posts/:id/approve", (req, res) => {
    const id = Number(req.params.id);
    if (!getPost(db, id)) return res.status(404).json({ error: "not found" });
    setPostStatus(db, id, "approved");
    res.json({ ok: true, id });
  });

  // ── Настройки ──────────────────────────────────────────
  app.get("/api/settings", (_req, res) => {
    const out = {};
    for (const k of SETTING_KEYS) out[k] = getSetting(db, k);
    res.json(out);
  });

  app.put("/api/settings", (req, res) => {
    const { key, value } = req.body || {};
    if (!SETTING_KEYS.includes(key)) return res.status(400).json({ error: "unknown key" });
    setSetting(db, key, String(value ?? ""));
    res.json({ ok: true });
  });

  return app;
}
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `npm test`
Expected: PASS — все server.test.js зелёные.

- [ ] **Step 5: Commit**

```bash
git add projects/content-agent/server.js projects/content-agent/test/server.test.js
git commit -m "feat(content-agent): HTTP API (стиль, посты, настройки)"
```

---

## Task 8: PM2 entry + ecosystem + README

**Files:**
- Create: `projects/content-agent/bin/start-server.js`
- Create: `projects/content-agent/ecosystem.config.cjs`
- Create: `projects/content-agent/README.md`

- [ ] **Step 1: Создать bin/start-server.js**

```javascript
// bin/start-server.js
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
dotenv.config();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { openDb } = await import("../lib/db.js");
const { createServer } = await import("../server.js");

const db = openDb(process.env.CA_DB_PATH || path.join(root, "data", "content-agent.db"));
const styleDir = process.env.CA_STYLE_DIR || path.join(root, "data", "style");
const port = Number(process.env.CA_PORT || 3002);
const password = process.env.CA_PASSWORD || "change-me";
const secret = process.env.CA_SECRET || "change-me-secret";
const model = process.env.CA_MODEL || "sonnet";

const app = createServer({ db, password, secret, styleDir, model });
app.listen(port, () => console.log(`content-agent server on :${port} (styleDir=${styleDir}, model=${model})`));
```

> Примечание: `createServer` без `runner` → используется `defaultRunner` из `lib/ai.js` (реальный claude CLI). `generatePost`/`generateStyleProfile` пробрасывают `runner=undefined` в `generate`, где он подменяется на `defaultRunner` по умолчанию.

- [ ] **Step 2: Создать ecosystem.config.cjs**

```javascript
module.exports = {
  apps: [
    {
      name: "agent-content-server",
      script: "./bin/start-server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      watch: false,
      env: { NODE_ENV: "production" },
    },
  ],
};
```

- [ ] **Step 3: Создать README.md**

```markdown
# Контент-Агент (Фаза 1: стиль + посты)

Сервис генерации контента в стиле Александра. HTTP API на :3002, управление — через раздел «✍ Контент» в @flash_gideon_bot.

## Запуск
1. `cp .env.example .env` и заполнить (CA_PASSWORD/CA_SECRET — те же, что у парсера; CLAUDE_CLI_PATH, AGENT_HOME).
2. Установка: `powershell -Command '$env:PATH = "C:\Users\Administrator\nodejs;" + $env:PATH; npm install'`
3. Тесты: `npm test`
4. PM2: `pm2 start ecosystem.config.cjs`

## Эндпоинты (x-auth-token, кроме /health и /auth)
- `GET /api/health`
- `POST /api/auth {password}` → `{token}`
- `GET /api/style/status`
- `POST /api/style/interview/start|answer|material|finish`, `POST /api/style/retrain`
- `POST /api/posts {user_prompt}`, `POST /api/posts/:id/variant {mode}`, `POST /api/posts/:id/approve`, `GET /api/posts/:id`
- `GET/PUT /api/settings`

Профиль стиля — 5 md в `data/style/`. БД — `data/content-agent.db`.
```

- [ ] **Step 4: Smoke-проверка запуска сервера**

Run:
```
powershell -Command '$env:PATH = "C:\Users\Administrator\nodejs;" + $env:PATH; cd "C:\Users\Administrator\Documents\Projects\gideon\projects\content-agent"; copy .env.example .env; node bin/start-server.js'
```
В другом окне: `curl http://127.0.0.1:3002/api/health`
Expected: сервер логирует `content-agent server on :3002`, curl возвращает `{"ok":true}`. Затем остановить процесс (Ctrl+C).

- [ ] **Step 5: Commit**

```bash
git add projects/content-agent/bin/start-server.js projects/content-agent/ecosystem.config.cjs projects/content-agent/README.md
git commit -m "feat(content-agent): PM2 entry, ecosystem, README"
```

---

## Task 9: Экспорт хелперов голоса/загрузки из бота (index.js)

**Files:**
- Modify: `.agent/bot/index.js` (функции `downloadTgFile` ~529, `transcribeVoice` ~676)

Контент-меню переиспользует распознавание голоса и загрузку файлов бота. Сейчас эти функции не экспортируются.

- [ ] **Step 1: Добавить `export` к двум функциям**

Найти `async function downloadTgFile(url, destPath) {` и заменить на:
```javascript
export async function downloadTgFile(url, destPath) {
```

Найти `async function transcribeVoice(filePath) {` и заменить на:
```javascript
export async function transcribeVoice(filePath) {
```

- [ ] **Step 2: Проверить, что бот стартует без ошибок импорта**

Run:
```
powershell -Command '$env:PATH = "C:\Users\Administrator\nodejs;" + $env:PATH; cd "C:\Users\Administrator\Documents\Projects\gideon\.agent\bot"; node -e "import(\"./index.js\").then(()=>console.log(\"OK import\")).catch(e=>{console.error(e);process.exit(1)})"'
```
Expected: модуль импортируется (может попытаться запустить бота — если требуется BOT_TOKEN, достаточно убедиться, что нет SyntaxError/ImportError по этим функциям). Альтернатива — проверить синтаксис: `node --check index.js` → без ошибок.

- [ ] **Step 3: Commit**

```bash
git add .agent/bot/index.js
git commit -m "refactor(bot): экспорт transcribeVoice и downloadTgFile для content-menu"
```

---

## Task 10: Модуль бота — каркас меню + клиент API (content-menu.js)

**Files:**
- Create: `.agent/bot/content-menu.js`

- [ ] **Step 1: Создать content-menu.js — клиент API, главное меню, инструкция**

```javascript
// .agent/bot/content-menu.js
// Раздел «✍ Контент» в @flash_gideon_bot — управление Контент-Агентом.
// Сервис content-agent живёт на http://127.0.0.1:3002.
import { InlineKeyboard } from "grammy";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { unlinkSync } from "node:fs";
import { downloadTgFile, transcribeVoice } from "./index.js";

function loadCaEnv() {
  const candidates = [
    process.env.CA_ENV_PATH,
    "C:/Users/Administrator/Documents/Projects/gideon/projects/content-agent/.env",
    path.resolve(process.cwd(), "../../projects/content-agent/.env"),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const out = {};
      for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
        if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
      return out;
    } catch {}
  }
  return {};
}
const caEnv = loadCaEnv();
const CA_API_BASE = process.env.CA_API_BASE || `http://127.0.0.1:${caEnv.CA_PORT || 3002}/api`;
const CA_PASSWORD = process.env.CA_PASSWORD || caEnv.CA_PASSWORD || "change-me";
const CA_SECRET = process.env.CA_SECRET || caEnv.CA_SECRET || "change-me-secret";
const AUTH_TOKEN = crypto.createHmac("sha256", CA_SECRET).update(CA_PASSWORD).digest("hex");

async function api(method, p, body) {
  const res = await fetch(`${CA_API_BASE}${p}`, {
    method,
    headers: { "x-auth-token": AUTH_TOKEN, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`content-agent API ${method} ${p}: ${res.status} ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function esc(s) { return String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])); }

// chatId → состояние мастера
const wizards = new Map();

const INSTRUCTION = `<b>ℹ️ Контент-Агент</b>

Я учусь твоему стилю и пишу посты как ты.

<b>🎭 Мой стиль</b> — пройди интервью (10 вопросов, отвечай голосом). Я проанализирую речь и создам профиль стиля. Все посты дальше — в нём.

<b>✍ Написать пост</b> — пришли тему текстом или голосом, я напишу пост и предложу варианты (экспертнее, проще, с юмором, короче, призыв).

<b>📡 Источники</b>, <b>🔍 Найти информацию</b>, <b>📆 Дайджест</b>, <b>📖 Контент-план</b> — появятся в следующих фазах.`;

export function registerContentHandlers(bot, isOwner) {
  async function showMainMenu(ctx) {
    const kb = new InlineKeyboard()
      .text("🎭 Мой стиль", "ca:style").text("✍ Написать пост", "ca:write").row()
      .text("🔍 Найти информацию", "ca:soon").text("📆 Дайджест", "ca:soon").row()
      .text("📖 Контент-план", "ca:soon").text("📡 Источники", "ca:soon").row()
      .text("⚙ Настройки", "ca:settings").text("ℹ️ Инструкция", "ca:help");
    await ctx.reply("✍ <b>Контент-Агент</b> — что делаем?", { parse_mode: "HTML", reply_markup: kb });
  }

  bot.command("content", async (ctx) => {
    if (!isOwner(ctx)) return;
    await showMainMenu(ctx);
  });

  bot.callbackQuery(/^ca:menu$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    await showMainMenu(ctx);
  });

  bot.callbackQuery(/^ca:help$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    await ctx.reply(INSTRUCTION, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("🏠 Меню", "ca:menu") });
  });

  bot.callbackQuery(/^ca:soon$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery({ text: "Скоро — в следующих фазах" });
  });

  bot.callbackQuery(/^ca:settings$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    try {
      const s = await api("GET", "/settings");
      await ctx.answerCallbackQuery();
      await ctx.reply(
        `⚙ <b>Настройки Контент-Агента</b>\n\n` +
        `VK токен: ${s.vk_token ? "задан" : "—"}\n` +
        `YouTube ключ: ${s.youtube_api_key ? "задан" : "—"}\n\n` +
        `<i>Понадобятся в Фазе 3 (мониторинг VK/YouTube).</i>`,
        { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("🏠 Меню", "ca:menu") },
      );
    } catch (e) {
      await ctx.answerCallbackQuery({ text: "Сервис недоступен" });
      await ctx.reply(`⚠️ ${esc(e.message)}\n\nПроверь, что content-agent запущен (pm2).`);
    }
  });

  // Обработчики стиля и постов регистрируются ниже (Tasks 10, 11).
  registerStyleHandlers(bot, isOwner, { api, wizards, esc });
  registerWriteHandlers(bot, isOwner, { api, wizards, esc });
}
```

> Примечание: функции `registerStyleHandlers` и `registerWriteHandlers` определяются в Task 11 и Task 12 в этом же файле (добавляются в конец `content-menu.js`). До их добавления файл не запускать.

- [ ] **Step 2: Commit (промежуточный — каркас)**

```bash
git add .agent/bot/content-menu.js
git commit -m "feat(bot): каркас раздела Контент (меню, API-клиент, настройки)"
```

---

## Task 11: Мастер обучения стилю (content-menu.js → registerStyleHandlers)

**Files:**
- Modify: `.agent/bot/content-menu.js` (добавить функцию в конец файла)

- [ ] **Step 1: Добавить registerStyleHandlers**

```javascript
// === Мастер «🎭 Мой стиль» ===
function registerStyleHandlers(bot, isOwner, { api, wizards, esc }) {
  async function askQuestion(ctx, step, total, question) {
    await ctx.reply(
      `🎭 <b>Вопрос ${step + 1}/${total}</b>\n\n${esc(question)}\n\n<i>Ответь голосовым (лучше) или текстом.</i>`,
      { parse_mode: "HTML" },
    );
  }

  bot.callbackQuery(/^ca:style$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    try {
      const status = await api("GET", "/style/status");
      const kb = new InlineKeyboard();
      if (status.present) {
        kb.text("🔄 Переобучить стиль", "ca:style-start").row();
      } else {
        kb.text("🚀 Начать интервью", "ca:style-start").row();
      }
      kb.text("🏠 Меню", "ca:menu");
      await ctx.reply(
        `🎭 <b>Мой стиль</b>\n\n` +
        (status.present ? "Профиль стиля обучен. Можно переобучить заново.\n\n" : "Профиль ещё не обучен.\n\n") +
        `Интервью: 10 вопросов, отвечаешь голосом. Потом можно прислать доп.материалы (транскрипты, выгрузку постов). В конце я создам 5 файлов профиля.`,
        { parse_mode: "HTML", reply_markup: kb },
      );
    } catch (e) {
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  });

  bot.callbackQuery(/^ca:style-start$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    try {
      const r = await api("POST", "/style/interview/start");
      wizards.set(ctx.chat.id, { mode: "style_interview", step: r.step, total: r.total });
      await askQuestion(ctx, r.step, r.total, r.question);
    } catch (e) {
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  });

  // Приём ответа (общая логика для текста и расшифрованного голоса)
  async function submitAnswer(ctx, transcript) {
    try {
      const r = await api("POST", "/style/interview/answer", { transcript });
      if (r.questions_done) {
        wizards.set(ctx.chat.id, { mode: "style_materials" });
        const kb = new InlineKeyboard()
          .text("➕ Прислать ещё инфо", "ca:style-more").row()
          .text("✅ Закончить и создать профиль", "ca:style-finish");
        await ctx.reply(
          "Отлично, 10 вопросов готово! ✅\n\nМожешь прислать доп.материалы (текстом или голосом): транскрипты, куски постов. Или сразу создать профиль.",
          { reply_markup: kb },
        );
        return;
      }
      const w = wizards.get(ctx.chat.id);
      if (w) w.step = r.step;
      await ctx.reply(
        `🎭 <b>Вопрос ${r.step + 1}/${r.total}</b>\n\n${esc(r.question)}\n\n<i>Ответь голосовым или текстом.</i>`,
        { parse_mode: "HTML" },
      );
    } catch (e) {
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  }

  bot.callbackQuery(/^ca:style-more$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    wizards.set(ctx.chat.id, { mode: "style_materials" });
    await ctx.reply("Шли материалы (текст или голос). Когда закончишь — нажми «✅ Закончить».", {
      reply_markup: new InlineKeyboard().text("✅ Закончить и создать профиль", "ca:style-finish"),
    });
  });

  bot.callbackQuery(/^ca:style-finish$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    wizards.delete(ctx.chat.id);
    const wait = await ctx.reply("Анализирую твой стиль и пишу профиль (5 документов)... это займёт минуту ⏳");
    try {
      const r = await api("POST", "/style/interview/finish");
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      await ctx.reply(
        `✅ Профиль стиля создан!\n\nФайлы: ${r.files.join(", ")}\n\nТеперь все посты будут в твоём стиле. Жми «✍ Написать пост».`,
        { reply_markup: new InlineKeyboard().text("✍ Написать пост", "ca:write").row().text("🏠 Меню", "ca:menu") },
      );
    } catch (e) {
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      await ctx.reply(`⚠️ Не получилось создать профиль: ${esc(e.message)}`);
    }
  });

  // Голос во время интервью/сбора материалов → расшифровка → ответ/материал
  bot.on("message:voice", async (ctx, next) => {
    if (!isOwner(ctx)) return next();
    const w = wizards.get(ctx.chat.id);
    if (!w || (w.mode !== "style_interview" && w.mode !== "style_materials")) return next();

    const note = await ctx.reply("Слушаю голосовое... 🎤");
    try {
      const file = await ctx.getFile();
      const tmp = `/tmp/ca_voice_${ctx.from.id}_${Date.now()}.ogg`;
      const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
      await downloadTgFile(url, tmp);
      const transcript = await transcribeVoice(tmp);
      try { unlinkSync(tmp); } catch {}
      await ctx.api.deleteMessage(ctx.chat.id, note.message_id).catch(() => {});
      if (!transcript) {
        await ctx.reply("Не распознал голос. Пришли текстом, пожалуйста.");
        return;
      }
      if (w.mode === "style_interview") {
        await ctx.reply(`Записал: "${transcript.slice(0, 80)}${transcript.length > 80 ? "…" : ""}"`);
        await submitAnswer(ctx, transcript);
      } else {
        await api("POST", "/style/interview/material", { type: "voice", text: transcript });
        await ctx.reply("📎 Материал добавлен. Шли ещё или нажми «✅ Закончить».", {
          reply_markup: new InlineKeyboard().text("✅ Закончить и создать профиль", "ca:style-finish"),
        });
      }
    } catch (e) {
      await ctx.api.deleteMessage(ctx.chat.id, note.message_id).catch(() => {});
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  });

  // Текст во время интервью/материалов
  bot.on("message:text", async (ctx, next) => {
    if (!isOwner(ctx)) return next();
    const w = wizards.get(ctx.chat.id);
    if (!w || (w.mode !== "style_interview" && w.mode !== "style_materials")) return next();
    const text = ctx.message.text.trim();
    if (w.mode === "style_interview") {
      await submitAnswer(ctx, text);
    } else {
      try {
        await api("POST", "/style/interview/material", { type: "text", text });
        await ctx.reply("📎 Материал добавлен. Шли ещё или «✅ Закончить».", {
          reply_markup: new InlineKeyboard().text("✅ Закончить и создать профиль", "ca:style-finish"),
        });
      } catch (e) {
        await ctx.reply(`⚠️ ${esc(e.message)}`);
      }
    }
  });
}
```

- [ ] **Step 2: Проверка синтаксиса**

Run:
```
powershell -Command '$env:PATH = "C:\Users\Administrator\nodejs;" + $env:PATH; cd "C:\Users\Administrator\Documents\Projects\gideon\.agent\bot"; node --check content-menu.js'
```
Expected: без ошибок (registerWriteHandlers ещё не определён, но `--check` проверяет только синтаксис; полный запуск — после Task 11).

- [ ] **Step 3: Commit**

```bash
git add .agent/bot/content-menu.js
git commit -m "feat(bot): мастер обучения стилю (интервью голосом + материалы)"
```

---

## Task 12: Мастер написания постов (content-menu.js → registerWriteHandlers)

**Files:**
- Modify: `.agent/bot/content-menu.js` (добавить функцию в конец файла)

- [ ] **Step 1: Добавить registerWriteHandlers**

```javascript
// === Мастер «✍ Написать пост» ===
function registerWriteHandlers(bot, isOwner, { api, wizards, esc }) {
  function postKeyboard(id) {
    return new InlineKeyboard()
      .text("✅ Сохранить", `ca:post-approve:${id}`).text("🔄 Переписать", `ca:post-var:${id}:rewrite`).row()
      .text("✂️ Короче", `ca:post-var:${id}:shorter`).text("📈 Экспертнее", `ca:post-var:${id}:expert`).row()
      .text("🙂 Проще", `ca:post-var:${id}:simpler`).text("😂 Юмор", `ca:post-var:${id}:humor`).row()
      .text("🎯 Призыв", `ca:post-var:${id}:cta`).row()
      .text("🏠 Меню", "ca:menu");
  }

  bot.callbackQuery(/^ca:write$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    wizards.set(ctx.chat.id, { mode: "post_prompt" });
    await ctx.reply("✍ О чём написать пост? Пришли тему текстом или голосом.\n\n<i>Например: «как предпринимателю выбрать нейросеть для бизнеса».</i>", { parse_mode: "HTML" });
  });

  async function generateAndSend(ctx, userPrompt) {
    const wait = await ctx.reply("Пишу пост в твоём стиле... ✍️ (до минуты)");
    try {
      const r = await api("POST", "/posts", { user_prompt: userPrompt });
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      await ctx.reply(r.draft_text || "(пусто)", { reply_markup: postKeyboard(r.id) });
    } catch (e) {
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  }

  bot.callbackQuery(/^ca:post-var:(\d+):(\w+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const [, id, mode] = ctx.match;
    await ctx.answerCallbackQuery({ text: "Переписываю..." });
    const wait = await ctx.reply("Переписываю... ✍️");
    try {
      const r = await api("POST", `/posts/${id}/variant`, { mode });
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      await ctx.reply(r.draft_text || "(пусто)", { reply_markup: postKeyboard(id) });
    } catch (e) {
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  });

  bot.callbackQuery(/^ca:post-approve:(\d+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const id = ctx.match[1];
    try {
      await api("POST", `/posts/${id}/approve`);
      await ctx.answerCallbackQuery({ text: "Сохранено" });
      await ctx.reply("✅ Пост сохранён. (Автопостинг во все соцсети — в Фазе 5.)", {
        reply_markup: new InlineKeyboard().text("✍ Ещё пост", "ca:write").row().text("🏠 Меню", "ca:menu"),
      });
    } catch (e) {
      await ctx.answerCallbackQuery({ text: "Ошибка" });
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  });

  // Текст-тема для поста
  bot.on("message:text", async (ctx, next) => {
    if (!isOwner(ctx)) return next();
    const w = wizards.get(ctx.chat.id);
    if (!w || w.mode !== "post_prompt") return next();
    wizards.delete(ctx.chat.id);
    await generateAndSend(ctx, ctx.message.text.trim());
  });

  // Голос-тема для поста
  bot.on("message:voice", async (ctx, next) => {
    if (!isOwner(ctx)) return next();
    const w = wizards.get(ctx.chat.id);
    if (!w || w.mode !== "post_prompt") return next();
    const note = await ctx.reply("Слушаю тему... 🎤");
    try {
      const file = await ctx.getFile();
      const tmp = `/tmp/ca_topic_${ctx.from.id}_${Date.now()}.ogg`;
      const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
      await downloadTgFile(url, tmp);
      const transcript = await transcribeVoice(tmp);
      try { unlinkSync(tmp); } catch {}
      await ctx.api.deleteMessage(ctx.chat.id, note.message_id).catch(() => {});
      if (!transcript) { await ctx.reply("Не распознал. Пришли тему текстом."); return; }
      wizards.delete(ctx.chat.id);
      await ctx.reply(`Тема: "${transcript.slice(0, 80)}${transcript.length > 80 ? "…" : ""}"`);
      await generateAndSend(ctx, transcript);
    } catch (e) {
      await ctx.api.deleteMessage(ctx.chat.id, note.message_id).catch(() => {});
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  });
}
```

> Важно про порядок обработчиков: и `registerStyleHandlers`, и `registerWriteHandlers`, и базовый `bot.on("message:text")`/`"message:voice"` в `index.js` слушают одни события. grammY вызывает обработчики в порядке регистрации; каждый из наших проверяет свой `wizards`-режим и при несовпадении вызывает `next()`. `registerContentHandlers` должен подключаться в `index.js` ДО основного `bot.on("message:text")` (который НЕ вызывает next и уходит в Claude). См. Task 13.

- [ ] **Step 2: Проверка синтаксиса**

Run:
```
powershell -Command '$env:PATH = "C:\Users\Administrator\nodejs;" + $env:PATH; cd "C:\Users\Administrator\Documents\Projects\gideon\.agent\bot"; node --check content-menu.js'
```
Expected: без ошибок.

- [ ] **Step 3: Commit**

```bash
git add .agent/bot/content-menu.js
git commit -m "feat(bot): мастер написания постов с кнопками вариантов"
```

---

## Task 13: Подключение раздела в index.js + кнопка + команда

**Files:**
- Modify: `.agent/bot/index.js` (импорт ~34, регистрация ~1067, клавиатура ~97-102, кнопка-hears, setMyCommands ~1371)

- [ ] **Step 1: Добавить импорт модуля**

После строки `import { registerSalesHandlers } from "./sales-menu.js";` добавить:
```javascript
import { registerContentHandlers } from "./content-menu.js";
```

- [ ] **Step 2: Зарегистрировать обработчики ДО основного message:text**

Найти строку `registerSalesHandlers(bot, isOwner);` и сразу после неё добавить:
```javascript

// Контент-Агент — раздел «✍ Контент» (модуль content-menu.js).
// ВАЖНО: регистрируется до основного bot.on("message:text"), чтобы мастера
// контента перехватывали ввод по своему wizards-режиму (иначе текст уйдёт в Claude).
registerContentHandlers(bot, isOwner);
```

> Проверь: блок `bot.on("message:text", ...)` (основной, уходящий в Claude) и `bot.on("message:voice", ...)` в index.js находятся НИЖЕ этой строки по файлу. Если нет — перенести регистрацию `registerContentHandlers` выше них. В текущем index.js основной `message:text` объявлен около строки 1288 — то есть ниже точки регистрации (~1070). Порядок корректен.

- [ ] **Step 3: Добавить кнопку «✍ Контент» в persistent-клавиатуру**

Найти блок:
```javascript
  .text("🎯 Парсер").text("💼 Продажи").row()
  .resized()
```
Заменить на:
```javascript
  .text("🎯 Парсер").text("💼 Продажи").row()
  .text("✍ Контент").row()
  .resized()
```

- [ ] **Step 4: Добавить hears-обработчик кнопки**

Найти блок `bot.hears("💼 Продажи", ...)` (около строки 1159) и сразу после него (после закрывающей `});`) добавить:
```javascript

bot.hears("✍ Контент", async (ctx) => {
  if (!isOwner(ctx)) return;
  ctx.message.text = "/content";
  ctx.message.entities = [{ type: "bot_command", offset: 0, length: 8 }];
  await bot.handleUpdate({ update_id: 0, message: ctx.message });
});
```

- [ ] **Step 5: Добавить команду в setMyCommands**

Найти строку `{ command: "sales",      description: "Sales Manager — AI-продавец" },` и сразу после добавить:
```javascript
      { command: "content",    description: "Контент-Агент — стиль и посты" },
```

- [ ] **Step 6: Проверка синтаксиса**

Run:
```
powershell -Command '$env:PATH = "C:\Users\Administrator\nodejs;" + $env:PATH; cd "C:\Users\Administrator\Documents\Projects\gideon\.agent\bot"; node --check index.js && node --check content-menu.js'
```
Expected: без ошибок.

- [ ] **Step 7: Commit**

```bash
git add .agent/bot/index.js
git commit -m "feat(bot): подключение раздела Контент (кнопка, команда /content)"
```

---

## Task 14: Сквозная ручная проверка (E2E)

**Files:** нет (ручная проверка работающего бота + сервиса)

- [ ] **Step 1: Запустить сервис content-agent**

Run:
```
powershell -Command '$env:PATH = "C:\Users\Administrator\nodejs;" + $env:PATH; cd "C:\Users\Administrator\Documents\Projects\gideon\projects\content-agent"; pm2 start ecosystem.config.cjs'
```
Проверка: `curl http://127.0.0.1:3002/api/health` → `{"ok":true}`. В `.env` заданы CA_PASSWORD/CA_SECRET (как у парсера), CLAUDE_CLI_PATH, AGENT_HOME, CA_MODEL.

- [ ] **Step 2: Перезапустить бота**

Перезапустить процесс бота (через `C:\Users\Administrator\.agent\start-bot.bat` или Планировщик/перезапуск). Убедиться, что в логах нет ошибок импорта `content-menu.js`.

- [ ] **Step 3: Проверить меню в Telegram**

В @flash_gideon_bot нажать кнопку «✍ Контент» (или `/content`). Ожидается: inline-меню с 8 кнопками. Нажать «ℹ️ Инструкция» — приходит текст инструкции.

- [ ] **Step 4: Проверить обучение стилю**

«🎭 Мой стиль» → «🚀 Начать интервью» → ответить голосом на 1-2 вопроса (проверить, что распознаётся и идёт следующий вопрос), затем для скорости ответить текстом на остальные. После 10-го → «✅ Закончить и создать профиль». Ожидается: через ~минуту «Профиль создан», и на диске появились `projects/content-agent/data/style/*.md` (5 файлов с осмысленным содержимым).

Проверка файлов:
```
powershell -Command 'dir "C:\Users\Administrator\Documents\Projects\gideon\projects\content-agent\data\style"'
```
Expected: 5 md-файлов, непустых.

- [ ] **Step 5: Проверить написание поста**

«✍ Написать пост» → прислать тему текстом («как выбрать нейросеть для бизнеса») → приходит пост. Нажать «😂 Юмор» — пост переписывается. Нажать «✅ Сохранить» — подтверждение сохранения. Убедиться, что пост звучит в обученном стиле (сверить с профилем).

- [ ] **Step 6: Финальный прогон тестов**

Run:
```
powershell -Command '$env:PATH = "C:\Users\Administrator\nodejs;" + $env:PATH; cd "C:\Users\Administrator\Documents\Projects\gideon\projects\content-agent"; npm test'
```
Expected: все тесты (db, auth, ai, style, writer, server) зелёные.

- [ ] **Step 7: Commit (если были правки по итогам проверки)**

```bash
git add -A
git commit -m "test(content-agent): сквозная проверка Фазы 1 — стиль и посты работают"
```

---

## Self-Review

**Spec coverage (Фаза 1 из §9 спеки):**
- Каркас сервиса (db, server :3002, PM2, auth, content-menu.js, главное меню) — Tasks 1, 2, 3, 7, 8, 10, 13 ✓ (воркер осознанно отложен в Фазу 2)
- Стиль (интервью 10 вопросов голосом + 5 md) — Tasks 5, 11, 14 ✓
- Написание постов по запросу (текст/голос) + кнопки вариантов — Tasks 6, 12, 14 ✓
- «стиль не обучен» fallback — writer.js buildPostPrompt ✓
- ℹ️ Инструкция, ⚙ Настройки (заготовка под VK/YouTube ключи) — Task 10 ✓
- Будущие фазы (источники/дайджест/контент-план) — кнопки-заглушки `ca:soon`, Task 10 ✓

**Placeholder scan:** нет TBD/TODO; весь код приведён целиком; вопросы интервью и промпты профиля — конкретные.

**Type consistency:** имена функций согласованы между задачами — `openDb`, `getActiveInterview`, `addInterviewAnswer`, `finishInterview`, `createPost`/`updatePostDraft`/`setPostStatus`, `makeToken`/`authMiddleware`, `generate`/`extractJson`, `INTERVIEW_QUESTIONS`/`STYLE_DOCS`/`buildCorpus`/`generateStyleProfile`, `loadStyleProfile`/`buildPostPrompt`/`VARIANTS`/`generatePost`, `createServer({db,password,secret,styleDir,runner,model})`. Бот: `registerContentHandlers`, `registerStyleHandlers`, `registerWriteHandlers`, callback-неймспейс `ca:*`. Сходится.

**Ambiguity:** runner инъектируется в тестах, в проде `createServer` без runner → `generate` подставляет `defaultRunner`. Порядок регистрации обработчиков в index.js явно описан (Task 12 Step 2).
