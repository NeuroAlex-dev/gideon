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
    // result.chats contains the joined chat(s)
    const chats = result.chats || [];
    if (chats.length === 0) {
      throw Object.assign(new Error("Invite returned no chats"), { code: "INVITE_EMPTY" });
    }
    return { entity: chats[0], joinedNow: true };
  } catch (e) {
    const msg = String(e?.errorMessage || e?.message || e);
    // Already a member — fetch entity via CheckChatInvite
    if (/USER_ALREADY_PARTICIPANT/.test(msg)) {
      const check = await c.invoke(new Api.messages.CheckChatInvite({ hash }));
      // check.chat is set when already a member
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
    // Try LeaveChannel first (works for supergroups and channels)
    await c.invoke(new Api.channels.LeaveChannel({ channel: entity }));
    return true;
  } catch (e) {
    // For legacy basic groups, use DeleteChatUser with self
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

  // Robust id stringification: GramJS uses BigInteger / bigint, plain String() may yield "[object Object]"
  const idStr = (v) => {
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "number") return String(v);
    if (typeof v.toString === "function") return v.toString();
    return String(v);
  };

  // Fetch admin list separately. Only supported on channels/supergroups; basic groups throw.
  const adminIds = new Set();
  const adminUserById = new Map(); // userId -> User object (for adding admins missing from participants)
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

  // Add admins that weren't in the regular participants list (anonymous admins,
  // admins from linked channels, hidden members, etc). They appear at the end.
  for (const [aid, a] of adminUserById) {
    if (seenIds.has(aid)) continue;
    if (a.bot) bots++;
    if (!a.username) {
      // No username — can't represent in our @username-only output. Skip silently.
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

  return {
    usernames,
    stats: { total, withUsername, withoutUsername, bots, admins },
  };
}

export function disconnectClient() {
  if (_client && _client.connected) {
    return _client.disconnect();
  }
}
