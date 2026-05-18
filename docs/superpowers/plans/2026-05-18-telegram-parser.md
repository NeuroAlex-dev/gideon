# Telegram Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Реализовать парсер участников Telegram-чатов в папке `parser/` с двумя точками входа (веб + бот `@flash_gideon_bot`) согласно спеке `docs/superpowers/specs/2026-05-18-telegram-parser-design.md`.

**Architecture:** Self-contained Node.js сервис в `parser/` на Express + GramJS, слушает порт 3000. Бот ходит в парсер по HTTP на `localhost:3000`. Веб-доступ защищён `AUTH_TOKEN` в URL. Никаких импортов между папками `bot/` и `parser/`.

**Tech Stack:** Node.js 20, GramJS (`telegram` npm), Express 4, dotenv, ванильный HTML/CSS/JS, встроенный `node:test`, PM2 для запуска. ESM-модули (`"type": "module"`).

**Environment notes:**
- Платформа: Windows Server 2022, PowerShell + Git Bash, Node v20.19.1 в `C:\Users\Administrator\nodejs\`
- PM2 установлен глобально (`C:\Users\Administrator\nodejs\pm2.cmd`)
- Существующий бот: `C:\Users\Administrator\.agent\bot\` (продакшн копия) и `bot/` в корне проекта (исходник)
- Все команды пишу для bash. Для PowerShell-only действий явно указываю `powershell -Command "..."`

---

## File Structure

```
parser/                                  ← новая папка
├── package.json                         ESM, scripts: start/test/dev
├── .env.example                         шаблон секретов
├── .gitignore                           .env, data/, node_modules/
├── README.md                            запуск, авторизация
├── ecosystem.config.cjs                 PM2 process: agent-parser
│
├── server.js                            Express, маршруты, статика
├── parse.js                             CLI обёртка (для отладки)
│
├── lib/
│   ├── session.js                       StringSession: load/save в data/
│   ├── telegram.js                      GramJS клиент, resolveChat, getParticipants
│   ├── auth.js                          sendCode / signIn / 2FA
│   ├── chats.js                         getDialogs() — список групп
│   └── chatref.js                       normalize @username / t.me / id
│
├── public/
│   ├── index.html                       SPA скелет: экран A / B
│   ├── style.css                        тёмная тема
│   └── app.js                           fetch к /api, состояния UI
│
├── test/
│   ├── chatref.test.js
│   ├── session.test.js
│   ├── chats-filter.test.js
│   └── server.test.js                   integration тесты HTTP
│
└── data/                                runtime, в .gitignore
    └── .gitkeep

