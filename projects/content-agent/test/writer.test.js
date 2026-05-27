import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { loadStyleProfile, buildPostPrompt, VARIANTS, generatePost } from "../lib/writer.js";

test("loadStyleProfile: пусто если файлов нет, иначе склейка", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "w-empty-"));
  assert.equal(loadStyleProfile(empty).present, false);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "w-full-"));
  fs.writeFileSync(path.join(dir, "tone-of-voice.md"), "ТОН-МАРКЕР");
  const loaded = loadStyleProfile(dir);
  assert.equal(loaded.present, true);
  assert.ok(loaded.text.includes("ТОН-МАРКЕР"));
});

test("buildPostPrompt включает стиль, запрос и инструкцию варианта", () => {
  const p = buildPostPrompt({ styleText: "СТИЛЬ-X", userPrompt: "пост про RAG", variantMode: "humor" });
  assert.ok(p.includes("СТИЛЬ-X"));
  assert.ok(p.includes("пост про RAG"));
  assert.ok(p.includes(VARIANTS.humor));
});

test("buildPostPrompt без стиля помечает, что стиль не обучен", () => {
  const p = buildPostPrompt({ styleText: "", userPrompt: "пост" });
  assert.match(p, /стиль не обучен|без профиля/i);
});

test("generatePost возвращает текст от runner", async () => {
  const fakeRunner = async () => JSON.stringify({ result: "текст поста" });
  const res = await generatePost({ styleText: "S", userPrompt: "тема", runner: fakeRunner });
  assert.equal(res, "текст поста");
});
