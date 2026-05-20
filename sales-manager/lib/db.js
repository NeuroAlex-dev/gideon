import Database from "better-sqlite3";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  mode TEXT,
  offer_text TEXT,
  offer_url TEXT,
  target_audience TEXT,
  goal_ikr TEXT,
  tone TEXT,
  stop_phrases TEXT,
  daily_message_limit INTEGER NOT NULL DEFAULT 15,
  working_hours_start INTEGER NOT NULL DEFAULT 10,
  working_hours_end INTEGER NOT NULL DEFAULT 21,
  timezone TEXT NOT NULL DEFAULT 'Europe/Moscow',
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  paused_at INTEGER,
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  tg_user_id INTEGER,
  tg_username TEXT,
  first_name TEXT,
  last_name TEXT,
  bio TEXT,
  source_chat_title TEXT,
  source_parse_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  next_action_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_leads_schedule ON leads(campaign_id, status, next_action_at);

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  stage TEXT NOT NULL DEFAULT 'intro',
  last_inbound_at INTEGER,
  last_outbound_at INTEGER,
  message_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL,
  body TEXT NOT NULL,
  tg_message_id INTEGER,
  status TEXT NOT NULL,
  scheduled_for INTEGER,
  sent_at INTEGER,
  received_at INTEGER,
  ai_model TEXT,
  ai_tokens_in INTEGER,
  ai_tokens_out INTEGER
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, sent_at);

CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES messages(id),
  telegram_bot_message_id INTEGER,
  status TEXT NOT NULL DEFAULT 'waiting',
  human_edit_text TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  lead_id INTEGER,
  campaign_id INTEGER,
  payload_json TEXT
);

