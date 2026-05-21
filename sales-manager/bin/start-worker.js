import dotenv from "dotenv";
dotenv.config();
import { openDb } from "../lib/db.js";
import { createTelegramAdapter } from "../lib/telegram.js";
import { askClaude } from "../lib/ai.js";
import { createBotNotifier } from "../lib/bot-notifier.js";
import { createWorker } from "../worker.js";

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
