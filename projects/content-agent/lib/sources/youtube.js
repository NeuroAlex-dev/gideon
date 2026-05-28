const YT_API = "https://www.googleapis.com/youtube/v3";

export function parseYtRef(input) {
  let s = String(input || "").trim();
  s = s.replace(/^https?:\/\/(?:www\.)?youtube\.com\//i, "");
  if (s.startsWith("channel/")) return { handle: null, id: s.slice("channel/".length).split(/[/?#]/)[0] };
  if (/^UC[\w-]{20,}$/.test(s)) return { handle: null, id: s };
  s = s.replace(/^@/, "");
  s = s.split(/[/?#]/)[0];
  return { handle: "@" + s, id: null };
}

export function buildYtUrl(videoId) { return `https://youtu.be/${videoId}`; }

export function normalizeYtVideo(item) {
  const sn = item.snippet || {};
  const st = item.statistics || {};
  return {
    platform: "youtube",
    url: buildYtUrl(item.id),
    title: (sn.title || "(без названия)").slice(0, 120),
    text: (sn.title || "") + (sn.description ? "\n\n" + sn.description : ""),
    metrics: {
      views: Number(st.viewCount) || 0,
      reactions: Number(st.likeCount) || 0,
      comments: Number(st.commentCount) || 0,
      forwards: 0,
    },
    date: sn.publishedAt ? new Date(sn.publishedAt).getTime() : null,
    score: (Number(st.viewCount) || 0) * 0.001 + (Number(st.likeCount) || 0) * 2 + (Number(st.commentCount) || 0) * 5,
  };
}

async function ytGet(path, params, apiKey, fetchImpl) {
  const qs = new URLSearchParams({ ...params, key: apiKey }).toString();
  const res = await fetchImpl(`${YT_API}/${path}?${qs}`);
  const data = await res.json();
  if (data.error) throw new Error(`youtube.${path}: ${data.error.message || data.error.code}`);
  return data;
}

export async function fetchYouTubeChannel({ ref, apiKey, maxResults = 25, sinceTs = 0, fetch: fetchImpl = globalThis.fetch }) {
  if (!apiKey) throw new Error("YouTube API ключ не задан");
  const parsed = parseYtRef(ref);
  const chParams = parsed.id ? { id: parsed.id, part: "contentDetails" } : { forHandle: parsed.handle, part: "contentDetails" };
  const chData = await ytGet("channels", chParams, apiKey, fetchImpl);
  const uploads = chData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error(`youtube: канал "${ref}" не найден`);
  const itemsData = await ytGet("playlistItems", { playlistId: uploads, part: "snippet", maxResults }, apiKey, fetchImpl);
  const videoIds = (itemsData.items || [])
    .filter((it) => {
      const ts = it.snippet?.publishedAt ? new Date(it.snippet.publishedAt).getTime() : 0;
      return ts >= sinceTs;
    })
    .map((it) => it.snippet?.resourceId?.videoId)
    .filter(Boolean);
  if (!videoIds.length) return [];
  const statsData = await ytGet("videos", { id: videoIds.join(","), part: "snippet,statistics" }, apiKey, fetchImpl);
  return (statsData.items || []).map((v) => ({ ...normalizeYtVideo(v), source_ref: ref }));
}

export async function validateYtKey(apiKey, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(`${YT_API}/channels?part=id&forHandle=%40YouTube&key=${encodeURIComponent(apiKey)}`);
    const data = await res.json();
    return !data.error;
  } catch { return false; }
}
