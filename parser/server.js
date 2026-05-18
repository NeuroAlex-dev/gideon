import express from "express";
import { readFileSync, existsSync, appendFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import dotenv from "dotenv";
import { createSessionStore } from "./lib/session.js";
import { configureClient } from "./lib/telegram.js";
import { sendCode, signIn, logout } from "./lib/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, ".env") });

const VERSION = "1.0.0";

const sessionStore = createSessionStore(join(__dirname, "data", "session.txt"));

function hasCredentials() {
  return Boolean(process.env.API_ID && process.env.API_HASH);
}

function ensureClientConfigured() {
  if (!hasCredentials()) return false;
  configureClient({
    apiId: process.env.API_ID,
    apiHash: process.env.API_HASH,
    sessionStore,
  });
  return true;
}

function ensureAuthToken() {
  if (process.env.AUTH_TOKEN && process.env.AUTH_TOKEN.trim() !== "") {
    return process.env.AUTH_TOKEN.trim();
  }
  const generated = randomBytes(16).toString("hex");
  process.env.AUTH_TOKEN = generated;
  const envPath = join(__dirname, ".env");
  if (existsSync(envPath)) {
    const txt = readFileSync(envPath, "utf8");
    if (/^AUTH_TOKEN=/m.test(txt)) {
      writeFileSync(envPath, txt.replace(/^AUTH_TOKEN=.*$/m, `AUTH_TOKEN=${generated}`), "utf8");
    } else {
      appendFileSync(envPath, `\nAUTH_TOKEN=${generated}\n`, "utf8");
    }
  } else {
    writeFileSync(envPath, `AUTH_TOKEN=${generated}\n`, "utf8");
  }
  return generated;
}

function isLoopback(ip) {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function requireAuth(req, res, next) {
  if (isLoopback(req.ip)) return next();
  const token = req.query.token || req.headers["x-auth-token"];
  if (token && token === process.env.AUTH_TOKEN) return next();
  return res.status(401).json({ error: "unauthorized" });
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

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, version: VERSION });
  });

  app.get("/api/auth/status", requireAuth, (_req, res) => {
    res.json({
      authorized: sessionStore.isAuthorized(),
      hasCredentials: hasCredentials(),
    });
  });

  app.post("/api/auth/send-code", requireAuth, async (req, res) => {
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

  app.post("/api/auth/sign-in", requireAuth, async (req, res) => {
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

  app.post("/api/auth/logout", requireAuth, async (_req, res) => {
    try {
      if (hasCredentials()) {
        ensureClientConfigured();
      }
      await logout(sessionStore);
      res.json({ ok: true });
    } catch (e) {
      console.error("[logout]", e);
      res.status(500).json({ error: "logout_failed" });
    }
  });

  app.get("/api/chats", requireAuth, async (_req, res) => {
    if (!sessionStore.isAuthorized()) {
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

  app.post("/api/parse", requireAuth, async (req, res) => {
    if (!sessionStore.isAuthorized()) {
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
      const { resolveChat, getParticipantUsernames } = await import("./lib/telegram.js");
      const entity = await withTimeout(resolveChat(chatRef), 15000, "resolve_timeout");
      const { usernames, stats } = await withTimeout(getParticipantUsernames(entity), 60000, "parse_timeout");

      pruneCache();
      const jobId = String(Date.now()) + "-" + Math.random().toString(36).slice(2, 8);
      const chat = {
        id: String(entity.id),
        title: entity.title || entity.username || String(entity.id),
        membersCount: Number(entity.participantsCount || stats.total || 0),
      };
      parseCache.set(jobId, {
        chat,
        usernames,
        stats,
        expiresAt: Date.now() + 10 * 60 * 1000,
      });

      res.json({
        jobId,
        chat,
        usernames,
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
      if (e?.code === "INVITE_NOT_SUPPORTED") {
        return res.status(400).json({ error: "invite_not_supported", hint: "Сначала вступи в чат" });
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

  app.get("/api/export.txt", requireAuth, (req, res) => {
    const { jobId } = req.query;
    if (!jobId) return res.status(400).json({ error: "jobId_required" });
    const entry = parseCache.get(String(jobId));
    if (!entry) return res.status(404).json({ error: "job_not_found_or_expired" });

    const date = new Date().toISOString().slice(0, 10);
    const safeTitle = String(entry.chat.title).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40) || "chat";
    const filename = `${safeTitle}-${date}.txt`;

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(entry.usernames.join("\n"));
  });

  return app;
}

export function startServer() {
  const token = ensureAuthToken();
  const app = createApp();
  const port = Number(process.env.PORT || 3000);
  const server = app.listen(port, () => {
    const actualPort = server.address().port;
    console.log(`[parser] listening on http://localhost:${actualPort}`);
    console.log(`[parser] AUTH_TOKEN=${token}`);
    console.log(`[parser] open: http://localhost:${actualPort}?token=${token}`);
  });
  return server;
}

// Only auto-start when this file is run directly (not when imported in tests)
const isMainModule = process.argv[1] && import.meta.url.endsWith(
  process.argv[1].replace(/\\/g, "/")
);
if (isMainModule) startServer();
