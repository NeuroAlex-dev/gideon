import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, chmodSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

function genId() {
  return "s_" + randomBytes(6).toString("hex");
}

export function createSessionsManager(dataDir) {
  const sessionsDir = join(dataDir, "sessions");
  const metaPath = join(sessionsDir, "_meta.json");
  const legacySessionPath = join(dataDir, "session.txt");

  function ensureDir() {
    if (!existsSync(sessionsDir)) {
      mkdirSync(sessionsDir, { recursive: true });
    }
  }

  function emptyMeta() {
    return { version: 1, activeId: null, sessions: [] };
  }

  function loadMeta() {
    if (!existsSync(metaPath)) return null;
    try {
      return JSON.parse(readFileSync(metaPath, "utf8"));
    } catch {
      return null;
    }
  }

  function saveMeta(meta) {
    ensureDir();
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");
    try { chmodSync(metaPath, 0o600); } catch {}
  }

  function sessionFile(id) {
    return join(sessionsDir, `${id}.txt`);
  }

  function migrateLegacyIfNeeded() {
    let meta = loadMeta();
    if (meta) return meta;

    ensureDir();

    let legacy = "";
    if (existsSync(legacySessionPath)) {
      try { legacy = readFileSync(legacySessionPath, "utf8").trim(); } catch {}
    }

    if (legacy) {
      const id = "s_migrated";
      writeFileSync(sessionFile(id), legacy, "utf8");
      try { chmodSync(sessionFile(id), 0o600); } catch {}
      meta = {
        version: 1,
        activeId: id,
        sessions: [{
          id,
          label: "Мой аккаунт",
          phone: null,
          tgUserId: null,
          username: null,
          createdAt: new Date().toISOString(),
        }],
      };
      try { renameSync(legacySessionPath, legacySessionPath + ".bak"); } catch {}
    } else {
      meta = emptyMeta();
    }
    saveMeta(meta);
    return meta;
  }

  let meta = migrateLegacyIfNeeded();

  function list() {
    return meta.sessions.map((s) => ({ ...s }));
  }

  function getActiveId() {
    return meta.activeId;
  }

  function getActive() {
    if (!meta.activeId) return null;
    return meta.sessions.find((s) => s.id === meta.activeId) || null;
  }

  function find(id) {
    return meta.sessions.find((s) => s.id === id) || null;
  }

  function setActive(id) {
    if (id !== null && !find(id)) {
      throw new Error(`session ${id} not found`);
    }
    meta.activeId = id;
    saveMeta(meta);
  }

  function add({ label, sessionString, phone = null, tgUserId = null, username = null }) {
    const id = genId();
    ensureDir();
    writeFileSync(sessionFile(id), sessionString || "", "utf8");
    try { chmodSync(sessionFile(id), 0o600); } catch {}
    const entry = {
      id,
      label: String(label || "Без названия").slice(0, 64),
      phone,
      tgUserId,
      username,
      createdAt: new Date().toISOString(),
    };
    meta.sessions.push(entry);
    if (!meta.activeId) meta.activeId = id;
    saveMeta(meta);
    return { ...entry };
  }

  function rename(id, label) {
    const s = find(id);
    if (!s) throw new Error(`session ${id} not found`);
    s.label = String(label || "Без названия").slice(0, 64);
    saveMeta(meta);
    return { ...s };
  }

  function remove(id) {
    const idx = meta.sessions.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    meta.sessions.splice(idx, 1);
    const f = sessionFile(id);
    if (existsSync(f)) {
      try { unlinkSync(f); } catch {}
    }
    if (meta.activeId === id) {
      meta.activeId = meta.sessions[0]?.id || null;
    }
    saveMeta(meta);
    return true;
  }

  function createStoreForId(id) {
    const filePath = sessionFile(id);
    return {
      load() {
        if (!existsSync(filePath)) return "";
        try { return readFileSync(filePath, "utf8").trim(); } catch { return ""; }
      },
      save(value) {
        ensureDir();
        writeFileSync(filePath, value, { encoding: "utf8" });
        try { chmodSync(filePath, 0o600); } catch {}
      },
      clear() {
        if (existsSync(filePath)) {
          try { unlinkSync(filePath); } catch {}
        }
      },
      isAuthorized() {
        return this.load() !== "";
      },
    };
  }

  function getActiveStore() {
    if (!meta.activeId) return null;
    return createStoreForId(meta.activeId);
  }

  function updateMetaForActive(patch) {
    const active = getActive();
    if (!active) return;
    Object.assign(active, patch);
    saveMeta(meta);
  }

  return {
    list,
    getActiveId,
    getActive,
    find,
    setActive,
    add,
    rename,
    remove,
    createStoreForId,
    getActiveStore,
    updateMetaForActive,
  };
}
