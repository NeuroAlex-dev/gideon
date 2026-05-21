import dotenv from "dotenv";
dotenv.config();
import { openDb } from "../lib/db.js";
import { createTelegramAdapter } from "../lib/telegram.js";
import { askClaude } from "../lib/ai.js";
import { createBotNotifier } from "../lib/bot-notifier.js";
import { createWorker } from "../worker.js";

// GramJS периодически бросает unhandledRejection при reconnect — не валим процесс,
// gramjs сам автоматически переподключится. Воркер должен переживать сетевые сбои.
process.on("unhandledRejection", (err) => {
  const msg = err?.message || String(err);
  if (/TIMEOUT|Not connected|disconnected|Connection closed/i.test(msg)) {
    console.warn("[worker] transient TG error (ignored):", msg.slice(0, 100));
    return;
  }
  console.error("[worker] unhandledRejection:", err);
});
process.on("uncaughtException", (err) => {
  console.error("[worker] uncaughtException:", err?.message || err);
});

const db = openDb(process.env.SM_DB_PATH || "./data/sales-manager.db");
const telegram = createTelegramAdapter();
const notifyAlexander = createBotNotifier({
  botToken: process.env.TG_BOT_TOKEN,
  chatId: process.env.OWNER_CHAT_ID,
});
const worker = createWorker({ db, telegram, askClaude, notifyAlexander });
await worker.start();
console.log("sales-manager worker started");
process.on("SIGINT", async () => { await worker.stop(); process.exit(0); });
