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
