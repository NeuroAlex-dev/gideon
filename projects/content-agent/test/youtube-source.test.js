import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYtRef, buildYtUrl, normalizeYtVideo, fetchYouTubeChannel } from "../lib/sources/youtube.js";

test("parseYtRef разные форматы", () => {
  assert.deepEqual(parseYtRef("@MKBHD"), { handle: "@MKBHD", id: null });
  assert.deepEqual(parseYtRef("MKBHD"), { handle: "@MKBHD", id: null });
  assert.deepEqual(parseYtRef("https://www.youtube.com/@MKBHD"), { handle: "@MKBHD", id: null });
  assert.deepEqual(parseYtRef("UCBJycsmduvYEL83R_U4JriQ"), { handle: null, id: "UCBJycsmduvYEL83R_U4JriQ" });
  assert.deepEqual(parseYtRef("https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ"), { handle: null, id: "UCBJycsmduvYEL83R_U4JriQ" });
});

test("buildYtUrl", () => {
  assert.equal(buildYtUrl("abc123"), "https://youtu.be/abc123");
});

test("normalizeYtVideo", () => {
  const item = {
    id: "vid1",
    snippet: { title: "Заголовок", description: "описание", publishedAt: "2024-01-15T12:00:00Z" },
    statistics: { viewCount: "10000", likeCount: "500", commentCount: "30" },
  };
  const n = normalizeYtVideo(item);
  assert.equal(n.platform, "youtube");
  assert.equal(n.url, "https://youtu.be/vid1");
  assert.equal(n.title, "Заголовок");
  assert.equal(n.metrics.views, 10000);
  assert.equal(n.metrics.reactions, 500);
  assert.equal(n.metrics.comments, 30);
  assert.equal(n.metrics.forwards, 0);
  assert.ok(n.date > 0);
});

test("fetchYouTubeChannel: fake fetch, последовательность вызовов", async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    if (url.includes("channels?")) {
      return { json: async () => ({ items: [{ contentDetails: { relatedPlaylists: { uploads: "UU_uploads_123" } } }] }) };
    }
    if (url.includes("playlistItems?")) {
      return { json: async () => ({ items: [
        { snippet: { resourceId: { videoId: "vid1" }, publishedAt: new Date().toISOString() } },
        { snippet: { resourceId: { videoId: "vid2" }, publishedAt: new Date().toISOString() } },
      ] }) };
    }
    if (url.includes("videos?")) {
      return { json: async () => ({ items: [
        { id: "vid1", snippet: { title: "T1", description: "d", publishedAt: new Date().toISOString() }, statistics: { viewCount: "100", likeCount: "10", commentCount: "1" } },
      ] }) };
    }
    return { json: async () => ({}) };
  };
  const posts = await fetchYouTubeChannel({ ref: "@MKBHD", apiKey: "KEY", maxResults: 5, fetch: fakeFetch });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, "https://youtu.be/vid1");
  assert.ok(calls[0].includes("forHandle=%40MKBHD"));
  assert.ok(calls[1].includes("playlistId=UU_uploads_123"));
  assert.ok(calls[2].includes("videos?"));
});

test("fetchYouTubeChannel без ключа кидает", async () => {
  await assert.rejects(() => fetchYouTubeChannel({ ref: "@x", apiKey: "", fetch: async () => ({}) }), /YouTube API ключ не задан/);
});
