import express from "express";
import { readFileSync, existsSync, appendFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import dotenv from "dotenv";
import {
  configureClient,
  reconfigureClient,
  resetClient,
  createTempClient,
  extractSessionString,
  disconnectClient,
  getClient,
} from "./lib/telegram.js";
import { sendCode, signIn, sendCodeOnClient, resendCodeOnClient, signInOnClient, logout } from "./lib/auth.js";
import { verifyPassword, hashPassword } from "./lib/password.js";
import { issueSession, verifyToken } from "./lib/web-session.js";
import { createSessionsManager } from "./lib/sessions-manager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, ".env") });

const VERSION = "1.0.0";

const sessionsManager = createSessionsManager(join(__dirname, "data"));

function activeSessionStore() {
  return sessionsManager.getActiveStore();
}

function hasCredentials() {
  return Boolean(process.env.API_ID && process.env.API_HASH);
}

function hasLoginPassword() {
  return Boolean(process.env.LOGIN_PASSWORD_HASH && process.env.LOGIN_PASSWORD_HASH.trim());
}

function ensureClientConfigured() {
  if (!hasCredentials()) return false;
  const store = activeSessionStore();
  if (!store) return false;
  configureClient({
    apiId: process.env.API_ID,
    apiHash: process.env.API_HASH,
    sessionStore: store,
  });
  return true;
}

const tempClients = new Map(); // tempId -> { client, label, phone, expiresAt }
const TEMP_TTL_MS = 10 * 60 * 1000;

function pruneTempClients() {
  const now = Date.now();
  for (const [k, v] of tempClients) {
    if (v.expiresAt < now) {
      try { v.client?.disconnect?.(); } catch {}
      tempClients.delete(k);
    }
  }
}

setInterval(pruneTempClients, 60 * 1000).unref?.();

function setEnvVar(name, value) {
  const envPath = join(__dirname, ".env");
  const line = `${name}=${value}`;
  if (existsSync(envPath)) {
    const txt = readFileSync(envPath, "utf8");
    const re = new RegExp(`^${name}=.*$`, "m");
    if (re.test(txt)) {
      writeFileSync(envPath, txt.replace(re, line), "utf8");
    } else {
      appendFileSync(envPath, `\n${line}\n`, "utf8");
    }
  } else {
    writeFileSync(envPath, `${line}\n`, "utf8");
  }
  process.env[name] = value;
}

function ensureSessionSecret() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim()) {
    return process.env.SESSION_SECRET.trim();
  }
  const generated = randomBytes(32).toString("hex");
  setEnvVar("SESSION_SECRET", generated);
  return generated;
}

function isLoopback(ip) {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function extractBearer(req) {
  const h = req.headers.authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

function requireSession(req, res, next) {
  if (isLoopback(req.ip)) return next();
  const token = extractBearer(req);
  if (!token) return res.status(401).json({ error: "unauthorized" });
  const payload = verifyToken(token, process.env.SESSION_SECRET);
  if (!payload) return res.status(401).json({ error: "unauthorized" });
  req.session = payload;
  return next();
}

const loginAttempts = new Map(); // ip -> { count, firstAt }
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

function checkLoginRateLimit(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now - entry.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, firstAt: now });
    return { allowed: true };
  }
  entry.count += 1;
  if (entry.count > LOGIN_MAX_ATTEMPTS) {
    const retryAfter = Math.ceil((LOGIN_WINDOW_MS - (now - entry.firstAt)) / 1000);
    return { allowed: false, retryAfter };
  }
  return { allowed: true };
}

function clearLoginRateLimit(ip) {
  loginAttempts.delete(ip);
}

const parseCache = new Map(); // jobId -> { chat, usernames, stats, expiresAt }
let parseInProgress = false;

function pruneCache() {
  const now = Date.now();
  for (const [k, v] of parseCache) {
    if (v.expiresAt < now) parseCache.delete(k);
  }
}

function withTimeout(promise, ms, errMessage) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error(errMessage), { code: "TIMEOUT" })), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

