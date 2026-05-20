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
