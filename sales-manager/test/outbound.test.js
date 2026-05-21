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
    now: new Date("2026-05-21T10:00:00Z").getTime(),
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
  addLeads(db, cid, [{ tg_user_id: 11, tg_username: "vasya", next_action_at: 0 }]);
  const res = await runOutboundTick({
    db,
    now: new Date("2026-05-21T00:00:00Z").getTime(),
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
