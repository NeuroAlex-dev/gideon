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

test("qualify_then_handoff: intent=qualified → handoff (бот не отправляет, передаёт Александру)", async () => {
  const ai = fakeAi({ text: "ок, давай встретимся", new_stage: "closing", intent: "qualified", reason: "лид готов" });
  const dec = await decideInboundAction({ campaign: { mode: "qualify_then_handoff" }, lead: baseLead, conversation: baseConv, history: [], inboundText: "да, давай созвон", askClaude: ai });
  assert.equal(dec.action, "handoff");
});

test("qualify_then_handoff: intent=reply → send_now (AI продолжает сам)", async () => {
  const ai = fakeAi({ text: "класс, расскажи больше", new_stage: "discovery", intent: "reply", reason: "" });
  const dec = await decideInboundAction({ campaign: { mode: "qualify_then_handoff" }, lead: baseLead, conversation: baseConv, history: [], inboundText: "интересно", askClaude: ai });
  assert.equal(dec.action, "send_now");
});

test("hybrid: триггерное слово 'цена' → create_draft", async () => {
  const ai = fakeAi({ text: "вот предложение", new_stage: "pitch", intent: "reply", reason: "" });
  const dec = await decideInboundAction({ campaign: { mode: "hybrid" }, lead: baseLead, conversation: baseConv, history: [], inboundText: "а какая цена?", askClaude: ai });
  assert.equal(dec.action, "create_draft");
});

test("hybrid: стадия closing → create_draft даже без триггерных слов", async () => {
  const ai = fakeAi({ text: "финал", new_stage: "closing", intent: "reply", reason: "" });
  const dec = await decideInboundAction({ campaign: { mode: "hybrid" }, lead: baseLead, conversation: baseConv, history: [], inboundText: "ок", askClaude: ai });
  assert.equal(dec.action, "create_draft");
});

test("hybrid: нейтральный диалог на intro → send_now", async () => {
  const ai = fakeAi({ text: "привет", new_stage: "intro", intent: "reply", reason: "" });
  const dec = await decideInboundAction({ campaign: { mode: "hybrid" }, lead: baseLead, conversation: baseConv, history: [], inboundText: "о, привет", askClaude: ai });
  assert.equal(dec.action, "send_now");
});
