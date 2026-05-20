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
