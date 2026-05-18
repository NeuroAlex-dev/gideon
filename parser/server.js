import express from "express";
import { readFileSync, existsSync, appendFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, ".env") });

const VERSION = "1.0.0";

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

  // Placeholder for /api/auth/* — fully implemented in Task 8
  app.get("/api/auth/status", requireAuth, (_req, res) => {
    res.json({ authorized: false, hasCredentials: false });
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