bot/                                     ← существующий, минимальные правки
├── index.js                             + 2 строки (импорт + регистрация) + 1 элемент в setMyCommands
└── parser-menu.js                       НОВЫЙ файл: handlers + FSM + fetch
```

**Принцип организации:**
- `lib/` — pure logic, тестируется отдельно от Express и от GramJS-сети.
- `server.js` — только маршруты и middleware, бизнес-логика в `lib/`.
- `chatref.js` выделен отдельно — pure-функция нормализации, нужна и серверу, и боту.
- Тесты для GramJS-зависимого кода — только то, что можно тестировать без сети (валидация, нормализация, фильтры). Сетевые сценарии — через ручные критерии приёмки.

---

## Test Strategy

- **Юнит-тесты:** pure functions — `chatref.js`, `chats.js` (фильтрация), `session.js` (работа с временным файлом).
- **Integration тесты:** `server.js` — поднимаем сервер на случайном порту, делаем fetch, проверяем коды и тела.
- **GramJS-зависимое:** мокаем минимально через инъекцию `telegramClient` параметром, либо тестируем только обёртки без реальной сети.
- **Manual E2E:** авторизация и реальный парсинг — по критериям приёмки из спеки.

Test runner: встроенный `node --test`. Запуск: `node --test parser/test/`.

---

## Task 1: Скаффолд `parser/` — package.json, .env.example, .gitignore

**Files:**
- Create: `parser/package.json`
- Create: `parser/.env.example`
- Create: `parser/.gitignore`
- Create: `parser/README.md`
- Create: `parser/data/.gitkeep`

- [ ] **Step 1.1: Создать `parser/package.json`**

```json
{
  "name": "gideon-parser",
  "version": "1.0.0",
  "description": "Telegram chat members parser — web UI + REST API for @flash_gideon_bot",
  "type": "module",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "node --watch server.js",
    "test": "node --test test/",
    "cli": "node parse.js"
  },
  "dependencies": {
    "telegram": "^2.26.16",
    "express": "^4.21.2",
    "dotenv": "^16.4.7"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 1.2: Создать `parser/.env.example`**

```
# Telegram User API credentials
# Get them at https://my.telegram.org → API development tools
API_ID=
API_HASH=

# Web access protection. Leave empty — auto-generated on first run.
AUTH_TOKEN=

# HTTP server
PORT=3000

# Optional: pre-fill phone in the auth web form
OWNER_PHONE=
```

- [ ] **Step 1.3: Создать `parser/.gitignore`**

```
node_modules/
.env
data/*
!data/.gitkeep
*.log
```

- [ ] **Step 1.4: Создать `parser/data/.gitkeep`** — пустой файл (`touch`)

- [ ] **Step 1.5: Создать `parser/README.md`**

```markdown
# Gideon Parser

Парсер участников Telegram-чатов. Часть проекта Gideon.

## Быстрый старт

1. `cd parser && npm install`
2. На https://my.telegram.org → API development tools → создай приложение
3. Скопируй `API_ID` и `API_HASH` в `parser/.env` (см. `.env.example`)
4. `npm start`
5. Открой `http://localhost:3000?token=<AUTH_TOKEN>` (токен в логах при первом запуске)
6. Пройди авторизацию: телефон → код → 2FA если есть
7. Готово. Можешь парсить участников групп где состоишь.

## Команды

- `npm start` — запуск сервера
- `npm run dev` — с авто-перезапуском при изменении
- `npm test` — юнит-тесты
- `npm run cli -- @chatname` — CLI парсинг для отладки

## Запуск под PM2

`pm2 start ecosystem.config.cjs`

См. полную спеку: `../docs/superpowers/specs/2026-05-18-telegram-parser-design.md`
```

- [ ] **Step 1.6: Установить зависимости**

```bash
cd parser && npm install
```

Expected: создаётся `node_modules/`, ставятся `telegram`, `express`, `dotenv`. Warnings про deprecation — игнорируем.

- [ ] **Step 1.7: Коммит**

```bash
git add parser/package.json parser/.env.example parser/.gitignore parser/README.md parser/data/.gitkeep
git commit -m "feat(parser): скаффолд проекта (package.json, .env.example, .gitignore)"
```

---

## Task 2: `lib/chatref.js` — нормализация ссылок на чат

Pure-функция: принимает строку (`@vibe_course`, `https://t.me/vibe_course`, `t.me/joinchat/abc`, `-1001234567890`), возвращает `{ type, value }` для GramJS.

**Files:**
- Create: `parser/lib/chatref.js`
- Test: `parser/test/chatref.test.js`

- [ ] **Step 2.1: Написать падающий тест**

`parser/test/chatref.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeChatRef } from "../lib/chatref.js";

test("username with @", () => {
  assert.deepEqual(normalizeChatRef("@vibe_course"), { type: "username", value: "vibe_course" });
});

test("plain username without @", () => {
  assert.deepEqual(normalizeChatRef("vibe_course"), { type: "username", value: "vibe_course" });
});

test("t.me link", () => {
  assert.deepEqual(normalizeChatRef("https://t.me/vibe_course"), { type: "username", value: "vibe_course" });
});

test("t.me/joinchat invite link", () => {
  assert.deepEqual(normalizeChatRef("https://t.me/joinchat/AbCdEf"), { type: "invite", value: "AbCdEf" });
});

test("t.me/+ invite link", () => {
  assert.deepEqual(normalizeChatRef("https://t.me/+AbCdEf"), { type: "invite", value: "AbCdEf" });
});

test("numeric chat id", () => {
  assert.deepEqual(normalizeChatRef("-1001234567890"), { type: "id", value: "-1001234567890" });
});

test("trims whitespace", () => {
  assert.deepEqual(normalizeChatRef("  @vibe_course  "), { type: "username", value: "vibe_course" });
});

test("throws on empty", () => {
  assert.throws(() => normalizeChatRef(""), /empty/i);
});

test("throws on invalid", () => {
  assert.throws(() => normalizeChatRef("not a ref!"), /invalid/i);
});

test("throws on null", () => {
  assert.throws(() => normalizeChatRef(null), /empty/i);
});
```

- [ ] **Step 2.2: Запустить — должны упасть**

```bash
cd parser && node --test test/chatref.test.js
```

Expected: все тесты FAIL (module not found).

- [ ] **Step 2.3: Реализовать `parser/lib/chatref.js`**

```javascript
const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/;
const ID_RE = /^-?\d+$/;
const TME_USERNAME_RE = /^(?:https?:\/\/)?t\.me\/([a-zA-Z][a-zA-Z0-9_]{4,31})\/?$/i;
const TME_INVITE_RE = /^(?:https?:\/\/)?t\.me\/(?:joinchat\/|\+)([a-zA-Z0-9_-]+)\/?$/i;

export function normalizeChatRef(input) {
  if (input == null || typeof input !== "string") {
    throw new Error("chatRef is empty");
  }
  const s = input.trim();
  if (s === "") throw new Error("chatRef is empty");

  let m = s.match(TME_INVITE_RE);
  if (m) return { type: "invite", value: m[1] };

  m = s.match(TME_USERNAME_RE);
  if (m) return { type: "username", value: m[1] };

  if (s.startsWith("@")) {
    const u = s.slice(1);
    if (USERNAME_RE.test(u)) return { type: "username", value: u };
    throw new Error("invalid username");
  }

  if (ID_RE.test(s)) return { type: "id", value: s };

  if (USERNAME_RE.test(s)) return { type: "username", value: s };

  throw new Error("invalid chatRef");
}
```

- [ ] **Step 2.4: Запустить — должны проходить**

```bash
cd parser && node --test test/chatref.test.js
```

Expected: 10 passes.

- [ ] **Step 2.5: Коммит**

```bash
git add parser/lib/chatref.js parser/test/chatref.test.js
git commit -m "feat(parser): нормализация chatRef с тестами"
```

---

## Task 3: `lib/session.js` — load/save StringSession

Маленькая обёртка над файлом `data/session.txt`. Без шифрования (сама session это уже секрет, прав файла 0600 достаточно). На Windows chmod игнорируется — это OK для one-user сервера.

**Files:**
- Create: `parser/lib/session.js`
- Test: `parser/test/session.test.js`

- [ ] **Step 3.1: Написать падающий тест**

`parser/test/session.test.js`:

```javascript
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionStore } from "../lib/session.js";

let dir, store;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "parser-session-"));
  store = createSessionStore(join(dir, "session.txt"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test("load returns empty string when file missing", () => {
  assert.equal(store.load(), "");
});

test("save then load returns the saved value", () => {
  store.save("abc123");
  assert.equal(store.load(), "abc123");
});

test("save overwrites existing", () => {
  store.save("first");
  store.save("second");
  assert.equal(store.load(), "second");
});

test("clear deletes the file", () => {
  store.save("abc");
  store.clear();
  assert.equal(store.load(), "");
  assert.equal(existsSync(join(dir, "session.txt")), false);
});

test("clear is idempotent when file missing", () => {
  store.clear();
  store.clear();
});

test("isAuthorized true after save", () => {
  store.save("abc");
  assert.equal(store.isAuthorized(), true);
});

test("isAuthorized false after clear", () => {
  store.save("abc");
  store.clear();
  assert.equal(store.isAuthorized(), false);
});
```

- [ ] **Step 3.2: Запустить — fail**

```bash
cd parser && node --test test/session.test.js
```

Expected: FAIL (module not found).

- [ ] **Step 3.3: Реализовать `parser/lib/session.js`**

```javascript
import { readFileSync, writeFileSync, existsSync, unlinkSync, chmodSync } from "node:fs";

export function createSessionStore(filePath) {
  return {
    load() {
      if (!existsSync(filePath)) return "";
      try {
        return readFileSync(filePath, "utf8").trim();
      } catch {
        return "";
      }
    },

    save(value) {
      writeFileSync(filePath, value, { encoding: "utf8" });
      try {
        chmodSync(filePath, 0o600);
      } catch {
        // Windows ignores chmod — that's fine
      }
    },

    clear() {
      if (existsSync(filePath)) {
        try { unlinkSync(filePath); } catch {}
      }
    },

    isAuthorized() {
      return this.load() !== "";
    },
  };
}
```

- [ ] **Step 3.4: Запустить — pass**

```bash
cd parser && node --test test/session.test.js
```

Expected: 7 passes.

- [ ] **Step 3.5: Коммит**

```bash
git add parser/lib/session.js parser/test/session.test.js
git commit -m "feat(parser): хранилище Telegram session (createSessionStore)"
```

---

## Task 4: `lib/telegram.js` — клиент-singleton и getParticipants

Один TelegramClient на весь процесс. Создаётся лениво при первом вызове `getClient()`. Использует StringSession из `session.js`. Экспортирует методы для работы с участниками.

**Files:**
- Create: `parser/lib/telegram.js`
- (Юнит-тестов нет — сетевой код. Покрывается integration-тестами сервера в Task 8.)

- [ ] **Step 4.1: Реализовать `parser/lib/telegram.js`**

```javascript
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { Api } from "telegram";
import { normalizeChatRef } from "./chatref.js";

let _client = null;
let _sessionStore = null;
let _configured = false;

export function configureClient({ apiId, apiHash, sessionStore }) {
  if (_configured) return _client; // idempotent: keep existing client and its connection
  const sessionString = sessionStore.load();
  const session = new StringSession(sessionString);
  _client = new TelegramClient(session, Number(apiId), apiHash, {
    connectionRetries: 3,
    useWSS: true,
  });
  _sessionStore = sessionStore;
  _configured = true;
  return _client;
}

export function resetClient() {
  // Used by tests and after logout
  _client = null;
  _sessionStore = null;
  _configured = false;
}

export function getClient() {
  if (!_client) {
    throw new Error("Telegram client not configured. Call configureClient() first.");
  }
  return _client;
}

export async function ensureConnected() {
  const c = getClient();
  if (!c.connected) {
    await c.connect();
  }
  return c;
}

export async function persistSession() {
  const c = getClient();
  if (!_sessionStore) throw new Error("sessionStore not set; call configureClient() first");
  const s = c.session.save();
  _sessionStore.save(s);
}

export async function resolveChat(chatRef) {
  const c = await ensureConnected();
  const ref = normalizeChatRef(chatRef);

  if (ref.type === "username") {
    return await c.getEntity(ref.value);
  }
  if (ref.type === "id") {
    return await c.getEntity(Number(ref.value));
  }
  if (ref.type === "invite") {
    // Joining via invite link is out of scope; user must already be a member.
    throw Object.assign(new Error("Invite links require joining first"), {
      code: "INVITE_NOT_SUPPORTED",
    });
  }
  throw new Error("unsupported chat ref type");
}

export async function getParticipantUsernames(entity) {
  const c = await ensureConnected();
  const participants = await c.getParticipants(entity, { limit: 10000 });

  const usernames = [];
  let total = 0;
  let withUsername = 0;
  let withoutUsername = 0;
  let bots = 0;

  for (const p of participants) {
    total++;
    if (p.bot) bots++;
    if (p.username) {
      withUsername++;
      usernames.push("@" + p.username);
    } else {
      withoutUsername++;
    }
  }

  return {
    usernames,
    stats: { total, withUsername, withoutUsername, bots },
  };
}

export function disconnectClient() {
  if (_client && _client.connected) {
    return _client.disconnect();
  }
}
```

- [ ] **Step 4.2: Smoke-проверка импорта**

```bash
cd parser && node -e "import('./lib/telegram.js').then(m => console.log(Object.keys(m)))"
```

Expected: `[ 'configureClient', 'getClient', 'ensureConnected', 'persistSession', 'resolveChat', 'getParticipantUsernames', 'disconnectClient' ]`

- [ ] **Step 4.3: Коммит**

```bash
git add parser/lib/telegram.js
git commit -m "feat(parser): GramJS клиент и getParticipantUsernames"
```

---

## Task 5: `lib/auth.js` — sendCode / signIn / 2FA

Тонкий слой над GramJS-методами авторизации. State хранит `phoneCodeHash` между запросами (через переданный параметр от вызывающего).

**Files:**
- Create: `parser/lib/auth.js`

- [ ] **Step 5.1: Реализовать `parser/lib/auth.js`**

```javascript
import { Api } from "telegram";
import { computeCheck } from "telegram/Password.js";
import { ensureConnected, persistSession, getClient } from "./telegram.js";

export async function sendCode(phone) {
  const c = await ensureConnected();
  const result = await c.invoke(
    new Api.auth.SendCode({
      phoneNumber: phone,
      apiId: c.apiId,
      apiHash: c.apiHash,
      settings: new Api.CodeSettings({}),
    })
  );
  return {
    phoneCodeHash: result.phoneCodeHash,
    timeout: result.timeout ?? 60,
  };
}

export async function signIn({ phone, phoneCodeHash, code, password }) {
  const c = await ensureConnected();

  try {
    const res = await c.invoke(
      new Api.auth.SignIn({
        phoneNumber: phone,
        phoneCodeHash,
        phoneCode: code,
      })
    );
    await persistSession();
    return { ok: true, user: extractUser(res.user) };
  } catch (e) {
    if (e?.errorMessage === "SESSION_PASSWORD_NEEDED") {
      if (!password) {
        const err = new Error("2FA password required");
        err.code = "2fa_required";
        throw err;
      }
      return await checkPassword(password);
    }
    throw e;
  }
}

async function checkPassword(password) {
  const c = getClient();
  const pwd = await c.invoke(new Api.account.GetPassword());
  const check = await computeCheck(pwd, password);
  const res = await c.invoke(new Api.auth.CheckPassword({ password: check }));
  await persistSession();
  return { ok: true, user: extractUser(res.user) };
}

export async function logout(sessionStore) {
  const c = getClient();
  try {
    if (c.connected) {
      await c.invoke(new Api.auth.LogOut());
      await c.disconnect();
    }
  } catch {}
  sessionStore.clear();
  const { resetClient } = await import("./telegram.js");
  resetClient();
}

function extractUser(u) {
  if (!u) return null;
  return {
    id: String(u.id),
    username: u.username || null,
    firstName: u.firstName || null,
  };
}
```

- [ ] **Step 5.2: Smoke-проверка**

```bash
cd parser && node -e "import('./lib/auth.js').then(m => console.log(Object.keys(m)))"
```

Expected: `[ 'sendCode', 'signIn', 'logout' ]`

- [ ] **Step 5.3: Коммит**

```bash
git add parser/lib/auth.js
git commit -m "feat(parser): auth flow (sendCode, signIn, 2FA, logout)"
```

---

## Task 6: `lib/chats.js` — список групп пользователя

Достаёт диалоги, оставляет только групповые (group, supergroup), сортирует по числу участников.

**Files:**
- Create: `parser/lib/chats.js`
- Test: `parser/test/chats-filter.test.js`

- [ ] **Step 6.1: Написать падающий тест на pure-функцию `filterAndSortGroups`**

`parser/test/chats-filter.test.js`:

```javascript
import { test } from "node:test";
import assert from "node:assert/strict";
import { filterAndSortGroups } from "../lib/chats.js";

const dialog = (overrides) => ({
  isGroup: false, isChannel: false, isUser: false,
  entity: { participantsCount: 0, id: 1, title: "", username: null, megagroup: false },
  ...overrides,
  entity: { participantsCount: 0, id: 1, title: "", username: null, megagroup: false, ...overrides.entity },
});

test("excludes private chats", () => {
  const result = filterAndSortGroups([
    dialog({ isUser: true, entity: { id: 1, title: "User", participantsCount: 0 } }),
  ]);
  assert.equal(result.length, 0);
});

test("excludes channels (non-megagroup)", () => {
  const result = filterAndSortGroups([
    dialog({ isChannel: true, entity: { id: 1, title: "News", participantsCount: 1000, megagroup: false } }),
  ]);
  assert.equal(result.length, 0);
});

test("includes basic groups", () => {
  const result = filterAndSortGroups([
    dialog({ isGroup: true, entity: { id: 1, title: "Friends", participantsCount: 5 } }),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].title, "Friends");
  assert.equal(result[0].type, "group");
});

test("includes supergroups (megagroup channels)", () => {
  const result = filterAndSortGroups([
    dialog({ isChannel: true, entity: { id: 1, title: "Course", participantsCount: 1247, megagroup: true, username: "course" } }),
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].type, "supergroup");
  assert.equal(result[0].username, "course");
});

test("sorts by participants desc", () => {
  const result = filterAndSortGroups([
    dialog({ isGroup: true, entity: { id: 1, title: "Small", participantsCount: 5 } }),
    dialog({ isChannel: true, entity: { id: 2, title: "Big", participantsCount: 1000, megagroup: true } }),
    dialog({ isGroup: true, entity: { id: 3, title: "Mid", participantsCount: 100 } }),
  ]);
  assert.deepEqual(result.map(c => c.title), ["Big", "Mid", "Small"]);
});

test("missing participantsCount treated as 0", () => {
  const result = filterAndSortGroups([
    dialog({ isGroup: true, entity: { id: 1, title: "Unknown", participantsCount: undefined } }),
  ]);
  assert.equal(result[0].membersCount, 0);
});
```

- [ ] **Step 6.2: Запустить — fail**

```bash
cd parser && node --test test/chats-filter.test.js
```

Expected: FAIL (module not found).

- [ ] **Step 6.3: Реализовать `parser/lib/chats.js`**

```javascript
import { ensureConnected } from "./telegram.js";

export function filterAndSortGroups(dialogs) {
  const out = [];
  for (const d of dialogs) {
    const e = d.entity || {};
    let type = null;
    if (d.isGroup && !d.isChannel) type = "group";
    else if (d.isChannel && e.megagroup) type = "supergroup";
    if (!type) continue;

    out.push({
      id: String(e.id),
      title: e.title || "(no title)",
      username: e.username || null,
      membersCount: Number(e.participantsCount || 0),
      type,
    });
  }
  out.sort((a, b) => b.membersCount - a.membersCount);
  return out;
}

export async function listOwnerGroups() {
  const c = await ensureConnected();
  const dialogs = await c.getDialogs({ limit: 500 });
  return filterAndSortGroups(dialogs);
}
```

- [ ] **Step 6.4: Запустить — pass**

```bash
cd parser && node --test test/chats-filter.test.js
```

Expected: 6 passes.

- [ ] **Step 6.5: Коммит**

```bash
git add parser/lib/chats.js parser/test/chats-filter.test.js
git commit -m "feat(parser): список групп пользователя с фильтром и сортировкой"
```

---

## Task 7: `server.js` — Express скелет, AUTH_TOKEN, /api/health

Минимальный сервер: middleware `requireAuth` (token в query/header или loopback), маршрут health-check. Бутстрап AUTH_TOKEN: если в `.env` нет — генерируем, пишем в `.env`, логируем при старте.

**Files:**
- Create: `parser/server.js`
- Test: `parser/test/server.test.js`

- [ ] **Step 7.1: Написать падающий integration-тест**

`parser/test/server.test.js`:

```javascript
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

let server;
let baseUrl;
let authToken;

before(async () => {
  process.env.AUTH_TOKEN = "test-token-12345";
  process.env.PORT = "0";
  process.env.API_ID = "1";
  process.env.API_HASH = "test";
  process.env.PARSER_DATA_DIR = ""; // server.js should use a temp dir when this is set later — for now leave default
  const mod = await import("../server.js");
  server = mod.startServer();
  await new Promise((resolve) => server.on("listening", resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
  authToken = "test-token-12345";
});

after(async () => {
  if (server) await new Promise((r) => server.close(r));
});

test("GET /api/health returns ok", async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(body.version);
});

test("protected route without token returns 401 from non-loopback", async () => {
  // Note: requests from 127.0.0.1 are treated as loopback, so we expect 200 even without token
  // This test is a placeholder — full non-loopback testing is in critère приёмки
  const res = await fetch(`${baseUrl}/api/auth/status`);
  assert.notEqual(res.status, 401, "loopback should bypass token check");
});

test("protected route with wrong token from explicit external IP would fail (smoke)", async () => {
  // We can't simulate external IP in unit tests — just check that valid token works
  const res = await fetch(`${baseUrl}/api/auth/status?token=${authToken}`);
  assert.equal(res.status, 200);
});
```

- [ ] **Step 7.2: Запустить — fail**

```bash
cd parser && node --test test/server.test.js
```

Expected: FAIL (server.js missing).

- [ ] **Step 7.3: Реализовать `parser/server.js` (часть 1: скелет + health + auth middleware)**

```javascript
import express from "express";
import { readFileSync, existsSync, appendFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, ".env") });

const VERSION = "1.0.0";

function ensureAuthToken() {
  if (process.env.AUTH_TOKEN && process.env.AUTH_TOKEN.trim() !== "") {
    return process.env.AUTH_TOKEN.trim();
  }
  const generated = randomBytes(16).toString("hex");
  process.env.AUTH_TOKEN = generated;
  const envPath = join(__dirname, ".env");
  if (existsSync(envPath)) {
    const txt = readFileSync(envPath, "utf8");
    if (/^AUTH_TOKEN=/m.test(txt)) {
      writeFileSync(envPath, txt.replace(/^AUTH_TOKEN=.*$/m, `AUTH_TOKEN=${generated}`), "utf8");
    } else {
      appendFileSync(envPath, `\nAUTH_TOKEN=${generated}\n`, "utf8");
    }
  } else {
    writeFileSync(envPath, `AUTH_TOKEN=${generated}\n`, "utf8");
  }
  return generated;
}

function isLoopback(ip) {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function requireAuth(req, res, next) {
  if (isLoopback(req.ip)) return next();
  const token = req.query.token || req.headers["x-auth-token"];
  if (token && token === process.env.AUTH_TOKEN) return next();
  return res.status(401).json({ error: "unauthorized" });
}

export function createApp() {
  const app = express();
  app.set("trust proxy", "loopback");
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, version: VERSION });
  });

  // Placeholder for /api/auth/* — fully implemented in Task 8
  app.get("/api/auth/status", requireAuth, (_req, res) => {
    res.json({ authorized: false, hasCredentials: false });
  });

  return app;
}

export function startServer() {
  const token = ensureAuthToken();
  const app = createApp();
  const port = Number(process.env.PORT || 3000);
  const server = app.listen(port, () => {
    const actualPort = server.address().port;
    console.log(`[parser] listening on http://localhost:${actualPort}`);
    console.log(`[parser] AUTH_TOKEN=${token}`);
    console.log(`[parser] open: http://localhost:${actualPort}?token=${token}`);
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("server.js")) {
  startServer();
}
```

- [ ] **Step 7.4: Запустить тесты — pass**

```bash
cd parser && node --test test/server.test.js
```

Expected: 3 passes.

- [ ] **Step 7.5: Коммит**

```bash
git add parser/server.js parser/test/server.test.js
git commit -m "feat(parser): Express скелет с auth middleware и /api/health"
```

---

## Task 8: `/api/auth/*` — реальные маршруты авторизации

Подключаем `lib/session.js`, `lib/telegram.js`, `lib/auth.js`. Маршруты: status, send-code, sign-in, logout.

**Files:**
- Modify: `parser/server.js`
- Extend: `parser/test/server.test.js`

- [ ] **Step 8.1: Расширить server.js — заменить заглушку `/api/auth/status` и добавить остальные маршруты**

В `parser/server.js`, **перед** функцией `createApp`, добавить:

```javascript
import { createSessionStore } from "./lib/session.js";
import { configureClient } from "./lib/telegram.js";
import { sendCode, signIn, logout } from "./lib/auth.js";

const sessionStore = createSessionStore(join(__dirname, "data", "session.txt"));

function hasCredentials() {
  return Boolean(process.env.API_ID && process.env.API_HASH);
}

function ensureClientConfigured() {
  if (!hasCredentials()) return false;
  configureClient({
    apiId: process.env.API_ID,
    apiHash: process.env.API_HASH,
    sessionStore,
  });
  return true;
}
```

В `createApp()` **заменить** заглушку `/api/auth/status` и добавить остальные:

```javascript
  app.get("/api/auth/status", requireAuth, (_req, res) => {
    res.json({
      authorized: sessionStore.isAuthorized(),
      hasCredentials: hasCredentials(),
    });
  });

  app.post("/api/auth/send-code", requireAuth, async (req, res) => {
    if (!hasCredentials()) {
      return res.status(400).json({ error: "no_credentials", hint: "Заполни API_ID/API_HASH в parser/.env" });
    }
    const { phone } = req.body || {};
    if (!phone || typeof phone !== "string") {
      return res.status(400).json({ error: "phone_required" });
    }
    try {
      ensureClientConfigured();
      const result = await sendCode(phone);
      res.json(result);
    } catch (e) {
      console.error("[send-code]", e);
      res.status(500).json({ error: "send_code_failed", message: String(e?.message || e) });
    }
  });

  app.post("/api/auth/sign-in", requireAuth, async (req, res) => {
    const { phone, phoneCodeHash, code, password } = req.body || {};
    if (!phone || !phoneCodeHash || !code) {
      return res.status(400).json({ error: "missing_fields" });
    }
    try {
      ensureClientConfigured();
      const result = await signIn({ phone, phoneCodeHash, code, password });
      res.json(result);
    } catch (e) {
      if (e?.code === "2fa_required") {
        return res.status(400).json({ error: "2fa_required" });
      }
      console.error("[sign-in]", e);
      res.status(500).json({ error: "sign_in_failed", message: String(e?.message || e) });
    }
  });

  app.post("/api/auth/logout", requireAuth, async (_req, res) => {
    try {
      if (hasCredentials()) {
        ensureClientConfigured();
      }
      await logout(sessionStore);
      res.json({ ok: true });
    } catch (e) {
      console.error("[logout]", e);
      res.status(500).json({ error: "logout_failed" });
    }
  });
```

- [ ] **Step 8.2: Добавить тест на /api/auth/status (расширить test/server.test.js)**

В `parser/test/server.test.js` добавить:

```javascript
test("GET /api/auth/status returns shape", async () => {
  const res = await fetch(`${baseUrl}/api/auth/status?token=${authToken}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.authorized, "boolean");
  assert.equal(typeof body.hasCredentials, "boolean");
});

test("POST /api/auth/send-code without phone returns 400", async () => {
  const res = await fetch(`${baseUrl}/api/auth/send-code?token=${authToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});

test("POST /api/auth/sign-in without fields returns 400", async () => {
  const res = await fetch(`${baseUrl}/api/auth/sign-in?token=${authToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});
```

- [ ] **Step 8.3: Запустить — pass**

```bash
cd parser && node --test test/server.test.js
```

Expected: 6 passes (3 старых + 3 новых).

- [ ] **Step 8.4: Коммит**

```bash
git add parser/server.js parser/test/server.test.js
git commit -m "feat(parser): /api/auth/* (status, send-code, sign-in, logout)"
```

---

## Task 9: `/api/chats` — список групп пользователя

**Files:**
- Modify: `parser/server.js`
- Extend: `parser/test/server.test.js`

- [ ] **Step 9.1: Добавить маршрут в `createApp()` server.js (после auth-маршрутов)**

```javascript
  app.get("/api/chats", requireAuth, async (_req, res) => {
    if (!sessionStore.isAuthorized()) {
      return res.status(403).json({ error: "not_authorized" });
    }
    try {
      ensureClientConfigured();
      const { listOwnerGroups } = await import("./lib/chats.js");
      const chats = await listOwnerGroups();
      res.json({ chats });
    } catch (e) {
      console.error("[chats]", e);
      res.status(500).json({ error: "chats_failed", message: String(e?.message || e) });
    }
  });
```

- [ ] **Step 9.2: Расширить тест**

```javascript
test("GET /api/chats without session returns 403", async () => {
  const res = await fetch(`${baseUrl}/api/chats?token=${authToken}`);
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, "not_authorized");
});
```

- [ ] **Step 9.3: Запустить — pass**

```bash
cd parser && node --test test/server.test.js
```

Expected: 7 passes.

- [ ] **Step 9.4: Коммит**

```bash
git add parser/server.js parser/test/server.test.js
git commit -m "feat(parser): /api/chats"
```

---

## Task 10: `/api/parse` + кеш + `/api/export.txt`

Парсинг с кешем в памяти на 10 минут. Один активный парсинг на процесс (это one-user-app, проще). Hard timeout 60 сек. FloodWait → 429.

**Files:**
- Modify: `parser/server.js`
- Extend: `parser/test/server.test.js`

- [ ] **Step 10.1: Добавить кеш и парсинг-маршруты в `parser/server.js`**

Перед `createApp()`:

```javascript
const parseCache = new Map(); // jobId -> { chat, usernames, stats, expiresAt }
let parseInProgress = false;

function pruneCache() {
  const now = Date.now();
  for (const [k, v] of parseCache) {
    if (v.expiresAt < now) parseCache.delete(k);
  }
}

function withTimeout(promise, ms, errMessage) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error(errMessage), { code: "TIMEOUT" })), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}
```

В `createApp()` после `/api/chats`:

```javascript
  app.post("/api/parse", requireAuth, async (req, res) => {
    if (!sessionStore.isAuthorized()) {
      return res.status(403).json({ error: "not_authorized" });
    }
    const { chatRef } = req.body || {};
    if (!chatRef) {
      return res.status(400).json({ error: "chatRef_required" });
    }
    if (parseInProgress) {
      return res.status(409).json({ error: "parse_in_progress" });
    }
    parseInProgress = true;
    const startedAt = Date.now();
    try {
      ensureClientConfigured();
      const { resolveChat, getParticipantUsernames } = await import("./lib/telegram.js");
      const entity = await withTimeout(resolveChat(chatRef), 15000, "resolve_timeout");
      const { usernames, stats } = await withTimeout(getParticipantUsernames(entity), 60000, "parse_timeout");

      pruneCache();
      const jobId = String(Date.now()) + "-" + Math.random().toString(36).slice(2, 8);
      const chat = {
        id: String(entity.id),
        title: entity.title || entity.username || String(entity.id),
        membersCount: Number(entity.participantsCount || stats.total || 0),
      };
      parseCache.set(jobId, {
        chat,
        usernames,
        stats,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });

      res.json({
        jobId,
        chat,
        usernames,
        stats,
        durationMs: Date.now() - startedAt,
      });
    } catch (e) {
      const msg = String(e?.errorMessage || e?.message || e);
      if (e?.code === "FLOOD_WAIT" || /FLOOD_WAIT_(\d+)/.test(msg)) {
        const m = msg.match(/FLOOD_WAIT_(\d+)/);
        const retryAfter = e?.seconds || (m ? Number(m[1]) : 5);
        return res.status(429).json({ error: "flood_wait", retryAfter });
      }
      if (e?.code === "TIMEOUT" || e?.code === "parse_timeout" || e?.code === "resolve_timeout") {
        return res.status(504).json({ error: "timeout" });
      }
      if (e?.code === "INVITE_NOT_SUPPORTED") {
        return res.status(400).json({ error: "invite_not_supported", hint: "Сначала вступи в чат" });
      }
      if (/USERNAME_NOT_OCCUPIED|CHANNEL_INVALID|PEER_ID_INVALID|USERNAME_INVALID/.test(msg)) {
        return res.status(404).json({ error: "chat_not_found" });
      }
      if (/CHANNEL_PRIVATE|CHAT_ADMIN_REQUIRED/.test(msg)) {
        return res.status(403).json({ error: "no_access", hint: "Вступи в чат или нужны права админа" });
      }
      if (/AUTH_KEY_UNREGISTERED|SESSION_REVOKED/.test(msg)) {
        return res.status(401).json({ error: "session_revoked", hint: "Нужно авторизоваться заново" });
      }
      console.error("[parse]", e);
      res.status(500).json({ error: "parse_failed", message: msg });
    } finally {
      parseInProgress = false;
    }
  });

  app.get("/api/export.txt", requireAuth, (req, res) => {
    const { jobId } = req.query;
    if (!jobId) return res.status(400).json({ error: "jobId_required" });
    const entry = parseCache.get(String(jobId));
    if (!entry) return res.status(404).json({ error: "job_not_found_or_expired" });

    const date = new Date().toISOString().slice(0, 10);
    const safeTitle = String(entry.chat.title).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || "chat";
    const filename = `${safeTitle}-${date}.txt`;

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(entry.usernames.join("\n"));
  });
```

- [ ] **Step 10.2: Расширить тест**

```javascript
test("POST /api/parse without session returns 403", async () => {
  const res = await fetch(`${baseUrl}/api/parse?token=${authToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatRef: "@test" }),
  });
  assert.equal(res.status, 403);
});

test("POST /api/parse without chatRef returns 403 (session check first) or 400", async () => {
  const res = await fetch(`${baseUrl}/api/parse?token=${authToken}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.ok(res.status === 400 || res.status === 403);
});

test("GET /api/export.txt without jobId returns 400", async () => {
  const res = await fetch(`${baseUrl}/api/export.txt?token=${authToken}`);
  assert.equal(res.status, 400);
});

test("GET /api/export.txt with unknown jobId returns 404", async () => {
  const res = await fetch(`${baseUrl}/api/export.txt?token=${authToken}&jobId=does-not-exist`);
  assert.equal(res.status, 404);
});
```

- [ ] **Step 10.3: Запустить — pass**

```bash
cd parser && node --test test/server.test.js
```

Expected: 11 passes.

- [ ] **Step 10.4: Коммит**

```bash
git add parser/server.js parser/test/server.test.js
git commit -m "feat(parser): /api/parse + кеш + /api/export.txt с обработкой ошибок"
```

---

## Task 11: Статика `public/` и middleware для отдачи фронта

**Files:**
- Modify: `parser/server.js`

- [ ] **Step 11.1: Добавить в `createApp()` ДО auth-маршрутов**

```javascript
  app.use(express.static(join(__dirname, "public"), { index: "index.html" }));
```

Расположение: между `app.use(express.json(...))` и `app.get("/api/health"...)`.

- [ ] **Step 11.2: Создать заглушку `parser/public/index.html` чтобы static не падал**

```html
<!doctype html>
<meta charset="utf-8">
<title>Gideon Parser</title>
<p>Loading…</p>
```

- [ ] **Step 11.3: Проверить что health-check всё ещё работает**

```bash
cd parser && node --test test/server.test.js
```

Expected: 11 passes.

- [ ] **Step 11.4: Коммит**

```bash
git add parser/server.js parser/public/index.html
git commit -m "feat(parser): отдача статики из public/"
```

---

## Task 12: Фронтенд — HTML и CSS скелет

**Files:**
- Modify: `parser/public/index.html`
- Create: `parser/public/style.css`

- [ ] **Step 12.1: Перезаписать `parser/public/index.html`**

```html
<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Гидеон · Парсер участников</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header>
    <h1>Гидеон · Парсер участников</h1>
    <div id="header-actions"></div>
  </header>

  <main id="app">
    <section id="loading" class="screen">
      <p>Загрузка…</p>
    </section>

    <section id="auth-screen" class="screen hidden">
      <h2>Авторизация Telegram</h2>
      <div id="no-credentials" class="hidden warning">
        <p>В <code>parser/.env</code> не заполнены <code>API_ID</code> и <code>API_HASH</code>.</p>
        <ol>
          <li>Открой <a href="https://my.telegram.org" target="_blank" rel="noopener">my.telegram.org</a> → API development tools.</li>
          <li>Создай приложение.</li>
          <li>Скопируй <code>API_ID</code> и <code>API_HASH</code> в файл <code>parser/.env</code>.</li>
          <li>Перезапусти сервис: <code>pm2 restart agent-parser</code>.</li>
          <li>Обнови страницу.</li>
        </ol>
      </div>

      <form id="phone-form" class="hidden">
        <label>Номер телефона (с кодом страны)
          <input type="tel" name="phone" placeholder="+79991234567" required>
        </label>
        <button type="submit">Получить код</button>
      </form>

      <form id="code-form" class="hidden">
        <p>Код пришёл в официальный чат Telegram.</p>
        <label>Код
          <input type="text" name="code" placeholder="12345" inputmode="numeric" required>
        </label>
        <button type="submit">Подтвердить</button>
      </form>

      <form id="password-form" class="hidden">
        <label>Пароль 2FA
          <input type="password" name="password" required>
        </label>
        <button type="submit">Войти</button>
      </form>

      <p id="auth-error" class="error hidden"></p>
    </section>

    <section id="parser-screen" class="screen hidden">
      <div class="row">
        <label><input type="radio" name="source" value="list" checked> Из моих чатов</label>
        <label><input type="radio" name="source" value="ref"> По ссылке / @username</label>
      </div>

      <div id="source-list">
        <input id="chat-search" type="search" placeholder="Поиск по названию…">
        <ul id="chats-list" class="chats"></ul>
      </div>

      <div id="source-ref" class="hidden">
        <input id="chat-ref-input" type="text" placeholder="@vibe_course или https://t.me/...">
      </div>

      <button id="parse-button" disabled>Спарсить участников</button>

      <p id="parser-status" class="hidden"></p>
      <p id="parser-error" class="error hidden"></p>

      <section id="result" class="hidden">
        <h2 id="result-title"></h2>
        <p id="result-stats"></p>
        <textarea id="result-list" readonly rows="14"></textarea>
        <div class="row">
          <button id="copy-btn">Копировать всё</button>
          <button id="download-btn">Скачать .txt</button>
          <button id="again-btn">Новый парсинг</button>
        </div>
        <p id="copy-toast" class="toast hidden"></p>
      </section>
    </section>
  </main>

  <script src="/app.js" type="module"></script>
</body>
</html>
```

- [ ] **Step 12.2: Создать `parser/public/style.css`**

```css
:root {
  --bg: #17212b;
  --panel: #232e3c;
  --border: #2b5278;
  --text: #ffffff;
  --muted: #8b98a5;
  --accent: #5288c1;
  --error: #e57373;
  --success: #81c784;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 15px;
  line-height: 1.5;
}

header {
  padding: 16px 24px;
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
header h1 { margin: 0; font-size: 18px; font-weight: 500; }

main { max-width: 720px; margin: 0 auto; padding: 24px; }
.screen { display: block; }
.hidden { display: none !important; }

h2 { margin: 0 0 16px; font-size: 16px; }

label { display: block; margin: 12px 0; color: var(--muted); }
label input { display: block; width: 100%; margin-top: 6px; }

input[type=text], input[type=tel], input[type=password], input[type=search] {
  background: var(--panel);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 15px;
  width: 100%;
}
input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }

button {
  background: var(--accent);
  color: white;
  border: none;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 15px;
  cursor: pointer;
  margin-top: 12px;
}
button:disabled { opacity: 0.5; cursor: not-allowed; }
button:hover:not(:disabled) { filter: brightness(1.1); }

.row { display: flex; gap: 16px; align-items: center; margin: 12px 0; flex-wrap: wrap; }
.row label { display: inline-flex; align-items: center; gap: 6px; margin: 0; }

.error { color: var(--error); }
.warning {
  background: rgba(229, 115, 115, 0.1);
  border-left: 3px solid var(--error);
  padding: 12px 16px;
  border-radius: 4px;
  margin: 12px 0;
}

.chats { list-style: none; padding: 0; margin: 8px 0; max-height: 400px; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px; }
.chats li { padding: 10px 14px; border-bottom: 1px solid var(--border); cursor: pointer; }
.chats li:hover { background: var(--panel); }
.chats li.selected { background: var(--accent); }
.chats li:last-child { border-bottom: 0; }
.chats .members { color: var(--muted); font-size: 13px; float: right; }

textarea {
  width: 100%;
  background: var(--panel);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 12px;
  border-radius: 8px;
  font-family: monospace;
  font-size: 14px;
  resize: vertical;
}

.toast {
  background: var(--success);
  color: #1a1a1a;
  padding: 8px 12px;
  border-radius: 6px;
  display: inline-block;
  margin-top: 8px;
}

code { background: var(--panel); padding: 2px 6px; border-radius: 4px; font-size: 13px; }
a { color: var(--accent); }
```

- [ ] **Step 12.3: Открыть в браузере (manual)**

```bash
cd parser && npm start
```

В отдельном терминале — открой `http://localhost:3000?token=<AUTH_TOKEN>` (токен в логах). Должна показаться страница «Загрузка…» (JS ещё не написан).

Останови сервер (Ctrl+C).

- [ ] **Step 12.4: Коммит**

```bash
git add parser/public/index.html parser/public/style.css
git commit -m "feat(parser): HTML+CSS скелет UI (два экрана, тёмная тема)"
```

---

## Task 13: Фронтенд — `app.js` экран авторизации

**Files:**
- Create: `parser/public/app.js`

- [ ] **Step 13.1: Создать `parser/public/app.js`**

```javascript
const TOKEN = new URLSearchParams(location.search).get("token") || "";

const $ = (id) => document.getElementById(id);

function show(id) { $(id).classList.remove("hidden"); }
function hide(id) { $(id).classList.add("hidden"); }
function showOnly(...ids) {
  for (const el of document.querySelectorAll(".screen")) el.classList.add("hidden");
  for (const id of ids) show(id);
}

async function api(path, options = {}) {
  const url = new URL(path, location.origin);
  if (TOKEN) url.searchParams.set("token", TOKEN);
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function showAuthError(msg) {
  const el = $("auth-error");
  el.textContent = msg;
  show("auth-error");
}

let authState = { phone: "", phoneCodeHash: "" };

async function init() {
  const { status, body } = await api("/api/auth/status");
  if (status === 401) {
    document.body.innerHTML = "<p style='padding:24px;color:#e57373'>Нет доступа. Открой страницу с правильным <code>?token=</code> в URL.</p>";
    return;
  }
  if (!body.authorized) {
    showOnly("auth-screen");
    if (!body.hasCredentials) {
      show("no-credentials");
    } else {
      show("phone-form");
    }
  } else {
    showOnly("parser-screen");
    await loadChats();
  }
}

$("phone-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  hide("auth-error");
  const phone = new FormData(e.target).get("phone").trim();
  const { status, body } = await api("/api/auth/send-code", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
  if (status !== 200) {
    showAuthError(body.message || body.hint || body.error || "Ошибка");
    return;
  }
  authState = { phone, phoneCodeHash: body.phoneCodeHash };
  hide("phone-form");
  show("code-form");
});

$("code-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  hide("auth-error");
  const code = new FormData(e.target).get("code").trim();
  const { status, body } = await api("/api/auth/sign-in", {
    method: "POST",
    body: JSON.stringify({ phone: authState.phone, phoneCodeHash: authState.phoneCodeHash, code }),
  });
  if (status === 400 && body.error === "2fa_required") {
    authState.code = code;
    hide("code-form");
    show("password-form");
    return;
  }
  if (status !== 200) {
    showAuthError(body.message || body.error || "Ошибка");
    return;
  }
  location.reload();
});

$("password-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  hide("auth-error");
  const password = new FormData(e.target).get("password");
  const { status, body } = await api("/api/auth/sign-in", {
    method: "POST",
    body: JSON.stringify({
      phone: authState.phone,
      phoneCodeHash: authState.phoneCodeHash,
      code: authState.code,
      password,
    }),
  });
  if (status !== 200) {
    showAuthError(body.message || body.error || "Ошибка");
    return;
  }
  location.reload();
});

// Parser screen handlers — Task 14
async function loadChats() { /* implemented in Task 14 */ }

