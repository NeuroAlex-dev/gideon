import { test } from "node:test";
import assert from "node:assert/strict";
import { isObjection, isSurrender } from "../lib/dialog-engine.js";

test("isObjection: ловит типичные возражения", () => {
  assert.equal(isObjection("Я подумаю"), true);
  assert.equal(isObjection("надо подумать"), true);
  assert.equal(isObjection("Дорого для меня"), true);
  assert.equal(isObjection("Нет времени сейчас"), true);
  assert.equal(isObjection("Не уверен что мне зайдёт"), true);
  assert.equal(isObjection("Потом, не сейчас"), true);
  assert.equal(isObjection("Надо посоветоваться с женой"), true);
  assert.equal(isObjection("У меня уже всё работает"), true);
  assert.equal(isObjection("клиентов хватает"), true);
});

test("isObjection: пропускает нейтральный текст", () => {
  assert.equal(isObjection("Да, интересно, расскажите"), false);
  assert.equal(isObjection("Согласен, давай попробуем"), false);
  assert.equal(isObjection("А как оплатить?"), false);
});

test("isSurrender: ловит капитуляционные финалы AI", () => {
  assert.equal(isSurrender("Ок, когда будете готовы — напишите"), true);
  assert.equal(isSurrender("Дам вам время подумать"), true);
  assert.equal(isSurrender("Не настаиваю"), true);
  assert.equal(isSurrender("Как решите — напишите"), true);
  assert.equal(isSurrender("Не отвлекаю"), true);
  assert.equal(isSurrender("Успехов вам в делах!"), true);
  assert.equal(isSurrender("Удачи вам в продвижении"), true);
});

test("isSurrender: пропускает нормальные отработки возражений", () => {
  assert.equal(isSurrender("Что именно смущает? Готовы зайти к нам?"), false);
  assert.equal(isSurrender("Места ещё есть, могу подключить как определишься"), false);
  assert.equal(isSurrender("Так оплата всего 5к — подъёмно?"), false);
});
