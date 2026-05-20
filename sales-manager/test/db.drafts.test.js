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
  // listEvents возвращает в порядке DESC by id — последний (received) идёт первым
  const sent = evs.find((e) => e.type === "sent");
  assert.equal(JSON.parse(sent.payload_json).foo, 1);
});

test("campaignStats считает по статусам лидов и сообщениям", () => {
  const { db, cid, lead } = setup();
  setLeadStatus(db, lead.id, "qualified");
  const stats = campaignStats(db, cid);
  assert.equal(stats.leads_total, 1);
  assert.equal(stats.leads_by_status.qualified, 1);
  assert.equal(stats.messages_outbound, 1);
});
