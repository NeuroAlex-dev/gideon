import Database from "better-sqlite3";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS style_interview (
  id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'in_progress',
  step INTEGER NOT NULL DEFAULT 0,
  answers_json TEXT NOT NULL DEFAULT '[]',
  materials_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY,
  origin TEXT NOT NULL,
  user_prompt TEXT,
  draft_text TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at INTEGER NOT NULL,
  approved_at INTEGER
);

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY,
  platform TEXT NOT NULL,
  ref TEXT NOT NULL,
  title TEXT,
  keywords_json TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS keywords (
  id INTEGER PRIMARY KEY,
  term TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'include',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS digests (
  id INTEGER PRIMARY KEY,
  created_at INTEGER NOT NULL,
  period TEXT,
  keywords_json TEXT,
  platforms_json TEXT,
  rendered_text TEXT,
  saved INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS digest_items (
  id INTEGER PRIMARY KEY,
  digest_id INTEGER NOT NULL,
  platform TEXT,
  source_ref TEXT,
  url TEXT,
  title TEXT,
  summary TEXT,
  raw_text TEXT,
  metrics_json TEXT,
  published_at INTEGER
);
`;

export function openDb(path = "./data/content-agent.db") {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// Idempotent миграции: ALTER TABLE если колонка ещё не добавлена в существующей БД.
function migrate(db) {
  const cols = db.prepare("PRAGMA table_info(sources)").all().map((c) => c.name);
  if (!cols.includes("keywords_json")) {
    db.exec("ALTER TABLE sources ADD COLUMN keywords_json TEXT");
  }
}

function parseSourceRow(row) {
  if (!row) return row;
  let keywords = [];
  if (row.keywords_json) {
    try { keywords = JSON.parse(row.keywords_json); if (!Array.isArray(keywords)) keywords = []; } catch {}
  }
  return { ...row, keywords };
}

export function getSetting(db, key) {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : null;
}

export function setSetting(db, key, value) {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

export function createInterview(db) {
  return db.prepare("INSERT INTO style_interview (created_at) VALUES (?)").run(Date.now()).lastInsertRowid;
}

export function getInterview(db, id) {
  return db.prepare("SELECT * FROM style_interview WHERE id = ?").get(id);
}

export function getActiveInterview(db) {
  return db.prepare("SELECT * FROM style_interview WHERE status = 'in_progress' ORDER BY id DESC LIMIT 1").get() ?? null;
}

export function addInterviewAnswer(db, id, question, transcript) {
  const iv = getInterview(db, id);
  const answers = JSON.parse(iv.answers_json);
  answers.push({ q: question, transcript });
  db.prepare("UPDATE style_interview SET answers_json = ?, step = ? WHERE id = ?")
    .run(JSON.stringify(answers), answers.length, id);
  return answers.length;
}

export function addInterviewMaterial(db, id, type, text) {
  const iv = getInterview(db, id);
  const materials = JSON.parse(iv.materials_json);
  materials.push({ type, text });
  db.prepare("UPDATE style_interview SET materials_json = ? WHERE id = ?")
    .run(JSON.stringify(materials), id);
  return materials.length;
}

export function finishInterview(db, id) {
  db.prepare("UPDATE style_interview SET status = 'done', finished_at = ? WHERE id = ?").run(Date.now(), id);
}

export function createPost(db, { origin, user_prompt = null }) {
  return db.prepare("INSERT INTO posts (origin, user_prompt, status, created_at) VALUES (?, ?, 'draft', ?)")
    .run(origin, user_prompt, Date.now()).lastInsertRowid;
}

export function getPost(db, id) {
  return db.prepare("SELECT * FROM posts WHERE id = ?").get(id);
}

export function updatePostDraft(db, id, draftText) {
  db.prepare("UPDATE posts SET draft_text = ? WHERE id = ?").run(draftText, id);
}

export function setPostStatus(db, id, status) {
  if (status === "approved") {
    db.prepare("UPDATE posts SET status = ?, approved_at = ? WHERE id = ?").run(status, Date.now(), id);
  } else {
    db.prepare("UPDATE posts SET status = ? WHERE id = ?").run(status, id);
  }
}

// Последние N постов с непустым draft_text — для подсказки писателю «не повторяйся».
// Исключаем конкретный id (только что созданный для генерации).
export function getRecentPostDrafts(db, { limit = 5, excludeId = null } = {}) {
  const rows = excludeId
    ? db.prepare("SELECT draft_text FROM posts WHERE draft_text IS NOT NULL AND draft_text != '' AND id != ? ORDER BY id DESC LIMIT ?").all(excludeId, limit)
    : db.prepare("SELECT draft_text FROM posts WHERE draft_text IS NOT NULL AND draft_text != '' ORDER BY id DESC LIMIT ?").all(limit);
  return rows.map((r) => r.draft_text);
}

// Реoткрывает последнее завершённое интервью — чтобы пользователь мог дополнить материалами
// и перегенерировать профиль без повторного прохождения 10 вопросов.
export function reopenLatestInterview(db) {
  const last = db.prepare("SELECT * FROM style_interview WHERE status = 'done' ORDER BY id DESC LIMIT 1").get();
  if (!last) return null;
  db.prepare("UPDATE style_interview SET status = 'in_progress', finished_at = NULL WHERE id = ?").run(last.id);
  return getInterview(db, last.id);
}

// ── Sources ──
export function addSource(db, { platform, ref, title = null, keywords = null }) {
  const kw = keywords && keywords.length ? JSON.stringify(keywords) : null;
  return db.prepare("INSERT INTO sources (platform, ref, title, keywords_json, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(platform, ref, title, kw, Date.now()).lastInsertRowid;
}
export function listSources(db, { platform = null } = {}) {
  const rows = platform
    ? db.prepare("SELECT * FROM sources WHERE active = 1 AND platform = ? ORDER BY id").all(platform)
    : db.prepare("SELECT * FROM sources WHERE active = 1 ORDER BY id").all();
  return rows.map(parseSourceRow);
}
export function getSource(db, id) {
  return parseSourceRow(db.prepare("SELECT * FROM sources WHERE id = ?").get(id));
}
export function updateSourceKeywords(db, id, keywords) {
  const kw = keywords && keywords.length ? JSON.stringify(keywords) : null;
  return db.prepare("UPDATE sources SET keywords_json = ? WHERE id = ?").run(kw, id).changes;
}
export function removeSource(db, id) {
  return db.prepare("DELETE FROM sources WHERE id = ?").run(id).changes;
}

// ── Keywords ──
export function addKeyword(db, { term, scope = "include" }) {
  return db.prepare("INSERT INTO keywords (term, scope, created_at) VALUES (?, ?, ?)")
    .run(term, scope, Date.now()).lastInsertRowid;
}
export function listKeywords(db) {
  return db.prepare("SELECT * FROM keywords ORDER BY id").all();
}
export function removeKeyword(db, id) {
  return db.prepare("DELETE FROM keywords WHERE id = ?").run(id).changes;
}

// ── Digests ──
export function createDigest(db, { period, keywords = [], platforms = [] }) {
  return db.prepare("INSERT INTO digests (created_at, period, keywords_json, platforms_json) VALUES (?, ?, ?, ?)")
    .run(Date.now(), period, JSON.stringify(keywords), JSON.stringify(platforms)).lastInsertRowid;
}
export function addDigestItems(db, digestId, items) {
  const stmt = db.prepare(`INSERT INTO digest_items
    (digest_id, platform, source_ref, url, title, summary, raw_text, metrics_json, published_at)
    VALUES (@digest_id, @platform, @source_ref, @url, @title, @summary, @raw_text, @metrics_json, @published_at)`);
  const tx = db.transaction((rows) => {
    for (const r of rows) {
      stmt.run({
        digest_id: digestId,
        platform: r.platform ?? "telegram",
        source_ref: r.source_ref ?? null,
        url: r.url ?? null,
        title: r.title ?? null,
        summary: r.summary ?? null,
        raw_text: r.text ?? r.raw_text ?? null,
        metrics_json: JSON.stringify(r.metrics ?? {}),
        published_at: r.date ?? r.published_at ?? null,
      });
    }
  });
  tx(items);
}
export function getDigest(db, id) {
  return db.prepare("SELECT * FROM digests WHERE id = ?").get(id);
}
export function listDigestItems(db, digestId) {
  return db.prepare("SELECT * FROM digest_items WHERE digest_id = ? ORDER BY id").all(digestId);
}
export function getDigestItem(db, id) {
  return db.prepare("SELECT * FROM digest_items WHERE id = ?").get(id);
}
export function setDigestRendered(db, id, text) {
  db.prepare("UPDATE digests SET rendered_text = ? WHERE id = ?").run(text, id);
}
export function saveDigest(db, id) {
  db.prepare("UPDATE digests SET saved = 1 WHERE id = ?").run(id);
}