init();
```

- [ ] **Step 13.2: Manual smoke test**

```bash
cd parser && npm start
```

Открой `http://localhost:3000?token=<AUTH_TOKEN>` в браузере. Если в `.env` нет API_ID/API_HASH — должен показаться блок с инструкцией. Если есть — поле «Номер телефона».

Останови сервер.

- [ ] **Step 13.3: Коммит**

```bash
git add parser/public/app.js
git commit -m "feat(parser): фронтенд авторизации (phone → code → 2FA)"
```

---

## Task 14: Фронтенд — экран парсера, список чатов, парсинг, копирование, скачивание

**Files:**
- Modify: `parser/public/app.js`

- [ ] **Step 14.1: Заменить заглушку `loadChats()` и добавить остальные хендлеры**

В `parser/public/app.js` **заменить** строку `async function loadChats() { /* implemented in Task 14 */ }` на:

```javascript
let allChats = [];
let selectedChatId = null;
let lastJobId = null;

async function loadChats() {
  const { status, body } = await api("/api/chats");
  if (status !== 200) {
    $("parser-error").textContent = body.message || body.error || "Не удалось загрузить чаты";
    show("parser-error");
    return;
  }
  allChats = body.chats || [];
  renderChats(allChats);
}

function renderChats(chats) {
  const ul = $("chats-list");
  ul.innerHTML = "";
  for (const c of chats) {
    const li = document.createElement("li");
    li.dataset.id = c.id;
    li.innerHTML = `<span class="members">${c.membersCount.toLocaleString()}</span>${escapeHtml(c.title)}`;
    li.addEventListener("click", () => selectChat(c));
    ul.appendChild(li);
  }
}

function selectChat(c) {
  selectedChatId = c.id;
  for (const li of document.querySelectorAll("#chats-list li")) {
    li.classList.toggle("selected", li.dataset.id === c.id);
  }
  $("parse-button").disabled = false;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

$("chat-search").addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase();
  renderChats(allChats.filter((c) => c.title.toLowerCase().includes(q)));
});

document.querySelectorAll('input[name="source"]').forEach((r) => {
  r.addEventListener("change", () => {
    const isList = r.value === "list" && r.checked;
    $("source-list").classList.toggle("hidden", !isList);
    $("source-ref").classList.toggle("hidden", isList);
    $("parse-button").disabled = isList ? !selectedChatId : !$("chat-ref-input").value.trim();
  });
});

$("chat-ref-input").addEventListener("input", (e) => {
  $("parse-button").disabled = !e.target.value.trim();
});

$("parse-button").addEventListener("click", async () => {
  hide("parser-error");
  hide("result");
  $("parse-button").disabled = true;
  $("parser-status").textContent = "Парсю…";
  show("parser-status");

  const source = document.querySelector('input[name="source"]:checked').value;
  let chatRef;
  if (source === "list") {
    const c = allChats.find((x) => x.id === selectedChatId);
    chatRef = c.username ? "@" + c.username : c.id;
  } else {
    chatRef = $("chat-ref-input").value.trim();
  }

  const { status, body } = await api("/api/parse", {
    method: "POST",
    body: JSON.stringify({ chatRef }),
  });
  hide("parser-status");
  $("parse-button").disabled = false;

  if (status === 429) {
    $("parser-error").textContent = `Telegram попросил подождать ${body.retryAfter} сек. Попробуй позже.`;
    show("parser-error");
    return;
  }
  if (status !== 200) {
    $("parser-error").textContent = body.hint || body.message || body.error || "Ошибка парсинга";
    show("parser-error");
    return;
  }

  lastJobId = body.jobId;
  $("result-title").textContent = body.chat.title;
  $("result-stats").textContent =
    `Всего: ${body.stats.total} · С username: ${body.stats.withUsername} · Без: ${body.stats.withoutUsername} · Боты: ${body.stats.bots}`;
  $("result-list").value = body.usernames.join("\n");
  show("result");
});

$("copy-btn").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("result-list").value);
  const t = $("copy-toast");
  t.textContent = `Скопировано · ${$("result-list").value.split("\n").length} строк`;
  show("copy-toast");
  setTimeout(() => hide("copy-toast"), 2000);
});

$("download-btn").addEventListener("click", () => {
  if (!lastJobId) return;
  const url = `/api/export.txt?jobId=${encodeURIComponent(lastJobId)}${TOKEN ? "&token=" + TOKEN : ""}`;
  location.href = url;
});

$("again-btn").addEventListener("click", () => {
  hide("result");
  $("parse-button").disabled = false;
});
```

