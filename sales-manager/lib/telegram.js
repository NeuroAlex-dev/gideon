import fs from "node:fs";
import path from "node:path";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";

const PARSER_DATA_DIR = path.resolve("../parser/data");
const LEGACY_SESSION_PATH = path.resolve("../parser/data/session.txt");
const SESSIONS_META_PATH = path.resolve("../parser/data/sessions/_meta.json");
const PARSER_ENV_PATH = path.resolve("../parser/.env");

function defaultSessionLoader() {
  if (fs.existsSync(SESSIONS_META_PATH)) {
    const meta = JSON.parse(fs.readFileSync(SESSIONS_META_PATH, "utf8"));
    const activeId = meta.activeId;
    if (!activeId) throw new Error(`sessions: в ${SESSIONS_META_PATH} нет activeId`);
    const sessionFile = path.join(PARSER_DATA_DIR, "sessions", `${activeId}.txt`);
    if (!fs.existsSync(sessionFile)) {
      throw new Error(`sessions: активная сессия ${activeId} (${sessionFile}) не найдена`);
    }
    return fs.readFileSync(sessionFile, "utf8").trim();
  }
  if (fs.existsSync(LEGACY_SESSION_PATH)) {
    return fs.readFileSync(LEGACY_SESSION_PATH, "utf8").trim();
  }
  throw new Error(`sessions: ни ${SESSIONS_META_PATH}, ни ${LEGACY_SESSION_PATH} не найдены — сначала залогинься в парсере`);
}

function readParserEnv() {
  if (!fs.existsSync(PARSER_ENV_PATH)) return {};
  const out = {};
  for (const line of fs.readFileSync(PARSER_ENV_PATH, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function defaultClientFactory(sessionString) {
  let apiId = Number(process.env.TG_API_ID || process.env.API_ID);
  let apiHash = process.env.TG_API_HASH || process.env.API_HASH;
  if (!apiId || !apiHash) {
    const parserEnv = readParserEnv();
    apiId = apiId || Number(parserEnv.TG_API_ID || parserEnv.API_ID);
    apiHash = apiHash || parserEnv.TG_API_HASH || parserEnv.API_HASH;
  }
  if (!apiId || !apiHash) throw new Error("TG_API_ID/TG_API_HASH не заданы (ни в env, ни в parser/.env)");
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
