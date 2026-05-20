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