- [ ] **Step 14.2: Manual smoke test (требует уже пройденной авторизации)**

```bash
cd parser && npm start
```

Открой страницу. Если уже авторизован — увидишь список чатов. Кликни на чат, нажми «Спарсить» — должен прийти результат. Проверь «Копировать всё» и «Скачать .txt».

Если не авторизован — пройди auth flow.

- [ ] **Step 14.3: Коммит**

```bash
git add parser/public/app.js
git commit -m "feat(parser): фронтенд парсинга (список, выбор, парсинг, copy, download)"
```

---

## Task 15: `parse.js` — CLI для отладки

**Files:**
- Create: `parser/parse.js`

- [ ] **Step 15.1: Создать `parser/parse.js`**

```javascript
#!/usr/bin/env node
import dotenv from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { createSessionStore } from "./lib/session.js";
import { configureClient } from "./lib/telegram.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env") });

const chatRef = process.argv[2];
if (!chatRef) {
  console.error("Usage: node parse.js <@chatname | t.me/... | id>");
  process.exit(1);
}

const sessionStore = createSessionStore(join(__dirname, "data", "session.txt"));
if (!sessionStore.isAuthorized()) {
  console.error("Not authorized. Open the web UI and complete sign-in first.");
  process.exit(1);
}
if (!process.env.API_ID || !process.env.API_HASH) {
  console.error("API_ID/API_HASH missing in .env");
  process.exit(1);
}

configureClient({
  apiId: process.env.API_ID,
  apiHash: process.env.API_HASH,
  sessionStore,
});

const { resolveChat, getParticipantUsernames, disconnectClient } = await import("./lib/telegram.js");

try {
  const entity = await resolveChat(chatRef);
  const { usernames, stats } = await getParticipantUsernames(entity);
  console.log(`Chat: ${entity.title || chatRef}`);
  console.log(`Stats:`, stats);
  const date = new Date().toISOString().slice(0, 10);
  const safe = String(entity.title || chatRef).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  const file = `${safe}-${date}.txt`;
  writeFileSync(file, usernames.join("\n"), "utf8");
  console.log(`Wrote ${usernames.length} usernames → ${file}`);
} catch (e) {
  console.error("Error:", e.message || e);
  process.exit(1);
} finally {
  await disconnectClient();
}
```

