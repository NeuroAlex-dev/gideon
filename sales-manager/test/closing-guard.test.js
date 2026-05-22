import { test } from "node:test";
import assert from "node:assert/strict";
import { violatesClosingRule, hasRecentMaterialsSent } from "../lib/dialog-engine.js";

test("violatesClosingRule: ловит абстрактные финалы без CTA", () => {
  assert.equal(violatesClosingRule("Вот видео и конспект. Что из этого больше всего откликается?"), true);
  assert.equal(violatesClosingRule("...Что вам ближе?"), true);
  assert.equal(violatesClosingRule("..Как вам?"), true);
  assert.equal(violatesClosingRule("Что думаете?"), true);
});

test("violatesClosingRule: пропускает ответы с CTA на участие", () => {
  assert.equal(violatesClosingRule("Что скажете насчёт участия в складчине?"), false);
  assert.equal(violatesClosingRule("Готовы зайти к нам?"), false);
  assert.equal(violatesClosingRule("Хочешь присоединиться?"), false);
  assert.equal(violatesClosingRule("Тема? Можем подключить."), false);
  assert.equal(violatesClosingRule("Интересно?"), false);
});

test("hasRecentMaterialsSent: True если в недавних outbound были файлы/ссылки", () => {
  const history1 = [
    { role: "outbound", body: "[файл: /path/abc.pdf]" },
  ];
  assert.equal(hasRecentMaterialsSent(history1), true);
  const history2 = [
    { role: "outbound", body: "Привет!" },
    { role: "inbound", body: "О, привет" },
    { role: "outbound", body: "Держи разбор: https://youtu.be/xyz" },
  ];
  assert.equal(hasRecentMaterialsSent(history2), true);
  const history3 = [
    { role: "outbound", body: "Привет, как дела?" },
  ];
  assert.equal(hasRecentMaterialsSent(history3), false);
});
