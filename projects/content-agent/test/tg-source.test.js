import { test } from "node:test";
import assert from "node:assert/strict";
import { periodToSinceTs, matchesKeywords, extractMetrics, normalizeMessage, engagementScore } from "../lib/sources/telegram.js";

test("periodToSinceTs", () => {
  const now = 1_000_000_000_000;
  assert.equal(periodToSinceTs("week", now), now - 7 * 86400_000);
  assert.equal(periodToSinceTs("3days", now), now - 3 * 86400_000);
  assert.equal(periodToSinceTs("month", now), now - 30 * 86400_000);
  assert.ok(periodToSinceTs("today", now) <= now && periodToSinceTs("today", now) > now - 86400_000);
});

test("matchesKeywords: include/exclude, регистронезависимо", () => {
  assert.equal(matchesKeywords("Новая модель GPT", { include: ["gpt"], exclude: [] }), true);
  assert.equal(matchesKeywords("Про котиков", { include: ["gpt"], exclude: [] }), false);
  assert.equal(matchesKeywords("GPT и реклама", { include: ["gpt"], exclude: ["реклама"] }), false);
  assert.equal(matchesKeywords("что угодно", { include: [], exclude: [] }), true);
});

test("extractMetrics из сообщения GramJS", () => {
  const msg = {
    views: 1200, forwards: 8,
    reactions: { results: [{ count: 10 }, { count: 5 }] },
    replies: { replies: 3 },
  };
  const m = extractMetrics(msg);
  assert.equal(m.views, 1200);
  assert.equal(m.forwards, 8);
  assert.equal(m.reactions, 15);
  assert.equal(m.comments, 3);
});

test("normalizeMessage строит url и title", () => {
  const msg = { id: 42, message: "Первая строка заголовок\nостальной текст", date: 1700000000, views: 100, reactions: null, replies: null, forwards: 0 };
  const n = normalizeMessage(msg, "durov");
  assert.equal(n.platform, "telegram");
  assert.equal(n.url, "https://t.me/durov/42");
  assert.equal(n.title, "Первая строка заголовок");
  assert.ok(n.text.includes("остальной текст"));
  assert.equal(n.date, 1700000000 * 1000);
});

test("engagementScore растёт с метриками", () => {
  const lo = engagementScore({ views: 100, reactions: 1, comments: 0, forwards: 0 });
  const hi = engagementScore({ views: 100, reactions: 50, comments: 20, forwards: 10 });
  assert.ok(hi > lo);
});
