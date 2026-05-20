# Sales Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Построить `sales-manager/` — отдельный сервис AI-продавца для тёплого аутрича в Telegram от личного аккаунта Александра, с диалоговым брифингом через @flash_gideon_bot и веб-UI на gideon-bay.vercel.app.

**Architecture:** Отдельный Node.js-сервис в папке `sales-manager/`, два процесса PM2 (HTTP API на :3001 и worker). Шарит TG-сессию с парсером через файл `parser/data/session.txt`. SQLite БД. AI через Claude Code CLI по OAuth-подписке (паттерн из `bot/`).

**Tech Stack:**
- Node.js 20 ESM (`"type": "module"`)
- Express (HTTP API)
- `telegram` (GramJS, как в парсере)
- `better-sqlite3` (SQLite драйвер, новая зависимость)
- `grammy` (бот, уже есть в `bot/`)
- Встроенный `node --test` + `node:assert` для тестов
- Встроенный `fetch` для межсервисных HTTP-вызовов

**Reference spec:** [`docs/superpowers/specs/2026-05-21-sales-manager-design.md`](../specs/2026-05-21-sales-manager-design.md)

**Testing principle:** все I/O (Telegram, claude CLI, время, рандом) инжектируются через параметры функций / конструкторов. В тестах подменяем моками. БД в тестах — `:memory:` через `better-sqlite3`.

---

## Phase 0 — Foundation (структура и БД)

Цель фазы: пустой сервис с готовой схемой БД и набором query-helpers. Никакого I/O пока нет.

### Task 1: Создать структуру папок и package.json

**Files:**
- Create: `sales-manager/package.json`
- Create: `sales-manager/.gitignore`
- Create: `sales-manager/README.md`
- Create: `sales-manager/lib/.gitkeep`, `sales-manager/test/.gitkeep`, `sales-manager/data/.gitkeep`

- [ ] **Step 1: Создать `sales-manager/package.json`**