- [ ] **Step 15.2: Коммит**

```bash
git add parser/parse.js
git commit -m "feat(parser): CLI для отладки (node parse.js @chatname)"
```

---

## Task 16: PM2 конфиг для парсера

**Files:**
- Create: `parser/ecosystem.config.cjs`

- [ ] **Step 16.1: Создать `parser/ecosystem.config.cjs`**

```javascript
module.exports = {
  apps: [
    {
      name: "agent-parser",
      script: "./server.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      watch: false,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
```

- [ ] **Step 16.2: Проверить запуск под PM2 (manual)**

```bash
"C:\Users\Administrator\nodejs\pm2.cmd" start parser/ecosystem.config.cjs
"C:\Users\Administrator\nodejs\pm2.cmd" list
"C:\Users\Administrator\nodejs\pm2.cmd" logs agent-parser --lines 20
```

Expected: процесс `agent-parser` в статусе `online`, в логах URL с токеном.

Затем останови (но оставь конфиг):

```bash
"C:\Users\Administrator\nodejs\pm2.cmd" stop agent-parser
```

- [ ] **Step 16.3: Коммит**

```bash
git add parser/ecosystem.config.cjs
git commit -m "feat(parser): PM2 конфиг agent-parser"
```

---

## Task 17: Бот — модуль `parser-menu.js`, главное меню /parser

