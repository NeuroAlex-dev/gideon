#!/usr/bin/env node
import dotenv from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { createSessionStore } from "./lib/session.js";
import { configureClient } from "./lib/telegram.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env") });

const chatRef = process.argv[2];
if (!chatRef) {
  console.error("Usage: node parse.js <@chatname | t.me/... | id>");
  process.exit(1);
}

const sessionStore = createSessionStore(join(__dirname, "data", "session.txt"));
if (!sessionStore.isAuthorized()) {
  console.error("Not authorized. Open the web UI and complete sign-in first.");
  process.exit(1);
}
if (!process.env.API_ID || !process.env.API_HASH) {
  console.error("API_ID/API_HASH missing in .env");
  process.exit(1);
}

configureClient({
  apiId: process.env.API_ID,
  apiHash: process.env.API_HASH,
  sessionStore,
});

const { resolveChat, getParticipantUsernames, disconnectClient } = await import("./lib/telegram.js");

try {
  const entity = await resolveChat(chatRef);
  const { usernames, stats } = await getParticipantUsernames(entity);
  console.log(`Chat: ${entity.title || chatRef}`);
  console.log(`Stats:`, stats);
  const date = new Date().toISOString().slice(0, 10);
  const safe = String(entity.title || chatRef).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  const file = `${safe}-${date}.txt`;
  writeFileSync(file, usernames.join("\n"), "utf8");
  console.log(`Wrote ${usernames.length} usernames → ${file}`);
} catch (e) {
  console.error("Error:", e.message || e);
  process.exit(1);
} finally {
  await disconnectClient();
}
