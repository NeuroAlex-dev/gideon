// Google Trends коннектор — бесплатный, без auth.
// Использует unofficial-обёртку google-trends-api. Может ломаться при изменениях Google,
// но мы не зависим от чего-то критичного: тренды — опциональная фича.

import googleTrendsDefault from "google-trends-api";

const PERIOD_MAP = {
  today: "now 1-d",
  "3days": "now 7-d", // GT даёт минимум "1 час / 4 часа / 1 день / 7 дней / 1 месяц / 3 / 12 / 5 лет"
  week: "now 7-d",
  month: "today 1-m",
};

export function mapPeriodToGT(period) {
  return PERIOD_MAP[period] || "now 7-d";
}

export function normalizeGtItem(rising, niche) {
  const keyword = rising.query;
  const growthFmt = rising.formattedValue || String(rising.value);
  return {
    platform: "google_trends",
    source_ref: niche,
    url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(keyword)}`,
    title: keyword,
    text: `Восходящий запрос в нише "${niche}" по данным Google Trends. Рост: ${growthFmt}. Запрос: ${keyword}.`,
    metrics: { views: 0, reactions: Number(rising.value) || 0, comments: 0, forwards: 0 },
    date: Date.now(),
    score: Number(rising.value) || 0,
    growth_label: growthFmt,
  };
}

export async function fetchGoogleTrends({ niche, period = "week", geo = "RU", gtApi = googleTrendsDefault }) {
  if (!niche || !String(niche).trim()) return [];
  const timeframe = mapPeriodToGT(period);
  let raw;
  try {
    raw = await gtApi.relatedQueries({ keyword: niche, geo, timeframe });
  } catch (e) {
    throw new Error(`google trends: ${e.message}`);
  }
  let data;
  try {
    data = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (e) {
    throw new Error(`google trends: парсинг JSON провален: ${e.message}`);
  }
  // Структура: { default: { rankedList: [ {rankedKeyword: [top]}, {rankedKeyword: [rising]} ] } }
  const lists = data?.default?.rankedList || [];
  const risingList = lists[1]?.rankedKeyword || [];
  return risingList
    .filter((r) => r && r.query)
    .map((r) => normalizeGtItem(r, niche));
}
