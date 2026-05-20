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
  const dec = await decideInboundAction({ campaign: baseCampaign, lead: baseLead, conversation: baseConv, history: [], inboundText: "грубое сообщение", askClaude: ai });
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
