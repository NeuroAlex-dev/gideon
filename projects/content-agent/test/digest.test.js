import { test } from "node:test";
import assert from "node:assert/strict";
import { extractiveSummary, sortByEngagement, reshapeDigest, aiSummarize } from "../lib/digest.js";

test("extractiveSummary берёт первые предложения и режет длину", () => {
  const s = extractiveSummary("Первое предложение. Второе предложение. Третье. Четвёртое.", 2);
  assert.ok(s.includes("Первое предложение"));
  assert.ok(s.includes("Второе предложение"));
  assert.ok(!s.includes("Четвёртое"));
});

test("sortByEngagement сортирует по score убыв", () => {
  const items = [{ score: 1 }, { score: 9 }, { score: 5 }];
  const sorted = sortByEngagement(items);
  assert.deepEqual(sorted.map((i) => i.score), [9, 5, 1]);
});

test("aiSummarize: пустой массив → пустой результат, без вызова runner", async () => {
  let called = false;
  const fakeRunner = async () => { called = true; return ""; };
  const r = await aiSummarize({ items: [], runner: fakeRunner });
  assert.deepEqual(r, []);
  assert.equal(called, false);
});

test("aiSummarize: валидный JSON-массив возвращает строки в том же порядке", async () => {
  let captured = null;
  const fakeRunner = async (_a, payload) => {
    captured = payload;
    return JSON.stringify({ result: '["саммари 1", "саммари 2"]' });
  };
  const r = await aiSummarize({
    items: [{ title: "T1", text: "Текст 1" }, { title: "T2", text: "Текст 2" }],
    runner: fakeRunner,
  });
  assert.deepEqual(r, ["саммари 1", "саммари 2"]);
  assert.ok(captured.includes("T1"));
  assert.ok(captured.includes("Текст 1"));
});

test("aiSummarize: markdown-обёртка ```json снимается", async () => {
  const fakeRunner = async () => JSON.stringify({ result: '```json\n["s1"]\n```' });
  const r = await aiSummarize({ items: [{ title: "T", text: "x" }], runner: fakeRunner });
  assert.deepEqual(r, ["s1"]);
});

test("aiSummarize: бросает при несовпадении длины", async () => {
  const fakeRunner = async () => JSON.stringify({ result: '["only one"]' });
  await assert.rejects(
    () => aiSummarize({ items: [{ title: "a", text: "1" }, { title: "b", text: "2" }], runner: fakeRunner }),
    /длина/,
  );
});

test("aiSummarize: бросает при не-массиве", async () => {
  const fakeRunner = async () => JSON.stringify({ result: '{"not": "array"}' });
  await assert.rejects(
    () => aiSummarize({ items: [{ title: "a", text: "1" }], runner: fakeRunner }),
    /массив/,
  );
});

test("reshapeDigest зовёт runner с режимом и текущим текстом", async () => {
  let captured = null;
  const fakeRunner = async (_a, payload) => { captured = payload; return JSON.stringify({ result: "новый дайджест" }); };
  const r = await reshapeDigest({ currentText: "СТАРЫЙ", mode: "shorter", runner: fakeRunner });
  assert.equal(r, "новый дайджест");
  assert.ok(captured.includes("СТАРЫЙ"));
  assert.match(captured, /короч/i);
});
