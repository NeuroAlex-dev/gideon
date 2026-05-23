import fs from "node:fs";
import path from "node:path";

const PARSER_DATA_DIR = path.resolve("../parser/data");
const META_PATH = path.join(PARSER_DATA_DIR, "sessions", "_meta.json");
const LEGACY_SESSION_PATH = path.join(PARSER_DATA_DIR, "session.txt");

/**
 * Возвращает список доступных TG-аккаунтов из парсера.
 * Каждый аккаунт: { id, label, phone, username, tgUserId, isActive }
 */
export function listAccounts() {
  if (fs.existsSync(META_PATH)) {
    try {
      const meta = JSON.parse(fs.readFileSync(META_PATH, "utf8"));
      const active = meta.activeId;
      return (meta.sessions || []).map((s) => ({
        id: s.id,
        label: s.label || s.id,
        phone: s.phone || null,
        username: s.username || null,
        tgUserId: s.tgUserId || null,
        isActive: s.id === active,
      }));
    } catch {
      return [];
    }
  }
  // Legacy: один session.txt без _meta.json
  if (fs.existsSync(LEGACY_SESSION_PATH)) {
    return [{ id: "legacy", label: "Мой аккаунт (legacy)", phone: null, username: null, tgUserId: null, isActive: true }];
  }
  return [];
}

/**
 * Возвращает строку сессии по id. Если id="legacy" — читает session.txt.
 * Если id не указан — возвращает активную сессию.
 */
export function getSessionString(id) {
  if (!id || id === "active") {
    if (fs.existsSync(META_PATH)) {
      const meta = JSON.parse(fs.readFileSync(META_PATH, "utf8"));
      id = meta.activeId;
    } else {
      id = "legacy";
    }
  }
  if (id === "legacy") {
    if (!fs.existsSync(LEGACY_SESSION_PATH)) {
      throw new Error(`session: legacy ${LEGACY_SESSION_PATH} не найден`);
    }
    return fs.readFileSync(LEGACY_SESSION_PATH, "utf8").trim();
  }
  const sessionFile = path.join(PARSER_DATA_DIR, "sessions", `${id}.txt`);
  if (!fs.existsSync(sessionFile)) {
    throw new Error(`session: ${id} (${sessionFile}) не найден`);
  }
  return fs.readFileSync(sessionFile, "utf8").trim();
}

export function getActiveAccountId() {
  if (fs.existsSync(META_PATH)) {
    try {
      const meta = JSON.parse(fs.readFileSync(META_PATH, "utf8"));
      return meta.activeId || null;
    } catch { return null; }
  }
  return fs.existsSync(LEGACY_SESSION_PATH) ? "legacy" : null;
}
