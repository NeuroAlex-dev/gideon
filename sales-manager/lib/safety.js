const MIN_OUTBOUND_DELAY_MS = 3 * 60_000;
const MAX_OUTBOUND_DELAY_MS = 25 * 60_000;
const HOURLY_FIRST_MESSAGE_LIMIT = 4;

export function hourInTimezone(ts, timezone) {
  const fmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: timezone });
  return Number(fmt.format(new Date(ts)));
}

export function dayKeyInTimezone(ts, timezone) {
  const fmt = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: timezone });
  return fmt.format(new Date(ts));
}

export function isWithinWorkingHours(ts, campaign) {
  const h = hourInTimezone(ts, campaign.timezone);
  return h >= campaign.working_hours_start && h < campaign.working_hours_end;
}

export function canSendNow({ now, campaign, sentTodayCount, sentLastHourCount, lastSentAt }) {
  if (!isWithinWorkingHours(now, campaign)) {
    return { ok: false, reason: "вне рабочих часов кампании" };
  }
  if (sentTodayCount >= campaign.daily_message_limit) {
    return { ok: false, reason: `дневной лимит ${campaign.daily_message_limit} исчерпан` };
  }
  if (sentLastHourCount >= HOURLY_FIRST_MESSAGE_LIMIT) {
    return { ok: false, reason: `часовой лимит ${HOURLY_FIRST_MESSAGE_LIMIT} исчерпан` };
  }
  if (lastSentAt && now - lastSentAt < MIN_OUTBOUND_DELAY_MS) {
    return { ok: false, reason: "минимальная задержка между сообщениями не выдержана" };
  }
  return { ok: true };
}

export function nextOutboundDelay(rng = Math.random) {
  return Math.floor(MIN_OUTBOUND_DELAY_MS + rng() * (MAX_OUTBOUND_DELAY_MS - MIN_OUTBOUND_DELAY_MS));
}

export function nextInboundReadDelay(rng = Math.random) {
  return Math.floor(30_000 + rng() * (180_000 - 30_000));
}

export function nextTypingDuration(rng = Math.random) {
  return Math.floor(1_000 + rng() * (3_000 - 1_000));
}

export function classifyTelegramError(err) {
  const msg = (err?.errorMessage || err?.message || "").toUpperCase();
  if (msg.includes("USER_DEACTIVATED_BAN") || msg.includes("USER_BANNED")) return { kind: "ban" };
  if (msg.includes("PEER_FLOOD")) return { kind: "flood" };
  const fw = msg.match(/FLOOD_WAIT_(\d+)/);
  if (fw) return { kind: "flood_wait", waitSec: Number(fw[1]) };
  if (msg.includes("USER_PRIVACY_RESTRICTED") || msg.includes("CHAT_WRITE_FORBIDDEN")) return { kind: "privacy" };
  if (msg.includes("INPUT_USER_DEACTIVATED")) return { kind: "deactivated" };
  return { kind: "unknown", raw: msg };
}

const UNSUB_PATTERNS = [
  /отстань/i,
  /не\s*пиши/i,
  /не\s*писать/i,
  /спам/i,
  /unsubscribe/i,
  /отпис(ка|аться|ыва)/i,
  /жалоб[ауы]/i,
  /блокирую/i,
];

export function isUnsubscribeMessage(text) {
  if (!text) return false;
  return UNSUB_PATTERNS.some((re) => re.test(text));
}

export const _internal = { MIN_OUTBOUND_DELAY_MS, MAX_OUTBOUND_DELAY_MS, HOURLY_FIRST_MESSAGE_LIMIT };