Все хендлеры под `isOwner(ctx)`. State хранится в `Map<userId, {step, data}>`. HTTP-вызовы парсера через `fetch` на `http://localhost:3000`.

**Files:**
- Create: `bot/parser-menu.js`

- [ ] **Step 17.1: Создать скелет `bot/parser-menu.js`**

```javascript
/**
 * Parser Menu — команды бота для парсера участников Telegram-чатов.
 * Подключается из bot/index.js через registerParserHandlers(bot, isOwner).
 * Парсер живёт отдельным сервисом на http://localhost:3000.
 */
import { InlineKeyboard, InputFile } from "grammy";

const PARSER_URL = process.env.PARSER_URL || "http://localhost:3000";

// FSM: userId -> { step, data }
const states = new Map();

function setState(userId, step, data = {}) {
  states.set(String(userId), { step, data });
}
function getState(userId) {
  return states.get(String(userId)) || null;
}
function clearState(userId) {
  states.delete(String(userId));
}

async function parserFetch(path, options = {}) {
  const res = await fetch(`${PARSER_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function mainMenuKeyboard() {
  return new InlineKeyboard()
    .text("📋 Из моих чатов", "parser_source_list").row()
    .text("🔗 По ссылке/@username", "parser_source_ref").row()
    .text("🌐 Открыть в браузере", "parser_open_web").row()
    .text("❌ Отмена", "parser_cancel");
}

export function registerParserHandlers(bot, isOwner) {
  bot.command("parser", async (ctx) => {
    if (!isOwner(ctx)) return;
    clearState(ctx.from.id);
    await ctx.reply(
      "🔎 Парсер участников Telegram-чатов\n\nОткуда взять чат?",
      { reply_markup: mainMenuKeyboard() }
    );
  });

  bot.callbackQuery("parser_cancel", async (ctx) => {
    if (!isOwner(ctx)) return;
    await ctx.answerCallbackQuery();
    clearState(ctx.from.id);
    try { await ctx.editMessageText("Отменено."); } catch {}
  });

  bot.callbackQuery("parser_open_web", async (ctx) => {
    if (!isOwner(ctx)) return;
    await ctx.answerCallbackQuery();
    const { body } = await parserFetch("/api/health");
    const token = process.env.PARSER_AUTH_TOKEN || "";
    if (!token) {
      await ctx.reply(
        "Не задан PARSER_AUTH_TOKEN в окружении бота. Возьми токен из логов парсера (`pm2 logs agent-parser`) и положи в `~/.agent/.env` как `PARSER_AUTH_TOKEN=...`, потом перезапусти бота."
      );
      return;
    }
    const ip = process.env.PARSER_PUBLIC_HOST || "138.16.178.94";
    const url = `http://${ip}:3000?token=${token}`;
    await ctx.reply(`Открой в браузере:\n${url}`);
  });

  // Placeholders — implemented in Tasks 18/19/20
  bot.callbackQuery("parser_source_list", async (ctx) => {
    if (!isOwner(ctx)) return;
    await ctx.answerCallbackQuery();
    await ctx.reply("[заглушка] список чатов будет в Task 18");
  });

  bot.callbackQuery("parser_source_ref", async (ctx) => {
    if (!isOwner(ctx)) return;
    await ctx.answerCallbackQuery();
    await ctx.reply("[заглушка] ввод ссылки будет в Task 19");
  });

  bot.command("cancel", async (ctx) => {
    if (!isOwner(ctx)) return;
    const st = getState(ctx.from.id);
    if (st) {
      clearState(ctx.from.id);
      await ctx.reply("Отменено.");
    }
  });
}
```

- [ ] **Step 17.2: Smoke-проверка импорта**

```bash
node -e "import('./bot/parser-menu.js').then(m => console.log(Object.keys(m)))"
```

Expected: `[ 'registerParserHandlers' ]`

- [ ] **Step 17.3: Коммит**

```bash
git add bot/parser-menu.js
git commit -m "feat(bot): parser-menu.js — скелет с главным меню /parser"
```

---

## Task 18: Бот — ветка «Из моих чатов» с пагинацией

**Files:**
- Modify: `bot/parser-menu.js`

- [ ] **Step 18.1: Заменить заглушку `parser_source_list` и добавить пагинацию**

В `bot/parser-menu.js` **заменить** хендлер `bot.callbackQuery("parser_source_list", ...)` на:

```javascript
  bot.callbackQuery("parser_source_list", async (ctx) => {
    if (!isOwner(ctx)) return;
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("⏳ Загружаю твои чаты…").catch(() => {});

    const { status, body } = await parserFetch("/api/chats");
    if (status === 403) {
      await ctx.reply(
        "Парсер не авторизован в Telegram. Открой веб-интерфейс и пройди вход (телефон → код → 2FA). Команда: «🌐 Открыть в браузере» из /parser."
      );
      return;
    }
    if (status !== 200) {
      await ctx.reply(`Ошибка парсера: ${body.error || status}`);
      return;
    }
    const chats = body.chats || [];
    if (chats.length === 0) {
      await ctx.reply("У тебя нет групповых чатов или парсер их не видит.");
      return;
    }
    setState(ctx.from.id, "browsing-chats", { chats, page: 0 });
    await renderChatsPage(ctx, chats, 0);
  });

  async function renderChatsPage(ctx, chats, page) {
    const perPage = 8;
    const total = chats.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const start = page * perPage;
    const slice = chats.slice(start, start + perPage);

    const kb = new InlineKeyboard();
    for (const c of slice) {
      const label = `${c.title.slice(0, 35)} · ${c.membersCount}`;
      kb.text(label, `parser_chat_${c.id}`).row();
    }
    if (totalPages > 1) {
      const nav = [];
      if (page > 0) nav.push({ text: "⬅️", data: `parser_page_${page - 1}` });
      nav.push({ text: `${page + 1}/${totalPages}`, data: "parser_noop" });
      if (page < totalPages - 1) nav.push({ text: "➡️", data: `parser_page_${page + 1}` });
      for (const b of nav) kb.text(b.text, b.data);
      kb.row();
    }
    kb.text("❌ Отмена", "parser_cancel");

    const text = `Выбери чат (всего ${total}):`;
    try {
      await ctx.editMessageText(text, { reply_markup: kb });
    } catch {
      await ctx.reply(text, { reply_markup: kb });
    }
  }

  bot.callbackQuery(/^parser_page_(\d+)$/, async (ctx) => {
    if (!isOwner(ctx)) return;
    await ctx.answerCallbackQuery();
    const page = Number(ctx.match[1]);
    const st = getState(ctx.from.id);
    if (!st || st.step !== "browsing-chats") return;
    st.data.page = page;
    await renderChatsPage(ctx, st.data.chats, page);
  });

  bot.callbackQuery("parser_noop", async (ctx) => {
    if (!isOwner(ctx)) return;
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^parser_chat_(.+)$/, async (ctx) => {
    if (!isOwner(ctx)) return;
    await ctx.answerCallbackQuery();
    const chatId = ctx.match[1];
    const st = getState(ctx.from.id);
    const chat = st?.data?.chats?.find((c) => c.id === chatId);
    const chatRef = chat?.username ? "@" + chat.username : chatId;
    await runParse(ctx, chatRef, chat?.title);
  });

  // Placeholder — implemented in Task 20
  async function runParse(ctx, chatRef, title) {
    await ctx.reply("[заглушка] парсинг будет в Task 20: " + chatRef);
  }
```

- [ ] **Step 18.2: Smoke-проверка импорта**

```bash
node -e "import('./bot/parser-menu.js').then(m => console.log('ok'))"
```

Expected: `ok` (никаких syntax errors).

- [ ] **Step 18.3: Коммит**

```bash
git add bot/parser-menu.js
git commit -m "feat(bot): ветка «Из моих чатов» с пагинацией"
```

---

## Task 19: Бот — ветка «По ссылке/@username»

**Files:**
- Modify: `bot/parser-menu.js`

- [ ] **Step 19.1: Заменить заглушку `parser_source_ref` и добавить text-handler**

В `bot/parser-menu.js` **заменить** хендлер `bot.callbackQuery("parser_source_ref", ...)` на:

```javascript
  bot.callbackQuery("parser_source_ref", async (ctx) => {
    if (!isOwner(ctx)) return;
    await ctx.answerCallbackQuery();
    setState(ctx.from.id, "awaiting-chat-ref");
    try {
      await ctx.editMessageText(
        "Пришли @username чата или ссылку (например: https://t.me/vibe_course).\n" +
        "Для отмены — /cancel."
      );
    } catch {
      await ctx.reply(
        "Пришли @username чата или ссылку (например: https://t.me/vibe_course).\n" +
        "Для отмены — /cancel."
      );
    }
  });

  bot.on("message:text", async (ctx, next) => {
    if (!isOwner(ctx)) return;
    const st = getState(ctx.from.id);
    if (!st || st.step !== "awaiting-chat-ref") return next();
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return next();
    clearState(ctx.from.id);
    await runParse(ctx, text, text);
  });
```

- [ ] **Step 19.2: Коммит**

```bash
git add bot/parser-menu.js
git commit -m "feat(bot): ветка «По ссылке/@username»"
```

---

## Task 20: Бот — собственно парсинг + отправка .txt файла

**Files:**
- Modify: `bot/parser-menu.js`

- [ ] **Step 20.1: Заменить заглушку `runParse` в `bot/parser-menu.js`**

Заменить:

```javascript
  async function runParse(ctx, chatRef, title) {
    await ctx.reply("[заглушка] парсинг будет в Task 20: " + chatRef);
  }
```

На:

```javascript
  async function runParse(ctx, chatRef, title) {
    const statusMsg = await ctx.reply(`🔍 Парсю «${title || chatRef}»…`);
    const typingTimer = setInterval(() => {
      ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => {});
    }, 4000);

    try {
      let attempt = 0;
      while (true) {
        attempt++;
        const { status, body } = await parserFetch("/api/parse", {
          method: "POST",
          body: JSON.stringify({ chatRef }),
        });

        if (status === 429 && attempt === 1) {
          const wait = Number(body.retryAfter) || 5;
          await ctx.api.editMessageText(
            ctx.chat.id, statusMsg.message_id,
            `Telegram попросил подождать ${wait} сек. Повторю автоматически.`
          ).catch(() => {});
          await new Promise((r) => setTimeout(r, wait * 1000));
          continue;
        }

        if (status === 403 && body.error === "not_authorized") {
          await ctx.reply(
            "Парсер не авторизован в Telegram. Открой веб-интерфейс через «🌐 Открыть в браузере» и пройди авторизацию."
          );
          return;
        }
        if (status === 404) {
          await ctx.reply("Чат не найден или ты в нём не состоишь.");
          return;
        }
        if (status === 403) {
          await ctx.reply(body.hint || "Нет доступа к чату.");
          return;
        }
        if (status === 504) {
          await ctx.reply("Слишком долго. Повтори позже.");
          return;
        }
        if (status === 409) {
          await ctx.reply("Сейчас уже идёт другой парсинг. Подожди и повтори.");
          return;
        }
        if (status !== 200) {
          await ctx.reply(`Ошибка: ${body.error || body.message || status}`);
          return;
        }

        const stats = body.stats;
        const summary =
          `✅ Готово!\n\n📊 ${body.chat.title}\n` +
          `Всего: ${stats.total} · С username: ${stats.withUsername} · Без: ${stats.withoutUsername}`;

        await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, summary).catch(() => {});

        const txt = body.usernames.join("\n");
        const safe = String(body.chat.title).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
        const date = new Date().toISOString().slice(0, 10);
        const filename = `${safe || "chat"}-${date}.txt`;

        await ctx.replyWithDocument(new InputFile(Buffer.from(txt, "utf8"), filename), {
          reply_markup: new InlineKeyboard()
            .text("🔁 Спарсить ещё", "parser_again").row()
            .text("📋 Главное меню", "parser_again"),
        });
        return;
      }
    } catch (e) {
      console.error("[parser/runParse]", e);
      await ctx.reply("Не удалось связаться с парсером. Проверь, что сервис запущен (`pm2 status`).");
    } finally {
      clearInterval(typingTimer);
    }
  }

  bot.callbackQuery("parser_again", async (ctx) => {
    if (!isOwner(ctx)) return;
    await ctx.answerCallbackQuery();
    await ctx.reply(
      "🔎 Парсер участников Telegram-чатов\n\nОткуда взять чат?",
      { reply_markup: mainMenuKeyboard() }
    );
  });