CREATE TABLE IF NOT EXISTS leads_blocked (
  tg_user_id INTEGER PRIMARY KEY,
  reason TEXT,
  blocked_at INTEGER NOT NULL
);
`;

export function openDb(path = "./data/sales-manager.db") {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

export function createCampaign(db, fields) {
  const now = Date.now();
  const stmt = db.prepare(`
    INSERT INTO campaigns (name, offer_text, offer_url, target_audience, goal_ikr, tone, stop_phrases, created_at)
    VALUES (@name, @offer_text, @offer_url, @target_audience, @goal_ikr, @tone, @stop_phrases, @created_at)
  `);
  const res = stmt.run({
    name: fields.name,
    offer_text: fields.offer_text ?? null,
    offer_url: fields.offer_url ?? null,
    target_audience: fields.target_audience ?? null,
    goal_ikr: fields.goal_ikr ?? null,
    tone: fields.tone ?? null,
    stop_phrases: fields.stop_phrases ?? null,
    created_at: now,
  });
  return res.lastInsertRowid;
}

export function getCampaign(db, id) {
  return db.prepare("SELECT * FROM campaigns WHERE id = ?").get(id);
}

export function listCampaigns(db, { includeArchived = false } = {}) {
  const sql = includeArchived
    ? "SELECT * FROM campaigns ORDER BY created_at DESC"
    : "SELECT * FROM campaigns WHERE status != 'archived' ORDER BY created_at DESC";
  return db.prepare(sql).all();
}

const ALLOWED_UPDATE = new Set([
  "name", "mode", "offer_text", "offer_url", "target_audience", "goal_ikr",
  "tone", "stop_phrases", "daily_message_limit", "working_hours_start",
  "working_hours_end", "timezone",
]);

export function updateCampaign(db, id, patch) {
  const entries = Object.entries(patch).filter(([k]) => ALLOWED_UPDATE.has(k));
  if (!entries.length) return 0;
  const sets = entries.map(([k]) => `${k} = @${k}`).join(", ");
  const stmt = db.prepare(`UPDATE campaigns SET ${sets} WHERE id = @id`);
  return stmt.run({ ...Object.fromEntries(entries), id }).changes;
}

const STATUS_TIMESTAMP_FIELD = {
  running: "started_at",
  paused: "paused_at",
  completed: "completed_at",
};

export function setCampaignStatus(db, id, status) {
  const field = STATUS_TIMESTAMP_FIELD[status];
  if (field) {
    db.prepare(`UPDATE campaigns SET status = ?, ${field} = ? WHERE id = ?`).run(status, Date.now(), id);
  } else {
    db.prepare(`UPDATE campaigns SET status = ? WHERE id = ?`).run(status, id);
  }
}

export function addLeads(db, campaignId, leads) {
  const now = Date.now();
  const insert = db.prepare(`
    INSERT INTO leads (campaign_id, tg_user_id, tg_username, first_name, last_name, bio, source_chat_title, source_parse_id, next_action_at, created_at)
    SELECT @campaign_id, @tg_user_id, @tg_username, @first_name, @last_name, @bio, @source_chat_title, @source_parse_id, @next_action_at, @created_at
    WHERE NOT EXISTS (
      SELECT 1 FROM leads WHERE campaign_id = @campaign_id AND tg_user_id IS NOT NULL AND tg_user_id = @tg_user_id
    )
  `);
  const tx = db.transaction((rows) => {
    let inserted = 0;
    for (const r of rows) {
      const res = insert.run({
        campaign_id: campaignId,
        tg_user_id: r.tg_user_id ?? null,
        tg_username: r.tg_username ?? null,
        first_name: r.first_name ?? null,
        last_name: r.last_name ?? null,
        bio: r.bio ?? null,
        source_chat_title: r.source_chat_title ?? null,
        source_parse_id: r.source_parse_id ?? null,
        next_action_at: r.next_action_at ?? now,
        created_at: now,
      });
      if (res.changes) inserted++;
    }
    return inserted;
  });
  return tx(leads);
}

export function getLead(db, id) {
  return db.prepare("SELECT * FROM leads WHERE id = ?").get(id);
}

export function listLeads(db, campaignId, { status = null, limit = 1000 } = {}) {
  const sql = status
    ? "SELECT * FROM leads WHERE campaign_id = ? AND status = ? ORDER BY created_at LIMIT ?"
    : "SELECT * FROM leads WHERE campaign_id = ? ORDER BY created_at LIMIT ?";
  return status
    ? db.prepare(sql).all(campaignId, status, limit)
    : db.prepare(sql).all(campaignId, limit);
}

export function setLeadStatus(db, id, status, nextActionAt = null) {
  if (nextActionAt !== null) {
    db.prepare("UPDATE leads SET status = ?, next_action_at = ? WHERE id = ?").run(status, nextActionAt, id);
  } else {
    db.prepare("UPDATE leads SET status = ? WHERE id = ?").run(status, id);
  }
}

export function nextLeadToContact(db, campaignId, now) {
  return db.prepare(`
    SELECT * FROM leads
    WHERE campaign_id = ? AND status = 'queued' AND (next_action_at IS NULL OR next_action_at <= ?)
    ORDER BY next_action_at ASC, id ASC
    LIMIT 1
  `).get(campaignId, now) ?? null;
}

export function blockLead(db, tgUserId, reason) {
  db.prepare("INSERT OR REPLACE INTO leads_blocked (tg_user_id, reason, blocked_at) VALUES (?, ?, ?)")
    .run(tgUserId, reason ?? null, Date.now());
}

export function isLeadBlocked(db, tgUserId) {
  return !!db.prepare("SELECT 1 FROM leads_blocked WHERE tg_user_id = ?").get(tgUserId);
}

export function getOrCreateConversation(db, leadId, campaignId) {
  const existing = db.prepare("SELECT * FROM conversations WHERE lead_id = ? AND campaign_id = ?").get(leadId, campaignId);
  if (existing) return existing;
  const id = db.prepare("INSERT INTO conversations (lead_id, campaign_id) VALUES (?, ?)").run(leadId, campaignId).lastInsertRowid;
  return db.prepare("SELECT * FROM conversations WHERE id = ?").get(id);
}

export function addMessage(db, { conversation_id, role, body, status, tg_message_id = null, scheduled_for = null, sent_at = null, received_at = null, ai_model = null, ai_tokens_in = null, ai_tokens_out = null }) {
  const id = db.prepare(`
    INSERT INTO messages (conversation_id, role, body, tg_message_id, status, scheduled_for, sent_at, received_at, ai_model, ai_tokens_in, ai_tokens_out)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(conversation_id, role, body, tg_message_id, status, scheduled_for, sent_at, received_at, ai_model, ai_tokens_in, ai_tokens_out).lastInsertRowid;
  db.prepare("UPDATE conversations SET message_count = message_count + 1 WHERE id = ?").run(conversation_id);
  if (role === "outbound") db.prepare("UPDATE conversations SET last_outbound_at = ? WHERE id = ?").run(sent_at ?? Date.now(), conversation_id);
  if (role === "inbound") db.prepare("UPDATE conversations SET last_inbound_at = ? WHERE id = ?").run(received_at ?? Date.now(), conversation_id);
  return id;
}

export function listMessages(db, conversationId, { limit = 200 } = {}) {
  return db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC LIMIT ?").all(conversationId, limit);
}

export function updateMessageStatus(db, id, status, patch = {}) {
  const fields = ["status"];
  const values = [status];
  for (const k of ["sent_at", "received_at", "tg_message_id"]) {
    if (patch[k] !== undefined) { fields.push(k); values.push(patch[k]); }
  }
  const sets = fields.map((f) => `${f} = ?`).join(", ");
  db.prepare(`UPDATE messages SET ${sets} WHERE id = ?`).run(...values, id);
}

export function setConversationStage(db, conversationId, stage) {
  db.prepare("UPDATE conversations SET stage = ? WHERE id = ?").run(stage, conversationId);
}
