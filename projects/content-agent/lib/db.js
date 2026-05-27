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
`;

export function openDb(path = "./data/content-agent.db") {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
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