export function createApp() {
  const app = express();
  app.set("trust proxy", "loopback");
  app.use(express.json({ limit: "100kb" }));
  app.use(express.static(join(__dirname, "public"), { index: "index.html" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, version: VERSION });
  });

  app.get("/api/auth/needs-setup", (_req, res) => {
    res.json({ needsSetup: !hasLoginPassword() });
  });

  app.post("/api/auth/setup", (req, res) => {
    if (hasLoginPassword()) {
      return res.status(409).json({ error: "already_set", hint: "Пароль уже задан. Используй смену пароля." });
    }
    const { password } = req.body || {};
    if (!password || typeof password !== "string") {
      return res.status(400).json({ error: "password_required" });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "password_too_short", hint: "Минимум 8 символов" });
    }
    const hash = hashPassword(password);
    setEnvVar("LOGIN_PASSWORD_HASH", hash);
    const token = issueSession(process.env.SESSION_SECRET);
    res.json({ token });
  });

  app.post("/api/auth/reset-password-from-bot", (req, res) => {
    if (!isLoopback(req.ip)) {
      return res.status(403).json({ error: "loopback_only" });
    }
    setEnvVar("LOGIN_PASSWORD_HASH", "");
    delete process.env.LOGIN_PASSWORD_HASH;
    const newSecret = randomBytes(32).toString("hex");
    setEnvVar("SESSION_SECRET", newSecret);
    res.json({ ok: true });
  });

  app.post("/api/auth/change-password", requireSession, (req, res) => {
    if (!hasLoginPassword()) {
      return res.status(400).json({ error: "no_password_set" });
    }
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "fields_required" });
    }
    if (typeof newPassword !== "string" || newPassword.length < 8) {
      return res.status(400).json({ error: "password_too_short", hint: "Минимум 8 символов" });
    }
    if (!verifyPassword(currentPassword, process.env.LOGIN_PASSWORD_HASH)) {
      return res.status(401).json({ error: "wrong_current_password" });
    }
    const hash = hashPassword(newPassword);
    setEnvVar("LOGIN_PASSWORD_HASH", hash);
    res.json({ ok: true });
  });

  app.post("/api/auth/login", (req, res) => {
    const rate = checkLoginRateLimit(req.ip);
    if (!rate.allowed) {
      return res.status(429).json({ error: "too_many_attempts", retryAfter: rate.retryAfter });
    }
    if (!hasLoginPassword()) {
      return res.status(500).json({
        error: "no_password_set",
        hint: "Запусти на сервере: node parser/scripts/set-password.js <пароль>",
      });
    }
    const { password } = req.body || {};
    if (!password || typeof password !== "string") {
      return res.status(400).json({ error: "password_required" });
    }
    if (!verifyPassword(password, process.env.LOGIN_PASSWORD_HASH)) {
      return res.status(401).json({ error: "wrong_password" });
    }
    clearLoginRateLimit(req.ip);
    const token = issueSession(process.env.SESSION_SECRET);
    res.json({ token });
  });

  app.get("/api/auth/me", requireSession, (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/auth/status", requireSession, (_req, res) => {
    const active = sessionsManager.getActive();
    res.json({
      authorized: (activeSessionStore()?.isAuthorized() ?? false),
      hasCredentials: hasCredentials(),
      hasActiveSession: Boolean(active),
      activeSession: active ? {
        id: active.id,
        label: active.label,
        username: active.username,
        tgUserId: active.tgUserId,
      } : null,
    });
  });

  app.post("/api/auth/send-code", requireSession, async (req, res) => {
    if (!hasCredentials()) {
      return res.status(400).json({ error: "no_credentials", hint: "Заполни API_ID/API_HASH в parser/.env" });
    }
    const { phone } = req.body || {};
    if (!phone || typeof phone !== "string") {
      return res.status(400).json({ error: "phone_required" });
    }
    try {
      ensureClientConfigured();
      const result = await sendCode(phone);
      res.json(result);
    } catch (e) {
      console.error("[send-code]", e);
      res.status(500).json({ error: "send_code_failed", message: String(e?.message || e) });
    }
  });

  app.post("/api/auth/sign-in", requireSession, async (req, res) => {
    const { phone, phoneCodeHash, code, password } = req.body || {};
    if (!phone || !phoneCodeHash || !code) {
      return res.status(400).json({ error: "missing_fields" });
    }
    try {
      ensureClientConfigured();
      const result = await signIn({ phone, phoneCodeHash, code, password });
      res.json(result);
    } catch (e) {
      if (e?.code === "2fa_required") {
        return res.status(400).json({ error: "2fa_required" });
      }
      console.error("[sign-in]", e);
      res.status(500).json({ error: "sign_in_failed", message: String(e?.message || e) });
    }
  });

  app.post("/api/auth/tg-logout", requireSession, async (_req, res) => {
    const active = sessionsManager.getActive();
    if (!active) {
      return res.status(400).json({ error: "no_active_session" });
    }
    try {
      const store = sessionsManager.createStoreForId(active.id);
      if (hasCredentials()) {
        ensureClientConfigured();
      }
      try { await logout(store); } catch {}
      sessionsManager.remove(active.id);
      resetClient();
      res.json({ ok: true });
    } catch (e) {
      console.error("[tg-logout]", e);
      res.status(500).json({ error: "logout_failed" });
    }
  });

  app.get("/api/sessions", requireSession, (_req, res) => {
    res.json({
      sessions: sessionsManager.list(),
      activeId: sessionsManager.getActiveId(),
    });
  });

  app.post("/api/sessions/activate", requireSession, async (req, res) => {
    if (parseInProgress) {
      return res.status(409).json({ error: "parse_in_progress", hint: "Дождись окончания парсинга и попробуй снова" });
    }
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: "id_required" });
    const target = sessionsManager.find(id);
    if (!target) return res.status(404).json({ error: "session_not_found" });
    try {
      try { await disconnectClient(); } catch {}
      resetClient();
      sessionsManager.setActive(id);
      ensureClientConfigured();
      res.json({ ok: true, activeId: id });
    } catch (e) {
      console.error("[sessions/activate]", e);
      res.status(500).json({ error: "activate_failed", message: String(e?.message || e) });
    }
  });

  app.patch("/api/sessions/:id", requireSession, (req, res) => {
    const { id } = req.params;
    const { label } = req.body || {};
    if (!label || typeof label !== "string") {
      return res.status(400).json({ error: "label_required" });
    }
    try {
      const updated = sessionsManager.rename(id, label);
      res.json(updated);
    } catch (e) {
      res.status(404).json({ error: "session_not_found" });
    }
  });

  app.delete("/api/sessions/:id", requireSession, async (req, res) => {
    if (parseInProgress) {
      return res.status(409).json({ error: "parse_in_progress" });
    }
    const { id } = req.params;
    const target = sessionsManager.find(id);
    if (!target) return res.status(404).json({ error: "session_not_found" });
    const wasActive = sessionsManager.getActiveId() === id;
    try {
      if (wasActive) {
        try { await disconnectClient(); } catch {}
        resetClient();
      }
      sessionsManager.remove(id);
      if (wasActive) {
        if (sessionsManager.getActiveId()) {
          ensureClientConfigured();
        }
      }
      res.json({ ok: true, newActiveId: sessionsManager.getActiveId() });
    } catch (e) {
      console.error("[sessions/delete]", e);
      res.status(500).json({ error: "delete_failed" });
    }
  });

  app.post("/api/sessions/add/send-code", requireSession, async (req, res) => {
    if (!hasCredentials()) {
      return res.status(400).json({ error: "no_credentials", hint: "Заполни API_ID/API_HASH в parser/.env" });
    }
    const { phone, label } = req.body || {};
    if (!phone || typeof phone !== "string") {
      return res.status(400).json({ error: "phone_required" });
    }
    try {
      pruneTempClients();
      const client = createTempClient({ apiId: process.env.API_ID, apiHash: process.env.API_HASH });
      const result = await sendCodeOnClient(client, phone);
      const tempId = "tmp_" + randomBytes(8).toString("hex");
      tempClients.set(tempId, {
        client,
        label: label || "Новый аккаунт",
        phone,
        phoneCodeHash: result.phoneCodeHash,
        expiresAt: Date.now() + TEMP_TTL_MS,
      });
      res.json({ tempId, phoneCodeHash: result.phoneCodeHash, timeout: result.timeout, type: result.type, nextType: result.nextType });
    } catch (e) {
      console.error("[sessions/add/send-code]", e);
      res.status(500).json({ error: "send_code_failed", message: String(e?.message || e) });
    }
  });

  app.post("/api/sessions/add/resend-code", requireSession, async (req, res) => {
    const { tempId } = req.body || {};
    if (!tempId) return res.status(400).json({ error: "tempId_required" });
    const entry = tempClients.get(tempId);
    if (!entry) return res.status(404).json({ error: "temp_session_expired", hint: "Запроси код заново через send-code" });
    try {
      const result = await resendCodeOnClient(entry.client, { phone: entry.phone, phoneCodeHash: entry.phoneCodeHash });
      // обновляем phoneCodeHash на новый
      entry.phoneCodeHash = result.phoneCodeHash;
      res.json({ tempId, phoneCodeHash: result.phoneCodeHash, timeout: result.timeout, type: result.type, nextType: result.nextType });
    } catch (e) {
      console.error("[sessions/add/resend-code]", e);
      res.status(500).json({ error: "resend_code_failed", message: String(e?.message || e) });
    }
  });

  app.post("/api/sessions/add/sign-in", requireSession, async (req, res) => {
    const { tempId, phone, phoneCodeHash, code, password, label, activate } = req.body || {};
    if (!tempId || !phone || !phoneCodeHash || !code) {
      return res.status(400).json({ error: "missing_fields" });
    }
    const entry = tempClients.get(tempId);
    if (!entry) {
      return res.status(404).json({ error: "temp_session_expired", hint: "Запроси код заново" });
    }
    try {
      const result = await signInOnClient(entry.client, { phone, phoneCodeHash, code, password });
      const sessionString = extractSessionString(entry.client);
      const finalLabel = label || entry.label || "Новый аккаунт";
      const added = sessionsManager.add({
        label: finalLabel,
        sessionString,
        phone: entry.phone,
        tgUserId: result.user?.id || null,
        username: result.user?.username || null,
      });
      try { await entry.client.disconnect(); } catch {}
      tempClients.delete(tempId);

      if (activate || !sessionsManager.getActiveId() || sessionsManager.getActiveId() === added.id) {
        try { await disconnectClient(); } catch {}
        resetClient();
        sessionsManager.setActive(added.id);
        ensureClientConfigured();
      }
      res.json({ ok: true, session: added, user: result.user });
    } catch (e) {
      if (e?.code === "2fa_required") {
        return res.status(400).json({ error: "2fa_required" });
      }
      console.error("[sessions/add/sign-in]", e);
      res.status(500).json({ error: "sign_in_failed", message: String(e?.message || e) });
    }
  });

  app.post("/api/auth/logout", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/chats", requireSession, async (_req, res) => {
    if (!(activeSessionStore()?.isAuthorized() ?? false)) {
      return res.status(403).json({ error: "not_authorized" });
    }
    try {
      ensureClientConfigured();
      const { listOwnerGroups } = await import("./lib/chats.js");
      const chats = await listOwnerGroups();
      res.json({ chats });
    } catch (e) {
      console.error("[chats]", e);
      res.status(500).json({ error: "chats_failed", message: String(e?.message || e) });
    }
  });

  app.post("/api/parse", requireSession, async (req, res) => {
    if (!(activeSessionStore()?.isAuthorized() ?? false)) {
      return res.status(403).json({ error: "not_authorized" });
    }
    const { chatRef } = req.body || {};
    if (!chatRef) {
      return res.status(400).json({ error: "chatRef_required" });
    }
    if (parseInProgress) {
      return res.status(409).json({ error: "parse_in_progress" });
    }
    parseInProgress = true;
    const startedAt = Date.now();
    try {
      ensureClientConfigured();
      const { resolveChat, getParticipantUsernames, leaveChat } = await import("./lib/telegram.js");
      const { entity, joinedNow } = await withTimeout(resolveChat(chatRef), 30000, "resolve_timeout");
      let parsed;
      try {
        parsed = await withTimeout(getParticipantUsernames(entity), 60000, "parse_timeout");
      } finally {
        if (joinedNow) {
          try {
            await withTimeout(leaveChat(entity), 10000, "leave_timeout");
          } catch (leaveErr) {
            console.warn("[parse] failed to leave after auto-join:", leaveErr?.message || leaveErr);
          }
        }
      }
      const { usernames, stats, adminUsernames = [] } = parsed;

      pruneCache();
      const jobId = String(Date.now()) + "-" + Math.random().toString(36).slice(2, 8);
      const chat = {
        id: String(entity.id),
        title: entity.title || entity.username || String(entity.id),
        membersCount: Number(entity.participantsCount || stats.total || 0),
      };
      const numberedList = usernames.map((u, i) => `${i + 1}. ${u}`).join("\n");
      parseCache.set(jobId, {
        chat,
        usernames,
        numberedList,
        adminUsernames,
        stats,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });

      res.json({
        jobId,
        chat,
        usernames,
        numberedList,
        adminUsernames,
        stats,
        durationMs: Date.now() - startedAt,
      });
    } catch (e) {
      const msg = String(e?.errorMessage || e?.message || e);
      if (e?.code === "FLOOD_WAIT" || /FLOOD_WAIT_(\d+)/.test(msg)) {
        const m = msg.match(/FLOOD_WAIT_(\d+)/);
        const retryAfter = e?.seconds || (m ? Number(m[1]) : 5);
        return res.status(429).json({ error: "flood_wait", retryAfter });
      }
      if (e?.code === "TIMEOUT" || e?.code === "parse_timeout" || e?.code === "resolve_timeout") {
        return res.status(504).json({ error: "timeout" });
      }
      if (e?.code === "INVITE_REQUEST_SENT") {
        return res.status(202).json({
          error: "invite_request_sent",
          hint: "Заявка на вступление отправлена. Жди одобрения админа, потом повтори парсинг.",
        });
      }
      if (e?.code === "INVITE_INVALID") {
        return res.status(400).json({ error: "invite_invalid", hint: "Ссылка-приглашение устарела или невалидна" });
      }
      if (e?.code === "INVITE_EMPTY" || e?.code === "INVITE_ALREADY_MEMBER") {
        return res.status(500).json({ error: "invite_resolve_failed", hint: String(e?.message || e) });
      }
      if (/USERNAME_NOT_OCCUPIED|CHANNEL_INVALID|PEER_ID_INVALID|USERNAME_INVALID/.test(msg)) {
        return res.status(404).json({ error: "chat_not_found" });
      }
      if (/CHANNEL_PRIVATE|CHAT_ADMIN_REQUIRED/.test(msg)) {
        return res.status(403).json({ error: "no_access", hint: "Вступи в чат или нужны права админа" });
      }
      if (/AUTH_KEY_UNREGISTERED|SESSION_REVOKED/.test(msg)) {
        return res.status(401).json({ error: "session_revoked", hint: "Нужно авторизоваться заново" });
      }
      console.error("[parse]", e);
      res.status(500).json({ error: "parse_failed", message: msg });
    } finally {
      parseInProgress = false;
    }
  });

  app.get("/api/export.txt", requireSession, (req, res) => {
    const { jobId } = req.query;
    if (!jobId) return res.status(400).json({ error: "jobId_required" });
    const entry = parseCache.get(String(jobId));
    if (!entry) return res.status(404).json({ error: "job_not_found_or_expired" });

    const date = new Date().toISOString().slice(0, 10);
    const safeTitle = String(entry.chat.title).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || "chat";
    const filename = `${safeTitle}-${date}.txt`;

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(entry.numberedList || entry.usernames.map((u, i) => `${i + 1}. ${u}`).join("\n"));
  });

  return app;
}

export function startServer() {
  ensureSessionSecret();
  if (hasCredentials() && sessionsManager.getActiveId()) {
    try { ensureClientConfigured(); } catch (e) {
      console.warn("[parser] failed to configure client for active session:", e?.message || e);
    }
  }
  const app = createApp();
  const port = Number(process.env.PORT || 3000);
  const server = app.listen(port, () => {
    const actualPort = server.address().port;
    console.log(`[parser] listening on http://localhost:${actualPort}`);
    const sessions = sessionsManager.list();
    console.log(`[parser] TG sessions: ${sessions.length} | active: ${sessionsManager.getActiveId() || "(none)"}`);
    if (!hasLoginPassword()) {
      console.log("[parser] ВНИМАНИЕ: LOGIN_PASSWORD_HASH не задан в .env");
    }
  });
  return server;
}

const isMainModule = process.argv[1] && import.meta.url.endsWith(
  process.argv[1].replace(/\\/g, "/")
);
if (isMainModule) startServer();
