// Reddit-коннектор для трендов — бесплатный публичный API, без auth.
// Используем endpoint /search.json для поиска топовых постов по нише.
// Rate limit для unauth: ~60 req/min — нам с головой.

const REDDIT_BASE = "https://www.reddit.com";
const UA = "content-agent/0.1 (trend-search)";

const PERIOD_MAP = { today: "day", "3days": "week", week: "week", month: "month" };

export function mapPeriodToReddit(period) {
  return PERIOD_MAP[period] || "week";
}

export function normalizeRedditPost(d, niche) {
  const permalink = d.permalink ? `${REDDIT_BASE}${d.permalink}` : d.url;
  return {
    platform: "reddit",
    source_ref: niche,
    url: permalink,
    title: d.title || "(без названия)",
    text: (d.title || "") + (d.selftext ? "\n\n" + d.selftext : ""),
    metrics: {
      views: 0,
      reactions: Number(d.score) || 0,
      comments: Number(d.num_comments) || 0,
      forwards: 0,
    },
    date: d.created_utc ? d.created_utc * 1000 : null,
    score: (Number(d.score) || 0) + (Number(d.num_comments) || 0) * 3,
    subreddit: d.subreddit || null,
  };
}

export async function fetchRedditTrends({ niche, period = "week", limit = 25, minScore = 50, fetch: fetchImpl = globalThis.fetch }) {
  if (!niche || !String(niche).trim()) return [];
  const t = mapPeriodToReddit(period);
  const qs = new URLSearchParams({ q: String(niche), sort: "top", t, limit: String(limit), restrict_sr: "false" });
  const res = await fetchImpl(`${REDDIT_BASE}/search.json?${qs}`, { headers: { "User-Agent": UA } });
  const data = await res.json();
  const items = data?.data?.children || [];
  const normalized = items
    .map((c) => normalizeRedditPost(c.data || {}, niche))
    .filter((it) => it.metrics.reactions >= minScore)
    .sort((a, b) => b.score - a.score);
  return normalized;
}
