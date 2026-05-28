import { test } from "node:test";
import assert from "node:assert/strict";
import { buildImagePromptFromPost } from "../lib/image-prompt.js";

test("buildImagePromptFromPost: возвращает текст от runner (trim)", async () => {
  let captured = null;
  const fakeRunner = async (_a, payload) => {
    captured = payload;
    return JSON.stringify({ result: "  professional businessman shaking hands with hologram robot, modern office, soft light, photorealistic 4k  " });
  };
  const r = await buildImagePromptFromPost({
    postText: "Как AI меняет переговоры с клиентами",
    runner: fakeRunner,
  });
  assert.equal(r, "professional businessman shaking hands with hologram robot, modern office, soft light, photorealistic 4k");
  // В пейлоаде есть исходный пост
  assert.ok(captured.includes("Как AI меняет переговоры"));
  // В системном промпте просим английский и без текста на картинке
  assert.match(captured, /english|англ/i);
});

test("buildImagePromptFromPost: пустой текст → пустой prompt без вызова AI", async () => {
  let called = false;
  const fakeRunner = async () => { called = true; return ""; };
  const r = await buildImagePromptFromPost({ postText: "  ", runner: fakeRunner });
  assert.equal(r, "");
  assert.equal(called, false);
});

test("buildImagePromptFromPost: обрезает длинный пост чтобы не раздувать запрос", async () => {
  let captured = null;
  const fakeRunner = async (_a, payload) => { captured = payload; return JSON.stringify({ result: "prompt" }); };
  const longPost = "x".repeat(10000);
  await buildImagePromptFromPost({ postText: longPost, runner: fakeRunner, maxChars: 1000 });
  // В payload не должно быть всех 10000 x'ов
  const xCount = (captured.match(/x/g) || []).length;
  assert.ok(xCount <= 1100, `xCount=${xCount}, ожидалось <=1100`);
});
