import { test } from "node:test";
import assert from "node:assert/strict";
import { mapPeriodToGT, normalizeGtItem, fetchGoogleTrends } from "../lib/trends/google-trends.js";

test("mapPeriodToGT", () => {
  assert.equal(mapPeriodToGT("today"), "now 1-d");
  assert.equal(mapPeriodToGT("3days"), "now 7-d");
  assert.equal(mapPeriodToGT("week"), "now 7-d");
  assert.equal(mapPeriodToGT("month"), "today 1-m");
  assert.equal(mapPeriodToGT("unknown"), "now 7-d");
});

test("normalizeGtItem (rising)", () => {
  const it = normalizeGtItem({ query: "AI agents", value: 450, formattedValue: "+450%" }, "нейросети");
  assert.equal(it.platform, "google_trends");
  assert.equal(it.title, "AI agents");
  assert.match(it.url, /trends\.google\.com.*AI%20agents/);
  assert.equal(it.metrics.reactions, 450); // growth → reactions поле
  assert.ok(it.text.includes("нейросети"));
});

test("fetchGoogleTrends: fake api возвращает rising queries", async () => {
  const calls = [];
  const fakeGtApi = {
    relatedQueries: async (opts) => {
      calls.push(opts);
      return JSON.stringify({
        default: {
          rankedList: [
            { rankedKeyword: [{ query: "top1", value: 100, formattedValue: "100" }] },
            { rankedKeyword: [
              { query: "rising1", value: 800, formattedValue: "+800%" },
              { query: "rising2", value: 300, formattedValue: "+300%" },
            ]},
          ],
        },
      });
    },
  };
  const items = await fetchGoogleTrends({ niche: "нейросети", period: "week", geo: "RU", gtApi: fakeGtApi });
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "rising1");
  assert.equal(items[0].metrics.reactions, 800);
  assert.equal(calls[0].keyword, "нейросети");
  assert.equal(calls[0].geo, "RU");
});

test("fetchGoogleTrends: graceful — пустой rising → пустой массив", async () => {
  const fakeGtApi = {
    relatedQueries: async () => JSON.stringify({ default: { rankedList: [{ rankedKeyword: [] }, { rankedKeyword: [] }] } }),
  };
  const items = await fetchGoogleTrends({ niche: "что-то редкое", gtApi: fakeGtApi });
  assert.deepEqual(items, []);
});

test("fetchGoogleTrends: ошибка API → бросает понятную", async () => {
  const fakeGtApi = { relatedQueries: async () => { throw new Error("network"); } };
  await assert.rejects(() => fetchGoogleTrends({ niche: "x", gtApi: fakeGtApi }), /google trends/i);
});
