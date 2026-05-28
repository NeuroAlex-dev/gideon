import { test } from "node:test";
import assert from "node:assert/strict";
import { expandNiche } from "../lib/trends/keyword-expander.js";

test("expandNiche: валидный JSON-массив парсится, исходная ниша добавляется первой", async () => {
  let captured = null;
  const fakeRunner = async (_a, payload) => {
    captured = payload;
    return JSON.stringify({ result: '["вайбкодинг","AI бизнес","cursor","no-code"]' });
  };
  const terms = await expandNiche({ niche: "Вайбкодинг для бизнеса", runner: fakeRunner });
  assert.equal(terms[0], "Вайбкодинг для бизнеса", "исходная ниша первой");
  assert.ok(terms.includes("вайбкодинг"));
  assert.ok(terms.includes("AI бизнес"));
  assert.equal(terms.length, 5);
  assert.ok(captured.includes("Вайбкодинг для бизнеса"));
});

test("expandNiche: дедуп — исходная ниша не дублируется если Claude её повторил", async () => {
  const fakeRunner = async () => JSON.stringify({ result: '["вайбкодинг","Вайбкодинг для бизнеса","AI"]' });
  const terms = await expandNiche({ niche: "Вайбкодинг для бизнеса", runner: fakeRunner });
  assert.equal(terms.filter((t) => t.toLowerCase() === "вайбкодинг для бизнеса").length, 1);
});

test("expandNiche: лимит max — обрезает", async () => {
  const fakeRunner = async () => JSON.stringify({ result: '["a","b","c","d","e","f","g","h","i","j"]' });
  const terms = await expandNiche({ niche: "X", runner: fakeRunner, max: 4 });
  assert.equal(terms.length, 4); // включая исходную
});

test("expandNiche: битый JSON → fallback на одну исходную нишу", async () => {
  const fakeRunner = async () => JSON.stringify({ result: "не json" });
  const terms = await expandNiche({ niche: "X", runner: fakeRunner });
  assert.deepEqual(terms, ["X"]);
});

test("expandNiche: пустой массив от AI → fallback на исходную нишу", async () => {
  const fakeRunner = async () => JSON.stringify({ result: "[]" });
  const terms = await expandNiche({ niche: "X", runner: fakeRunner });
  assert.deepEqual(terms, ["X"]);
});
