import { test } from "node:test";
import assert from "node:assert/strict";
import { extractiveSummary, sortByEngagement, reshapeDigest } from "../lib/digest.js";

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

test("reshapeDigest зовёт runner с режимом и текущим текстом", async () => {
  let captured = null;
  const fakeRunner = async (_a, payload) => { captured = payload; return JSON.stringify({ result: "новый дайджест" }); };
  const r = await reshapeDigest({ currentText: "СТАРЫЙ", mode: "shorter", runner: fakeRunner });
  assert.equal(r, "новый дайджест");
  assert.ok(captured.includes("СТАРЫЙ"));
  assert.match(captured, /короч/i);
});
