import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { INTERVIEW_QUESTIONS, STYLE_DOCS, buildCorpus, generateStyleProfile } from "../lib/style.js";

test("10 вопросов интервью", () => {
  assert.equal(INTERVIEW_QUESTIONS.length, 10);
  for (const q of INTERVIEW_QUESTIONS) assert.ok(q.length > 10);
});

test("5 документов профиля с уникальными именами", () => {
  assert.equal(STYLE_DOCS.length, 5);
  const names = STYLE_DOCS.map((d) => d.filename);
  assert.deepEqual(new Set(names).size, 5);
  assert.ok(names.includes("tone-of-voice.md"));
  assert.ok(names.includes("brand-code.md"));
  assert.ok(names.includes("content-system.md"));
  assert.ok(names.includes("personal-phrasebook.md"));
  assert.ok(names.includes("ideal-post-structure.md"));
});

test("buildCorpus собирает ответы и материалы в текст", () => {
  const corpus = buildCorpus({
    answers: [{ q: "Вопрос?", transcript: "Ответ голосом" }],
    materials: [{ type: "transcript", text: "доп текст" }],
  });
  assert.ok(corpus.includes("Вопрос?"));
  assert.ok(corpus.includes("Ответ голосом"));
  assert.ok(corpus.includes("доп текст"));
});

test("generateStyleProfile пишет 5 файлов, в промпт попадает корпус", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "style-"));
  const prompts = [];
  const fakeRunner = async (_args, payload) => {
    prompts.push(payload);
    return JSON.stringify({ result: "# Сгенерированный md\nсодержимое" });
  };
  const files = await generateStyleProfile({
    corpus: "КОРПУС-МАРКЕР",
    styleDir: dir,
    runner: fakeRunner,
  });
  assert.equal(files.length, 5);
  for (const f of STYLE_DOCS.map((d) => d.filename)) {
    assert.ok(fs.existsSync(path.join(dir, f)), `нет файла ${f}`);
  }
  assert.equal(prompts.length, 5);
  assert.ok(prompts.every((p) => p.includes("КОРПУС-МАРКЕР")));
});
