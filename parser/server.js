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
