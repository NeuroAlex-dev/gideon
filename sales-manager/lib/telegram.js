import fs from "node:fs";
import path from "node:path";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";

const DEFAULT_SESSION_PATH = path.resolve("../parser/data/session.txt");

function defaultSessionLoader() {
  if (!fs.existsSync(DEFAULT_SESSION_PATH)) {
    throw new Error(`sessions: ${DEFAULT_SESSION_PATH} не найден — сначала залогинься в парсере`);
  }
  return fs.readFileSync(DEFAULT_SESSION_PATH, "utf8").trim();
}

function defaultClientFactory(sessionString) {
  const apiId = Number(process.env.TG_API_ID || process.env.API_ID);
  const apiHash = process.env.TG_API_HASH || process.env.API_HASH;
  if (!apiId || !apiHash) throw new Error("TG_API_ID/TG_API_HASH не заданы в env");
  return new TelegramClient(new StringSession(sessionString), apiId, apiHash, {
    connectionRetries: 3,
    useWSS: true,
  });
}

export function createTelegramAdapter({ sessionLoader = defaultSessionLoader, clientFactory = defaultClientFactory } = {}) {
  let client = null;
  let connected = false;

  async function connect() {
    if (connected) return;
    const session = sessionLoader();
    client = clientFactory(session);
    await client.connect();
    connected = true;
  }

  async function disconnect() {
    if (client && connected) {
      try { await client.disconnect(); } catch {}
    }
    connected = false;
    client = null;
  }

  async function sendMessage({ peer, text, typingMs = 0 }) {
    if (!connected) throw new Error("telegram: connect() сначала");
    if (typingMs > 0) {
      try { await client.invoke(new Api.messages.SetTyping({ peer, action: new Api.SendMessageTypingAction() })); } catch {}
      await sleep(typingMs);
    }
    const res = await client.sendMessage(peer, { message: text });
    return res.id;
  }

  function onNewMessage(handler) {
    if (!connected) throw new Error("telegram: connect() сначала");
    client.addEventHandler(handler, new NewMessage({}));
  }

  async function getUserBio(userIdOrUsername) {
    if (!connected) throw new Error("telegram: connect() сначала");
    try {
      const full = await client.invoke(new Api.users.GetFullUser({ id: userIdOrUsername }));
      return full?.fullUser?.about ?? null;
    } catch {
      return null;
    }
  }

  function rawClient() { return client; }

  return { connect, disconnect, sendMessage, onNewMessage, getUserBio, rawClient };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
