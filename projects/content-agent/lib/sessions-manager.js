import fs from "node:fs";
import path from "node:path";

const PARSER_DATA_DIR = path.resolve("../parser/data");
const META_PATH = path.join(PARSER_DATA_DIR, "sessions", "_meta.json");
const LEGACY_SESSION_PATH = path.join(PARSER_DATA_DIR, "session.txt");

export function listAccounts() {
  if (fs.existsSync(META_PATH)) {
    try {
      const meta = JSON.parse(fs.readFileSync(META_PATH, "utf8"));
      const active = meta.activeId;
      return (meta.sessions || []).map((s) => ({
        id: s.id, label: s.label || s.id, username: s.username || null, isActive: s.id === active,
      }));
    } catch { return []; }
  }
  if (fs.existsSync(LEGACY_SESSION_PATH)) {
    return [{ id: "legacy", label: "Мой аккаунт (legacy)", username: null, isActive: true }];
  }
  return [];
}

export function getActiveAccountId() {
  if (fs.existsSync(META_PATH)) {
    try { return JSON.parse(fs.readFileSync(META_PATH, "utf8")).activeId || null; } catch { return null; }
  }
  return fs.existsSync(LEGACY_SESSION_PATH) ? "legacy" : null;
}

export function getSessionString(id) {
  if (!id || id === "active") {
    id = getActiveAccountId();
  }
  if (id === "legacy") {
    if (!fs.existsSync(LEGACY_SESSION_PATH)) throw new Error(`session: legacy ${LEGACY_SESSION_PATH} не найден`);
    return fs.readFileSync(LEGACY_SESSION_PATH, "utf8").trim();
  }
  const sessionFile = path.join(PARSER_DATA_DIR, "sessions", `${id}.txt`);
  if (!fs.existsSync(sessionFile)) throw new Error(`session: ${id} (${sessionFile}) не найден`);
  return fs.readFileSync(sessionFile, "utf8").trim();
}

// API_ID/HASH из env или parser/.env
export function getApiCredentials() {
  let apiId = Number(process.env.TG_API_ID || process.env.API_ID);
  let apiHash = process.env.TG_API_HASH || process.env.API_HASH;
  if (!apiId || !apiHash) {
    const envPath = path.resolve("../parser/.env");
    if (fs.existsSync(envPath)) {
      const env = {};
      for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
        if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
      apiId = apiId || Number(env.TG_API_ID || env.API_ID);
      apiHash = apiHash || env.TG_API_HASH || env.API_HASH;
    }
  }
  if (!apiId || !apiHash) throw new Error("TG_API_ID/TG_API_HASH не заданы (ни в env, ни в parser/.env)");
  return { apiId, apiHash };
}
