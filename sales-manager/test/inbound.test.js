import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, createCampaign, setCampaignStatus, addLeads, listLeads, getOrCreateConversation, addMessage, listMessages, getDraftByMessage } from "../lib/db.js";
import { createInboundProcessor } from "../lib/inbound.js";

function setupFullAuto() {
  const db = openDb(":memory:");
  const cid = createCampaign(db, { name: "C", offer_text: "X", offer_url: "https://x", target_audience: "y", goal_ikr: "z" });
  db.prepare("UPDATE campaigns SET mode = 'full_auto' WHERE id = ?").run(cid);
  setCampaignStatus(db, cid, "running");
  addLeads(db, cid, [{ tg_user_id: 11, tg_username: "vasya" }]);
  const lead = listLeads(db, cid)[0];
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
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, "конечно, расскажу");
  const msgs = listMessages(db, conv.id);
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
  await new Promise((r) => setTimeout(r, 250));
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
  await new Promise((r) => setTimeout(r, 200));
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
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(sent.length, 0);
});
