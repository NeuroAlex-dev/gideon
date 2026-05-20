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
