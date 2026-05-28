// Reddit-коннектор для трендов — бесплатный публичный API, без auth.
// Используем endpoint /search.json для поиска топовых постов по нише.
// Rate limit для unauth: ~60 req/min — нам с головой.

// old.reddit.com — старый домен с заметно меньшим anti-bot. JSON-эндпоинты те же.
const REDDIT_BASE = "https://old.reddit.com";
// Реалистичный browser-UA — без него Reddit чаще возвращает HTML/блок вместо JSON.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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
  const res = await fetchImpl(`${REDDIT_BASE}/search.json?${qs}`, {
    headers: { "User-Agent": UA, "Accept": "application/json" },
  });
  // Reddit на anti-bot отдаёт HTML вместо JSON — защищаемся: проверяем content-type явно.
  const ct = res.headers?.get?.("content-type");
  if (ct && !ct.includes("json")) {
    throw new Error(`reddit: ожидался JSON, пришёл ${ct} (status ${res.status}) — anti-bot или rate limit`);
  }
  const data = await res.json();
  const items = data?.data?.children || [];
  return items
    .map((c) => normalizeRedditPost(c.data || {}, niche))
    .filter((it) => it.metrics.reactions >= minScore)
    .sort((a, b) => b.score - a.score);
}
