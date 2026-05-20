import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { Api } from "telegram";
import { normalizeChatRef } from "./chatref.js";

let _client = null;
let _sessionStore = null;
let _configured = false;
let _apiId = null;
let _apiHash = null;

export function configureClient({ apiId, apiHash, sessionStore }) {
  if (_configured) return _client;
  _apiId = Number(apiId);
  _apiHash = apiHash;
  const sessionString = sessionStore.load();
  const session = new StringSession(sessionString);
  _client = new TelegramClient(session, _apiId, _apiHash, {
    connectionRetries: 3,
    useWSS: true,
  });
  _sessionStore = sessionStore;
  _configured = true;
  return _client;
}

export async function reconfigureClient({ apiId, apiHash, sessionStore }) {
  if (_client && _client.connected) {
    try { await _client.disconnect(); } catch {}
  }
  _client = null;
  _sessionStore = null;
  _configured = false;
  return configureClient({ apiId, apiHash, sessionStore });
}

export function resetClient() {
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

export function getActiveStore() {
  return _sessionStore;
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

export function createTempClient({ apiId, apiHash }) {
  const session = new StringSession("");
  const client = new TelegramClient(session, Number(apiId), apiHash, {
    connectionRetries: 3,
    useWSS: true,
  });
  return client;
}

export function extractSessionString(client) {
  return client.session.save();
}

export async function resolveChat(chatRef) {
  const c = await ensureConnected();
  const ref = normalizeChatRef(chatRef);

  if (ref.type === "username") {
    const entity = await c.getEntity(ref.value);
    return { entity, joinedNow: false };
  }
  if (ref.type === "id") {
    const entity = await c.getEntity(Number(ref.value));
    return { entity, joinedNow: false };
  }
  if (ref.type === "invite") {
    return await joinByInvite(ref.value);
  }
  throw new Error("unsupported chat ref type");
}

async function joinByInvite(hash) {
  const c = await ensureConnected();
  try {
    const result = await c.invoke(new Api.messages.ImportChatInvite({ hash }));
    const chats = result.chats || [];
    if (chats.length === 0) {
      throw Object.assign(new Error("Invite returned no chats"), { code: "INVITE_EMPTY" });
    }
    return { entity: chats[0], joinedNow: true };
  } catch (e) {
    const msg = String(e?.errorMessage || e?.message || e);
    if (/USER_ALREADY_PARTICIPANT/.test(msg)) {
      const check = await c.invoke(new Api.messages.CheckChatInvite({ hash }));
      const entity = check?.chat;
      if (entity) return { entity, joinedNow: false };
      throw Object.assign(new Error("Already a member but no chat returned"), { code: "INVITE_ALREADY_MEMBER" });
    }
    if (/INVITE_REQUEST_SENT/.test(msg)) {
      throw Object.assign(new Error("Invite request sent, waiting for admin approval"), {
        code: "INVITE_REQUEST_SENT",
      });
    }
    if (/INVITE_HASH_EXPIRED|INVITE_HASH_INVALID/.test(msg)) {
      throw Object.assign(new Error("Invite link expired or invalid"), { code: "INVITE_INVALID" });
    }
    throw e;
  }
}

export async function leaveChat(entity) {
  const c = await ensureConnected();
  try {
    await c.invoke(new Api.channels.LeaveChannel({ channel: entity }));
    return true;
  } catch (e) {
    try {
      const me = await c.getMe();
      await c.invoke(
        new Api.messages.DeleteChatUser({ chatId: entity.id, userId: me.id })
      );
      return true;
    } catch (e2) {
      console.error("[leaveChat] both attempts failed:", e.message, "and", e2.message);
      return false;
    }
  }
}

export async function getParticipantUsernames(entity) {
  const c = await ensureConnected();
  const participants = await c.getParticipants(entity, { limit: 10000 });

  const idStr = (v) => {
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "number") return String(v);
    if (typeof v.toString === "function") return v.toString();
    return String(v);
  };

  const adminIds = new Set();
  const adminUserById = new Map();
  let creatorId = null;
  try {
    const adminList = await c.getParticipants(entity, {
      filter: new Api.ChannelParticipantsAdmins(),
      limit: 200,
    });
    for (const a of adminList) {
      const candidateId = idStr(a.participant?.userId) || idStr(a.userId) || idStr(a.id);
      if (!candidateId) continue;
      adminIds.add(candidateId);
      adminUserById.set(candidateId, a);
      const cls = a.participant?.className || a.participant?.constructor?.name;
      if (cls === "ChannelParticipantCreator") creatorId = candidateId;
    }
  } catch (e) {
    console.warn("[getParticipants] admin filter not available:", e?.message || e);
  }

  const usernames = [];
  const seenIds = new Set();
  let total = 0;
  let withUsername = 0;
  let withoutUsername = 0;
  let bots = 0;
  let admins = 0;

  for (const p of participants) {
    total++;
    seenIds.add(idStr(p.id));
    if (p.bot) bots++;
    if (!p.username) {
      withoutUsername++;
      continue;
    }
    withUsername++;
    const pid = idStr(p.id);
    const isCreator = pid === creatorId;
    const isAdmin = adminIds.has(pid) && !isCreator;
    if (isAdmin || isCreator) admins++;

    let prefix = "";
    if (p.bot) prefix += "🤖";
    if (isCreator) prefix += "⭐";
    else if (isAdmin) prefix += "👑";

    usernames.push(prefix ? `${prefix} @${p.username}` : `@${p.username}`);
  }

  for (const [aid, a] of adminUserById) {
    if (seenIds.has(aid)) continue;
    if (a.bot) bots++;
    if (!a.username) {
      continue;
    }
    total++;
    withUsername++;
    admins++;
    const cls = a.participant?.className || a.participant?.constructor?.name;
    const isCreator = cls === "ChannelParticipantCreator" || aid === creatorId;
    let prefix = "";
    if (a.bot) prefix += "🤖";
    prefix += isCreator ? "⭐" : "👑";
    usernames.push(`${prefix} @${a.username}`);
  }

  const sortRank = (str) => {
    if (str.startsWith("⭐") || str.startsWith("🤖⭐")) return 0;
    if (str.startsWith("👑") || str.startsWith("🤖👑")) return 1;
    if (str.startsWith("🤖")) return 2;
    return 3;
  };
  const indexed = usernames.map((u, i) => ({ u, i }));
  indexed.sort((a, b) => {
    const r = sortRank(a.u) - sortRank(b.u);
    return r !== 0 ? r : a.i - b.i;
  });
  const sortedUsernames = indexed.map((x) => x.u);

  const adminUsernames = sortedUsernames
    .filter((u) => u.startsWith("⭐") || u.startsWith("👑") || u.startsWith("🤖⭐") || u.startsWith("🤖👑"))
    .map((u) => {
      const at = u.indexOf("@");
      return at >= 0 ? u.slice(at) : u;
    });

  return {
    usernames: sortedUsernames,
    adminUsernames,
    stats: { total, withUsername, withoutUsername, bots, admins },
  };
}

export function disconnectClient() {
  if (_client && _client.connected) {
    return _client.disconnect();
  }
}
