import dotenv from "dotenv";
dotenv.config();
import { openDb } from "../lib/db.js";
import { createTelegramAdapter } from "../lib/telegram.js";
import { askClaude } from "../lib/ai.js";
import { createBotNotifier } from "../lib/bot-notifier.js";
import { createWorker } from "../worker.js";
import { listAccounts, getActiveAccountId } from "../lib/sessions-manager.js";

// GramJS периодически бросает unhandledRejection/uncaughtException при reconnect.
// Любая ошибка где упоминается telegram/gramjs/socket/timeout — глушим.
// Воркер должен переживать сетевые сбои без рестарта (рестарт = потеря батч-таймеров).
const TRANSIENT_PATTERNS = /TIMEOUT|Not connected|disconnected|Connection closed|ECONNRESET|ETIMEDOUT|EPIPE|EHOSTUNREACH|ENETUNREACH|socket\s+hang|telegram[\\/].*node_modules|gramjs|MTProto|TCPFull|MTProtoSender|_updateLoop|_recvLoop/i;

function isTransientNetworkError(err) {
  const msg = err?.message || String(err) || "";
  const stack = err?.stack || "";
  return TRANSIENT_PATTERNS.test(msg) || TRANSIENT_PATTERNS.test(stack);
}

process.on("unhandledRejection", (err) => {
  if (isTransientNetworkError(err)) {
    console.warn("[worker] transient TG error (ignored):", (err?.message || String(err)).slice(0, 120));
    return;
  }
  console.error("[worker] unhandledRejection (kept alive):", err);
});

process.on("uncaughtException", (err) => {
  if (isTransientNetworkError(err)) {
    console.warn("[worker] transient TG uncaught (ignored):", (err?.message || String(err)).slice(0, 120));
    return;
  }
  console.error("[worker] uncaughtException (kept alive):", err?.message || err);
});

const db = openDb(process.env.SM_DB_PATH || "./data/sales-manager.db");

// Telegram pool: один адаптер на sessionId
const telegramPool = new Map();
function getTelegramFor(sessionId) {
  const key = sessionId || getActiveAccountId() || "default";
  if (!telegramPool.has(key)) {
    const adapter = createTelegramAdapter({ sessionId });
    telegramPool.set(key, adapter);
  }
  return telegramPool.get(key);
}

const notifyAlexander = createBotNotifier({
  botToken: process.env.TG_BOT_TOKEN,
  chatId: process.env.OWNER_CHAT_ID,
});

// Список сессий которые используются хотя бы одной running кампанией (+ active как fallback)
const runningSessionIds = new Set(
  db.prepare("SELECT DISTINCT session_id FROM campaigns WHERE status = 'running'").all().map((r) => r.session_id),
);
runningSessionIds.delete(null); // null = use active
const activeId = getActiveAccountId();
if (activeId) runningSessionIds.add(activeId); // активная сессия всегда подключается (для кампаний без явного session_id)

console.log(`[worker] available accounts:`, listAccounts().map((a) => `${a.id}${a.isActive ? "*" : ""}`).join(", "));
console.log(`[worker] will connect to sessions:`, [...runningSessionIds].join(", "));

// Прелоадим все нужные адаптеры
for (const sid of runningSessionIds) getTelegramFor(sid);

const worker = createWorker({ db, getTelegramFor, telegramPool, askClaude, notifyAlexander });
await worker.start();
console.log("sales-manager worker started");
process.on("SIGINT", async () => { await worker.stop(); process.exit(0); });