```

- [ ] **Step 20.2: Smoke-проверка**

```bash
node -e "import('./bot/parser-menu.js').then(m => console.log('ok'))"
```

- [ ] **Step 20.3: Коммит**

```bash
git add bot/parser-menu.js
git commit -m "feat(bot): runParse — вызов /api/parse, обработка ошибок, отправка .txt"
```

---

## Task 21: Подключить parser-menu в `bot/index.js`

**Files:**
- Modify: `bot/index.js`

- [ ] **Step 21.1: Добавить импорт**

Найди строку в `bot/index.js` (около строки 23):

```javascript
import { hasAnyTranscriber, registerVoiceHelpers, voiceFallbackKeyboard, VOICE_FALLBACK_PROMPT } from "./voice-helper.js";
```

После неё добавь:

```javascript
import { registerParserHandlers } from "./parser-menu.js";
```

- [ ] **Step 21.2: Зарегистрировать handlers**

Найди в `bot/index.js` строку:

```javascript
registerVoiceHelpers(bot, isOwner);
```

После неё добавь:

```javascript
registerParserHandlers(bot, isOwner);
```

- [ ] **Step 21.3: Добавить команду в setMyCommands**

Найди блок `await bot.api.setMyCommands([...])` (около строки 1271). Добавь после `{ command: "settings", ... }`:

```javascript
      { command: "parser",   description: "Парсер участников чатов" },
