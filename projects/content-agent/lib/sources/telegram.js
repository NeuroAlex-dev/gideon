import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { getSessionString, getApiCredentials } from "../sessions-manager.js";

const DAY = 86400_000;

export function periodToSinceTs(period, now = Date.now()) {
  switch (period) {
    case "today": { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); }
    case "3days": return now - 3 * DAY;
    case "week": return now - 7 * DAY;
    case "month": return now - 30 * DAY;
    default: return now - 7 * DAY;
  }
}

export function matchesKeywords(text, { include = [], exclude = [] } = {}) {
  const t = (text || "").toLowerCase();
  for (const ex of exclude) { if (ex && t.includes(ex.toLowerCase())) return false; }
  if (!include.length) return true;
  return include.some((kw) => kw && t.includes(kw.toLowerCase()));
}

export function extractMetrics(msg) {
  const reactions = (msg.reactions?.results || []).reduce((s, r) => s + (r.count || 0), 0);
  return {
    views: msg.views || 0,
    forwards: msg.forwards || 0,
    reactions,
    comments: msg.replies?.replies || 0,
  };
}

export function engagementScore(m) {
  // Комментарии и репосты весомее простых просмотров.
  return (m.views || 0) * 0.01 + (m.reactions || 0) * 2 + (m.comments || 0) * 5 + (m.forwards || 0) * 3;
}

export function normalizeMessage(msg, channelUsername) {
  const text = msg.message || "";
  const firstLine = text.split("\n").find((l) => l.trim()) || "(без текста)";
  const metrics = extractMetrics(msg);
  return {
    platform: "telegram",
    url: channelUsername ? `https://t.me/${channelUsername}/${msg.id}` : null,
    title: firstLine.slice(0, 120),
    text,
    metrics,
    date: msg.date ? msg.date * 1000 : null,
    score: engagementScore(metrics),
  };
}

// Реальное TG-чтение: connect-on-demand, без session.save().
export async function fetchFromChannels({ channels, sinceTs, keywords = {}, perChannelLimit = 80, clientFactory = defaultClientFactory }) {
  const client = clientFactory();
  await client.connect();
  const out = [];
  try {
    for (const ref of channels) {
      try {
        const entity = await client.getEntity(ref);
        // entity.username бывает пустым у некоторых каналов — берём из ref (@name) как fallback.
        const refUsername = typeof ref === "string" && ref.trim().startsWith("@") ? ref.trim().slice(1) : null;
        const username = entity.username || refUsername;
        const messages = await client.getMessages(entity, { limit: perChannelLimit });
        for (const msg of messages) {
          const ts = msg.date ? msg.date * 1000 : 0;
          if (ts < sinceTs) continue;
          if (!msg.message) continue;
          if (!matchesKeywords(msg.message, keywords)) continue;
          out.push({ ...normalizeMessage(msg, username), source_ref: ref });
        }
      } catch (e) {
        out.push({ platform: "telegram", source_ref: ref, error: String(e.message).slice(0, 150) });
      }
    }
  } finally {
    try { await client.disconnect(); } catch {}
  }
  return out;
}

function defaultClientFactory() {
  const { apiId, apiHash } = getApiCredentials();
  const sessionString = getSessionString("active");
  return new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
    connectionRetries: 2,
    useWSS: true,
  });
}