```json
{
  "name": "agent-sales-manager",
  "version": "0.1.0",
  "type": "module",
  "description": "AI sales manager — outbound + inbound Telegram dialogs",
  "main": "server.js",
  "scripts": {
    "start:server": "node server.js",
    "start:worker": "node worker.js",
    "dev:server": "node --watch server.js",
    "dev:worker": "node --watch worker.js",
    "test": "node --test test/"
  },
  "dependencies": {
    "telegram": "^2.26.16",
    "express": "^4.21.2",
    "better-sqlite3": "^11.3.0",
    "dotenv": "^16.4.7"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 2: Создать `sales-manager/.gitignore`**

```
node_modules/
data/sales-manager.db
data/sales-manager.db-journal
data/*.db
data/*.db-*
.env
```

- [ ] **Step 3: Создать `sales-manager/README.md`**

```markdown
# sales-manager

AI-продавец на Telegram. Outbound (исходящие с задержками) + inbound (AI-ответы) для тёплого аутрича от личного аккаунта.

Спека: `docs/superpowers/specs/2026-05-21-sales-manager-design.md`
План: `docs/superpowers/plans/2026-05-21-sales-manager.md`

## Запуск
- HTTP API: `npm run start:server` (порт 3001)
- Worker: `npm run start:worker`
- PM2: `pm2 start ecosystem.config.cjs`

## Тесты
`npm test`
```

- [ ] **Step 4: Создать пустые `.gitkeep` файлы**

```
sales-manager/lib/.gitkeep
sales-manager/test/.gitkeep
sales-manager/data/.gitkeep
```

- [ ] **Step 5: Установить зависимости**

Run: `cd sales-manager && npm install`
Expected: создаётся `node_modules/`, `package-lock.json`. Может быть warning про `node-gyp` для `better-sqlite3` — на Windows это нормально, проверь что он всё-таки скомпилировался.

- [ ] **Step 6: Commit**

```
git add sales-manager/package.json sales-manager/package-lock.json sales-manager/.gitignore sales-manager/README.md sales-manager/lib/.gitkeep sales-manager/test/.gitkeep sales-manager/data/.gitkeep
git commit -m "feat(sales-manager): initial package scaffold"
```

---

### Task 2: Схема БД и миграции (`db.js`)

**Files:**
- Create: `sales-manager/lib/db.js`
- Create: `sales-manager/test/db.schema.test.js`

- [ ] **Step 1: Написать падающий тест на создание схемы**

`sales-manager/test/db.schema.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../lib/db.js";

test("openDb создаёт все таблицы и индексы", () => {
  const db = openDb(":memory:");
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
  assert.deepEqual(tables, [
    "campaigns",
    "conversations",
    "drafts",
    "events",
    "leads",
    "leads_blocked",
    "messages",
  ]);
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name);
  assert.ok(idx.includes("idx_leads_schedule"));
  assert.ok(idx.includes("idx_messages_conv"));
  db.close();
});
```

- [ ] **Step 2: Запустить — должен упасть**

Run: `cd sales-manager && node --test test/db.schema.test.js`
Expected: FAIL — модуль `../lib/db.js` не найден

- [ ] **Step 3: Реализовать `sales-manager/lib/db.js`**

```js
import Database from "better-sqlite3";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  mode TEXT,
  offer_text TEXT,
  offer_url TEXT,
  target_audience TEXT,
  goal_ikr TEXT,
  tone TEXT,
  stop_phrases TEXT,
  daily_message_limit INTEGER NOT NULL DEFAULT 15,
  working_hours_start INTEGER NOT NULL DEFAULT 10,
  working_hours_end INTEGER NOT NULL DEFAULT 21,
  timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  paused_at INTEGER,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  tg_user_id INTEGER,
  tg_username TEXT,
  first_name TEXT,
  last_name TEXT,
  bio TEXT,
  source_chat_title TEXT,
  source_parse_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  next_action_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_leads_schedule ON leads(campaign_id, status, next_action_at);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  stage TEXT NOT NULL DEFAULT 'intro',
  last_inbound_at INTEGER,
  last_outbound_at INTEGER,
  message_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL,
  body TEXT NOT NULL,
  tg_message_id INTEGER,
  status TEXT NOT NULL,
  scheduled_for INTEGER,
  sent_at INTEGER,
  received_at INTEGER,
  ai_model TEXT,
  ai_tokens_in INTEGER,
  ai_tokens_out INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, sent_at);

CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES messages(id),
  telegram_bot_message_id INTEGER,
  status TEXT NOT NULL DEFAULT 'waiting',
  human_edit_text TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  lead_id INTEGER,
  campaign_id INTEGER,
  payload_json TEXT
);

CREATE TABLE IF NOT EXISTS leads_blocked (
  tg_user_id INTEGER PRIMARY KEY,
  reason TEXT,
  blocked_at INTEGER NOT NULL
);
`;

export function openDb(path = "./data/sales-manager.db") {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}
```

- [ ] **Step 4: Прогнать тест — должен пройти**

Run: `cd sales-manager && node --test test/db.schema.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```
git add sales-manager/lib/db.js sales-manager/test/db.schema.test.js
git commit -m "feat(sales-manager): SQLite schema and openDb"
```

---

### Task 3: Query-helpers для campaigns

**Files:**
- Modify: `sales-manager/lib/db.js`
- Create: `sales-manager/test/db.campaigns.test.js`

- [ ] **Step 1: Написать падающий тест**

`sales-manager/test/db.campaigns.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, createCampaign, getCampaign, listCampaigns, updateCampaign, setCampaignStatus } from "../lib/db.js";

function freshDb() { return openDb(":memory:"); }

test("createCampaign + getCampaign round-trip", () => {
  const db = freshDb();
  const id = createCampaign(db, { name: "Test", offer_text: "X", offer_url: "https://x", target_audience: "y", goal_ikr: "z" });
  assert.equal(typeof id, "number");
  const c = getCampaign(db, id);
  assert.equal(c.name, "Test");
  assert.equal(c.status, "draft");
  assert.equal(c.daily_message_limit, 15);
});

test("listCampaigns возвращает все, кроме архивных по умолчанию", () => {
  const db = freshDb();
  const a = createCampaign(db, { name: "A" });
  const b = createCampaign(db, { name: "B" });
  setCampaignStatus(db, b, "archived");
  const list = listCampaigns(db);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, a);
  const all = listCampaigns(db, { includeArchived: true });
  assert.equal(all.length, 2);
});

test("updateCampaign правит только переданные поля", () => {
  const db = freshDb();
  const id = createCampaign(db, { name: "A", offer_text: "old" });
  updateCampaign(db, id, { offer_text: "new", tone: "friendly" });
  const c = getCampaign(db, id);
  assert.equal(c.offer_text, "new");
  assert.equal(c.tone, "friendly");
  assert.equal(c.name, "A");
});

test("setCampaignStatus меняет status и проставляет timestamp", () => {
  const db = freshDb();
  const id = createCampaign(db, { name: "A" });
  setCampaignStatus(db, id, "running");
  const c = getCampaign(db, id);
  assert.equal(c.status, "running");
  assert.ok(c.started_at > 0);
});
```

- [ ] **Step 2: Запустить тест — должен упасть**

Run: `cd sales-manager && node --test test/db.campaigns.test.js`
Expected: FAIL — функции не экспортируются

- [ ] **Step 3: Добавить query-helpers в `sales-manager/lib/db.js`** (после `openDb`)

```js
export function createCampaign(db, fields) {
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO campaigns (name, offer_text, offer_url, target_audience, goal_ikr, tone, stop_phrases, created_at)
    VALUES (@name, @offer_text, @offer_url, @target_audience, @goal_ikr, @tone, @stop_phrases, @created_at)
  `);
  const res = stmt.run({
    name: fields.name,
    offer_text: fields.offer_text ?? null,
    offer_url: fields.offer_url ?? null,
    target_audience: fields.target_audience ?? null,
    goal_ikr: fields.goal_ikr ?? null,
    tone: fields.tone ?? null,
    stop_phrases: fields.stop_phrases ?? null,
    created_at: now,
  });
  return res.lastInsertRowid;
}

export function getCampaign(db, id) {
  return db.prepare("SELECT * FROM campaigns WHERE id = ?").get(id);
}

export function listCampaigns(db, { includeArchived = false } = {}) {
  const sql = includeArchived
    ? "SELECT * FROM campaigns ORDER BY created_at DESC"
    : "SELECT * FROM campaigns WHERE status != 'archived' ORDER BY created_at DESC";
  return db.prepare(sql).all();
}

const ALLOWED_UPDATE = new Set([
  "name", "mode", "offer_text", "offer_url", "target_audience", "goal_ikr",
  "tone", "stop_phrases", "daily_message_limit", "working_hours_start",
  "working_hours_end", "timezone",
]);

export function updateCampaign(db, id, patch) {
  const entries = Object.entries(patch).filter(([k]) => ALLOWED_UPDATE.has(k));
  if (!entries.length) return 0;
  const sets = entries.map(([k]) => `${k} = @${k}`).join(", ");
  const stmt = db.prepare(`UPDATE campaigns SET ${sets} WHERE id = @id`);
  return stmt.run({ ...Object.fromEntries(entries), id }).changes;
}

const STATUS_TIMESTAMP_FIELD = {
  running: "started_at",
  paused: "paused_at",
  completed: "completed_at",
};

export function setCampaignStatus(db, id, status) {
  const field = STATUS_TIMESTAMP_FIELD[status];
  if (field) {
    db.prepare(`UPDATE campaigns SET status = ?, ${field} = ? WHERE id = ?`).run(status, Date.now(), id);
  } else {
    db.prepare(`UPDATE campaigns SET status = ? WHERE id = ?`).run(status, id);
  }
}
```

- [ ] **Step 4: Запустить тест — должен пройти**

Run: `cd sales-manager && node --test test/db.campaigns.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```
git add sales-manager/lib/db.js sales-manager/test/db.campaigns.test.js
git commit -m "feat(sales-manager/db): campaigns CRUD helpers"
```

---

### Task 4: Query-helpers для leads

**Files:**
- Modify: `sales-manager/lib/db.js`
- Create: `sales-manager/test/db.leads.test.js`

- [ ] **Step 1: Написать падающий тест**

`sales-manager/test/db.leads.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, createCampaign, addLeads, getLead, listLeads, setLeadStatus, nextLeadToContact, isLeadBlocked, blockLead } from "../lib/db.js";

function setup() {
  const db = openDb(":memory:");
  const cid = createCampaign(db, { name: "C" });
  return { db, cid };
}

test("addLeads вставляет массив, пропускает дубликаты по tg_user_id в кампании", () => {
  const { db, cid } = setup();
  const inserted = addLeads(db, cid, [
    { tg_user_id: 1, tg_username: "a" },
    { tg_user_id: 2, tg_username: "b" },
    { tg_user_id: 1, tg_username: "a_dup" },
  ]);
  assert.equal(inserted, 2);
  assert.equal(listLeads(db, cid).length, 2);
});

test("nextLeadToContact берёт queued с самым старым next_action_at", () => {
  const { db, cid } = setup();
  addLeads(db, cid, [
    { tg_user_id: 1, tg_username: "a", next_action_at: 1000 },
    { tg_user_id: 2, tg_username: "b", next_action_at: 500 },
    { tg_user_id: 3, tg_username: "c", next_action_at: 2000 },
  ]);
  const lead = nextLeadToContact(db, cid, Date.now());
  assert.equal(lead.tg_user_id, 2);
});

test("nextLeadToContact возвращает null если все ждут будущего", () => {
  const { db, cid } = setup();
  addLeads(db, cid, [{ tg_user_id: 1, tg_username: "a", next_action_at: Date.now() + 60000 }]);
  const lead = nextLeadToContact(db, cid, Date.now());
  assert.equal(lead, null);
});

test("blockLead + isLeadBlocked", () => {
  const db = openDb(":memory:");
  assert.equal(isLeadBlocked(db, 42), false);
  blockLead(db, 42, "spam complaint");
  assert.equal(isLeadBlocked(db, 42), true);
});
```

- [ ] **Step 2: Запустить — упадёт**

Run: `cd sales-manager && node --test test/db.leads.test.js`
Expected: FAIL

- [ ] **Step 3: Добавить в `sales-manager/lib/db.js`**

```js
export function addLeads(db, campaignId, leads) {
  const now = Date.now();
  const insert = db.prepare(`
    INSERT INTO leads (campaign_id, tg_user_id, tg_username, first_name, last_name, bio, source_chat_title, source_parse_id, next_action_at, created_at)
    SELECT @campaign_id, @tg_user_id, @tg_username, @first_name, @last_name, @bio, @source_chat_title, @source_parse_id, @next_action_at, @created_at
    WHERE NOT EXISTS (
      SELECT 1 FROM leads WHERE campaign_id = @campaign_id AND tg_user_id IS NOT NULL AND tg_user_id = @tg_user_id
    )
  `);
  const tx = db.transaction((rows) => {
    let inserted = 0;
    for (const r of rows) {
      const res = insert.run({
        campaign_id: campaignId,
        tg_user_id: r.tg_user_id ?? null,
        tg_username: r.tg_username ?? null,
        first_name: r.first_name ?? null,
        last_name: r.last_name ?? null,
        bio: r.bio ?? null,
        source_chat_title: r.source_chat_title ?? null,
        source_parse_id: r.source_parse_id ?? null,
        next_action_at: r.next_action_at ?? now,
        created_at: now,
      });
      if (res.changes) inserted++;
    }
    return inserted;
  });
  return tx(leads);
}

export function getLead(db, id) {
  return db.prepare("SELECT * FROM leads WHERE id = ?").get(id);
}

export function listLeads(db, campaignId, { status = null, limit = 1000 } = {}) {
  const sql = status
    ? "SELECT * FROM leads WHERE campaign_id = ? AND status = ? ORDER BY created_at LIMIT ?"
    : "SELECT * FROM leads WHERE campaign_id = ? ORDER BY created_at LIMIT ?";
  return status
    ? db.prepare(sql).all(campaignId, status, limit)
    : db.prepare(sql).all(campaignId, limit);
}

export function setLeadStatus(db, id, status, nextActionAt = null) {
  if (nextActionAt !== null) {
    db.prepare("UPDATE leads SET status = ?, next_action_at = ? WHERE id = ?").run(status, nextActionAt, id);
  } else {
    db.prepare("UPDATE leads SET status = ? WHERE id = ?").run(status, id);
  }
}

export function nextLeadToContact(db, campaignId, now) {
  return db.prepare(`
    SELECT * FROM leads
    WHERE campaign_id = ? AND status = 'queued' AND (next_action_at IS NULL OR next_action_at <= ?)
    ORDER BY next_action_at ASC, id ASC
    LIMIT 1
  `).get(campaignId, now) ?? null;
}

export function blockLead(db, tgUserId, reason) {
  db.prepare("INSERT OR REPLACE INTO leads_blocked (tg_user_id, reason, blocked_at) VALUES (?, ?, ?)")
    .run(tgUserId, reason ?? null, Date.now());
}

export function isLeadBlocked(db, tgUserId) {
  return !!db.prepare("SELECT 1 FROM leads_blocked WHERE tg_user_id = ?").get(tgUserId);
}
```

- [ ] **Step 4: Прогнать — пройти**

Run: `cd sales-manager && node --test test/db.leads.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```
git add sales-manager/lib/db.js sales-manager/test/db.leads.test.js
git commit -m "feat(sales-manager/db): leads helpers + blocklist"
```

---

### Task 5: Query-helpers для conversations и messages

**Files:**
- Modify: `sales-manager/lib/db.js`
- Create: `sales-manager/test/db.messages.test.js`

- [ ] **Step 1: Написать падающий тест**

`sales-manager/test/db.messages.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, createCampaign, addLeads, listLeads, getOrCreateConversation, addMessage, listMessages, updateMessageStatus, setConversationStage } from "../lib/db.js";

function setup() {
  const db = openDb(":memory:");
  const cid = createCampaign(db, { name: "C" });
  addLeads(db, cid, [{ tg_user_id: 1, tg_username: "a" }]);
  const lead = listLeads(db, cid)[0];
  return { db, cid, lead };
}

test("getOrCreateConversation создаёт одну запись для пары lead+campaign", () => {
  const { db, cid, lead } = setup();
  const conv1 = getOrCreateConversation(db, lead.id, cid);
  const conv2 = getOrCreateConversation(db, lead.id, cid);
  assert.equal(conv1.id, conv2.id);
  assert.equal(conv1.stage, "intro");
});

test("addMessage + listMessages возвращает в порядке вставки", () => {
  const { db, cid, lead } = setup();
  const conv = getOrCreateConversation(db, lead.id, cid);
  const m1 = addMessage(db, { conversation_id: conv.id, role: "outbound", body: "hi", status: "sent" });
  const m2 = addMessage(db, { conversation_id: conv.id, role: "inbound", body: "hello", status: "received" });
  const list = listMessages(db, conv.id);
  assert.equal(list.length, 2);
  assert.equal(list[0].id, m1);
  assert.equal(list[1].id, m2);
});

test("updateMessageStatus обновляет статус и timestamp", () => {
  const { db, cid, lead } = setup();
  const conv = getOrCreateConversation(db, lead.id, cid);
  const mid = addMessage(db, { conversation_id: conv.id, role: "outbound", body: "draft", status: "scheduled" });
  updateMessageStatus(db, mid, "sent", { sent_at: 12345 });
  const msg = db.prepare("SELECT * FROM messages WHERE id = ?").get(mid);
  assert.equal(msg.status, "sent");
  assert.equal(msg.sent_at, 12345);
});

test("setConversationStage", () => {
  const { db, cid, lead } = setup();
  const conv = getOrCreateConversation(db, lead.id, cid);
  setConversationStage(db, conv.id, "pitch");
  const fresh = db.prepare("SELECT stage FROM conversations WHERE id = ?").get(conv.id);
  assert.equal(fresh.stage, "pitch");
});
```

- [ ] **Step 2: Запустить — упадёт**

Run: `cd sales-manager && node --test test/db.messages.test.js`
Expected: FAIL

- [ ] **Step 3: Добавить в `lib/db.js`**

```js
export function getOrCreateConversation(db, leadId, campaignId) {
  const existing = db.prepare("SELECT * FROM conversations WHERE lead_id = ? AND campaign_id = ?").get(leadId, campaignId);
  if (existing) return existing;
  const id = db.prepare("INSERT INTO conversations (lead_id, campaign_id) VALUES (?, ?)").run(leadId, campaignId).lastInsertRowid;
  return db.prepare("SELECT * FROM conversations WHERE id = ?").get(id);
}

export function addMessage(db, { conversation_id, role, body, status, tg_message_id = null, scheduled_for = null, sent_at = null, received_at = null, ai_model = null, ai_tokens_in = null, ai_tokens_out = null }) {
  const id = db.prepare(`
    INSERT INTO messages (conversation_id, role, body, tg_message_id, status, scheduled_for, sent_at, received_at, ai_model, ai_tokens_in, ai_tokens_out)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(conversation_id, role, body, tg_message_id, status, scheduled_for, sent_at, received_at, ai_model, ai_tokens_in, ai_tokens_out).lastInsertRowid;
  db.prepare("UPDATE conversations SET message_count = message_count + 1 WHERE id = ?").run(conversation_id);
  if (role === "outbound") db.prepare("UPDATE conversations SET last_outbound_at = ? WHERE id = ?").run(sent_at ?? Date.now(), conversation_id);
  if (role === "inbound") db.prepare("UPDATE conversations SET last_inbound_at = ? WHERE id = ?").run(received_at ?? Date.now(), conversation_id);
  return id;
}

export function listMessages(db, conversationId, { limit = 200 } = {}) {
  return db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC LIMIT ?").all(conversationId, limit);
}

export function updateMessageStatus(db, id, status, patch = {}) {
  const fields = ["status"];
  const values = [status];
  for (const k of ["sent_at", "received_at", "tg_message_id"]) {
    if (patch[k] !== undefined) { fields.push(k); values.push(patch[k]); }
  }
  const sets = fields.map((f) => `${f} = ?`).join(", ");
  db.prepare(`UPDATE messages SET ${sets} WHERE id = ?`).run(...values, id);
}

export function setConversationStage(db, conversationId, stage) {
  db.prepare("UPDATE conversations SET stage = ? WHERE id = ?").run(stage, conversationId);
}
```

- [ ] **Step 4: Прогнать — пройти**

Run: `cd sales-manager && node --test test/db.messages.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```
git add sales-manager/lib/db.js sales-manager/test/db.messages.test.js
git commit -m "feat(sales-manager/db): conversations + messages helpers"
```

---

### Task 6: Query-helpers для drafts, events, метрик

**Files:**
- Modify: `sales-manager/lib/db.js`
- Create: `sales-manager/test/db.drafts.test.js`

- [ ] **Step 1: Падающий тест**

`sales-manager/test/db.drafts.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, createCampaign, addLeads, listLeads, getOrCreateConversation, addMessage, createDraft, getDraft, resolveDraft, logEvent, listEvents, campaignStats, setLeadStatus } from "../lib/db.js";

function setup() {
  const db = openDb(":memory:");
  const cid = createCampaign(db, { name: "C" });
  addLeads(db, cid, [{ tg_user_id: 1, tg_username: "a" }]);
  const lead = listLeads(db, cid)[0];
  const conv = getOrCreateConversation(db, lead.id, cid);
  const mid = addMessage(db, { conversation_id: conv.id, role: "outbound", body: "draft body", status: "drafted" });
  return { db, cid, lead, conv, mid };
}

test("createDraft + getDraft + resolveDraft", () => {
  const { db, mid } = setup();
  const did = createDraft(db, mid);
  const d = getDraft(db, did);
  assert.equal(d.message_id, mid);
  assert.equal(d.status, "waiting");
  resolveDraft(db, did, "approved");
  const after = getDraft(db, did);
  assert.equal(after.status, "approved");
  assert.ok(after.resolved_at > 0);
});

test("logEvent + listEvents с фильтром по campaign", () => {
  const { db, cid } = setup();
  logEvent(db, { type: "sent", campaign_id: cid, lead_id: 1, payload: { foo: 1 } });
  logEvent(db, { type: "received", campaign_id: cid, lead_id: 1 });
  const evs = listEvents(db, { campaignId: cid });
  assert.equal(evs.length, 2);
  assert.equal(JSON.parse(evs[0].payload_json).foo, 1);
});

test("campaignStats считает по статусам лидов и сообщениям", () => {
  const { db, cid, lead } = setup();
  setLeadStatus(db, lead.id, "qualified");
  const stats = campaignStats(db, cid);
  assert.equal(stats.leads_total, 1);
  assert.equal(stats.leads_by_status.qualified, 1);
  assert.equal(stats.messages_outbound, 1);
});
```

- [ ] **Step 2: Запустить — упадёт**

Run: `cd sales-manager && node --test test/db.drafts.test.js`
Expected: FAIL

- [ ] **Step 3: Добавить в `lib/db.js`**

```js
export function createDraft(db, messageId, telegramBotMessageId = null) {
  return db.prepare(`
    INSERT INTO drafts (message_id, telegram_bot_message_id, created_at) VALUES (?, ?, ?)
  `).run(messageId, telegramBotMessageId, Date.now()).lastInsertRowid;
}

export function getDraft(db, id) {
  return db.prepare("SELECT * FROM drafts WHERE id = ?").get(id);
}

export function getDraftByMessage(db, messageId) {
  return db.prepare("SELECT * FROM drafts WHERE message_id = ? ORDER BY id DESC LIMIT 1").get(messageId);
}

export function resolveDraft(db, id, status, humanEditText = null) {
  db.prepare("UPDATE drafts SET status = ?, human_edit_text = ?, resolved_at = ? WHERE id = ?")
    .run(status, humanEditText, Date.now(), id);
}

export function logEvent(db, { type, lead_id = null, campaign_id = null, payload = null }) {
  return db.prepare("INSERT INTO events (ts, type, lead_id, campaign_id, payload_json) VALUES (?, ?, ?, ?, ?)")
    .run(Date.now(), type, lead_id, campaign_id, payload ? JSON.stringify(payload) : null).lastInsertRowid;
}

export function listEvents(db, { campaignId = null, leadId = null, limit = 500 } = {}) {
  if (campaignId) return db.prepare("SELECT * FROM events WHERE campaign_id = ? ORDER BY id DESC LIMIT ?").all(campaignId, limit);
  if (leadId) return db.prepare("SELECT * FROM events WHERE lead_id = ? ORDER BY id DESC LIMIT ?").all(leadId, limit);
  return db.prepare("SELECT * FROM events ORDER BY id DESC LIMIT ?").all(limit);
}

export function campaignStats(db, campaignId) {
  const leads = db.prepare("SELECT status, COUNT(*) as n FROM leads WHERE campaign_id = ? GROUP BY status").all(campaignId);
  const by = {};
  let total = 0;
  for (const r of leads) { by[r.status] = r.n; total += r.n; }
  const msgs = db.prepare(`
    SELECT m.role, COUNT(*) as n
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE c.campaign_id = ?
    GROUP BY m.role
  `).all(campaignId);
  const msgBy = {};
  for (const r of msgs) msgBy[r.role] = r.n;
  return {
    leads_total: total,
    leads_by_status: by,
    messages_outbound: msgBy.outbound ?? 0,
    messages_inbound: msgBy.inbound ?? 0,
    messages_human_takeover: msgBy.human_takeover ?? 0,
  };
}

export function countOutboundFirstMessagesSince(db, sinceTs) {
  return db.prepare(`
    SELECT COUNT(*) as n FROM messages m
    WHERE m.role = 'outbound' AND m.status = 'sent' AND m.sent_at >= ?
      AND m.id = (SELECT MIN(id) FROM messages WHERE conversation_id = m.conversation_id)
  `).get(sinceTs).n;
}
```

- [ ] **Step 4: Прогнать — пройти**

Run: `cd sales-manager && node --test test/db.drafts.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```
git add sales-manager/lib/db.js sales-manager/test/db.drafts.test.js
git commit -m "feat(sales-manager/db): drafts, events, campaign stats"
```

---

## Phase 1 — Core libs (без I/O)

Чистая логика: safety, AI-промпты, dialog engine. Все зависимости инжектируются — в тестах подменяются моками.

### Task 7: Safety — рабочие часы, дневные лимиты, рандом-задержки

**Files:**
- Create: `sales-manager/lib/safety.js`
- Create: `sales-manager/test/safety.test.js`

- [ ] **Step 1: Падающий тест**

`sales-manager/test/safety.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { isWithinWorkingHours, canSendNow, nextOutboundDelay } from "../lib/safety.js";

test("isWithinWorkingHours: 10-21 Europe/Moscow", () => {
  const campaign = { working_hours_start: 10, working_hours_end: 21, timezone: "Europe/Moscow" };
  // 2026-05-21 13:00 МСК = 10:00 UTC
  const at13msk = new Date("2026-05-21T10:00:00Z").getTime();
  assert.equal(isWithinWorkingHours(at13msk, campaign), true);
  // 2026-05-21 03:00 МСК = 2026-05-21 00:00 UTC
  const at3msk = new Date("2026-05-21T00:00:00Z").getTime();
  assert.equal(isWithinWorkingHours(at3msk, campaign), false);
});

test("canSendNow проверяет дневной лимит, часовой, окно ожидания", () => {
  const campaign = { daily_message_limit: 15, working_hours_start: 10, working_hours_end: 21, timezone: "Europe/Moscow" };
  const now = new Date("2026-05-21T10:00:00Z").getTime(); // 13:00 МСК
  // Лимит дня не достигнут
  let result = canSendNow({ now, campaign, sentTodayCount: 5, sentLastHourCount: 1, lastSentAt: now - 10 * 60_000 });
  assert.equal(result.ok, true);
  // Лимит дня достигнут
  result = canSendNow({ now, campaign, sentTodayCount: 15, sentLastHourCount: 1, lastSentAt: now - 10 * 60_000 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /дневной лимит/i);
  // Часовой лимит достигнут
  result = canSendNow({ now, campaign, sentTodayCount: 5, sentLastHourCount: 3, lastSentAt: now - 10 * 60_000 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /час/i);
  // Слишком мало времени с прошлого
  result = canSendNow({ now, campaign, sentTodayCount: 5, sentLastHourCount: 1, lastSentAt: now - 60_000 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /задержк/i);
});

test("nextOutboundDelay возвращает 5-40 мин", () => {
  const rng = () => 0.5;
  const d = nextOutboundDelay(rng);
  assert.ok(d >= 5 * 60_000 && d <= 40 * 60_000);
  const dMin = nextOutboundDelay(() => 0);
  const dMax = nextOutboundDelay(() => 0.9999);
  assert.equal(dMin, 5 * 60_000);
  assert.ok(dMax <= 40 * 60_000 && dMax >= 39 * 60_000);
});
```

- [ ] **Step 2: Запустить — упадёт**

Run: `cd sales-manager && node --test test/safety.test.js`
Expected: FAIL

- [ ] **Step 3: Реализовать `sales-manager/lib/safety.js`**

```js
const MIN_OUTBOUND_DELAY_MS = 5 * 60_000;
const MAX_OUTBOUND_DELAY_MS = 40 * 60_000;
const HOURLY_FIRST_MESSAGE_LIMIT = 3;

export function hourInTimezone(ts, timezone) {
  const fmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: timezone });
  return Number(fmt.format(new Date(ts)));
}

export function dayKeyInTimezone(ts, timezone) {
  const fmt = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: timezone });
  return fmt.format(new Date(ts));
}

export function isWithinWorkingHours(ts, campaign) {
  const h = hourInTimezone(ts, campaign.timezone);
  return h >= campaign.working_hours_start && h < campaign.working_hours_end;
}

export function canSendNow({ now, campaign, sentTodayCount, sentLastHourCount, lastSentAt }) {
  if (!isWithinWorkingHours(now, campaign)) {
    return { ok: false, reason: "вне рабочих часов кампании" };
  }
  if (sentTodayCount >= campaign.daily_message_limit) {
    return { ok: false, reason: `дневной лимит ${campaign.daily_message_limit} исчерпан` };
  }
  if (sentLastHourCount >= HOURLY_FIRST_MESSAGE_LIMIT) {
    return { ok: false, reason: `часовой лимит ${HOURLY_FIRST_MESSAGE_LIMIT} исчерпан` };
  }
  if (lastSentAt && now - lastSentAt < MIN_OUTBOUND_DELAY_MS) {
    return { ok: false, reason: "минимальная задержка между сообщениями не выдержана" };
  }
  return { ok: true };
}

export function nextOutboundDelay(rng = Math.random) {
  return Math.floor(MIN_OUTBOUND_DELAY_MS + rng() * (MAX_OUTBOUND_DELAY_MS - MIN_OUTBOUND_DELAY_MS));
}

export function nextInboundReadDelay(rng = Math.random) {
  return Math.floor(30_000 + rng() * (180_000 - 30_000));
}

export function nextTypingDuration(rng = Math.random) {
  return Math.floor(2_000 + rng() * (8_000 - 2_000));
}

export const _internal = { MIN_OUTBOUND_DELAY_MS, MAX_OUTBOUND_DELAY_MS, HOURLY_FIRST_MESSAGE_LIMIT };
```

- [ ] **Step 4: Прогнать — пройти**

Run: `cd sales-manager && node --test test/safety.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```
git add sales-manager/lib/safety.js sales-manager/test/safety.test.js
git commit -m "feat(sales-manager/safety): working hours, limits, delays"
```

---

### Task 8: Safety — обнаружение бан-сигналов и unsubscribe

**Files:**
- Modify: `sales-manager/lib/safety.js`
- Create: `sales-manager/test/safety.signals.test.js`

- [ ] **Step 1: Падающий тест**

`sales-manager/test/safety.signals.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTelegramError, isUnsubscribeMessage } from "../lib/safety.js";

test("classifyTelegramError распознаёт ключевые ошибки GramJS", () => {
  assert.equal(classifyTelegramError({ errorMessage: "USER_DEACTIVATED_BAN" }).kind, "ban");
  assert.equal(classifyTelegramError({ errorMessage: "PEER_FLOOD" }).kind, "flood");
  const fw = classifyTelegramError({ errorMessage: "FLOOD_WAIT_42" });
  assert.equal(fw.kind, "flood_wait");
  assert.equal(fw.waitSec, 42);
  assert.equal(classifyTelegramError({ errorMessage: "USER_PRIVACY_RESTRICTED" }).kind, "privacy");
  assert.equal(classifyTelegramError({ errorMessage: "WHATEVER" }).kind, "unknown");
});

test("isUnsubscribeMessage ловит стоп-фразы", () => {
  assert.equal(isUnsubscribeMessage("отстань"), true);
  assert.equal(isUnsubscribeMessage("не пиши мне больше"), true);
  assert.equal(isUnsubscribeMessage("Спам!"), true);
  assert.equal(isUnsubscribeMessage("UNSUBSCRIBE"), true);
  assert.equal(isUnsubscribeMessage("Здравствуйте"), false);
  assert.equal(isUnsubscribeMessage("норм оффер, расскажи подробнее"), false);
});
```

- [ ] **Step 2: Запустить — упадёт**

- [ ] **Step 3: Добавить в `lib/safety.js`**

```js
export function classifyTelegramError(err) {
  const msg = (err?.errorMessage || err?.message || "").toUpperCase();
  if (msg.includes("USER_DEACTIVATED_BAN") || msg.includes("USER_BANNED")) return { kind: "ban" };
  if (msg.includes("PEER_FLOOD")) return { kind: "flood" };
  const fw = msg.match(/FLOOD_WAIT_(\d+)/);
  if (fw) return { kind: "flood_wait", waitSec: Number(fw[1]) };
  if (msg.includes("USER_PRIVACY_RESTRICTED") || msg.includes("CHAT_WRITE_FORBIDDEN")) return { kind: "privacy" };
  if (msg.includes("INPUT_USER_DEACTIVATED")) return { kind: "deactivated" };
  return { kind: "unknown", raw: msg };
}

const UNSUB_PATTERNS = [
  /\bотстань\b/i,
  /\bне\s*пиши\b/i,
  /\bне\s*писать\b/i,
  /\bспам\b/i,
  /\bunsubscribe\b/i,
  /\bотпис(ка|аться|ыва)/i,
  /\bжалоб[ауы]\b/i,
  /\bблокирую\b/i,
];

export function isUnsubscribeMessage(text) {
  if (!text) return false;
  return UNSUB_PATTERNS.some((re) => re.test(text));
}
```

- [ ] **Step 4: Прогнать — пройти**

- [ ] **Step 5: Commit**

```
git add sales-manager/lib/safety.js sales-manager/test/safety.signals.test.js
git commit -m "feat(sales-manager/safety): TG error classification + unsubscribe detector"
```

---

### Task 9: AI — обёртка над claude CLI

**Files:**
- Create: `sales-manager/lib/ai.js`
- Create: `sales-manager/test/ai.test.js`

Идея: `ai.js` экспортирует `askClaude({ systemPrompt, history, userMessage, runner })`. `runner` — функция, которая принимает `(args, stdinJson)` и возвращает stdout. В проде это вызов `claude` CLI, в тестах — мок.

- [ ] **Step 1: Падающий тест**

`sales-manager/test/ai.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { askClaude } from "../lib/ai.js";

test("askClaude собирает payload и парсит ответ", async () => {
  let captured = null;
  const fakeRunner = async (args, payload) => {
    captured = { args, payload };
    return JSON.stringify({ text: "fake reply", usage: { input_tokens: 100, output_tokens: 20 } });
  };
  const res = await askClaude({
    systemPrompt: "Ты продавец",
    history: [{ role: "user", content: "привет" }, { role: "assistant", content: "хай" }],
    userMessage: "сколько стоит",
    runner: fakeRunner,
  });
  assert.equal(res.text, "fake reply");
  assert.equal(res.tokensIn, 100);
  assert.equal(res.tokensOut, 20);
  assert.ok(captured.payload.includes("Ты продавец"));
  assert.ok(captured.payload.includes("сколько стоит"));
});

test("askClaude бросает понятную ошибку если CLI вернул мусор", async () => {
  const badRunner = async () => "не-json мусор";
  await assert.rejects(() => askClaude({ systemPrompt: "x", history: [], userMessage: "y", runner: badRunner }), /парсинг ответа/i);
});
```

- [ ] **Step 2: Запустить — упадёт**

- [ ] **Step 3: Реализовать `sales-manager/lib/ai.js`**

```js
import { spawn } from "node:child_process";

const CLAUDE_PATH = process.env.CLAUDE_CLI_PATH || "claude";

export async function askClaude({ systemPrompt, history = [], userMessage, runner = defaultRunner, model = "sonnet" }) {
  const payload = buildPayload({ systemPrompt, history, userMessage });
  const stdout = await runner(["-p", "--output-format", "json", "--model", model], payload);
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch (e) {
    throw new Error(`AI: парсинг ответа CLI провален: ${e.message}; raw: ${stdout.slice(0, 200)}`);
  }
  return {
    text: parsed.text ?? parsed.result ?? "",
    tokensIn: parsed.usage?.input_tokens ?? null,
    tokensOut: parsed.usage?.output_tokens ?? null,
    raw: parsed,
  };
}

function buildPayload({ systemPrompt, history, userMessage }) {
  const lines = [systemPrompt, "", "## История диалога:"];
  for (const m of history) {
    lines.push(`### ${m.role === "user" ? "Лид" : "Я"}:`);
    lines.push(m.content);
    lines.push("");
  }
  lines.push("## Новое сообщение от лида:");
  lines.push(userMessage);
  lines.push("");
  lines.push("Ответь как описано в системном промпте.");
  return lines.join("\n");
}

function defaultRunner(args, stdinPayload) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_PATH, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`claude CLI exit ${code}: ${stderr}`));
      resolve(stdout);
    });
    child.stdin.write(stdinPayload);
    child.stdin.end();
  });
}
```

- [ ] **Step 4: Прогнать — пройти**

- [ ] **Step 5: Commit**

```
git add sales-manager/lib/ai.js sales-manager/test/ai.test.js
git commit -m "feat(sales-manager/ai): claude CLI wrapper with injectable runner"
```

---

### Task 10: AI — системные промпты для outbound и inbound

**Files:**
- Create: `sales-manager/lib/prompts.js`
- Create: `sales-manager/test/prompts.test.js`

- [ ] **Step 1: Падающий тест**

`sales-manager/test/prompts.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOutboundSystemPrompt, buildInboundSystemPrompt, buildFirstMessageUserPrompt } from "../lib/prompts.js";

const campaign = {
  name: "Лендинги для коучей",
  offer_text: "Лендинг под ключ за 30к, 5 дней",
  offer_url: "https://example.com",
  target_audience: "Коучи в TG-чатах про инфобиз",
  goal_ikr: "Записаться на 15-мин созвон в Calendly",
  tone: "дружески на ты",
  stop_phrases: "не обещаем гарантий результата",
};

const lead = {
  tg_username: "vasya_coach",
  first_name: "Вася",
  source_chat_title: "Инфобиз TG",
  bio: "Помогаю коучам найти первых клиентов",
};

test("buildOutboundSystemPrompt включает оффер, ЦА, ИКР, тон и стоп-фразы", () => {
  const p = buildOutboundSystemPrompt(campaign);
  assert.match(p, /Лендинг под ключ/);
  assert.match(p, /Коучи/);
  assert.match(p, /Calendly/);
  assert.match(p, /дружески на ты/);
  assert.match(p, /не обещаем гарантий/);
});

test("buildInboundSystemPrompt добавляет инструкции по стадиям и осторожности", () => {
  const p = buildInboundSystemPrompt(campaign);
  assert.match(p, /стади/i);
  assert.match(p, /отстань|жалоб/i);
});

test("buildFirstMessageUserPrompt подставляет лида и просит JSON-ответ", () => {
  const p = buildFirstMessageUserPrompt(lead);
  assert.match(p, /vasya_coach|Вася/);
  assert.match(p, /Инфобиз TG/);
  assert.match(p, /JSON/);
});
```

- [ ] **Step 2: Запустить — упадёт**

- [ ] **Step 3: Реализовать `sales-manager/lib/prompts.js`**

```js
export function buildOutboundSystemPrompt(campaign) {
  return `Ты — личный AI-продавец Александра. Пишешь от его личного Telegram-аккаунта.

# Кампания
- Название: ${campaign.name}
- Что предлагаем: ${campaign.offer_text}
- Ссылка на оффер: ${campaign.offer_url}
- ЦА: ${campaign.target_audience}
- Идеальный конечный результат (ИКР): ${campaign.goal_ikr}
- Тон: ${campaign.tone || "дружески на ты"}
- Стоп-фразы (никогда не говори): ${campaign.stop_phrases || "—"}

# Правила
1. Не продавай в лоб. Начинай с релевантного знакомства (упомяни откуда нашёл лида).
2. Узнавай боль раньше, чем презентуешь оффер.
3. Не используй штампы «Здравствуйте, я представляю компанию».
4. Короткие сообщения (1-3 предложения), как пишет человек.
5. Не давай ссылку на оффер до того, как лид сам захотел подробностей.
6. Финал — мягкое предложение того что в ИКР.
`;
}

export function buildInboundSystemPrompt(campaign) {
  return buildOutboundSystemPrompt(campaign) + `

# Контекст входящего ответа
Лид только что ответил. Тебе нужно:
1. Понять текущую **стадию** диалога: intro | discovery | pitch | objection | closing | post_close.
2. Ответить уместно для стадии: на intro — углубить знакомство; на discovery — задавать про боль; на pitch — кратко рассказать оффер; на objection — снять; на closing — звать в ИКР.
3. Если лид написал «отстань / спам / не пиши / жалоба» — НЕ отвечай, верни специальный маркер.
4. Не отправляй ссылку на оффер пока не наступила pitch-стадия.

Ответь СТРОГО в JSON:
{
  "text": "твой ответ лиду или null если не отвечать",
  "new_stage": "intro|discovery|pitch|objection|closing|post_close",
  "intent": "reply|unsubscribe|handoff|qualified|won|lost",
  "reason": "коротко почему такое решение"
}`;
}

export function buildFirstMessageUserPrompt(lead) {
  return `Напиши первое сообщение лиду.

Профиль лида:
- Username: @${lead.tg_username || "—"}
- Имя: ${lead.first_name || "—"}${lead.last_name ? " " + lead.last_name : ""}
- Bio: ${lead.bio || "—"}
- Где нашли: ${lead.source_chat_title || "—"}

Ответь СТРОГО в JSON:
{
  "text": "первое сообщение лиду",
  "reason": "коротко зачем именно так"
}`;
}
```

- [ ] **Step 4: Прогнать — пройти**

- [ ] **Step 5: Commit**

```
git add sales-manager/lib/prompts.js sales-manager/test/prompts.test.js
git commit -m "feat(sales-manager/ai): system + first-message prompts"
```

---

### Task 11: Dialog Engine — full_auto и draft_approval

**Files:**
- Create: `sales-manager/lib/dialog-engine.js`
- Create: `sales-manager/test/dialog-engine.test.js`

- [ ] **Step 1: Падающий тест**

`sales-manager/test/dialog-engine.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideInboundAction } from "../lib/dialog-engine.js";

const baseCampaign = { mode: "full_auto" };
const baseLead = { id: 1, tg_username: "vasya" };
const baseConv = { id: 10, stage: "intro" };

function fakeAi(reply) {
  return async () => ({ text: JSON.stringify(reply), tokensIn: 10, tokensOut: 20 });
}

test("full_auto + intent=reply → send_now с обновлением стадии", async () => {
  const ai = fakeAi({ text: "ок, расскажи подробнее", new_stage: "discovery", intent: "reply", reason: "" });
  const dec = await decideInboundAction({ campaign: baseCampaign, lead: baseLead, conversation: baseConv, history: [], inboundText: "привет", askClaude: ai });
  assert.equal(dec.action, "send_now");
  assert.equal(dec.text, "ок, расскажи подробнее");
  assert.equal(dec.newStage, "discovery");
});

test("full_auto + intent=unsubscribe → mark_unsubscribed", async () => {
  const ai = fakeAi({ text: null, new_stage: "intro", intent: "unsubscribe", reason: "" });
  const dec = await decideInboundAction({ campaign: baseCampaign, lead: baseLead, conversation: baseConv, history: [], inboundText: "отстань", askClaude: ai });
  assert.equal(dec.action, "mark_unsubscribed");
});

test("draft_approval → create_draft даже если intent=reply", async () => {
  const ai = fakeAi({ text: "вариант ответа", new_stage: "discovery", intent: "reply", reason: "" });
  const dec = await decideInboundAction({ campaign: { mode: "draft_approval" }, lead: baseLead, conversation: baseConv, history: [], inboundText: "?", askClaude: ai });
  assert.equal(dec.action, "create_draft");
  assert.equal(dec.text, "вариант ответа");
});

test("safety: локальный детектор unsub перекрывает AI", async () => {
  const ai = fakeAi({ text: "вариант ответа", new_stage: "intro", intent: "reply", reason: "" });
  const dec = await decideInboundAction({ campaign: baseCampaign, lead: baseLead, conversation: baseConv, history: [], inboundText: "не пиши мне", askClaude: ai });
  assert.equal(dec.action, "mark_unsubscribed");
});
```

- [ ] **Step 2: Запустить — упадёт**

- [ ] **Step 3: Реализовать `sales-manager/lib/dialog-engine.js`**

```js
import { buildInboundSystemPrompt } from "./prompts.js";
import { isUnsubscribeMessage } from "./safety.js";

export async function decideInboundAction({ campaign, lead, conversation, history, inboundText, askClaude }) {
  // Локальный детектор unsubscribe идёт первым — не тратим токены и точно не отвечаем
  if (isUnsubscribeMessage(inboundText)) {
    return { action: "mark_unsubscribed", reason: "локальный unsubscribe-детектор" };
  }

  const system = buildInboundSystemPrompt(campaign);
  const aiHistory = history.map((m) => ({
    role: m.role === "outbound" || m.role === "human_takeover" ? "assistant" : "user",
    content: m.body,
  }));

  const res = await askClaude({ systemPrompt: system, history: aiHistory, userMessage: inboundText });
  let parsed;
  try {
    parsed = JSON.parse(res.text);
  } catch {
    return { action: "escalate_error", reason: `AI вернул не-JSON: ${res.text?.slice(0, 100)}` };
  }

  if (parsed.intent === "unsubscribe") return { action: "mark_unsubscribed", reason: parsed.reason || "" };
  if (parsed.intent === "handoff") return { action: "handoff", reason: parsed.reason || "" };

  const decision = {
    text: parsed.text,
    newStage: parsed.new_stage,
    intent: parsed.intent,
    reason: parsed.reason || "",
    tokensIn: res.tokensIn,
    tokensOut: res.tokensOut,
  };

  if (!parsed.text) return { action: "escalate_error", reason: "AI вернул пустой text" };

  if (campaign.mode === "draft_approval") {
    return { ...decision, action: "create_draft" };
  }
  if (campaign.mode === "full_auto") {
    return { ...decision, action: "send_now" };
  }
  // qualify_then_handoff и hybrid — фаза 2, пока не реализуем
  return { ...decision, action: "send_now" };
}
```

- [ ] **Step 4: Прогнать — пройти**

- [ ] **Step 5: Commit**

```
git add sales-manager/lib/dialog-engine.js sales-manager/test/dialog-engine.test.js
git commit -m "feat(sales-manager/dialog-engine): full_auto + draft_approval"
```

---

## Phase 2 — I/O: Telegram + Outbound + Inbound

### Task 12: Telegram-клиент с шарингом сессии парсера

**Files:**
- Create: `sales-manager/lib/telegram.js`
- Create: `sales-manager/test/telegram.test.js`

Идея: модуль экспортирует фабрику `createTelegramAdapter({ sessionLoader, clientFactory })` — инжектируем зависимости, чтобы тесты могли подменить GramJS целиком.

- [ ] **Step 1: Падающий тест**

`sales-manager/test/telegram.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTelegramAdapter } from "../lib/telegram.js";

test("createTelegramAdapter не подключается пока не вызван connect()", async () => {
  let connected = false;
  const fakeClient = {
    connect: async () => { connected = true; },
    sendMessage: async () => ({ id: 123 }),
    invoke: async () => null,
  };
  const adapter = createTelegramAdapter({
    sessionLoader: () => "fake-session-string",
    clientFactory: () => fakeClient,
  });
  assert.equal(connected, false);
  await adapter.connect();
  assert.equal(connected, true);
});

test("sendMessage прокидывает typing и вернёт id", async () => {
  const calls = [];
  const fakeClient = {
    connect: async () => {},
    sendMessage: async (peer, opts) => { calls.push({ peer, opts }); return { id: 999 }; },
    invoke: async (req) => { calls.push({ invoke: req.className }); return null; },
  };
  const adapter = createTelegramAdapter({
    sessionLoader: () => "x",
    clientFactory: () => fakeClient,
  });
  await adapter.connect();
  const id = await adapter.sendMessage({ peer: "vasya", text: "hello", typingMs: 0 });
  assert.equal(id, 999);
  assert.equal(calls.some((c) => c.invoke === "messages.SetTyping"), true);
  assert.equal(calls.some((c) => c.opts?.message === "hello"), true);
});

test("sendMessage кидает classified ошибку при FLOOD_WAIT", async () => {
  const fakeClient = {
    connect: async () => {},
    sendMessage: async () => { const e = new Error(); e.errorMessage = "FLOOD_WAIT_60"; throw e; },
    invoke: async () => null,
  };
  const adapter = createTelegramAdapter({ sessionLoader: () => "x", clientFactory: () => fakeClient });
  await adapter.connect();
  await assert.rejects(() => adapter.sendMessage({ peer: "x", text: "y", typingMs: 0 }), /FLOOD_WAIT/);
});
```

- [ ] **Step 2: Запустить — упадёт**

- [ ] **Step 3: Реализовать `sales-manager/lib/telegram.js`**

```js
import fs from "node:fs";
import path from "node:path";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";

const DEFAULT_SESSION_PATH = path.resolve("../parser/data/session.txt");

function defaultSessionLoader() {
  if (!fs.existsSync(DEFAULT_SESSION_PATH)) {
    throw new Error(`sessions: ${DEFAULT_SESSION_PATH} не найден — сначала залогинься в парсере`);
  }
  return fs.readFileSync(DEFAULT_SESSION_PATH, "utf8").trim();
}

function defaultClientFactory(sessionString) {
  const apiId = Number(process.env.TG_API_ID || process.env.API_ID);
  const apiHash = process.env.TG_API_HASH || process.env.API_HASH;
  if (!apiId || !apiHash) throw new Error("TG_API_ID/TG_API_HASH не заданы в env");
  return new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
    connectionRetries: 3,
    useWSS: true,
  });
}

export function createTelegramAdapter({ sessionLoader = defaultSessionLoader, clientFactory = defaultClientFactory } = {}) {
  let client = null;
  let connected = false;

  async function connect() {
    if (connected) return;
    const session = sessionLoader();
    client = clientFactory(session);
    await client.connect();
    connected = true;
  }

  async function disconnect() {
    if (client && connected) {
      try { await client.disconnect(); } catch {}
    }
    connected = false;
    client = null;
  }

  async function sendMessage({ peer, text, typingMs = 0 }) {
    if (!connected) throw new Error("telegram: connect() сначала");
    if (typingMs > 0) {
      try { await client.invoke(new Api.messages.SetTyping({ peer, action: new Api.SendMessageTypingAction() })); } catch {}
      await sleep(typingMs);
    }
    const res = await client.sendMessage(peer, { message: text });
    return res.id;
  }

  function onNewMessage(handler) {
    if (!connected) throw new Error("telegram: connect() сначала");
    client.addEventHandler(handler, new NewMessage({}));
  }

  async function getUserBio(userIdOrUsername) {
    if (!connected) throw new Error("telegram: connect() сначала");
    try {
      const full = await client.invoke(new Api.users.GetFullUser({ id: userIdOrUsername }));
      return full?.fullUser?.about ?? null;
    } catch {
      return null;
    }
  }

  function rawClient() { return client; }

  return { connect, disconnect, sendMessage, onNewMessage, getUserBio, rawClient };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
```

- [ ] **Step 4: Прогнать — пройти**

Run: `cd sales-manager && node --test test/telegram.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```
git add sales-manager/lib/telegram.js sales-manager/test/telegram.test.js
git commit -m "feat(sales-manager/telegram): GramJS adapter with shared parser session"
```

---

### Task 13: Outbound — выбор лида, AI, отправка

**Files:**
- Create: `sales-manager/lib/outbound.js`
- Create: `sales-manager/test/outbound.test.js`

- [ ] **Step 1: Падающий тест**

`sales-manager/test/outbound.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, createCampaign, addLeads, setCampaignStatus, listLeads, listEvents } from "../lib/db.js";
import { runOutboundTick } from "../lib/outbound.js";

function setup() {
  const db = openDb(":memory:");
  const cid = createCampaign(db, {
    name: "C", offer_text: "X", offer_url: "https://x", target_audience: "y", goal_ikr: "z",
  });
  setCampaignStatus(db, cid, "running");
  // mode нужен для dialog-engine, но outbound сам по себе не зависит от mode (первое сообщение — всегда AI)
  return { db, cid };
}

function fakeAi(text = "первое сообщение") {
  return async () => ({ text: JSON.stringify({ text, reason: "" }), tokensIn: 10, tokensOut: 5 });
}

function fakeTelegram({ failWith = null } = {}) {
  return {
    sendMessage: async ({ peer, text }) => {
      if (failWith) { const e = new Error(); e.errorMessage = failWith; throw e; }
      return 1000 + Math.floor(Math.random() * 1000);
    },
  };
}

test("outbound: пишет первое сообщение и переводит лида в first_sent", async () => {
  const { db, cid } = setup();
  addLeads(db, cid, [{ tg_user_id: 11, tg_username: "vasya", first_name: "Вася" }]);
  const res = await runOutboundTick({
    db,
    now: new Date("2026-05-21T10:00:00Z").getTime(), // 13:00 МСК — в рабочих часах
    askClaude: fakeAi("Привет, Вася"),
    telegram: fakeTelegram(),
    rng: () => 0.5,
  });
  assert.equal(res.sent.length, 1);
  assert.equal(res.sent[0].leadId, listLeads(db, cid)[0].id);
  assert.equal(listLeads(db, cid)[0].status, "first_sent");
  const events = listEvents(db, { campaignId: cid });
  assert.ok(events.some((e) => e.type === "sent"));
});

test("outbound: вне рабочих часов — ничего не отправляет, лид остаётся queued", async () => {
  const { db, cid } = setup();
  addLeads(db, cid, [{ tg_user_id: 11, tg_username: "vasya" }]);
  const res = await runOutboundTick({
    db,
    now: new Date("2026-05-21T00:00:00Z").getTime(), // 03:00 МСК
    askClaude: fakeAi(),
    telegram: fakeTelegram(),
    rng: () => 0.5,
  });
  assert.equal(res.sent.length, 0);
  assert.equal(res.skipped.length, 1);
  assert.equal(listLeads(db, cid)[0].status, "queued");
});

test("outbound: FLOOD_WAIT логируется как событие и останавливает тик", async () => {
  const { db, cid } = setup();
  addLeads(db, cid, [
    { tg_user_id: 11, tg_username: "v1" },
    { tg_user_id: 12, tg_username: "v2" },
  ]);
  const res = await runOutboundTick({
    db,
    now: new Date("2026-05-21T10:00:00Z").getTime(),
    askClaude: fakeAi(),
    telegram: fakeTelegram({ failWith: "FLOOD_WAIT_60" }),
    rng: () => 0.5,
  });
  assert.equal(res.sent.length, 0);
  assert.equal(res.errors.length, 1);
  const events = listEvents(db, { campaignId: cid });
  assert.ok(events.some((e) => e.type === "ban_signal"));
});

test("outbound: лид с tg_user_id в blocklist пропускается", async () => {
  const { db, cid } = setup();
  addLeads(db, cid, [{ tg_user_id: 11, tg_username: "vasya" }]);
  db.prepare("INSERT INTO leads_blocked (tg_user_id, reason, blocked_at) VALUES (?, ?, ?)").run(11, "prev campaign", Date.now());
  const res = await runOutboundTick({
    db,
    now: new Date("2026-05-21T10:00:00Z").getTime(),
    askClaude: fakeAi(),
    telegram: fakeTelegram(),
    rng: () => 0.5,
  });
  assert.equal(res.sent.length, 0);
  assert.equal(listLeads(db, cid)[0].status, "blocked");
});
```

- [ ] **Step 2: Запустить — упадёт**

- [ ] **Step 3: Реализовать `sales-manager/lib/outbound.js`**

```js
import {
  listCampaigns, getCampaign, nextLeadToContact, setLeadStatus,
  getOrCreateConversation, addMessage, isLeadBlocked, logEvent,
  countOutboundFirstMessagesSince, setCampaignStatus,
} from "./db.js";
import { canSendNow, nextOutboundDelay, nextTypingDuration, classifyTelegramError, dayKeyInTimezone } from "./safety.js";
import { buildOutboundSystemPrompt, buildFirstMessageUserPrompt } from "./prompts.js";

export async function runOutboundTick({ db, now = Date.now(), askClaude, telegram, rng = Math.random }) {
  const result = { sent: [], skipped: [], errors: [] };
  const runningCampaigns = listCampaigns(db).filter((c) => c.status === "running");

  // глобальный счётчик первых сообщений за день (по всей системе)
  const dayStart = startOfDayMs(now, "Europe/Moscow");
  const sentTodayGlobal = countOutboundFirstMessagesSince(db, dayStart);

  for (const campaign of runningCampaigns) {
    const lead = nextLeadToContact(db, campaign.id, now);
    if (!lead) { continue; }

    if (lead.tg_user_id && isLeadBlocked(db, lead.tg_user_id)) {
      setLeadStatus(db, lead.id, "blocked");
      logEvent(db, { type: "skip_blocked", campaign_id: campaign.id, lead_id: lead.id });
      result.skipped.push({ leadId: lead.id, reason: "blocklist" });
      continue;
    }

    // последний sent_at среди всех outbound у этой кампании — для проверки задержки
    const lastSent = db.prepare(`
      SELECT MAX(m.sent_at) as last FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.campaign_id = ? AND m.role = 'outbound' AND m.status = 'sent'
    `).get(campaign.id).last;
    const sentLastHour = db.prepare(`
      SELECT COUNT(*) as n FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.campaign_id = ? AND m.role = 'outbound' AND m.status = 'sent' AND m.sent_at >= ?
    `).get(campaign.id, now - 3600_000).n;

    const check = canSendNow({
      now, campaign,
      sentTodayCount: sentTodayGlobal,
      sentLastHourCount: sentLastHour,
      lastSentAt: lastSent,
    });
    if (!check.ok) {
      result.skipped.push({ leadId: lead.id, reason: check.reason });
      // сдвинуть next_action_at чтобы не долбить
      setLeadStatus(db, lead.id, "queued", now + nextOutboundDelay(rng));
      continue;
    }

    // Генерируем первое сообщение
    let aiText;
    try {
      const ai = await askClaude({
        systemPrompt: buildOutboundSystemPrompt(campaign),
        history: [],
        userMessage: buildFirstMessageUserPrompt(lead),
      });
      const parsed = JSON.parse(ai.text);
      aiText = parsed.text;
      if (!aiText) throw new Error("AI вернул пустой text");
    } catch (e) {
      logEvent(db, { type: "error", campaign_id: campaign.id, lead_id: lead.id, payload: { stage: "ai", message: e.message } });
      result.errors.push({ leadId: lead.id, error: e.message });
      setLeadStatus(db, lead.id, "queued", now + nextOutboundDelay(rng));
      continue;
    }

    const conv = getOrCreateConversation(db, lead.id, campaign.id);
    const peer = lead.tg_username || lead.tg_user_id;
    const typingMs = nextTypingDuration(rng);

    try {
      const tgMsgId = await telegram.sendMessage({ peer, text: aiText, typingMs });
      const sentAt = Date.now();
      const messageId = addMessage(db, {
        conversation_id: conv.id, role: "outbound", body: aiText,
        status: "sent", tg_message_id: tgMsgId, sent_at: sentAt,
      });
      setLeadStatus(db, lead.id, "first_sent");
      logEvent(db, { type: "sent", campaign_id: campaign.id, lead_id: lead.id, payload: { message_id: messageId } });
      result.sent.push({ leadId: lead.id, messageId });
      return result; // только один лид за тик, чтобы выдержать задержки
    } catch (e) {
      const cls = classifyTelegramError(e);
      logEvent(db, { type: "ban_signal", campaign_id: campaign.id, lead_id: lead.id, payload: { ...cls, message: e.message } });
      result.errors.push({ leadId: lead.id, error: e.message, classified: cls });
      if (cls.kind === "ban" || cls.kind === "deactivated" || cls.kind === "privacy") {
        setLeadStatus(db, lead.id, "blocked");
      } else if (cls.kind === "flood_wait" || cls.kind === "flood") {
        // авто-пауза всех кампаний
        for (const c of runningCampaigns) setCampaignStatus(db, c.id, "paused");
        return result;
      } else {
        setLeadStatus(db, lead.id, "queued", now + nextOutboundDelay(rng));
      }
    }
  }
  return result;
}

function startOfDayMs(ts, tz) {
  const key = dayKeyInTimezone(ts, tz); // YYYY-MM-DD
  // approximate — для лимита достаточно UTC midnight того дня в этом TZ
  return new Date(`${key}T00:00:00Z`).getTime();
}
```

- [ ] **Step 4: Прогнать — пройти**

Run: `cd sales-manager && node --test test/outbound.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```
git add sales-manager/lib/outbound.js sales-manager/test/outbound.test.js
git commit -m "feat(sales-manager/outbound): scheduler tick — pick lead, AI, send, safety"
```

---

### Task 14: Inbound — приём, батч-окно, обработка

**Files:**
- Create: `sales-manager/lib/inbound.js`
- Create: `sales-manager/test/inbound.test.js`

- [ ] **Step 1: Падающий тест**

`sales-manager/test/inbound.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, createCampaign, setCampaignStatus, addLeads, listLeads, getOrCreateConversation, addMessage, listMessages, listEvents, getDraftByMessage } from "../lib/db.js";
import { createInboundProcessor } from "../lib/inbound.js";

function setupFullAuto() {
  const db = openDb(":memory:");
  const cid = createCampaign(db, { name: "C", offer_text: "X", offer_url: "https://x", target_audience: "y", goal_ikr: "z" });
  db.prepare("UPDATE campaigns SET mode = 'full_auto' WHERE id = ?").run(cid);
  setCampaignStatus(db, cid, "running");
  addLeads(db, cid, [{ tg_user_id: 11, tg_username: "vasya" }]);
  const lead = listLeads(db, cid)[0];
  // эмулируем что мы уже писали лиду
  const conv = getOrCreateConversation(db, lead.id, cid);
  addMessage(db, { conversation_id: conv.id, role: "outbound", body: "hi", status: "sent", sent_at: Date.now() - 100000 });
  return { db, cid, lead, conv };
}

const fakeAiReply = async () => ({ text: JSON.stringify({ text: "конечно, расскажу", new_stage: "discovery", intent: "reply", reason: "" }), tokensIn: 10, tokensOut: 5 });

test("inbound full_auto: одно сообщение → ответ AI отправляется", async () => {
  const { db, cid, lead, conv } = setupFullAuto();
  const sent = [];
  const proc = createInboundProcessor({
    db,
    askClaude: fakeAiReply,
    telegram: { sendMessage: async ({ peer, text }) => { sent.push({ peer, text }); return 555; } },
    rng: () => 0.5,
    batchWindowMs: 50,
  });
  await proc.onInbound({ tgUserId: 11, tgUsername: "vasya", text: "привет, расскажи подробнее", tgMessageId: 1 });
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, "конечно, расскажу");
  const msgs = listMessages(db, conv.id);
  // outbound (был), inbound (1), outbound (новый ответ)
  assert.equal(msgs.length, 3);
});

test("inbound: батч-окно склеивает два быстрых входящих", async () => {
  const { db, cid, lead, conv } = setupFullAuto();
  let aiCalls = 0;
  let aiInbound = "";
  const proc = createInboundProcessor({
    db,
    askClaude: async ({ userMessage }) => { aiCalls++; aiInbound = userMessage; return await fakeAiReply(); },
    telegram: { sendMessage: async () => 555 },
    rng: () => 0.5,
    batchWindowMs: 80,
  });
  await proc.onInbound({ tgUserId: 11, tgUsername: "vasya", text: "первая часть", tgMessageId: 1 });
  await new Promise((r) => setTimeout(r, 30));
  await proc.onInbound({ tgUserId: 11, tgUsername: "vasya", text: "вторая часть", tgMessageId: 2 });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(aiCalls, 1);
  assert.match(aiInbound, /первая часть\s*\n\s*вторая часть/);
});

test("inbound draft_approval: ответ AI попадает в drafts, не отправляется", async () => {
  const { db, cid, lead, conv } = setupFullAuto();
  db.prepare("UPDATE campaigns SET mode = 'draft_approval' WHERE id = ?").run(cid);
  const sent = [];
  const alerts = [];
  const proc = createInboundProcessor({
    db,
    askClaude: fakeAiReply,
    telegram: { sendMessage: async ({ peer, text }) => { sent.push({ peer, text }); return 1; } },
    notifyAlexander: async ({ kind, payload }) => { alerts.push({ kind, payload }); return 7777; },
    rng: () => 0.5,
    batchWindowMs: 50,
  });
  await proc.onInbound({ tgUserId: 11, tgUsername: "vasya", text: "?", tgMessageId: 1 });
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(sent.length, 0);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].kind, "draft_pending");
  const msgs = listMessages(db, conv.id);
  const drafted = msgs.find((m) => m.status === "drafted" || m.status === "pending_approval");
  assert.ok(drafted);
  const d = getDraftByMessage(db, drafted.id);
  assert.equal(d.status, "waiting");
});

test("inbound: входящее от лида не из активной кампании — игнорируется", async () => {
  const { db } = setupFullAuto();
  const sent = [];
  const proc = createInboundProcessor({
    db, askClaude: fakeAiReply,
    telegram: { sendMessage: async ({ peer, text }) => { sent.push({ peer, text }); return 1; } },
    rng: () => 0.5, batchWindowMs: 30,
  });
  await proc.onInbound({ tgUserId: 999, tgUsername: "unknown", text: "hi", tgMessageId: 1 });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(sent.length, 0);
});
```

- [ ] **Step 2: Запустить — упадёт**

- [ ] **Step 3: Реализовать `sales-manager/lib/inbound.js`**

```js
import {
  listCampaigns, listLeads, getOrCreateConversation, addMessage, listMessages,
  setLeadStatus, setConversationStage, createDraft, updateMessageStatus, logEvent,
} from "./db.js";
import { decideInboundAction } from "./dialog-engine.js";
import { nextInboundReadDelay, nextTypingDuration } from "./safety.js";

export function createInboundProcessor({ db, askClaude, telegram, notifyAlexander = null, rng = Math.random, batchWindowMs = 60_000 }) {
  // in-memory: leadId → { timer, batchTexts[], lastInbound, peer }
  const buffers = new Map();

  async function onInbound({ tgUserId, tgUsername, text, tgMessageId }) {
    const found = findActiveLead({ db, tgUserId, tgUsername });
    if (!found) return; // не наш лид — молча игнорим

    const { lead, campaign } = found;
    const conv = getOrCreateConversation(db, lead.id, campaign.id);
    addMessage(db, {
      conversation_id: conv.id, role: "inbound", body: text,
      status: "received", tg_message_id: tgMessageId, received_at: Date.now(),
    });

    const peer = tgUsername || tgUserId;
    let buf = buffers.get(lead.id);
    if (!buf) {
      buf = { texts: [], peer, conv, lead, campaign };
      buffers.set(lead.id, buf);
    }
    buf.texts.push(text);

    if (buf.timer) clearTimeout(buf.timer);
    buf.timer = setTimeout(() => { processBatch(lead.id).catch((err) => {
      logEvent(db, { type: "error", lead_id: lead.id, campaign_id: campaign.id, payload: { stage: "inbound-batch", message: err.message } });
    }); }, batchWindowMs);
  }

  async function processBatch(leadId) {
    const buf = buffers.get(leadId);
    if (!buf) return;
    buffers.delete(leadId);

    const { lead, campaign, conv, peer } = buf;
    const combined = buf.texts.join("\n");
    const history = listMessages(db, conv.id).filter((m) => m.body !== combined);

    const dec = await decideInboundAction({ campaign, lead, conversation: conv, history, inboundText: combined, askClaude });

    if (dec.action === "mark_unsubscribed") {
      setLeadStatus(db, lead.id, "unsubscribed");
      logEvent(db, { type: "unsubscribed", campaign_id: campaign.id, lead_id: lead.id, payload: { reason: dec.reason } });
      return;
    }
    if (dec.action === "handoff") {
      setLeadStatus(db, lead.id, "qualified");
      logEvent(db, { type: "handoff", campaign_id: campaign.id, lead_id: lead.id, payload: { reason: dec.reason } });
      if (notifyAlexander) await notifyAlexander({ kind: "handoff", payload: { campaign, lead, reason: dec.reason } });
      return;
    }
    if (dec.action === "escalate_error") {
      logEvent(db, { type: "error", campaign_id: campaign.id, lead_id: lead.id, payload: { stage: "dialog-engine", message: dec.reason } });
      if (notifyAlexander) await notifyAlexander({ kind: "engine_error", payload: { campaign, lead, reason: dec.reason } });
      return;
    }

    if (dec.newStage) setConversationStage(db, conv.id, dec.newStage);

    if (dec.action === "create_draft") {
      const messageId = addMessage(db, {
        conversation_id: conv.id, role: "outbound", body: dec.text,
        status: "pending_approval", ai_tokens_in: dec.tokensIn, ai_tokens_out: dec.tokensOut,
      });
      const draftId = createDraft(db, messageId);
      logEvent(db, { type: "draft_created", campaign_id: campaign.id, lead_id: lead.id, payload: { message_id: messageId, draft_id: draftId } });
      if (notifyAlexander) {
        const botMsgId = await notifyAlexander({ kind: "draft_pending", payload: { campaign, lead, conv, text: dec.text, draftId, messageId } });
        if (botMsgId) db.prepare("UPDATE drafts SET telegram_bot_message_id = ? WHERE id = ?").run(botMsgId, draftId);
      }
      return;
    }

    // send_now
    if (dec.action === "send_now") {
      // имитация «читаем»: задержку даём ДО ответа AI? Лучше просто typing перед отправкой.
      const typingMs = nextTypingDuration(rng);
      try {
        const tgMsgId = await telegram.sendMessage({ peer, text: dec.text, typingMs });
        const sentAt = Date.now();
        const messageId = addMessage(db, {
          conversation_id: conv.id, role: "outbound", body: dec.text, status: "sent",
          tg_message_id: tgMsgId, sent_at: sentAt, ai_tokens_in: dec.tokensIn, ai_tokens_out: dec.tokensOut,
        });
        setLeadStatus(db, lead.id, "in_dialog");
        logEvent(db, { type: "sent", campaign_id: campaign.id, lead_id: lead.id, payload: { message_id: messageId } });
      } catch (e) {
        logEvent(db, { type: "error", campaign_id: campaign.id, lead_id: lead.id, payload: { stage: "send-reply", message: e.message } });
      }
    }
  }

  return { onInbound, _processBatchForTest: processBatch };
}

function findActiveLead({ db, tgUserId, tgUsername }) {
  const runningCampaigns = listCampaigns(db).filter((c) => c.status === "running");
  for (const campaign of runningCampaigns) {
    const sql = tgUserId
      ? "SELECT * FROM leads WHERE campaign_id = ? AND tg_user_id = ? AND status NOT IN ('unsubscribed','blocked','human_takeover') LIMIT 1"
      : "SELECT * FROM leads WHERE campaign_id = ? AND tg_username = ? AND status NOT IN ('unsubscribed','blocked','human_takeover') LIMIT 1";
    const lead = tgUserId ? db.prepare(sql).get(campaign.id, tgUserId) : db.prepare(sql).get(campaign.id, tgUsername);
    if (lead) return { lead, campaign };
  }
  return null;
}
```

- [ ] **Step 4: Прогнать — пройти**

Run: `cd sales-manager && node --test test/inbound.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```
git add sales-manager/lib/inbound.js sales-manager/test/inbound.test.js
git commit -m "feat(sales-manager/inbound): batch window + dialog-engine integration + draft alerts"
```

---

## Phase 3 — HTTP API + Worker

### Task 15: HTTP-сервер с auth middleware

**Files:**
- Create: `sales-manager/server.js`
- Create: `sales-manager/lib/auth.js`
- Create: `sales-manager/test/server.basic.test.js`

Идея: переиспользуем тот же простой auth-паттерн что в парсере (HMAC-токен в заголовке). Не импортируем напрямую — копируем реализацию в `lib/auth.js`, чтобы сервисы оставались изолированы.

- [ ] **Step 1: Падающий тест на старт сервера и health-эндпоинт**

`sales-manager/test/server.basic.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../server.js";
import { openDb } from "../lib/db.js";

test("GET /api/health возвращает ok", async () => {
  const db = openDb(":memory:");
  const app = createServer({ db, password: "test", secret: "s" });
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  server.close();
});

test("защищённый эндпоинт без токена даёт 401", async () => {
  const db = openDb(":memory:");
  const app = createServer({ db, password: "test", secret: "s" });
  const server = app.listen(0);
  const port = server.address().port;
  const res = await fetch(`http://127.0.0.1:${port}/api/campaigns`);
  assert.equal(res.status, 401);
  server.close();
});
```

- [ ] **Step 2: Запустить — упадёт**

- [ ] **Step 3: Реализовать `sales-manager/lib/auth.js`**

```js
import crypto from "node:crypto";

export function makeToken(secret, password) {
  return crypto.createHmac("sha256", secret).update(password).digest("hex");
}

export function authMiddleware({ secret, password }) {
  const valid = makeToken(secret, password);
  return (req, res, next) => {
    const t = req.headers["x-auth-token"] || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!t || t !== valid) return res.status(401).json({ error: "unauthorized" });
    next();
  };
}
```

- [ ] **Step 4: Реализовать `sales-manager/server.js`**

```js
import express from "express";
import { authMiddleware } from "./lib/auth.js";

export function createServer({ db, password, secret }) {
  const app = express();
  app.use(express.json({ limit: "5mb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  const auth = authMiddleware({ secret, password });
  app.use("/api/campaigns", auth);
  app.use("/api/leads", auth);
  app.use("/api/drafts", auth);
  app.use("/api/conversations", auth);
  app.use("/api/events", auth);

  // Placeholder routes — будут добавлены в следующих тасках
  app.get("/api/campaigns", (_req, res) => res.json([]));

  return app;
}

// Запуск
if (import.meta.url === `file://${process.argv[1]}`) {
  const dotenv = await import("dotenv");
  dotenv.config();
  const { openDb } = await import("./lib/db.js");
  const db = openDb(process.env.SM_DB_PATH || "./data/sales-manager.db");
  const password = process.env.SM_PASSWORD || "change-me";
  const secret = process.env.SM_SECRET || "change-me-secret";
  const port = Number(process.env.SM_PORT || 3001);
  const app = createServer({ db, password, secret });
  app.listen(port, () => console.log(`sales-manager server on :${port}`));
}
```

- [ ] **Step 5: Прогнать тесты — пройти**

Run: `cd sales-manager && node --test test/server.basic.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```
git add sales-manager/server.js sales-manager/lib/auth.js sales-manager/test/server.basic.test.js
git commit -m "feat(sales-manager/server): Express bootstrap + HMAC auth"
```

---

### Task 16: API — campaigns CRUD

**Files:**
- Modify: `sales-manager/server.js`
- Create: `sales-manager/test/server.campaigns.test.js`

- [ ] **Step 1: Падающий тест**

`sales-manager/test/server.campaigns.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../server.js";
import { openDb } from "../lib/db.js";
import { makeToken } from "../lib/auth.js";

async function makeApp() {
  const db = openDb(":memory:");
  const password = "p", secret = "s";
  const app = createServer({ db, password, secret });
  const server = app.listen(0);
  const port = server.address().port;
  const token = makeToken(secret, password);
  const close = () => server.close();
  const req = (method, path, body) => fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { "x-auth-token": token, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { req, close, db };
}

test("POST /api/campaigns создаёт и возвращает", async () => {
  const { req, close } = await makeApp();
  const res = await req("POST", "/api/campaigns", { name: "Test", offer_text: "X" });
  assert.equal(res.status, 201);
  const c = await res.json();
  assert.equal(c.name, "Test");
  assert.equal(c.status, "draft");
  close();
});

test("PUT /api/campaigns/:id правит поля", async () => {
  const { req, close } = await makeApp();
  const created = await (await req("POST", "/api/campaigns", { name: "T" })).json();
  const res = await req("PUT", `/api/campaigns/${created.id}`, { tone: "формально" });
  assert.equal(res.status, 200);
  const got = await (await req("GET", `/api/campaigns/${created.id}`)).json();
  assert.equal(got.tone, "формально");
  close();
});

test("DELETE архивирует, не удаляет физически", async () => {
  const { req, close } = await makeApp();
  const c = await (await req("POST", "/api/campaigns", { name: "T" })).json();
  const del = await req("DELETE", `/api/campaigns/${c.id}`);
  assert.equal(del.status, 204);
  const list = await (await req("GET", "/api/campaigns")).json();
  assert.equal(list.length, 0);
  close();
});
```

- [ ] **Step 2: Запустить — упадёт**

- [ ] **Step 3: Добавить роуты в `sales-manager/server.js`** (заменить placeholder `GET /api/campaigns`)

```js
import {
  listCampaigns, getCampaign, createCampaign, updateCampaign, setCampaignStatus,
} from "./lib/db.js";

// ... внутри createServer, после auth setup:

app.get("/api/campaigns", (req, res) => {
  const includeArchived = req.query.includeArchived === "1";
  res.json(listCampaigns(db, { includeArchived }));
});

app.get("/api/campaigns/:id", (req, res) => {
  const c = getCampaign(db, Number(req.params.id));
  if (!c) return res.status(404).json({ error: "not found" });
  res.json(c);
});

app.post("/api/campaigns", (req, res) => {
  const id = createCampaign(db, req.body || {});
  res.status(201).json(getCampaign(db, id));
});

app.put("/api/campaigns/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!getCampaign(db, id)) return res.status(404).json({ error: "not found" });
  updateCampaign(db, id, req.body || {});
  res.json(getCampaign(db, id));
});

app.delete("/api/campaigns/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!getCampaign(db, id)) return res.status(404).json({ error: "not found" });
  setCampaignStatus(db, id, "archived");
  res.status(204).end();
});
```

- [ ] **Step 4: Прогнать — пройти**

Run: `cd sales-manager && node --test test/server.campaigns.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```
git add sales-manager/server.js sales-manager/test/server.campaigns.test.js
git commit -m "feat(sales-manager/server): campaigns CRUD endpoints"
```

---

### Task 17: API — leads, start/pause, stats, drafts, conversations, events

**Files:**
- Modify: `sales-manager/server.js`
- Create: `sales-manager/test/server.endpoints.test.js`

- [ ] **Step 1: Падающий тест**

`sales-manager/test/server.endpoints.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../server.js";
import { openDb, addMessage, getOrCreateConversation, createDraft } from "../lib/db.js";
import { makeToken } from "../lib/auth.js";

async function setup() {
  const db = openDb(":memory:");
  const password = "p", secret = "s";
  const app = createServer({ db, password, secret });
  const server = app.listen(0);
  const port = server.address().port;
  const token = makeToken(secret, password);
  const req = (method, path, body) => fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { "x-auth-token": token, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const close = () => server.close();
  return { req, close, db };
}

test("POST /api/campaigns/:id/leads добавляет лидов и возвращает кол-во", async () => {
  const { req, close } = await setup();
  const c = await (await req("POST", "/api/campaigns", { name: "C" })).json();
  const res = await req("POST", `/api/campaigns/${c.id}/leads`, { leads: [{ tg_username: "v1" }, { tg_username: "v2" }] });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.inserted, 2);
  const list = await (await req("GET", `/api/campaigns/${c.id}/leads`)).json();
  assert.equal(list.length, 2);
  close();
});

test("POST start/pause меняет status", async () => {
  const { req, close } = await setup();
  const c = await (await req("POST", "/api/campaigns", { name: "C" })).json();
  await req("POST", `/api/campaigns/${c.id}/start`);
  let got = await (await req("GET", `/api/campaigns/${c.id}`)).json();
  assert.equal(got.status, "running");
  await req("POST", `/api/campaigns/${c.id}/pause`);
  got = await (await req("GET", `/api/campaigns/${c.id}`)).json();
  assert.equal(got.status, "paused");
  close();
});

test("GET /api/campaigns/:id/stats", async () => {
  const { req, close } = await setup();
  const c = await (await req("POST", "/api/campaigns", { name: "C" })).json();
  await req("POST", `/api/campaigns/${c.id}/leads`, { leads: [{ tg_username: "v" }] });
  const res = await req("GET", `/api/campaigns/${c.id}/stats`);
  assert.equal(res.status, 200);
  const s = await res.json();
  assert.equal(s.leads_total, 1);
  close();
});

test("POST /api/drafts/:id/approve меняет статус", async () => {
  const { req, close, db } = await setup();
  const c = await (await req("POST", "/api/campaigns", { name: "C" })).json();
  await req("POST", `/api/campaigns/${c.id}/leads`, { leads: [{ tg_user_id: 1, tg_username: "v" }] });
  const lead = db.prepare("SELECT id FROM leads").get();
  const conv = getOrCreateConversation(db, lead.id, c.id);
  const mid = addMessage(db, { conversation_id: conv.id, role: "outbound", body: "draft", status: "pending_approval" });
  const did = createDraft(db, mid);
  const res = await req("POST", `/api/drafts/${did}/approve`);
  assert.equal(res.status, 200);
  const fresh = db.prepare("SELECT status FROM drafts WHERE id = ?").get(did);
  assert.equal(fresh.status, "approved");
  close();
});

test("GET /api/conversations/:lead_id возвращает сообщения", async () => {
  const { req, close, db } = await setup();
  const c = await (await req("POST", "/api/campaigns", { name: "C" })).json();
  await req("POST", `/api/campaigns/${c.id}/leads`, { leads: [{ tg_username: "v" }] });
  const lead = db.prepare("SELECT id FROM leads").get();
  const conv = getOrCreateConversation(db, lead.id, c.id);
  addMessage(db, { conversation_id: conv.id, role: "outbound", body: "hi", status: "sent" });
  const res = await req("GET", `/api/conversations/${lead.id}`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.messages.length, 1);
  assert.equal(data.lead.id, lead.id);
  close();
});
```

- [ ] **Step 2: Запустить — упадёт**

- [ ] **Step 3: Добавить роуты в `server.js`**

```js
import {
  addLeads, listLeads, campaignStats, getDraft, resolveDraft, updateMessageStatus,
  getOrCreateConversation, listMessages, getLead, listEvents,
} from "./lib/db.js";

// Внутри createServer, после campaign-роутов:

app.post("/api/campaigns/:id/leads", (req, res) => {
  const id = Number(req.params.id);
  const leads = (req.body?.leads || []);
  if (!Array.isArray(leads)) return res.status(400).json({ error: "leads must be array" });
  const inserted = addLeads(db, id, leads);
  res.json({ inserted, total: listLeads(db, id).length });
});

app.get("/api/campaigns/:id/leads", (req, res) => {
  res.json(listLeads(db, Number(req.params.id), { status: req.query.status || null }));
});

app.post("/api/campaigns/:id/start", (req, res) => {
  const id = Number(req.params.id);
  if (!getCampaign(db, id)) return res.status(404).json({ error: "not found" });
  setCampaignStatus(db, id, "running");
  res.json(getCampaign(db, id));
});

app.post("/api/campaigns/:id/pause", (req, res) => {
  const id = Number(req.params.id);
  if (!getCampaign(db, id)) return res.status(404).json({ error: "not found" });
  setCampaignStatus(db, id, "paused");
  res.json(getCampaign(db, id));
});

app.get("/api/campaigns/:id/stats", (req, res) => {
  res.json(campaignStats(db, Number(req.params.id)));
});

app.post("/api/drafts/:id/approve", (req, res) => {
  const id = Number(req.params.id);
  const draft = getDraft(db, id);
  if (!draft) return res.status(404).json({ error: "not found" });
  resolveDraft(db, id, "approved");
  res.json({ ok: true, draftId: id, messageId: draft.message_id });
});

app.post("/api/drafts/:id/reject", (req, res) => {
  const id = Number(req.params.id);
  const draft = getDraft(db, id);
  if (!draft) return res.status(404).json({ error: "not found" });
  resolveDraft(db, id, "rejected");
  res.json({ ok: true });
});

app.post("/api/drafts/:id/edit", (req, res) => {
  const id = Number(req.params.id);
  const draft = getDraft(db, id);
  if (!draft) return res.status(404).json({ error: "not found" });
  const newText = String(req.body?.text || "").trim();
  if (!newText) return res.status(400).json({ error: "text required" });
  resolveDraft(db, id, "edited", newText);
  // обновляем body в messages
  db.prepare("UPDATE messages SET body = ? WHERE id = ?").run(newText, draft.message_id);
  res.json({ ok: true });
});

app.get("/api/conversations/:lead_id", (req, res) => {
  const leadId = Number(req.params.lead_id);
  const lead = getLead(db, leadId);
  if (!lead) return res.status(404).json({ error: "not found" });
  const conv = db.prepare("SELECT * FROM conversations WHERE lead_id = ?").get(leadId);
  const messages = conv ? listMessages(db, conv.id) : [];
  res.json({ lead, conversation: conv, messages });
});

app.get("/api/events", (req, res) => {
  res.json(listEvents(db, { campaignId: req.query.campaign_id ? Number(req.query.campaign_id) : null }));
});
```

- [ ] **Step 4: Прогнать — пройти**

Run: `cd sales-manager && node --test test/server.endpoints.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```
git add sales-manager/server.js sales-manager/test/server.endpoints.test.js
git commit -m "feat(sales-manager/server): leads, lifecycle, stats, drafts, conversations, events"
```

---

### Task 18: Worker — outbound tick + inbound listener

**Files:**
- Create: `sales-manager/worker.js`
- Create: `sales-manager/test/worker.test.js`

- [ ] **Step 1: Падающий тест на фабрику воркера**

`sales-manager/test/worker.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorker } from "../worker.js";
import { openDb, createCampaign, setCampaignStatus, addLeads } from "../lib/db.js";

const fakeTelegram = {
  connect: async () => {},
  disconnect: async () => {},
  sendMessage: async () => 1,
  onNewMessage: () => {},
};
const fakeAi = async () => ({ text: JSON.stringify({ text: "hi", reason: "" }), tokensIn: 1, tokensOut: 1 });

test("createWorker: tick запускает outbound", async () => {
  const db = openDb(":memory:");
  const cid = createCampaign(db, { name: "C" });
  setCampaignStatus(db, cid, "running");
  addLeads(db, cid, [{ tg_user_id: 1, tg_username: "v" }]);
  const worker = createWorker({ db, telegram: fakeTelegram, askClaude: fakeAi, tickIntervalMs: 999999 });
  await worker.start();
  await worker.runTickNow(new Date("2026-05-21T10:00:00Z").getTime());
  await worker.stop();
  const lead = db.prepare("SELECT * FROM leads").get();
  assert.equal(lead.status, "first_sent");
});
```

- [ ] **Step 2: Запустить — упадёт**

- [ ] **Step 3: Реализовать `sales-manager/worker.js`**

```js
import { runOutboundTick } from "./lib/outbound.js";
import { createInboundProcessor } from "./lib/inbound.js";

export function createWorker({ db, telegram, askClaude, notifyAlexander = null, tickIntervalMs = 60_000, batchWindowMs = 60_000 }) {
  let timer = null;
  const processor = createInboundProcessor({ db, askClaude, telegram, notifyAlexander, batchWindowMs });

  async function start() {
    await telegram.connect();
    telegram.onNewMessage(async (event) => {
      const m = event.message;
      if (!m?.message) return;
      const sender = await m.getSender();
      const tgUserId = sender?.id ? Number(sender.id) : null;
      const tgUsername = sender?.username || null;
      const tgMessageId = m.id;
      await processor.onInbound({ tgUserId, tgUsername, text: m.message, tgMessageId });
    });
    timer = setInterval(() => { tick().catch((err) => console.error("tick error:", err)); }, tickIntervalMs);
  }

  async function tick() {
    const out = await runOutboundTick({ db, askClaude, telegram });
    if (notifyAlexander) {
      for (const e of out.errors || []) {
        if (e.classified?.kind === "flood_wait" || e.classified?.kind === "flood") {
          await notifyAlexander({ kind: "auto_paused", payload: { reason: `${e.classified.kind}${e.classified.waitSec ? " " + e.classified.waitSec + "s" : ""}` } });
          break;
        }
      }
    }
  }

  async function runTickNow(now) {
    await runOutboundTick({ db, askClaude, telegram, now });
  }

  async function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    await telegram.disconnect();
  }

  return { start, stop, tick, runTickNow };
}

// Запуск
if (import.meta.url === `file://${process.argv[1]}`) {
  const dotenv = await import("dotenv");
  dotenv.config();
  const { openDb } = await import("./lib/db.js");
  const { createTelegramAdapter } = await import("./lib/telegram.js");
  const { askClaude } = await import("./lib/ai.js");
  const { createBotNotifier } = await import("./lib/bot-notifier.js");

  const db = openDb(process.env.SM_DB_PATH || "./data/sales-manager.db");
  const telegram = createTelegramAdapter();
  const notifyAlexander = createBotNotifier({
    botToken: process.env.TG_BOT_TOKEN,
    chatId: process.env.OWNER_CHAT_ID,
  });
  const worker = createWorker({ db, telegram, askClaude, notifyAlexander });
  await worker.start();
  console.log("sales-manager worker started");
  process.on("SIGINT", async () => { await worker.stop(); process.exit(0); });
}
```

- [ ] **Step 4: Создать `sales-manager/lib/bot-notifier.js`**

```js
export function createBotNotifier({ botToken, chatId }) {
  if (!botToken || !chatId) {
    return async () => null;
  }
  return async function notify({ kind, payload }) {
    const text = formatAlert(kind, payload);
    const body = {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    };
    if (kind === "draft_pending") {
      body.reply_markup = {
        inline_keyboard: [[
          { text: "✅ Отправить", callback_data: `sm:approve:${payload.draftId}` },
          { text: "✏️ Правка", callback_data: `sm:edit:${payload.draftId}` },
          { text: "⏭ Пропустить", callback_data: `sm:reject:${payload.draftId}` },
        ]],
      };
    }
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return data?.result?.message_id ?? null;
  };
}

function formatAlert(kind, payload) {
  if (kind === "draft_pending") {
    return `<b>Драфт ожидает</b>\nКампания: ${esc(payload.campaign.name)}\nЛид: @${esc(payload.lead.tg_username || "")}\n\n${esc(payload.text)}`;
  }
  if (kind === "handoff") {
    return `<b>🎯 Лид готов к handoff</b>\nКампания: ${esc(payload.campaign.name)}\nЛид: @${esc(payload.lead.tg_username || "")}\nПричина: ${esc(payload.reason || "")}`;
  }
  if (kind === "engine_error") {
    return `<b>⚠️ Ошибка dialog-engine</b>\nКампания: ${esc(payload.campaign.name)}\nЛид: @${esc(payload.lead.tg_username || "")}\n${esc(payload.reason || "")}`;
  }
  if (kind === "auto_paused") {
    return `<b>🛑 Все кампании на автопаузе</b>\nПричина: ${esc(payload.reason || "")}`;
  }
  return `<b>${esc(kind)}</b>\n${esc(JSON.stringify(payload))}`;
}
function esc(s) { return String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])); }
```

- [ ] **Step 5: Прогнать тест — пройти**

Run: `cd sales-manager && node --test test/worker.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```
git add sales-manager/worker.js sales-manager/lib/bot-notifier.js sales-manager/test/worker.test.js
git commit -m "feat(sales-manager/worker): tick + inbound listener + bot notifier"
```

---

### Task 19: ecosystem.config.cjs для PM2 (server + worker)

**Files:**
- Create: `sales-manager/ecosystem.config.cjs`

- [ ] **Step 1: Создать конфиг**

```js
module.exports = {
  apps: [
    {
      name: "agent-sales-manager-server",
      script: "./server.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      watch: false,
      env: { NODE_ENV: "production" },
    },
    {
      name: "agent-sales-manager-worker",
      script: "./worker.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      watch: false,
      env: { NODE_ENV: "production" },
    },
  ],
};
```

- [ ] **Step 2: Создать `sales-manager/.env.example`**

```
SM_PORT=3001
SM_DB_PATH=./data/sales-manager.db
SM_PASSWORD=change-me
SM_SECRET=change-me-secret
TG_API_ID=12345
TG_API_HASH=abcdef
TG_BOT_TOKEN=12345:bot-token-here
OWNER_CHAT_ID=123456789
CLAUDE_CLI_PATH=C:\\Users\\Administrator\\.vscode\\extensions\\anthropic.claude-code-2.1.143-win32-x64\\resources\\native-binary\\claude.exe
```

- [ ] **Step 3: Commit**

```
git add sales-manager/ecosystem.config.cjs sales-manager/.env.example
git commit -m "chore(sales-manager): PM2 ecosystem + .env.example"
```

---

## Phase 4 — Bot integration (@flash_gideon_bot)

### Task 20: bot/sales-menu.js — команда /sales + меню

**Files:**
- Create: `bot/sales-menu.js`
- Modify: `bot/index.js` (подключение модуля)

> Не пишем юнит-тесты для grammy-обработчиков (паттерн в существующем боте такой же). Тестируем руками через бот.

- [ ] **Step 1: Создать `bot/sales-menu.js` — каркас и команда `/sales`**

```js
import { InlineKeyboard } from "grammy";

const API_BASE = process.env.SM_API_BASE || "http://127.0.0.1:3001/api";
const API_PASSWORD = process.env.SM_PASSWORD || "change-me";
const API_SECRET = process.env.SM_SECRET || "change-me-secret";

import crypto from "node:crypto";
const AUTH_TOKEN = crypto.createHmac("sha256", API_SECRET).update(API_PASSWORD).digest("hex");

async function api(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "x-auth-token": AUTH_TOKEN, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API ${method} ${path}: ${res.status}`);
  if (res.status === 204) return null;
  return res.json();
}

export function registerSalesMenu(bot, { ownerChatId }) {
  bot.command("sales", async (ctx) => {
    if (String(ctx.chat.id) !== String(ownerChatId)) return;
    const kb = new InlineKeyboard()
      .text("➕ Новая кампания", "sm:new").row()
      .text("📋 Мои кампании", "sm:list").row()
      .text("📊 Статус", "sm:status");
    await ctx.reply("Sales Manager — что делаем?", { reply_markup: kb });
  });

  bot.callbackQuery(/^sm:list$/, async (ctx) => {
    const list = await api("GET", "/campaigns");
    if (!list.length) { await ctx.answerCallbackQuery(); await ctx.reply("Кампаний пока нет."); return; }
    const text = list.map((c) => `<b>${esc(c.name)}</b> · ${c.status} · ${c.mode || "—"}`).join("\n");
    await ctx.answerCallbackQuery();
    await ctx.reply(text, { parse_mode: "HTML" });
  });

  bot.callbackQuery(/^sm:status$/, async (ctx) => {
    const list = await api("GET", "/campaigns");
    const running = list.filter((c) => c.status === "running").length;
    await ctx.answerCallbackQuery();
    await ctx.reply(`Активных кампаний: ${running} из ${list.length}`);
  });

  // мастер брифинга — Task 21
  // драфт-кнопки — Task 22
}

function esc(s) { return String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])); }
```

- [ ] **Step 2: Подключить в `bot/index.js`**

Найти место где регистрируются другие модули меню (например `parser-menu.js`) и добавить рядом:

```js
import { registerSalesMenu } from "./sales-menu.js";
// ...
registerSalesMenu(bot, { ownerChatId: process.env.OWNER_CHAT_ID });
```

- [ ] **Step 3: Smoke руками**

Run: перезапустить бот (`pm2 restart agent-bot` или из start-bot.bat).
В Telegram: написать `/sales` боту.
Expected: появляется меню с тремя кнопками.

- [ ] **Step 4: Commit**

```
git add bot/sales-menu.js bot/index.js
git commit -m "feat(bot): sales-menu skeleton — /sales command + list/status"
```

---

### Task 21: Бот — мастер брифинга + выбор режима + старт

**Files:**
- Modify: `bot/sales-menu.js`

- [ ] **Step 1: Добавить state machine для брифинга**

Добавить в `bot/sales-menu.js` (поверх существующего, не заменять):

```js
const wizards = new Map(); // chatId → { step, data }

const FIELDS = [
  { key: "name", q: "Как назовём кампанию?" },
  { key: "offer_text", q: "Что предлагаем и в чём суть?" },
  { key: "offer_url", q: "Ссылка на оффер (сайт / прайс)?" },
  { key: "target_audience", q: "Кто эти лиды, по какой боли мы попадаем?" },
  { key: "goal_ikr", q: "Идеальный конечный результат — что считаем закрытием?" },
  { key: "tone", q: "Тон? (можно пропустить — введи `-`)", optional: true },
  { key: "stop_phrases", q: "Стоп-фразы — чего точно не говорим? (`-` если пропустить)", optional: true },
];
```

И в `registerSalesMenu`:

```js
  bot.callbackQuery(/^sm:new$/, async (ctx) => {
    wizards.set(ctx.chat.id, { step: 0, data: {} });
    await ctx.answerCallbackQuery();
    await ctx.reply(FIELDS[0].q);
  });

  bot.on("message:text", async (ctx, next) => {
    const w = wizards.get(ctx.chat.id);
    if (!w) return next();
    const field = FIELDS[w.step];
    let val = ctx.message.text.trim();
    if (field.optional && val === "-") val = null;
    w.data[field.key] = val;
    w.step++;
    if (w.step < FIELDS.length) {
      await ctx.reply(FIELDS[w.step].q);
      return;
    }
    // готово — показываем саммари и спрашиваем подтверждение
    wizards.delete(ctx.chat.id);
    const summary = FIELDS.map((f) => `<b>${esc(f.q)}</b>\n${esc(w.data[f.key] || "—")}`).join("\n\n");
    const created = await api("POST", "/campaigns", w.data);
    const kb = new InlineKeyboard()
      .text("🤖 Полная автономия", `sm:mode:${created.id}:full_auto`).row()
      .text("✋ Драфты на одобрение", `sm:mode:${created.id}:draft_approval`);
    await ctx.reply(`<b>Кампания создана</b>\n\n${summary}\n\nВыбери режим:`, { parse_mode: "HTML", reply_markup: kb });
  });

  bot.callbackQuery(/^sm:mode:(\d+):(\w+)$/, async (ctx) => {
    const [, id, mode] = ctx.match;
    await api("PUT", `/campaigns/${id}`, { mode });
    await ctx.answerCallbackQuery();
    const kb = new InlineKeyboard()
      .text("📥 Загрузить лидов", `sm:leads:${id}`).row()
      .text("🚀 Запустить", `sm:start:${id}`);
    await ctx.reply(`Режим: ${mode}. Что дальше?`, { reply_markup: kb });
  });

  bot.callbackQuery(/^sm:start:(\d+)$/, async (ctx) => {
    const id = ctx.match[1];
    await api("POST", `/campaigns/${id}/start`);
    await ctx.answerCallbackQuery();
    await ctx.reply(`🚀 Кампания #${id} запущена.`);
  });
```

- [ ] **Step 2: Smoke руками**

В TG: `/sales` → `➕ Новая кампания` → пройти 7 вопросов → выбрать режим → запустить.
Expected: видишь подтверждение создания и подтверждение запуска. В БД появилась запись.

- [ ] **Step 3: Commit**

```
git add bot/sales-menu.js
git commit -m "feat(bot/sales-menu): brief wizard + mode selection + start"
```

---

### Task 22: Бот — загрузка лидов (вручную списком) + кнопки драфтов

> **Уточнение MVP-скоупа (отступление от спеки §5.4):** этот таск реализует только **manual**-загрузку (список юзернеймов в чат с ботом). Импорт из парсера через HTTP и парсинг CSV — переносятся в фазу 2 как отдельные таски. Причина: для первой кампании 10-20 лидов проще ввести руками, а оба других пути требуют интеграции (HTTP к parser API, мульти-форматный CSV-парсер). MVP не блокируется.

**Files:**
- Modify: `bot/sales-menu.js`

- [ ] **Step 1: Добавить обработчик `sm:leads:<id>`**

```js
  bot.callbackQuery(/^sm:leads:(\d+)$/, async (ctx) => {
    const id = ctx.match[1];
    const kb = new InlineKeyboard()
      .text("Из парсера", `sm:leads:${id}:parser`).row()
      .text("CSV-файл", `sm:leads:${id}:csv`).row()
      .text("Списком вручную", `sm:leads:${id}:manual`);
    await ctx.answerCallbackQuery();
    await ctx.reply("Откуда лидов?", { reply_markup: kb });
  });

  bot.callbackQuery(/^sm:leads:(\d+):manual$/, async (ctx) => {
    const id = ctx.match[1];
    wizards.set(ctx.chat.id, { mode: "manual_leads", campaignId: Number(id) });
    await ctx.answerCallbackQuery();
    await ctx.reply("Пришли список юзернеймов через запятую или пробел (`@vasya @petya`):");
  });

  // расширяем существующий message:text обработчик: добавить ветку для manual_leads
  // (внутри bot.on("message:text", ...) ДО обращения к FIELDS[w.step]):
  // if (w.mode === "manual_leads") { ... обработка списка ... return; }
```

Полная новая версия `bot.on("message:text", ...)`:

```js
  bot.on("message:text", async (ctx, next) => {
    const w = wizards.get(ctx.chat.id);
    if (!w) return next();

    if (w.mode === "manual_leads") {
      wizards.delete(ctx.chat.id);
      const usernames = ctx.message.text.split(/[\s,]+/).map((s) => s.replace(/^@/, "")).filter(Boolean);
      const leads = usernames.map((u) => ({ tg_username: u }));
      const res = await api("POST", `/campaigns/${w.campaignId}/leads`, { leads });
      await ctx.reply(`Добавлено лидов: ${res.inserted}. Всего в кампании: ${res.total}.`);
      return;
    }

    // прежняя логика брифинга (FIELDS)
    const field = FIELDS[w.step];
    let val = ctx.message.text.trim();
    if (field.optional && val === "-") val = null;
    w.data[field.key] = val;
    w.step++;
    if (w.step < FIELDS.length) {
      await ctx.reply(FIELDS[w.step].q);
      return;
    }
    wizards.delete(ctx.chat.id);
    // ... остаток как был в Task 21
  });
```

- [ ] **Step 2: Добавить обработчики драфт-кнопок**

```js
  bot.callbackQuery(/^sm:approve:(\d+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    const res = await api("POST", `/drafts/${draftId}/approve`);
    await ctx.answerCallbackQuery({ text: "Одобрено — будет отправлено воркером" });
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
  });

  bot.callbackQuery(/^sm:reject:(\d+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    await api("POST", `/drafts/${draftId}/reject`);
    await ctx.answerCallbackQuery({ text: "Пропущено" });
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
  });

  bot.callbackQuery(/^sm:edit:(\d+)$/, async (ctx) => {
    const draftId = ctx.match[1];
    wizards.set(ctx.chat.id, { mode: "edit_draft", draftId: Number(draftId) });
    await ctx.answerCallbackQuery();
    await ctx.reply("Пришли свой текст — отправлю его вместо AI-варианта:");
  });
```

И ветка в `message:text` для `edit_draft`:

```js
    if (w.mode === "edit_draft") {
      wizards.delete(ctx.chat.id);
      await api("POST", `/drafts/${w.draftId}/edit`, { text: ctx.message.text });
      await ctx.reply("Готово — отредактированный текст отправлен.");
      return;
    }
```

> **Важное замечание про режим draft_approval:** воркер сейчас НЕ отслеживает что драфт одобрен — он только создаёт. Нужно добавить в `worker.js` периодический tick по `drafts where status='approved' and not yet sent`. Это сделаем в Task 23.

- [ ] **Step 3: Smoke руками**

Создать кампанию в режиме `draft_approval`, добавить 1 свой второй TG-аккаунт лидом, запустить. Когда придёт драфт в бот — нажать кнопки.

- [ ] **Step 4: Commit**

```
git add bot/sales-menu.js
git commit -m "feat(bot/sales-menu): leads loading (manual) + draft action buttons"
```

---

### Task 23: Worker — обработка одобренных драфтов

**Files:**
- Modify: `sales-manager/worker.js`
- Modify: `sales-manager/lib/outbound.js` (новая функция `processApprovedDrafts`)
- Create: `sales-manager/test/drafts.process.test.js`

- [ ] **Step 1: Падающий тест**

`sales-manager/test/drafts.process.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, createCampaign, setCampaignStatus, addLeads, listLeads, getOrCreateConversation, addMessage, createDraft, resolveDraft, listMessages } from "../lib/db.js";
import { processApprovedDrafts } from "../lib/outbound.js";

test("processApprovedDrafts: отправляет одобренные, обновляет статусы", async () => {
  const db = openDb(":memory:");
  const cid = createCampaign(db, { name: "C" });
  db.prepare("UPDATE campaigns SET mode = 'draft_approval' WHERE id = ?").run(cid);
  setCampaignStatus(db, cid, "running");
  addLeads(db, cid, [{ tg_user_id: 11, tg_username: "v" }]);
  const lead = listLeads(db, cid)[0];
  const conv = getOrCreateConversation(db, lead.id, cid);
  const mid = addMessage(db, { conversation_id: conv.id, role: "outbound", body: "draft text", status: "pending_approval" });
  const did = createDraft(db, mid);
  resolveDraft(db, did, "approved");

  const sent = [];
  const tg = { sendMessage: async ({ peer, text }) => { sent.push({ peer, text }); return 999; } };
  await processApprovedDrafts({ db, telegram: tg, rng: () => 0.5 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, "draft text");
  const msg = db.prepare("SELECT * FROM messages WHERE id = ?").get(mid);
  assert.equal(msg.status, "sent");
});

test("processApprovedDrafts: edited используется human_edit_text", async () => {
  const db = openDb(":memory:");
  const cid = createCampaign(db, { name: "C" });
  setCampaignStatus(db, cid, "running");
  addLeads(db, cid, [{ tg_user_id: 11, tg_username: "v" }]);
  const lead = listLeads(db, cid)[0];
  const conv = getOrCreateConversation(db, lead.id, cid);
  const mid = addMessage(db, { conversation_id: conv.id, role: "outbound", body: "ai version", status: "pending_approval" });
  const did = createDraft(db, mid);
  // симуляция edit-флоу: body уже обновлён в server.js на новый текст
  db.prepare("UPDATE messages SET body = ? WHERE id = ?").run("human version", mid);
  resolveDraft(db, did, "edited", "human version");

  const sent = [];
  const tg = { sendMessage: async ({ peer, text }) => { sent.push({ peer, text }); return 999; } };
  await processApprovedDrafts({ db, telegram: tg, rng: () => 0.5 });
  assert.equal(sent[0].text, "human version");
});
```

- [ ] **Step 2: Запустить — упадёт**

- [ ] **Step 3: Добавить в `sales-manager/lib/outbound.js`**

```js
import { updateMessageStatus, getOrCreateConversation, setLeadStatus, logEvent, getLead } from "./db.js";
// (некоторые уже импортированы — не дублируйте)

export async function processApprovedDrafts({ db, telegram, rng = Math.random }) {
  const rows = db.prepare(`
    SELECT d.id as draft_id, d.status as draft_status, m.id as message_id, m.body, m.conversation_id, c.lead_id, c.campaign_id
    FROM drafts d
    JOIN messages m ON m.id = d.message_id
    JOIN conversations c ON c.id = m.conversation_id
    WHERE d.status IN ('approved', 'edited') AND m.status = 'pending_approval'
  `).all();

  for (const r of rows) {
    const lead = getLead(db, r.lead_id);
    const peer = lead.tg_username || lead.tg_user_id;
    const typingMs = nextTypingDuration(rng);
    try {
      const tgMsgId = await telegram.sendMessage({ peer, text: r.body, typingMs });
      const sentAt = Date.now();
      updateMessageStatus(db, r.message_id, "sent", { sent_at: sentAt, tg_message_id: tgMsgId });
      setLeadStatus(db, lead.id, "in_dialog");
      logEvent(db, { type: "sent", campaign_id: r.campaign_id, lead_id: lead.id, payload: { message_id: r.message_id, source: "draft" } });
    } catch (e) {
      logEvent(db, { type: "error", campaign_id: r.campaign_id, lead_id: lead.id, payload: { stage: "send-approved-draft", message: e.message } });
    }
  }
}
```

- [ ] **Step 4: Подключить в `worker.js`**

В функции `tick`:

```js
  async function tick() {
    await runOutboundTick({ db, askClaude, telegram });
    await processApprovedDrafts({ db, telegram });
  }
```

И импорт сверху:

```js
import { runOutboundTick, processApprovedDrafts } from "./lib/outbound.js";
```

- [ ] **Step 5: Прогнать тест — пройти**

Run: `cd sales-manager && node --test test/drafts.process.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```
git add sales-manager/lib/outbound.js sales-manager/worker.js sales-manager/test/drafts.process.test.js
git commit -m "feat(sales-manager): worker processes approved/edited drafts"
```

---

## Phase 5 — Web UI (расширение parser/public)

> UI расширяет фронт парсера. Все запросы идут на эндпоинты `/api/sales/*`, которые проксируются Vercel-rewrites на `https://sales.138-16-178-94.nip.io/api/*` (см. Phase 6 deploy).

### Task 24: parser/public — вкладка «Sales Manager» (список кампаний)

**Files:**
- Create: `parser/public/sales.html`
- Create: `parser/public/sales.js`
- Modify: `parser/public/index.html` (добавить ссылку на sales.html в навигацию, если она есть)

- [ ] **Step 1: Создать `parser/public/sales.html`**

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Sales Manager — Кампании</title>
<link rel="stylesheet" href="./style.css">
<style>
  .campaign-card { border: 1px solid var(--border, #ccc); padding: 1em; margin: 0.5em 0; border-radius: 6px; }
  .campaign-card .meta { color: #888; font-size: 0.9em; }
  .status-running { color: green; }
  .status-paused { color: orange; }
  .status-draft { color: #888; }
</style>
</head>
<body>
  <header>
    <h1>Sales Manager</h1>
    <nav><a href="./index.html">Парсер</a> · <a href="./sales.html">Кампании</a></nav>
  </header>
  <main>
    <div id="auth-section" hidden>
      <input id="pwd" type="password" placeholder="Пароль">
      <button id="login">Войти</button>
    </div>
    <div id="campaigns-section" hidden>
      <div id="campaigns-list"></div>
    </div>
  </main>
  <script src="./sales.js"></script>
</body>
</html>
```

- [ ] **Step 2: Создать `parser/public/sales.js`**

```js
const API_BASE = "/api/sales";
const TOKEN_KEY = "sales_token";

async function api(method, path, body) {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "x-auth-token": token, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { showLogin(); throw new Error("unauthorized"); }
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
  if (res.status === 204) return null;
  return res.json();
}

async function deriveToken(password) {
  // Должен совпадать с server-side HMAC.
  // Для UI: храним сразу токен (полученный из бота через /sales — или вычисленный на бэке через POST /api/auth)
  // Здесь упростим: пароль = токен в dev. Для prod добавим POST /api/auth в Task 25.
  return password;
}

async function loadCampaigns() {
  const list = await api("GET", "/campaigns");
  const root = document.getElementById("campaigns-list");
  root.innerHTML = list.map(renderCard).join("") || "<p>Кампаний нет.</p>";
  for (const c of list) {
    document.getElementById(`pause-${c.id}`)?.addEventListener("click", async () => {
      await api("POST", `/campaigns/${c.id}/${c.status === "running" ? "pause" : "start"}`);
      loadCampaigns();
    });
  }
}

function renderCard(c) {
  return `<div class="campaign-card">
    <h3>${escapeHtml(c.name)}</h3>
    <div class="meta">
      Статус: <span class="status-${c.status}">${c.status}</span> ·
      Режим: ${c.mode || "—"}
    </div>
    <div>
      <a href="./sales-campaign.html?id=${c.id}">Открыть</a>
      <button id="pause-${c.id}">${c.status === "running" ? "Пауза" : "Запустить"}</button>
    </div>
  </div>`;
}

function showLogin() {
  document.getElementById("auth-section").hidden = false;
  document.getElementById("campaigns-section").hidden = true;
}
function showMain() {
  document.getElementById("auth-section").hidden = true;
  document.getElementById("campaigns-section").hidden = false;
  loadCampaigns();
}
function escapeHtml(s) { return String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c])); }

document.getElementById("login").addEventListener("click", async () => {
  const pwd = document.getElementById("pwd").value;
  const token = await deriveToken(pwd);
  localStorage.setItem(TOKEN_KEY, token);
  showMain();
});

if (localStorage.getItem(TOKEN_KEY)) showMain(); else showLogin();
```

- [ ] **Step 3: Smoke в браузере**

После деплоя (Phase 6) — открыть `https://gideon-bay.vercel.app/sales.html`, войти, увидеть список. Сейчас можно проверить локально: открыть `parser/public/sales.html` через `npm run dev` парсера и временно поставить `API_BASE = "http://localhost:3001/api"`.

- [ ] **Step 4: Commit**

```
git add parser/public/sales.html parser/public/sales.js
git commit -m "feat(ui): sales campaigns list page"
```

---

### Task 25: API — выдача токена по паролю (для веб-UI)

**Files:**
- Modify: `sales-manager/server.js`
- Create: `sales-manager/test/server.auth.test.js`

Проблема Task 24: UI хранит «токен», но не знает как его получить из пароля. Добавим эндпоинт `POST /api/auth` который принимает пароль и возвращает токен.

- [ ] **Step 1: Падающий тест**

`sales-manager/test/server.auth.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../server.js";
import { openDb } from "../lib/db.js";
import { makeToken } from "../lib/auth.js";

async function setup() {
  const db = openDb(":memory:");
  const app = createServer({ db, password: "p", secret: "s" });
  const server = app.listen(0);
  const port = server.address().port;
  return { close: () => server.close(), port };
}

test("POST /api/auth с правильным паролем возвращает токен", async () => {
  const { close, port } = await setup();
  const res = await fetch(`http://127.0.0.1:${port}/api/auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "p" }),
  });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.token, makeToken("s", "p"));
  close();
});

test("POST /api/auth с неправильным паролем → 401", async () => {
  const { close, port } = await setup();
  const res = await fetch(`http://127.0.0.1:${port}/api/auth`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "wrong" }),
  });
  assert.equal(res.status, 401);
  close();
});
```

- [ ] **Step 2: Запустить — упадёт**

- [ ] **Step 3: Добавить в `server.js`**

```js
import { makeToken } from "./lib/auth.js";

// в createServer, ПЕРЕД auth middleware:
app.post("/api/auth", (req, res) => {
  if (req.body?.password !== password) return res.status(401).json({ error: "bad password" });
  res.json({ token: makeToken(secret, password) });
});
```

- [ ] **Step 4: Обновить `parser/public/sales.js` — функция `deriveToken`**

```js
async function deriveToken(password) {
  const res = await fetch(`${API_BASE}/auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new Error("bad password");
  const j = await res.json();
  return j.token;
}
```

- [ ] **Step 5: Прогнать — пройти**

- [ ] **Step 6: Commit**

```
git add sales-manager/server.js sales-manager/test/server.auth.test.js parser/public/sales.js
git commit -m "feat(sales-manager): POST /api/auth for web UI token derivation"
```

---

### Task 26: parser/public — страница деталей кампании (3 таба)

**Files:**
- Create: `parser/public/sales-campaign.html`
- Create: `parser/public/sales-campaign.js`

- [ ] **Step 1: Создать `parser/public/sales-campaign.html`**

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>Кампания — Sales Manager</title>
<link rel="stylesheet" href="./style.css">
<style>
  .tabs { display: flex; gap: 1em; border-bottom: 1px solid #ccc; margin-bottom: 1em; }
  .tab { padding: 0.5em 1em; cursor: pointer; }
  .tab.active { border-bottom: 2px solid #007acc; font-weight: bold; }
  .field { margin: 0.5em 0; }
  .field label { display: block; font-weight: bold; color: #555; }
  .field textarea, .field input { width: 100%; padding: 0.4em; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: 0.4em; border-bottom: 1px solid #eee; text-align: left; }
</style>
</head>
<body>
  <header>
    <h1 id="campaign-title">Кампания</h1>
    <a href="./sales.html">← Все кампании</a>
  </header>
  <main>
    <div class="tabs">
      <div class="tab active" data-tab="brief">Бриф</div>
      <div class="tab" data-tab="leads">Лиды</div>
      <div class="tab" data-tab="stats">Метрики</div>
    </div>
    <section id="tab-brief"></section>
    <section id="tab-leads" hidden></section>
    <section id="tab-stats" hidden></section>
  </main>
  <script src="./sales-campaign.js"></script>
</body>
</html>
```

- [ ] **Step 2: Создать `parser/public/sales-campaign.js`**

```js
const API_BASE = "/api/sales";
const TOKEN_KEY = "sales_token";
const cid = Number(new URLSearchParams(location.search).get("id"));

async function api(method, path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "x-auth-token": localStorage.getItem(TOKEN_KEY), "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) { location.href = "./sales.html"; throw new Error("unauthorized"); }
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
  return res.status === 204 ? null : res.json();
}

function esc(s) { return String(s ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c])); }

const FIELDS = [
  ["name", "Название", "input"],
  ["offer_text", "Оффер", "textarea"],
  ["offer_url", "Ссылка на оффер", "input"],
  ["target_audience", "ЦА", "textarea"],
  ["goal_ikr", "ИКР", "textarea"],
  ["tone", "Тон", "input"],
  ["stop_phrases", "Стоп-фразы", "textarea"],
  ["daily_message_limit", "Дневной лимит", "input"],
];

async function renderBrief() {
  const c = await api("GET", `/campaigns/${cid}`);
  document.getElementById("campaign-title").textContent = c.name;
  const root = document.getElementById("tab-brief");
  root.innerHTML = FIELDS.map(([k, label, type]) => `
    <div class="field">
      <label>${esc(label)}</label>
      ${type === "textarea" ? `<textarea data-key="${k}" rows="3">${esc(c[k] ?? "")}</textarea>` : `<input data-key="${k}" value="${esc(c[k] ?? "")}">`}
    </div>
  `).join("") + `<button id="save-brief">Сохранить</button>`;
  document.getElementById("save-brief").addEventListener("click", async () => {
    const patch = {};
    for (const el of root.querySelectorAll("[data-key]")) {
      patch[el.dataset.key] = el.value;
    }
    patch.daily_message_limit = Number(patch.daily_message_limit) || 15;
    await api("PUT", `/campaigns/${cid}`, patch);
    alert("Сохранено");
  });
}

async function renderLeads() {
  const leads = await api("GET", `/campaigns/${cid}/leads`);
  const root = document.getElementById("tab-leads");
  root.innerHTML = `<table><thead><tr><th>Username</th><th>Имя</th><th>Статус</th><th>Источник</th></tr></thead><tbody>
    ${leads.map((l) => `<tr><td>@${esc(l.tg_username || "")}</td><td>${esc(l.first_name || "")}</td><td>${esc(l.status)}</td><td>${esc(l.source_chat_title || "")}</td></tr>`).join("")}
  </tbody></table>`;
}

async function renderStats() {
  const s = await api("GET", `/campaigns/${cid}/stats`);
  const root = document.getElementById("tab-stats");
  root.innerHTML = `
    <div>Всего лидов: <b>${s.leads_total}</b></div>
    <div>Отправлено: <b>${s.messages_outbound}</b></div>
    <div>Ответили: <b>${s.messages_inbound}</b></div>
    <h3>По статусам</h3>
    <ul>${Object.entries(s.leads_by_status).map(([k, v]) => `<li>${esc(k)}: ${v}</li>`).join("")}</ul>
  `;
}

function activateTab(name) {
  for (const t of document.querySelectorAll(".tab")) t.classList.toggle("active", t.dataset.tab === name);
  document.getElementById("tab-brief").hidden = name !== "brief";
  document.getElementById("tab-leads").hidden = name !== "leads";
  document.getElementById("tab-stats").hidden = name !== "stats";
  if (name === "brief") renderBrief();
  if (name === "leads") renderLeads();
  if (name === "stats") renderStats();
}
for (const t of document.querySelectorAll(".tab")) t.addEventListener("click", () => activateTab(t.dataset.tab));
activateTab("brief");
```

- [ ] **Step 3: Smoke в браузере**

Открыть `sales.html` → клик «Открыть» на карточке → видишь 3 таба. Бриф редактируется, лиды видны, метрики считаются.

- [ ] **Step 4: Commit**

```
git add parser/public/sales-campaign.html parser/public/sales-campaign.js
git commit -m "feat(ui): sales campaign detail with brief/leads/stats tabs"
```

---

## Phase 6 — Deploy + Smoke

### Task 27: Vercel rewrite для `/api/sales/*`

**Files:**
- Modify: `vercel.json` (в корне репозитория)

- [ ] **Step 1: Прочитать текущий `vercel.json`**

Run: открыть файл, посмотреть существующий блок rewrites.

- [ ] **Step 2: Добавить rewrite перед существующим парсерским**

```json
{
  "rewrites": [
    {
      "source": "/api/sales/:path*",
      "destination": "https://sales.138-16-178-94.nip.io/api/:path*"
    },
    {
      "source": "/api/:path*",
      "destination": "https://parser.138-16-178-94.nip.io/api/:path*"
    }
  ]
}
```

> **Важно:** правило `/api/sales/*` должно быть ВЫШЕ общего `/api/*`, иначе перехватит парсерский api.

- [ ] **Step 3: Commit + push**

```
git add vercel.json
git commit -m "chore(vercel): rewrite /api/sales/* to sales.138-16-178-94.nip.io"
git push
```

Vercel автоматически передеплоит. Smoke: `https://gideon-bay.vercel.app/sales.html` должен работать после деплоя бэка.

---

### Task 28: Caddy блок для sales.138-16-178-94.nip.io

**Files:**
- Modify: `C:\Users\Administrator\projects\voice-input\Caddyfile`

- [ ] **Step 1: Открыть Caddyfile, найти блок парсера**

- [ ] **Step 2: Добавить ниже блок sales-manager**

```
sales.138-16-178-94.nip.io {
  reverse_proxy localhost:3001
}
```

- [ ] **Step 3: Перезапустить Caddy**

Run: `caddy reload --config C:\Users\Administrator\projects\voice-input\Caddyfile`
Expected: «successfully reloaded», новый сертификат Let's Encrypt получен автоматически.

- [ ] **Step 4: Smoke**

Run: `curl https://sales.138-16-178-94.nip.io/api/health`
Expected: `{"ok":true}`

- [ ] **Step 5: Commit (Caddyfile в другом репо, ОК если просто записать в memory)**

Если Caddyfile под git — commit. Если нет — добавить запись в `memory/2026-05-21.md` про изменение конфига.

---

### Task 29: PM2 — запуск двух новых процессов + автозапуск

**Files:**
- Modify: `C:\Users\Administrator\.agent\start-bot.bat` (или соответствующий стартер)

- [ ] **Step 1: Создать `.env` в sales-manager/**

Скопировать `sales-manager/.env.example` в `sales-manager/.env`, заполнить реальные значения (особенно TG_API_ID/HASH из MEMORY: они же что у парсера, OWNER_CHAT_ID Александра).

- [ ] **Step 2: Запустить PM2-процессы**

Run:
```
cd C:\Users\Administrator\Documents\Projects\gideon\sales-manager
pm2 start ecosystem.config.cjs
pm2 save
```

Expected: `pm2 list` показывает `agent-sales-manager-server` (online :3001) и `agent-sales-manager-worker` (online).

- [ ] **Step 3: Проверить логи воркера**

Run: `pm2 logs agent-sales-manager-worker --lines 30`
Expected: «sales-manager worker started», без traceback'ов.

- [ ] **Step 4: Добавить в start-bot.bat (или в Планировщик отдельную задачу)**

Если бот стартует через `start-bot.bat`, дописать в конец:

```
pm2 start C:\Users\Administrator\Documents\Projects\gideon\sales-manager\ecosystem.config.cjs
```

Альтернатива: создать отдельную задачу в Планировщике `GideonSalesManager` с триггером по логону.

- [ ] **Step 5: Commit изменений если файлы под git**

(start-bot.bat обычно в `.agent/`, не в репо — записать в `memory/2026-05-21.md`.)

---

### Task 30: Smoke-тест целиком (1 лид)

- [ ] **Step 1: Подготовка**
  - Войти в бот через `/sales` (Александр)
  - Создать кампанию: name `Smoke #1`, оффер «Тест связи», url `https://example.com`, ЦА «test», ИКР «получить любой ответ»
  - Режим: `draft_approval` (чтобы можно было перехватить если AI напишет ерунду)
  - Загрузить 1 лида — свой второй TG-аккаунт (`@my_test_account`)
  - Запустить

- [ ] **Step 2: Дождаться первого сообщения**
  - В течение 5-40 минут (рандом-задержка) на втором аккаунте должно прийти AI-сгенерированное сообщение
  - В @flash_gideon_bot НЕ должно быть алертов про первое сообщение (full_auto путь — оно ушло; draft путь срабатывает только на ответы)

- [ ] **Step 3: Ответить с второго аккаунта**
  - Написать что-то осмысленное: «привет, расскажи подробнее»
  - В течение 30-120 сек воркер увидит, обработает батч, AI сгенерирует ответ
  - В режиме `draft_approval` — придёт алерт в бот с кнопками. Нажать «Отправить»
  - На втором аккаунте должен прийти ответ AI

- [ ] **Step 4: Проверить БД**

Run в `sales-manager/`:
```
node -e "const {openDb,listMessages,listEvents}=require('./lib/db.js');const db=openDb('./data/sales-manager.db');console.log(listEvents(db).slice(0,10));"
```
Expected: видишь события `sent`, `received`, `draft_created`.

- [ ] **Step 5: Тест unsubscribe**
  - Со второго аккаунта: «отстань»
  - В БД лид должен перейти в `unsubscribed`, AI не должен ответить, в боте — никаких драфтов.

- [ ] **Step 6: Зафиксировать в дневнике**

Добавить в `memory/2026-05-21.md` (или новый день, если smoke провели позже) раздел `### Smoke-тест #1` с результатами: что работало, что нет, какие баги нашли.

---

## Самопроверка плана

Этот раздел — для self-review автора плана, не для исполнения.

**Соответствие спеке (раздел спеки → задачи):**
- Спека §3 (архитектура) → Tasks 1, 12, 15
- Спека §4 (структура папок) → Task 1
- Спека §5 (жизненный цикл кампании) → Tasks 16, 21, 22
- Спека §6 (модель данных) → Tasks 2-6
- Спека §7 (анти-бан, уровни 1-4) → Tasks 7, 8, 13, 14 (уровень 5 — фаза 2, не в плане)
- Спека §8 (outbound) → Task 13
- Спека §9 (inbound) → Task 14
- Спека §10 (режимы автономии — full_auto + draft_approval) → Task 11 (qualify/hybrid — фаза 2, не в плане)
- Спека §11 (HTTP API) → Tasks 15, 16, 17, 25
- Спека §12 (веб-UI) → Tasks 24, 26 (вкладка «Переписки» — фаза 2, не в плане)
- Спека §13 (интеграция с ботом) → Tasks 20, 21, 22 + Task 18 (bot-notifier на стороне воркера)
- Спека §14 (тестирование) → встроено в каждый task (TDD)
- Спека §15 (деплой) → Tasks 19, 27, 28, 29
- Спека §16 (открытые вопросы) — не реализуются в этом плане, отслежены в спеке

**Скоп фаз 2-3 явно вне плана:** режимы `qualify_then_handoff` и `hybrid`, вкладка «Переписки», AI-самопроверка драфтов, множественные TG-аккаунты, A/B-тесты, Calendly. Эти пункты переходят в отдельные планы после первой успешной кампании.

**Тип-консистентность:**
- `mode` всегда строка из набора `full_auto|qualify_then_handoff|draft_approval|hybrid`
- `lead.status` всегда из набора в схеме БД (`queued|first_sent|in_dialog|qualified|won|lost|unsubscribed|blocked|human_takeover`)
- `message.status` из набора (`drafted|pending_approval|scheduled|sent|failed|received`)
- `peer` в telegram.sendMessage = либо `tg_username` (строка) либо `tg_user_id` (число) — GramJS принимает оба
