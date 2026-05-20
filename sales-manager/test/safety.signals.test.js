import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTelegramError, isUnsubscribeMessage } from "../lib/safety.js";

test("classifyTelegramError распознаёт ключевые ошибки GramJS", () => {
  assert.equal(classifyTelegramError({ errorMessage: "USER_DEACTIVATED_BAN" }).kind, "ban");
  assert.equal(classifyTelegramError({ errorMessage: "PEER_FLOOD" }).kind, "flood");
  const fw = classifyTelegramError({ errorMessage: "FLOOD_WAIT_42" });
  assert.equal(fw.kind, "flood_wait");
  assert.equal(fw.waitSec, 42);
  assert.equal(classifyTelegramError({ errorMessage: "USER_PRIVACY_RESTRICTED" }).kind, "privacy");
  assert.equal(classifyTelegramError({ errorMessage: "WHATEVER" }).kind, "unknown");
});

test("isUnsubscribeMessage ловит стоп-фразы", () => {
  assert.equal(isUnsubscribeMessage("отстань"), true);
  assert.equal(isUnsubscribeMessage("не пиши мне больше"), true);
  assert.equal(isUnsubscribeMessage("Спам!"), true);
  assert.equal(isUnsubscribeMessage("UNSUBSCRIBE"), true);
  assert.equal(isUnsubscribeMessage("Здравствуйте"), false);
  assert.equal(isUnsubscribeMessage("норм оффер, расскажи подробнее"), false);
});
