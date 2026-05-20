import { test } from "node:test";
import assert from "node:assert/strict";
import { askClaude } from "../lib/ai.js";

test("askClaude собирает payload и парсит ответ", async () => {
  let captured = null;
  const fakeRunner = async (args, payload) => {
    captured = { args, payload };
    return JSON.stringify({ text: "fake reply", usage: { input_tokens: 100, output_tokens: 20 } });
  };
  const res = await askClaude({
    systemPrompt: "Ты продавец",
    history: [{ role: "user", content: "привет" }, { role: "assistant", content: "хай" }],
    userMessage: "сколько стоит",
    runner: fakeRunner,
  });
  assert.equal(res.text, "fake reply");
  assert.equal(res.tokensIn, 100);
  assert.equal(res.tokensOut, 20);
  assert.ok(captured.payload.includes("Ты продавец"));
  assert.ok(captured.payload.includes("сколько стоит"));
});

test("askClaude бросает понятную ошибку если CLI вернул мусор", async () => {
  const badRunner = async () => "не-json мусор";
  await assert.rejects(() => askClaude({ systemPrompt: "x", history: [], userMessage: "y", runner: badRunner }), /парсинг ответа/i);
});
