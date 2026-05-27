import { test } from "node:test";
import assert from "node:assert/strict";
import { generate, extractJson } from "../lib/ai.js";

test("generate собирает payload и парсит JSON-ответ CLI", async () => {
  let captured = null;
  const fakeRunner = async (args, payload) => {
    captured = { args, payload };
    return JSON.stringify({ result: "готовый текст" });
  };
  const res = await generate({
    systemPrompt: "Ты пишешь в стиле Александра",
    userMessage: "напиши пост про нейросети",
    runner: fakeRunner,
    model: "sonnet",
  });
  assert.equal(res.text, "готовый текст");
  assert.ok(captured.payload.includes("Ты пишешь в стиле Александра"));
  assert.ok(captured.payload.includes("напиши пост про нейросети"));
  assert.ok(captured.args.includes("--model"));
  assert.ok(captured.args.includes("sonnet"));
});

test("generate бросает понятную ошибку на мусор от CLI", async () => {
  const badRunner = async () => "не-json";
  await assert.rejects(
    () => generate({ systemPrompt: "x", userMessage: "y", runner: badRunner }),
    /парсинг/i,
  );
});

test("extractJson снимает markdown-обёртку", () => {
  assert.equal(extractJson('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(extractJson('{"a":1}'), '{"a":1}');
});