```

Итоговый блок:

```javascript
    await bot.api.setMyCommands([
      { command: "start", description: "Меню" },
      { command: "reset", description: "Новая сессия" },
      { command: "status", description: "Статус системы" },
      { command: "settings", description: "Подключить API-ключи" },
      { command: "parser",   description: "Парсер участников чатов" },
    ]);
```

- [ ] **Step 21.4: Smoke-проверка**

```bash
node -e "import('./bot/index.js').then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1) })"
```

Expected: процесс упадёт с `BOT_TOKEN is required` (значит модуль загрузился без syntax errors). Это **успех** — мы не хотим запускать второй экземпляр бота, лишь проверяем импорты.

- [ ] **Step 21.5: Коммит**

```bash
git add bot/index.js
git commit -m "feat(bot): подключить parser-menu и команду /parser в меню"
```

---

## Task 22: Обновить CLAUDE.md и MEMORY.md

**Files:**
- Modify: `CLAUDE.md`
- Modify: `MEMORY.md`

- [ ] **Step 22.1: Поправить раздел «Заблокированные зоны» в `CLAUDE.md`**

Найди в `CLAUDE.md` строку:

```
- ~/.agent/bot/ — код бота (read-only)
```

Замени на:

```
- ~/.agent/bot/ — продакшн копия бота (read-only). Менять только в gideon/bot/, потом синхронизация на сервер
```

- [ ] **Step 22.2: Добавить раздел про парсер в `MEMORY.md`**

В разделе «Активные проекты» **заменить**:

```
Пока не определены.
```

На:

```
- **Парсер участников Telegram-чатов** (`parser/`). Node.js + GramJS + Express. Работает под PM2 как `agent-parser` на порту 3000. Команда `/parser` в @flash_gideon_bot вызывает его по HTTP на localhost. Веб-доступ — `http://138.16.178.94:3000?token=<AUTH_TOKEN>`. Спека: `docs/superpowers/specs/2026-05-18-telegram-parser-design.md`. План: `docs/superpowers/plans/2026-05-18-telegram-parser.md`.
```

В разделе «Инфраструктура» **добавить** в конец:

```
- **Парсер:** `parser/` в этом проекте, запускается через `pm2 start parser/ecosystem.config.cjs`, имя процесса `agent-parser`
```

- [ ] **Step 22.3: Коммит**

```bash
git add CLAUDE.md MEMORY.md
git commit -m "docs: snять read-only с bot/ и зафиксировать парсер в MEMORY.md"
```

---

## Task 23: Синхронизация бота на сервере и запуск парсера под PM2

Эта задача — **операционная**. Делается вручную с подтверждением Александра, так как трогает `~/.agent/bot/` (зону, которая раньше была read-only) и стартует новый сервис.

**Pre-requisites:**
- Александр должен заполнить `parser/.env` (`API_ID`, `API_HASH`)
- Александр должен решить, нужен ли revoke токена бота (с прошлой сессии)

**Files:**
- Manipulate: `~/.agent/bot/` (sync)
- Manipulate: PM2 (start agent-parser)
- Manipulate: Task Scheduler (restart GideonBot)

- [ ] **Step 23.1: Запросить подтверждение пользователя**

Спросить: «Готов синхронизировать `bot/` → `~/.agent/bot/` и запустить парсер? Нужно подтверждение прежде чем трогать продакшн».

- [ ] **Step 23.2: Скопировать обновлённые файлы бота**

```bash
cp bot/index.js "C:/Users/Administrator/.agent/bot/index.js"
cp bot/parser-menu.js "C:/Users/Administrator/.agent/bot/parser-menu.js"
```

- [ ] **Step 23.3: Прописать `PARSER_AUTH_TOKEN` в `~/.agent/.env`**

Александр сам открывает `C:\Users\Administrator\.agent\.env` через RDP и добавляет строку:

```
PARSER_AUTH_TOKEN=<скопировать из parser/.env>
```

Я (агент) НЕ читаю `.env` — это в заблокированной зоне.

- [ ] **Step 23.4: Перезапустить бота через Планировщик**

```bash
powershell -Command "Stop-ScheduledTask -TaskName GideonBot; Start-Sleep 2; Start-ScheduledTask -TaskName GideonBot"
```

Также убить старый процесс node бота, если он завис:

```bash
powershell -Command "Get-CimInstance Win32_Process -Filter 'name = \"node.exe\"' | Where-Object { $_.CommandLine -like '*agent*bot*index.js*' -and $_.CommandLine -notlike '*pm2*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
```

Подождать 5 сек и перезапустить задачу:

```bash
powershell -Command "Start-ScheduledTask -TaskName GideonBot"
```

- [ ] **Step 23.5: Запустить парсер под PM2**

```bash
"C:\Users\Administrator\nodejs\pm2.cmd" start parser/ecosystem.config.cjs
"C:\Users\Administrator\nodejs\pm2.cmd" save
"C:\Users\Administrator\nodejs\pm2.cmd" logs agent-parser --lines 30 --nostream
```

Expected: парсер слушает порт 3000, в логах URL вида `http://localhost:3000?token=...`.

- [ ] **Step 23.6: Manual проверка боевого окружения**

1. Открой `http://138.16.178.94:3000?token=<токен из логов>` в браузере с твоего ноутбука.
2. Пройди авторизацию: телефон → код → 2FA (если есть).
3. Должен открыться список твоих чатов.
4. Выбери небольшой тестовый чат, нажми «Спарсить» — получи результат.
5. Открой `@flash_gideon_bot` в Telegram → команда `/parser`.
6. Жми «Из моих чатов» → выбери тестовый чат → должен прийти .txt.

- [ ] **Step 23.7: Зафиксировать результат в дневнике**

В `memory/2026-05-18.md` (или сегодняшнем файле) дописать в «Сделано»:

```
- Парсер реализован полностью по плану docs/superpowers/plans/2026-05-18-telegram-parser.md
- Запущен под PM2 как agent-parser
- Синхронизирован bot/ → ~/.agent/bot/, бот перезапущен, /parser работает в @flash_gideon_bot
- Авторизация Telegram пройдена через веб-форму, session сохранена в parser/data/session.txt
```

---

## Critères приёмки (из спеки, для финальной проверки)

1. ✅ `pm2 list` показывает `agent-parser` в статусе `online`.
2. ✅ `http://138.16.178.94:3000?token=...` открывает страницу.
3. ✅ После заполнения `parser/.env` и веб-авторизации создаётся `parser/data/session.txt`.
4. ✅ Список групповых чатов отображается, отсортирован по числу членов.
5. ✅ Парсинг чата 10K участников укладывается в 15 сек, кнопки `Копировать`/`Скачать .txt` работают.
6. ✅ `/parser` в @flash_gideon_bot показывает inline-меню; выбор чата → .txt в чат.
7. ✅ Все четыре формата `chatRef` (`@xxx`, `t.me/xxx`, `https://t.me/xxx`, числовой ID) принимаются.
8. ✅ FloodWait отрабатывается: показ таймера, нет stacktrace.
9. ✅ Веб без `?token=` или с неверным токеном → 401.
10. ✅ `parser/.env` и `parser/data/session.txt` отсутствуют в `git status`.

## Self-review checklist (для меня после написания плана)

**Spec coverage:**
- §3 архитектурные решения 1-8 — покрыты Tasks 1-21.
- §4 структура файлов — Tasks 1-21 создают все файлы.
- §5 REST API (все 9 маршрутов) — Tasks 7-11.
- §6 flow в браузере (экраны A/B, состояния) — Tasks 12-14.
- §7 flow в боте — Tasks 17-21.
- §8 безопасность (AUTH_TOKEN, loopback, 0600, FloodWait, лимиты) — Tasks 7, 8, 10.
- §9 изменение CLAUDE.md — Task 22.
- §11 критерии приёмки — Task 23 (manual E2E).

**Placeholder scan:** код в каждом step показан целиком; «заглушки» в Tasks 17-19 заменяются явно в последующих Tasks. Нет «TBD».

**Type consistency:**
- `chatRef` нормализуется через `normalizeChatRef` в `lib/chatref.js`, используется в `lib/telegram.js` (Task 4) и сервером (Task 10) — единый формат `{type, value}`.
- `sessionStore` создаётся в server.js (Task 8), передаётся в `configureClient` (Task 4) — API совпадает (`load/save/clear/isAuthorized`).
- `stats` в `/api/parse` (`{total, withUsername, withoutUsername, bots}`) совпадает с тем что собирает `getParticipantUsernames` (Task 4) и что рендерит фронт (Task 14) и бот (Task 20).
- `jobId` — генерится в Task 10, читается в `/api/export.txt` (Task 10), используется фронтом (Task 14). Совпадает.
- `configureClient` сделан идемпотентным (правка после self-review): повторные вызовы возвращают существующий клиент, не пересоздают подключение. После logout вызывается `resetClient()` для обнуления (см. Task 5 — добавить `resetClient()` в `logout`).

План готов к исполнению.
