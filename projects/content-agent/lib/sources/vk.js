const VK_API = "https://api.vk.com/method";
const VK_VERSION = "5.199";

export function parseVkRef(input) {
  let s = String(input || "").trim();
  s = s.replace(/^(?:https?:\/\/)?(?:www\.)?vk\.com\//i, "");
  s = s.replace(/^@/, "");
  s = s.split(/[/?#]/)[0];
  return s;
}

export function buildVkUrl(ownerId, postId) {
  return `https://vk.com/wall${ownerId}_${postId}`;
}

export function normalizeVkPost(post) {
  const text = post.text || "";
  const firstLine = text.split("\n").find((l) => l.trim()) || "(без текста)";
  const metrics = {
    views: post.views?.count || 0,
    reactions: post.likes?.count || 0,
    forwards: post.reposts?.count || 0,
    comments: post.comments?.count || 0,
  };
  return {
    platform: "vk",
    url: buildVkUrl(post.owner_id, post.id),
    title: firstLine.slice(0, 120),
    text,
    metrics,
    date: post.date ? post.date * 1000 : null,
    score: metrics.views * 0.01 + metrics.reactions * 2 + metrics.comments * 5 + metrics.forwards * 3,
  };
}

async function vkCall(method, params, fetchImpl, token) {
  const qs = new URLSearchParams({ ...params, v: VK_VERSION, access_token: token }).toString();
  const res = await fetchImpl(`${VK_API}/${method}?${qs}`);
  const data = await res.json();
  if (data.error) {
    throw new Error(`vk.${method}: ${data.error.error_msg || data.error.error_code}`);
  }
  return data.response;
}

export async function fetchVkWall({ screenName, token, count = 50, sinceTs = 0, fetch: fetchImpl = globalThis.fetch }) {
  if (!token) throw new Error("VK токен не задан");
  const screen = parseVkRef(screenName);
  const resolved = await vkCall("utils.resolveScreenName", { screen_name: screen }, fetchImpl, token);
  if (!resolved?.object_id) throw new Error(`vk: не нашёл "${screen}"`);
  const ownerId = resolved.type === "group" ? -resolved.object_id : resolved.object_id;
  const wall = await vkCall("wall.get", { owner_id: ownerId, count }, fetchImpl, token);
  const out = [];
  for (const p of wall.items || []) {
    if (p.date && p.date * 1000 < sinceTs) continue;
    if (!p.text) continue;
    out.push({ ...normalizeVkPost(p), source_ref: screenName });
  }
  return out;
}

export async function validateVkToken(token, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(`${VK_API}/users.get?${new URLSearchParams({ v: VK_VERSION, access_token: token })}`);
    const data = await res.json();
    return !data.error;
  } catch { return false; }
}
