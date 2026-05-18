import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { Api } from "telegram";
import { normalizeChatRef } from "./chatref.js";

let _client = null;
let _sessionStore = null;
let _configured = false;

export function configureClient({ apiId, apiHash, sessionStore }) {
  if (_configured) return _client; // idempotent: keep existing client and its connection
  const sessionString = sessionStore.load();
  const session = new StringSession(sessionString);
  _client = new TelegramClient(session, Number(apiId), apiHash, {
    connectionRetries: 3,
    useWSS: true,
  });
  _sessionStore = sessionStore;
  _configured = true;
  return _client;
}

export function resetClient() {
  // Used by tests and after logout
  _client = null;
  _sessionStore = null;
  _configured = false;
}

export function getClient() {
  if (!_client) {
    throw new Error("Telegram client not configured. Call configureClient() first.");
  }
  return _client;
}

export async function ensureConnected() {
  const c = getClient();
  if (!c.connected) {
    await c.connect();
  }
  return c;
}

export async function persistSession() {
  const c = getClient();
  if (!_sessionStore) throw new Error("sessionStore not set; call configureClient() first");
  const s = c.session.save();
  _sessionStore.save(s);
}

export async function resolveChat(chatRef) {
  const c = await ensureConnected();
  const ref = normalizeChatRef(chatRef);

  if (ref.type === "username") {
    return await c.getEntity(ref.value);
  }
  if (ref.type === "id") {
    return await c.getEntity(Number(ref.value));
  }
  if (ref.type === "invite") {
    // Joining via invite link is out of scope; user must already be a member.
    throw Object.assign(new Error("Invite links require joining first"), {
      code: "INVITE_NOT_SUPPORTED",
    });
  }
  throw new Error("unsupported chat ref type");
}

export async function getParticipantUsernames(entity) {
  const c = await ensureConnected();
  const participants = await c.getParticipants(entity, { limit: 10000 });

  const usernames = [];
  let total = 0;
  let withUsername = 0;
  let withoutUsername = 0;
  let bots = 0;

  for (const p of participants) {
    total++;
    if (p.bot) bots++;
    if (p.username) {
      withUsername++;
      usernames.push("@" + p.username);
    } else {
      withoutUsername++;
    }
  }

  return {
    usernames,
    stats: { total, withUsername, withoutUsername, bots },
  };
}

export function disconnectClient() {
  if (_client && _client.connected) {
    return _client.disconnect();
  }
}
