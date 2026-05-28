import { test } from "node:test";
import assert from "node:assert/strict";
import { mapPeriodToReddit, normalizeRedditPost, fetchRedditTrends } from "../lib/trends/reddit.js";

test("mapPeriodToReddit", () => {
  assert.equal(mapPeriodToReddit("today"), "day");
  assert.equal(mapPeriodToReddit("3days"), "week");
  assert.equal(mapPeriodToReddit("week"), "week");
  assert.equal(mapPeriodToReddit("month"), "month");
  assert.equal(mapPeriodToReddit("unknown"), "week");
});

test("normalizeRedditPost", () => {
  const d = {
    title: "Some AI breakthrough",
    selftext: "Долгий текст поста",
    url: "https://www.reddit.com/r/MachineLearning/comments/abc/some_thread",
    permalink: "/r/MachineLearning/comments/abc/some_thread",
    subreddit: "MachineLearning",
    score: 1234,
    num_comments: 89,
    created_utc: 1700000000,
  };
  const n = normalizeRedditPost(d, "AI");
  assert.equal(n.platform, "reddit");
  assert.equal(n.source_ref, "AI");
  assert.equal(n.title, "Some AI breakthrough");
  assert.match(n.url, /reddit\.com.*r\/MachineLearning/);
  assert.equal(n.metrics.reactions, 1234);
  assert.equal(n.metrics.comments, 89);
  assert.ok(n.score > 0);
});

test("fetchRedditTrends: fake fetch, фильтрует по score и сортирует", async () => {
  const fakeFetch = async (url) => {
    return { json: async () => ({ data: { children: [
      { data: { title: "weak", selftext: "", url: "u1", permalink: "/r/x/1", subreddit: "x", score: 2, num_comments: 0, created_utc: 1 } },
      { data: { title: "strong", selftext: "", url: "u2", permalink: "/r/x/2", subreddit: "x", score: 5000, num_comments: 200, created_utc: 2 } },
      { data: { title: "mid", selftext: "", url: "u3", permalink: "/r/x/3", subreddit: "x", score: 500, num_comments: 30, created_utc: 3 } },
    ] } }) };
  };
  const items = await fetchRedditTrends({ niche: "AI", period: "week", limit: 10, minScore: 100, fetch: fakeFetch });
  // weak (score 2) отфильтрован, остаются strong + mid, отсортированы по score
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "strong");
  assert.equal(items[1].title, "mid");
});

test("fetchRedditTrends: пустая ниша → []", async () => {
  const items = await fetchRedditTrends({ niche: "", fetch: async () => ({}) });
  assert.deepEqual(items, []);
});
