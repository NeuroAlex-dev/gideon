import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOutboundSystemPrompt, buildInboundSystemPrompt, buildFirstMessageUserPrompt } from "../lib/prompts.js";

const campaign = {
  name: "Лендинги для коучей",
  offer_text: "Лендинг под ключ за 30к, 5 дней",
  offer_url: "https://example.com",
  target_audience: "Коучи в TG-чатах про инфобиз",
  goal_ikr: "Записаться на 15-мин созвон в Calendly",
  tone: "дружески на ты",
  stop_phrases: "не обещаем гарантий результата",
};

const lead = {
  tg_username: "vasya_coach",
  first_name: "Вася",
  source_chat_title: "Инфобиз TG",
  bio: "Помогаю коучам найти первых клиентов",
};

test("buildOutboundSystemPrompt включает оффер, ЦА, ИКР, тон и стоп-фразы", () => {
  const p = buildOutboundSystemPrompt(campaign);
  assert.match(p, /Лендинг под ключ/);
  assert.match(p, /Коучи/);
  assert.match(p, /Calendly/);
  assert.match(p, /дружески на ты/);
  assert.match(p, /не обещаем гарантий/);
});

test("buildInboundSystemPrompt добавляет инструкции по стадиям и осторожности", () => {
  const p = buildInboundSystemPrompt(campaign);
  assert.match(p, /стади/i);
  assert.match(p, /отстань|жалоб/i);
});

test("buildFirstMessageUserPrompt подставляет лида и просит JSON-ответ", () => {
  const p = buildFirstMessageUserPrompt(lead);
  assert.match(p, /vasya_coach|Вася/);
  assert.match(p, /Инфобиз TG/);
  assert.match(p, /JSON/);
});
