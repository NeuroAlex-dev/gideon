import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVkRef, buildVkUrl, normalizeVkPost, fetchVkWall } from "../lib/sources/vk.js";

test("parseVkRef разные форматы", () => {
  assert.equal(parseVkRef("durov"), "durov");
  assert.equal(parseVkRef("@durov"), "durov");
  assert.equal(parseVkRef("https://vk.com/durov"), "durov");
  assert.equal(parseVkRef("vk.com/club1"), "club1");
});

test("buildVkUrl", () => {
  assert.equal(buildVkUrl(1, 42), "https://vk.com/wall1_42");
  assert.equal(buildVkUrl(-1, 42), "https://vk.com/wall-1_42");
});

test("normalizeVkPost", () => {
  const post = { id: 5, owner_id: -100, text: "Привет\nмир", date: 1700000000, views: { count: 1000 }, likes: { count: 50 }, reposts: { count: 10 }, comments: { count: 3 } };
  const n = normalizeVkPost(post);
  assert.equal(n.platform, "vk");
  assert.equal(n.url, "https://vk.com/wall-100_5");
  assert.equal(n.title, "Привет");
  assert.equal(n.text, "Привет\nмир");
  assert.equal(n.metrics.views, 1000);
  assert.equal(n.metrics.reactions, 50);
  assert.equal(n.metrics.forwards, 10);
  assert.equal(n.metrics.comments, 3);
  assert.equal(n.date, 1700000000 * 1000);
  assert.ok(n.score > 0);
});

test("fetchVkWall: dependency injection (fakeFetch)", async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    if (url.includes("utils.resolveScreenName")) {
      return { json: async () => ({ response: { type: "group", object_id: 100 } }) };
    }
    return { json: async () => ({ response: { count: 1, items: [
      { id: 5, owner_id: -100, text: "пост о gpt", date: Math.floor(Date.now()/1000) - 10, views: { count: 500 }, likes: { count: 25 }, reposts: { count: 5 }, comments: { count: 2 } },
    ] } }) };
  };
  const posts = await fetchVkWall({ screenName: "durov", token: "TKN", count: 10, fetch: fakeFetch });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, "https://vk.com/wall-100_5");
  assert.ok(calls[0].includes("utils.resolveScreenName"));
  assert.ok(calls[1].includes("wall.get"));
  assert.ok(calls[1].includes("access_token=TKN"));
});

test("fetchVkWall без токена кидает", async () => {
  await assert.rejects(() => fetchVkWall({ screenName: "durov", token: "", fetch: async () => ({}) }), /VK токен не задан/);
});
