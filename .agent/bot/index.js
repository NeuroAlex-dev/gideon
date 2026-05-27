/**
 * Agent Bot — Telegram bot powered by Claude Code CLI
 * Part of jarvis-architect: personal AI agent for course students
 *
 * Features: text + voice + photos + documents + media groups → Claude Code → response
 *           sessions, DNA files, persistent keyboard, folder structure awareness
 *           stream mode, crash recovery, circuit breaker, confirmation buttons,
 *           thinking phrases rotation, URL pre-fetch, human-friendly errors
 */

import { Bot, Keyboard, InlineKeyboard, InputFile } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, renameSync, copyFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { execSync } from "node:child_process";
import https from "node:https";
import http from "node:http";
import dotenv from "dotenv";

// Подгружаем секреты которые юзер сохранил через /settings → Environment Variables.
// Без этого после рестарта бота все ключи (DEEPGRAM_API_KEY, GITHUB_TOKEN и т.д.)
// исчезают из process.env и Claude в спавне их не получает.
dotenv.config({ path: join(process.env.AGENT_HOME || "/home/agent", ".agent", ".env") });

import { handlePendingInput, registerSecretsHandlers } from "./secrets-menu.js";
import { hasAnyTranscriber, registerVoiceHelpers, voiceFallbackKeyboard, VOICE_FALLBACK_PROMPT } from "./voice-helper.js";
import { registerParserHandlers } from "./parser-menu.js";
import { registerSalesHandlers } from "./sales-menu.js";
import { registerSettingsHandlers, getClaudeModel, getClaudePermissionMode, getTimezone } from "./settings-menu.js";
import { registerCommandsHandlers } from "./commands-menu.js";

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const BOT_TOKEN = process.env.BOT_TOKEN;
const AGENT_HOME = process.env.AGENT_HOME || "/home/agent";
const WORKSPACE = join(AGENT_HOME, "workspace");
const PROJECTS = join(AGENT_HOME, "projects");
const DATA_DIR = join(AGENT_HOME, ".agent");
const MEDIA_DIR = join(WORKSPACE, ".media");
const SESSIONS_FILE = join(DATA_DIR, "sessions.json");
const OWNER_FILE = join(DATA_DIR, "owner.json");
const SYSTEM_PROMPT_PATH = join(WORKSPACE, "CLAUDE.md");
const CRASH_CONTEXT_FILE = join(DATA_DIR, ".crash_context.md");
const MAX_SESSION_SIZE = 2 * 1024 * 1024; // 2 MB — start fresh if session too large
const MAX_SYSTEM_PROMPT_CHARS = 30000;
const STREAM_THROTTLE_MS = 1500;

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN is required");
  process.exit(1);
}

// Ensure directories exist
for (const dir of [DATA_DIR, join(WORKSPACE, "memory"), join(WORKSPACE, "knowledge"), PROJECTS, MEDIA_DIR]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ─── OWNER CHECK (auto-lock to first user) ──────────────────────────────────

// Priority: OWNER_ID env var > owner.json file > auto-lock on first /start
let _ownerId = process.env.OWNER_ID || null;

function loadOwner() {
  if (_ownerId) return; // env var takes priority
  try {
    const data = JSON.parse(readFileSync(OWNER_FILE, "utf8"));
    _ownerId = String(data.id);
    console.log(`[owner] loaded from file: ${_ownerId} (${data.name || "unknown"})`);
  } catch {}
}

function saveOwner(ctx) {
  const data = {
    id: String(ctx.from.id),
    name: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" "),
    username: ctx.from.username || null,
    lockedAt: new Date().toISOString(),
  };
  _ownerId = data.id;
  writeFileSync(OWNER_FILE, JSON.stringify(data, null, 2));
  console.log(`[owner] auto-locked to: ${data.id} (${data.name})`);
}

loadOwner();

function isOwner(ctx) {
  if (!_ownerId) return false; // No owner yet — only /start can set it
  return String(ctx.from?.id) === String(_ownerId);
}

// ─── PERSISTENT KEYBOARD ────────────────────────────────────────────────────

const mainKeyboard = new Keyboard()
  .text("📋 Статус").text("🔄 Новый диалог").row()
  .text("📁 Проекты").text("🧠 Память").row()
  .text("🎯 Парсер").text("💼 Продажи").row()
  .resized()
  .persistent();

// ─── SESSIONS ────────────────────────────────────────────────────────────────

function loadSessions() {
  try {
    return new Map(Object.entries(JSON.parse(readFileSync(SESSIONS_FILE, "utf8"))));
  } catch {
    return new Map();
  }
}

function saveSessions() {
  try {
    writeFileSync(SESSIONS_FILE, JSON.stringify(Object.fromEntries(sessions), null, 2));
  } catch (e) {
    console.error("[sessions] save error:", e.message);
  }
}

const sessions = loadSessions();

// ─── CIRCUIT BREAKER (rate limiting protection) ─────────────────────────────

let _rateLimitUntil = 0;

function setGlobalRateLimit(retryAfterSec) {
  _rateLimitUntil = Date.now() + (retryAfterSec || 5) * 1000;
  console.warn(`[rate-limit] breaker ON for ${retryAfterSec}s`);
}

function isGloballyRateLimited() {
  return Date.now() < _rateLimitUntil;
}

// ─── SYSTEM PROMPT (with mtime caching) ─────────────────────────────────────

const ARCHITECTURE_CONTEXT = `
## Архитектура файловой системы агента

Ты работаешь на VPS-сервере. Вот структура папок:

/home/agent/                    <- твой дом на сервере
|-- .claude/                    <- настройки Claude Code (settings.json)
|   +-- settings.json           <- правила светофора (зелёный/жёлтый/красный)
|-- workspace/                  <- главная рабочая папка (cwd)
|   |-- CLAUDE.md               <- правила работы
|   |-- SOUL.md                 <- твоя личность
|   |-- MEMORY.md               <- долгосрочная память (обновляй!)
|   |-- GOALS.md                <- цели пользователя
|   |-- USER.md, MISSION.md, PROJECTS.md, PREFERENCES.md, LEARNED.md
|   |-- .claude/skills/         <- навыки (скиллы) — Claude Code находит их project-level
|   |-- .media/                 <- медиафайлы от пользователя (фото, документы)
|   |-- memory/                 <- дневники по дням (YYYY-MM-DD.md)
|   +-- knowledge/              <- база знаний (справочники, инструкции)
|-- projects/                   <- папка для ПРОЕКТОВ (каждый проект в подпапке)
|   +-- название-проекта/       <- сюда создавай новые проекты
+-- .agent/                     <- служебная папка бота (не трогай)

ВАЖНО:
- Новые проекты ВСЕГДА создавай в /home/agent/projects/название-проекта/, НЕ в workspace/
- Workspace — только для DNA-файлов и памяти
- Скиллы лежат в /home/agent/workspace/.claude/skills/ — если пользователь просит установить скилл, клади туда
- Настройки Claude Code (settings.json) — в /home/agent/.claude/
- Медиафайлы от пользователя сохраняются в workspace/.media/ — используй Read для их чтения
- При создании проекта: mkdir -p ~/projects/название && cd ~/projects/название
`;

const MAX_MEMORY_CHARS = 15000;
const MAX_DIARY_CHARS = 2000;

// Cache for system prompt file
let _sysPromptCache = { mtime: 0, content: "" };

function _safeRead(path) {
  try {
    if (!existsSync(path)) return "";
    return readFileSync(path, "utf8");
  } catch { return ""; }
}

function _cachedRead(path) {
  try {
    const stat = statSync(path);
    const mtime = stat.mtimeMs;
    if (mtime === _sysPromptCache.mtime) return _sysPromptCache.content;
    const content = readFileSync(path, "utf8");
    _sysPromptCache = { mtime, content };
    return content;
  } catch { return ""; }
}

function buildSystemPrompt() {
  const parts = [];

  // 1. CLAUDE.md is auto-loaded by Claude Code CLI from cwd (WORKSPACE)
  //    We do NOT inject it here to avoid double-loading and wasting tokens.
  //    Only inject what Claude CLI doesn't see: DNA files, diaries, architecture.

  // 2. Architecture context
  parts.push(ARCHITECTURE_CONTEXT);

  // 3. All DNA files (skip CLAUDE.md — already loaded)
  const dnaFiles = [
    "SOUL.md", "USER.md", "MEMORY.md", "MISSION.md",
    "GOALS.md", "PROJECTS.md", "PREFERENCES.md", "LEARNED.md",
  ];
  for (const name of dnaFiles) {
    const text = _safeRead(join(WORKSPACE, name));
    if (text) {
      const trimmed = name === "MEMORY.md" && text.length > MAX_MEMORY_CHARS
        ? text.slice(0, MAX_MEMORY_CHARS) + "\n...(truncated)"
        : text;
      parts.push(`--- ${name} ---\n${trimmed}`);
    }
  }

  // 4. Today's diary (last N chars — newest data)
  const today = new Date().toISOString().split("T")[0];
  const todayText = _safeRead(join(WORKSPACE, "memory", `${today}.md`));
  if (todayText) {
    const d = todayText.length > MAX_DIARY_CHARS ? todayText.slice(-MAX_DIARY_CHARS) : todayText;
    parts.push(`--- Дневник ${today} ---\n${d}`);
  }

  // 5. Yesterday's diary
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toISOString().split("T")[0];
  const yText = _safeRead(join(WORKSPACE, "memory", `${yStr}.md`));
  if (yText) {
    const d = yText.length > MAX_DIARY_CHARS ? yText.slice(-MAX_DIARY_CHARS) : yText;
    parts.push(`--- Дневник ${yStr} ---\n${d}`);
  }

  // 6. Crash context (if previous session crashed)
  if (existsSync(CRASH_CONTEXT_FILE)) {
    try {
      const ctx = readFileSync(CRASH_CONTEXT_FILE, "utf8");
      parts.push(`--- Контекст: предыдущая сессия завершилась ошибкой ---\n${ctx}`);
      unlinkSync(CRASH_CONTEXT_FILE);
      console.log("[crash-recovery] injected crash context");
    } catch {}
  }

  // 7. Current date + memory nudge
  parts.push(`# Current date\n${today}`);
  parts.push("# Memory reminder\nЕсли в этом диалоге появились важные факты, решения или предпочтения клиента — сохрани их в memory/YYYY-MM-DD.md или MEMORY.md. Не теряй контекст между сессиями.");

  // Trim to max
  let result = parts.join("\n\n");
  if (result.length > MAX_SYSTEM_PROMPT_CHARS) {
    result = result.slice(0, MAX_SYSTEM_PROMPT_CHARS);
  }
  return result;
}

// ─── THINKING PHRASES ───────────────────────────────────────────────────────

const THINKING_PHRASES = [
  ["Думаю...", "⏳"],
  ["Соображаю...", "🤔"],
  ["Мозгую...", "🧠"],
  ["Анализирую...", "🔍"],
  ["Копаюсь в памяти...", "📚"],
  ["Обрабатываю...", "⚙️"],
  ["Почти готов...", "✍️"],
];

let _phraseIdx = 0;
function nextThinkingPhrase() {
  const [text, emoji] = THINKING_PHRASES[_phraseIdx % THINKING_PHRASES.length];
  _phraseIdx++;
  return `${text} ${emoji}`;
}

// ─── HUMAN-FRIENDLY ERRORS ──────────────────────────────────────────────────

function humanizeError(errMsg) {
  const msg = String(errMsg);
  if (msg.includes("429") || msg.includes("rate")) return "Слишком много запросов. Подожди минутку и попробуй снова.";
  if (msg.includes("529") || msg.includes("503") || msg.includes("overloaded")) return "Серверы Claude перегружены. Попробуй через пару минут.";
  if (msg.includes("401") || msg.includes("auth")) return "Проблема с авторизацией Claude. Нужно заново авторизоваться (claude auth login).";
  if (msg.includes("image") || msg.includes("Could not process")) return "Не получилось обработать файл. Попробуй отправить в другом формате.";
  if (msg.includes("timeout") || msg.includes("TIMEOUT")) return "Claude думал слишком долго. Попробуй задать вопрос короче.";
  if (msg.includes("No conversation found")) return null; // авто-восстановление сработает, пользователю не показываем
  if (msg.includes("corrupt")) return "Сессия повреждена. Нажми 🔄 Новый диалог.";
  if (msg.includes("command line is too long") || msg.includes("ENAMETOOLONG")) return "Слишком длинный запрос (Windows-ограничение). Сократи сообщение или пришли файлом.";
  return null; // unknown error — show generic message
}

// ─── URL PRE-FETCH ──────────────────────────────────────────────────────────

function extractUrls(text) {
  const urlRe = /https?:\/\/[^\s<>"')\]]+/gi;
  return (text.match(urlRe) || []).slice(0, 3); // max 3 URLs
}

async function prefetchUrl(url) {
  return new Promise((resolve) => {
    const proto = url.startsWith("https") ? https : http;
    const req = proto.get(url, { timeout: 5000, headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      if (res.statusCode !== 200) return resolve(null);
      let data = "";
      res.on("data", (d) => {
        data += d;
        if (data.length > 10000) { res.destroy(); resolve(data.slice(0, 10000)); }
      });
      res.on("end", () => resolve(data.slice(0, 10000)));
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

async function prefetchUrls(text) {
  const urls = extractUrls(text);
  if (urls.length === 0) return "";
  const results = await Promise.allSettled(urls.map(prefetchUrl));
  const parts = [];
  for (let i = 0; i < urls.length; i++) {
    const val = results[i].status === "fulfilled" ? results[i].value : null;
    if (val) {
      // Strip HTML tags for cleaner context
      const clean = val.replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 3000);
      if (clean.length > 100) {
        parts.push(`[Контент с ${urls[i]}]:\n${clean}`);
      }
    }
  }
  return parts.length > 0 ? "\n\n" + parts.join("\n\n") : "";
}

// ─── CLAUDE CODE CLI ─────────────────────────────────────────────────────────

// Sequential queue — only one Claude call at a time
let _queue = Promise.resolve();

// Текущий активный subprocess — нужен для /stop
let _activeChild = null;
export function killActiveChild() {
  if (!_activeChild) return false;
  try {
    _activeChild.kill("SIGTERM");
    // На Windows SIGTERM может не сработать, добиваем SIGKILL через 500ms
    setTimeout(() => { try { _activeChild?.kill?.("SIGKILL"); } catch {} }, 500);
    return true;
  } catch {
    return false;
  }
}
export function hasActiveChild() { return !!_activeChild; }

function callClaude(prompt, sessionId, { onText } = {}) {
  const p = _queue.then(async () => {
    try {
      return await _callClaudeInner(prompt, sessionId, { onText });
    } catch (e) {
      // Авто-восстановление: если session_id протух — повторяем без --resume
      if (sessionId && /No conversation found with session ID/i.test(String(e.message))) {
        console.log(`[claude] session ${sessionId} not found, retrying without --resume`);
        return await _callClaudeInner(prompt, null, { onText });
      }
      throw e;
    }
  });
  _queue = p.catch(() => {});
  return p;
}

function _getSessionSize(sessionId) {
  if (!sessionId) return 0;
  try {
    // Claude stores sessions in ~/.claude/sessions/
    const sessDir = join(AGENT_HOME, ".claude", "sessions");
    const sessFile = join(sessDir, sessionId + ".jsonl");
    if (existsSync(sessFile)) return statSync(sessFile).size;
  } catch {}
  return 0;
}

function _callClaudeInner(prompt, sessionId, { onText } = {}) {
  return new Promise((resolve, reject) => {
    // Check session size — if too large, start fresh
    if (sessionId && _getSessionSize(sessionId) > MAX_SESSION_SIZE) {
      console.log(`[session] ${sessionId} too large (>${MAX_SESSION_SIZE}), starting fresh`);
      sessionId = null;
    }

    const useStream = typeof onText === "function";
    const model = getClaudeModel();
    const permissionMode = getClaudePermissionMode();
    const timezone = getTimezone();
    const args = [
      "-p", prompt,
      "--output-format", useStream ? "stream-json" : "json",
      "--max-turns", "15",
      "--model", model,
      "--permission-mode", permissionMode,
    ];
    // stream-json в новых версиях Claude CLI требует --verbose
    if (useStream) args.push("--verbose");

    const systemPrompt = buildSystemPrompt();
    if (systemPrompt) args.push("--append-system-prompt", systemPrompt);

    if (sessionId) args.push("--resume", sessionId);

    // Find claude binary. Шим лежит в C:\Users\Administrator\.agent\bot\claude.cmd
    const claudePath = process.env.CLAUDE_CLI_PATH
      || process.env.CLAUDE_CODE_EXECPATH
      || (existsSync(join(AGENT_HOME, ".agent", "bot", "claude.cmd")) ? join(AGENT_HOME, ".agent", "bot", "claude.cmd") : "claude");
    const child = spawn(claudePath, args, {
      cwd: WORKSPACE,
      env: { ...process.env, HOME: AGENT_HOME, TZ: timezone },
      timeout: 600000, // 10 min
      windowsHide: true,
    });
    _activeChild = child;
    child.stdin.end();

    let stdout = "";
    let stderr = "";
    let lastText = "";
    let lastStreamTs = 0;
    let resultSessionId = sessionId;
    let cost = 0;

    child.stdout.on("data", (d) => {
      stdout += d;

      if (useStream) {
        // Parse JSONL lines for streaming
        const lines = stdout.split("\n");
        stdout = lines.pop(); // keep incomplete line
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.type === "assistant" && obj.message?.content) {
              for (const block of obj.message.content) {
                if (block.type === "text" && block.text) {
                  lastText = block.text;
                  const now = Date.now();
                  if (now - lastStreamTs >= STREAM_THROTTLE_MS) {
                    lastStreamTs = now;
                    onText(lastText);
                  }
                }
              }
            } else if (obj.type === "result") {
              resultSessionId = obj.session_id || sessionId;
              cost = obj.cost_usd || 0;
              if (obj.result) lastText = obj.result;
            }
          } catch {}
        }
      }
    });

    child.stderr.on("data", (d) => (stderr += d));

    const clearActive = () => { if (_activeChild === child) _activeChild = null; };

    child.on("close", (code) => {
      clearActive();
      if (useStream) {
        // Parse any remaining line
        if (stdout.trim()) {
          try {
            const obj = JSON.parse(stdout);
            if (obj.type === "result") {
              resultSessionId = obj.session_id || sessionId;
              cost = obj.cost_usd || 0;
              if (obj.result) lastText = obj.result;
            }
          } catch {}
        }
        resolve({
          text: lastText || "(пустой ответ)",
          sessionId: resultSessionId,
          cost,
        });
        return;
      }

      // Non-stream JSON mode
      if (code !== 0 && !stdout.trim()) {
        // Save crash context for recovery
        try {
          writeFileSync(CRASH_CONTEXT_FILE,
            `Последний запрос (${new Date().toISOString()}):\n${prompt.slice(0, 500)}\n\nОшибка: exit ${code}\n${stderr.slice(0, 300)}`);
        } catch {}
        return reject(new Error(`Claude exit ${code}: ${stderr.slice(0, 300)}`));
      }
      try {
        const result = JSON.parse(stdout);
        resolve({
          text: result.result || result.text || "(пустой ответ)",
          sessionId: result.session_id || sessionId,
          cost: result.cost_usd || 0,
        });
      } catch {
        const text = stdout.trim();
        resolve({ text: text || "(пустой ответ)", sessionId, cost: 0 });
      }
    });

    child.on("error", (err) => {
      clearActive();
      // Save crash context
      try {
        writeFileSync(CRASH_CONTEXT_FILE,
          `Последний запрос (${new Date().toISOString()}):\n${prompt.slice(0, 500)}\n\nОшибка: ${err.message}`);
      } catch {}
      reject(err);
    });
  });
}

// ─── FILE DOWNLOAD ──────────────────────────────────────────────────────────

export async function downloadTgFile(url, destPath) {
  const proto = url.startsWith("https") ? https : http;
  const response = await new Promise((resolve, reject) => {
    proto.get(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      resolve(res);
    }).on("error", reject);
  });
  await pipeline(response, createWriteStream(destPath));
}

async function downloadAndSave(ctx, fileId, ext) {
  const file = await ctx.api.getFile(fileId);
  const tmpPath = `/tmp/media_${Date.now()}_${fileId.slice(-8)}${ext}`;
  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
  await downloadTgFile(fileUrl, tmpPath);

  // Move to persistent .media/ directory (copyFile+unlink for cross-filesystem safety)
  const destPath = join(MEDIA_DIR, `${Date.now()}_${fileId.slice(-8)}${ext}`);
  try {
    renameSync(tmpPath, destPath);
  } catch {
    copyFileSync(tmpPath, destPath);
    unlinkSync(tmpPath);
  }
  return destPath;
}

// ─── MEDIA BATCH (for handling multiple photos at once) ─────────────────────

const MEDIA_BATCH_DELAY_MS = 2500;
const mediaBatch = new Map(); // chatId -> { items, caption, ctx, timer, statusMsgId }

async function enqueueMedia(ctx, item) {
  if (!isOwner(ctx)) return;
  const key = String(ctx.chat.id);
  let batch = mediaBatch.get(key);

  if (batch) {
    // Add to existing batch, restart timer
    batch.items.push(item);
    if (item.caption && !batch.caption) batch.caption = item.caption;
    batch.ctx = ctx;
    clearTimeout(batch.timer);
    batch.timer = setTimeout(() => processMediaBatch(key), MEDIA_BATCH_DELAY_MS);
    try {
      await ctx.api.editMessageText(ctx.chat.id, batch.statusMsgId,
        `Принимаю файлы... (${batch.items.length} шт) ⏳`);
    } catch {}
    return;
  }

  // First item — create new batch
  const statusMsg = await ctx.reply(`Принимаю файл... ⏳`);
  batch = {
    items: [item],
    caption: item.caption || null,
    chatId: ctx.chat.id,
    userId: String(ctx.from.id),
    statusMsgId: statusMsg.message_id,
    ctx,
    timer: null,
  };
  batch.timer = setTimeout(() => processMediaBatch(key), MEDIA_BATCH_DELAY_MS);
  mediaBatch.set(key, batch);
}

async function processMediaBatch(key) {
  const batch = mediaBatch.get(key);
  if (!batch) return;
  mediaBatch.delete(key);
  clearTimeout(batch.timer);

  const { ctx, items, userId, chatId, statusMsgId } = batch;

  try {
    await ctx.api.editMessageText(chatId, statusMsgId,
      `Скачиваю ${items.length === 1 ? "файл" : items.length + " файлов"}... ⏳`);
  } catch {}

  // Download all files
  const downloaded = [];
  for (const it of items) {
    try {
      const path = await downloadAndSave(ctx, it.fileId, it.ext);
      downloaded.push({ ...it, path });
      console.log(`[media] ${userId} saved ${it.kind} -> ${path}`);
    } catch (e) {
      console.warn(`[media] download failed for ${it.kind}: ${e.message}`);
    }
  }

  if (downloaded.length === 0) {
    try {
      await ctx.api.editMessageText(chatId, statusMsgId, "Не удалось скачать файлы. Попробуй ещё раз.");
    } catch {}
    return;
  }

  // Build prompt with file paths
  const filesBlock = downloaded
    .map((d) => {
      const label = d.kind === "photo" ? "Фото" : d.kind === "video" ? "Видео" : `Файл (${d.fileName || d.ext})`;
      return `${label}: ${d.path}`;
    })
    .join("\n");

  const mediaIntro = downloaded.length === 1
    ? "Пользователь отправил медиа. Файл сохранён — открой через Read:"
    : `Пользователь отправил ${downloaded.length} медиа. Файлы сохранены — открой через Read:`;

  const caption = batch.caption || "";
  const prompt = `${mediaIntro}\n${filesBlock}${caption ? `\n\nПодпись пользователя: ${caption}` : ""}`;

  try {
    await ctx.api.editMessageText(chatId, statusMsgId, nextThinkingPhrase());
  } catch {}

  const typingInterval = setInterval(() => {
    if (!isGloballyRateLimited()) {
      ctx.api.sendChatAction(chatId, "typing").catch(() => {});
    }
  }, 4000);

  try {
    const sessionId = sessions.get(userId) || null;
    const result = await callClaude(prompt, sessionId);

    if (result.sessionId) {
      sessions.set(userId, result.sessionId);
      saveSessions();
    }

    clearInterval(typingInterval);
    await ctx.api.deleteMessage(chatId, statusMsgId).catch(() => {});
    await sendResponse(ctx, result.text);
  } catch (err) {
    clearInterval(typingInterval);
    await ctx.api.deleteMessage(chatId, statusMsgId).catch(() => {});
    console.error("[media-error]", err.message);
    const friendly = humanizeError(err.message);
    await ctx.reply(friendly || "Ошибка обработки медиа. Попробуй ещё раз или нажми 🔄 Новый диалог.", { reply_markup: mainKeyboard });
  }
}

// ─── VOICE HANDLING ──────────────────────────────────────────────────────────

export async function transcribeVoice(filePath) {
  // 1. Try Deepgram
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (apiKey) {
    try {
      return await _deepgramTranscribe(filePath, apiKey);
    } catch (e) {
      console.warn("[voice] Deepgram failed:", e.message);
    }
  }

  // 2. Fallback: local Whisper
  try {
    return _whisperTranscribe(filePath);
  } catch {
    return null;
  }
}

function _deepgramTranscribe(filePath, apiKey) {
  return new Promise((resolve, reject) => {
    const fileData = readFileSync(filePath);
    const options = {
      hostname: "api.deepgram.com",
      path: "/v1/listen?model=nova-2&language=ru&smart_format=true",
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "audio/ogg",
        "Content-Length": fileData.length,
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (d) => (data += d));
      res.on("end", () => {
        try {
          const result = JSON.parse(data);
          resolve(result.results?.channels?.[0]?.alternatives?.[0]?.transcript || "");
        } catch {
          resolve("");
        }
      });
    });
    req.on("error", reject);
    req.write(fileData);
    req.end();
  });
}

function _whisperTranscribe(filePath) {
  try {
    execSync("which whisper", { stdio: "ignore" });
  } catch {
    return null; // whisper not installed
  }
  try {
    const outDir = "/tmp";
    execSync(`whisper "${filePath}" --model base --language ru --output_format txt --output_dir ${outDir}`, {
      timeout: 60000,
      stdio: "ignore",
    });
    const txtFile = filePath.replace(/\.\w+$/, ".txt");
    const altTxtFile = join(outDir, basename(filePath).replace(/\.\w+$/, ".txt"));
    const resultFile = existsSync(txtFile) ? txtFile : existsSync(altTxtFile) ? altTxtFile : null;
    if (resultFile) {
      const text = readFileSync(resultFile, "utf8").trim();
      try { unlinkSync(resultFile); } catch {}
      return text;
    }
  } catch (e) {
    console.warn("[voice] Whisper failed:", e.message);
  }
  return null;
}

// ─── MARKDOWN → TELEGRAM HTML ────────────────────────────────────────────────

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function mdToTgHtml(text) {
  if (!text) return "";
  let result = text;

  // Code blocks: ```lang\n...\n``` → <pre>...</pre>
  result = result.replace(/```[\w]*\n([\s\S]*?)```/g, (_, code) => {
    return `<pre>${escapeHtml(code.trim())}</pre>`;
  });

  // Inline code: `...` → <code>...</code>
  result = result.replace(/`([^`]+)`/g, (_, code) => {
    return `<code>${escapeHtml(code)}</code>`;
  });

  // Bold: **text** or __text__
  result = result.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  result = result.replace(/__(.+?)__/g, "<b>$1</b>");

  // Italic: *text* or _text_
  result = result.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, "<i>$1</i>");
  result = result.replace(/(?<!\w)_([^_]+)_(?!\w)/g, "<i>$1</i>");

  // Links: [text](url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Headings: remove # prefix, make bold
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

  return result;
}

// ─── MEDIA TAGS (Claude → Telegram file sending) ────────────────────────────

const MEDIA_TAG_RE = /\[(ФОТО|ФАЙЛ|СТИКЕР|ВИДЕО|АУДИО|ГОЛОС|GIF|PHOTO|FILE|STICKER|VIDEO|AUDIO|VOICE|ANIMATION):\s*([^\]\s]+)(?:\s+([^\]]*))?\]/gi;

const MEDIA_TYPE_MAP = {
  "ФОТО": "photo", "PHOTO": "photo",
  "ФАЙЛ": "document", "FILE": "document",
  "СТИКЕР": "sticker", "STICKER": "sticker",
  "ВИДЕО": "video", "VIDEO": "video",
  "АУДИО": "audio", "AUDIO": "audio",
  "ГОЛОС": "voice", "VOICE": "voice",
  "GIF": "animation", "ANIMATION": "animation",
};

function extractMediaTags(text) {
  const media = [];
  const cleaned = text.replace(MEDIA_TAG_RE, (_, type, path, caption) => {
    let filePath = path.trim();
    let fileCaption = caption?.trim()?.slice(0, 1024) || undefined;

    if (!filePath.startsWith("http") && !existsSync(filePath) && fileCaption) {
      const fullPath = (filePath + " " + fileCaption).replace(/\s+$/, "");
      if (existsSync(fullPath)) {
        filePath = fullPath;
        fileCaption = undefined;
      }
    }

    media.push({
      type: MEDIA_TYPE_MAP[type.toUpperCase()] || "document",
      path: filePath,
      caption: fileCaption,
    });
    return "";
  });
  return { cleaned: cleaned.trim(), media };
}

async function sendMediaItem(ctx, item) {
  try {
    const isUrl = /^https?:\/\//i.test(item.path);
    let source;
    if (isUrl) {
      source = item.path;
    } else if (existsSync(item.path)) {
      const buf = await readFile(item.path);
      source = new InputFile(buf, basename(item.path));
    } else {
      await ctx.reply(`Файл не найден: ${item.path}`);
      return;
    }
    const opts = {};
    if (item.caption && item.type !== "sticker") opts.caption = item.caption;

    switch (item.type) {
      case "photo": await ctx.replyWithPhoto(source, opts); break;
      case "document": await ctx.replyWithDocument(source, opts); break;
      case "voice": await ctx.replyWithVoice(source, opts); break;
      case "video": await ctx.replyWithVideo(source, opts); break;
      case "audio": await ctx.replyWithAudio(source, opts); break;
      case "animation": await ctx.replyWithAnimation(source, opts); break;
      case "sticker": await ctx.replyWithSticker(source); break;
      default: await ctx.replyWithDocument(source, opts);
    }
  } catch (e) {
    console.error(`[media] Failed to send ${item.type} ${item.path}:`, e.message);
    await ctx.reply(`Не удалось отправить: ${basename(item.path)}`).catch(() => {});
  }
}

// ─── CONFIRMATION BUTTONS ───────────────────────────────────────────────────

function needsConfirmation(text) {
  const lower = text.toLowerCase();
  return /делаем\s*\?|план:|✔\s*(или|\/)\s*✖/i.test(lower);
}

function confirmKeyboard() {
  return new InlineKeyboard()
    .text("✔ Продолжай", "confirm_yes")
    .text("✖ Стоп", "confirm_no");
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getStatusText() {
  const dnaFiles = ["SOUL.md", "USER.md", "MEMORY.md", "MISSION.md", "GOALS.md", "PROJECTS.md", "PREFERENCES.md", "LEARNED.md"];
  const found = dnaFiles.filter((f) => existsSync(join(WORKSPACE, f)));
  const missing = dnaFiles.filter((f) => !existsSync(join(WORKSPACE, f)));

  let projectsList = "пусто";
  try {
    const dirs = readdirSync(PROJECTS, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    if (dirs.length > 0) projectsList = dirs.join(", ");
  } catch {}

  // Count media files
  let mediaCount = 0;
  try {
    mediaCount = readdirSync(MEDIA_DIR).length;
  } catch {}

  // Count skills
  let skillCount = 0;
  try {
    const skillDir = join(AGENT_HOME, "workspace", ".claude", "skills");
    if (existsSync(skillDir)) {
      skillCount = readdirSync(skillDir, { withFileTypes: true }).filter(d => d.isDirectory()).length;
    }
  } catch {}

  const today = new Date().toISOString().split("T")[0];
  const hasDiary = existsSync(join(WORKSPACE, "memory", `${today}.md`));

  return (
    `📋 Статус агента\n\n` +
    `DNA-файлы: ${found.length}/${dnaFiles.length} (${found.join(", ")})\n` +
    `${missing.length > 0 ? `Не найдены: ${missing.join(", ")}\n` : ""}` +
    `Дневник сегодня: ${hasDiary ? "есть" : "нет"}\n` +
    `Медиафайлов: ${mediaCount}\n` +
    `Скиллов: ${skillCount}\n` +
    `Проекты: ${projectsList}\n\n` +
    `Workspace: ${WORKSPACE}\n` +
    `Проекты: ${PROJECTS}`
  );
}

function getProjectsText() {
  let dirs = [];
  try {
    dirs = readdirSync(PROJECTS, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {}

  if (dirs.length === 0) {
    return (
      `📁 Проекты\n\n` +
      `Папка проектов пока пустая.\n` +
      `Путь: ${PROJECTS}\n\n` +
      `Попросите меня создать проект — я создам его здесь.`
    );
  }

  return (
    `📁 Проекты (${dirs.length})\n\n` +
    dirs.map((d) => `- ${d}`).join("\n") +
    `\n\nПуть: ${PROJECTS}`
  );
}

function getMemoryText() {
  const memoryDir = join(WORKSPACE, "memory");
  let files = [];
  try {
    files = readdirSync(memoryDir)
      .filter((f) => f.endsWith(".md") && f !== "README.md")
      .sort()
      .reverse()
      .slice(0, 7);
  } catch {}

  const memoryExists = existsSync(join(WORKSPACE, "MEMORY.md"));
  let memorySize = 0;
  if (memoryExists) {
    try {
      memorySize = readFileSync(join(WORKSPACE, "MEMORY.md"), "utf8").split("\n").length;
    } catch {}
  }

  return (
    `🧠 Память\n\n` +
    `MEMORY.md: ${memoryExists ? `${memorySize} строк` : "не найден"}\n\n` +
    `Последние дневники:\n` +
    (files.length > 0 ? files.map((f) => `- ${f}`).join("\n") : "пусто") +
    `\n\nПуть: ${WORKSPACE}/memory/`
  );
}

// ─── SEND RESPONSE ──────────────────────────────────────────────────────────

const CHUNK_SOFT_LIMIT = 1800;
const CHUNK_HARD_LIMIT = 4096;

function sendChunked(html) {
  const chunks = [];
  const paragraphs = html.split("\n\n");
  let current = "";

  for (const para of paragraphs) {
    if (para.length > CHUNK_HARD_LIMIT) {
      // Split oversized paragraph by lines
      if (current) { chunks.push(current); current = ""; }
      const lines = para.split("\n");
      for (const line of lines) {
        if (current.length + line.length + 1 > CHUNK_HARD_LIMIT) {
          if (current) chunks.push(current);
          current = line.slice(0, CHUNK_HARD_LIMIT);
        } else {
          current = current ? current + "\n" + line : line;
        }
      }
    } else if (current.length + para.length + 2 > CHUNK_SOFT_LIMIT && current) {
      chunks.push(current);
      current = para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function sendResponse(ctx, text) {
  // Extract media tags before formatting
  const { cleaned, media } = extractMediaTags(text);
  const html = mdToTgHtml(cleaned);

  // Check if response needs confirmation buttons
  const hasConfirmation = needsConfirmation(cleaned);

  if (html.length <= CHUNK_HARD_LIMIT) {
    const replyOpts = {
      parse_mode: "HTML",
      reply_markup: hasConfirmation ? confirmKeyboard() : mainKeyboard,
    };
    try {
      await ctx.reply(html, replyOpts);
    } catch {
      // Fallback: if HTML parsing fails, send as plain text
      await ctx.reply(cleaned, { reply_markup: mainKeyboard });
    }
  } else {
    const chunks = sendChunked(html);
    for (let i = 0; i < chunks.length; i++) {
      const isLast = i === chunks.length - 1;
      const markup = isLast
        ? { reply_markup: hasConfirmation ? confirmKeyboard() : mainKeyboard }
        : {};
      try {
        await ctx.reply(chunks[i], { parse_mode: "HTML", ...markup });
      } catch {
        await ctx.reply(chunks[i].replace(/<[^>]+>/g, ""), markup);
      }
    }
  }

  // Send media files after text
  for (const item of media) {
    await sendMediaItem(ctx, item);
  }
}

// ─── TELEGRAM BOT ────────────────────────────────────────────────────────────

const bot = new Bot(BOT_TOKEN);
bot.api.config.use(autoRetry());

// Большое меню /settings (модель/режим/env/часовой пояс/перезагрузка)
registerSettingsHandlers(bot, isOwner, mainKeyboard);

// Переменные окружения — подменю «🔌 Переменные окружения» из /settings
registerSecretsHandlers(bot, isOwner, mainKeyboard);

// 7 «фоновых» специалистов как slash-команды: reload, remember, diagnose,
// media, web, transcript, digest (+ monitor — алиас digest по knowledge)
registerCommandsHandlers(bot, isOwner, mainKeyboard, processUserText);

// Подсказка при первом голосовом без распознавалки (модуль voice-helper.js)
registerVoiceHelpers(bot, isOwner);

// Парсер участников чатов (модуль parser-menu.js)
registerParserHandlers(bot, isOwner);

// Sales Manager — AI-продавец (модуль sales-menu.js)
registerSalesHandlers(bot, isOwner);

// /start
bot.command("start", async (ctx) => {
  // Auto-lock: first user to /start becomes the owner
  if (!_ownerId) {
    saveOwner(ctx);
    await ctx.reply(
      "Привет! Я твой персональный AI-агент.\n\n" +
      "Я привязался к твоему аккаунту и буду отвечать только тебе.\n\n" +
      "Пиши мне текстом, отправляй голосовые, фото или файлы — я помогу с любыми задачами.\n\n" +
      "Используй кнопки внизу или просто пиши.\n\n" +
      "📌 /settings — подключить API-ключи (Deepgram, GitHub, Vercel и т.д.)",
      { reply_markup: mainKeyboard }
    );
    return;
  }
  if (!isOwner(ctx)) return;
  await ctx.reply(
    "Привет! Я твой персональный AI-агент.\n\n" +
    "Пиши мне текстом, отправляй голосовые, фото или файлы — я помогу с любыми задачами.\n\n" +
    "Используй кнопки внизу или просто пиши.\n\n" +
    "📌 /settings — подключить API-ключи (Deepgram, GitHub, Vercel и т.д.)",
    { reply_markup: mainKeyboard }
  );
});

// /reset
bot.command("reset", async (ctx) => {
  if (!isOwner(ctx)) return;
  const userId = String(ctx.from.id);
  sessions.delete(userId);
  saveSessions();
  await ctx.reply("Сессия сброшена. Начинаем с чистого листа.", { reply_markup: mainKeyboard });
});

// /stop — прервать текущую задачу (kill активного claude subprocess)
bot.command("stop", async (ctx) => {
  if (!isOwner(ctx)) return;
  if (!hasActiveChild()) {
    await ctx.reply("Сейчас ничего не выполняется — нечего останавливать.", { reply_markup: mainKeyboard });
    return;
  }
  const killed = killActiveChild();
  if (killed) {
    await ctx.reply("⛔ Остановлено. Контекст и память остаются — продолжай с нового сообщения.", { reply_markup: mainKeyboard });
  } else {
    await ctx.reply("⚠️ Не смог корректно прервать процесс. Попробуй /reset если бот завис.", { reply_markup: mainKeyboard });
  }
});

// /status
bot.command("status", async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.reply(getStatusText(), { reply_markup: mainKeyboard });
});

// Button handlers
bot.hears("📋 Статус", async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.reply(getStatusText(), { reply_markup: mainKeyboard });
});

bot.hears("🔄 Новый диалог", async (ctx) => {
  if (!isOwner(ctx)) return;
  const userId = String(ctx.from.id);
  sessions.delete(userId);
  saveSessions();
  await ctx.reply("Сессия сброшена. Начинаем с чистого листа.", { reply_markup: mainKeyboard });
});

bot.hears("📁 Проекты", async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.reply(getProjectsText(), { reply_markup: mainKeyboard });
});

bot.hears("🧠 Память", async (ctx) => {
  if (!isOwner(ctx)) return;
  await ctx.reply(getMemoryText(), { reply_markup: mainKeyboard });
});

bot.hears("🎯 Парсер", async (ctx) => {
  if (!isOwner(ctx)) return;
  // Симулируем команду /parser
  ctx.message.text = "/parser";
  ctx.message.entities = [{ type: "bot_command", offset: 0, length: 7 }];
  await bot.handleUpdate({ update_id: 0, message: ctx.message });
});

bot.hears("💼 Продажи", async (ctx) => {
  if (!isOwner(ctx)) return;
  ctx.message.text = "/sales";
  ctx.message.entities = [{ type: "bot_command", offset: 0, length: 6 }];
  await bot.handleUpdate({ update_id: 0, message: ctx.message });
});

// ─── CONFIRMATION CALLBACKS ─────────────────────────────────────────────────

bot.callbackQuery("confirm_yes", async (ctx) => {
  await ctx.answerCallbackQuery();
  const userId = String(ctx.from.id);
  const sessionId = sessions.get(userId) || null;

  const thinkingMsg = await ctx.reply(nextThinkingPhrase());
  const typingInterval = setInterval(() => {
    if (!isGloballyRateLimited()) {
      ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => {});
    }
  }, 4000);

  try {
    const result = await callClaude("✔ Продолжай выполнение.", sessionId);
    if (result.sessionId) {
      sessions.set(userId, result.sessionId);
      saveSessions();
    }
    clearInterval(typingInterval);
    await ctx.api.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => {});
    await sendResponse(ctx, result.text);
  } catch (err) {
    clearInterval(typingInterval);
    await ctx.api.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => {});
    const friendly = humanizeError(err.message);
    await ctx.reply(friendly || "Ошибка. Попробуй ещё раз.", { reply_markup: mainKeyboard });
  }
});

bot.callbackQuery("confirm_no", async (ctx) => {
  await ctx.answerCallbackQuery("Остановлено");
  await ctx.reply("Остановлено. Что делаем дальше?", { reply_markup: mainKeyboard });
});

// Handle photos (single or media group)
bot.on("message:photo", async (ctx) => {
  const photo = ctx.message.photo[ctx.message.photo.length - 1]; // largest size
  await enqueueMedia(ctx, {
    kind: "photo",
    fileId: photo.file_id,
    ext: ".jpg",
    caption: ctx.message.caption || null,
  });
});

// Handle documents (PDF, DOCX, etc.)
bot.on("message:document", async (ctx) => {
  if (!isOwner(ctx)) return;
  const doc = ctx.message.document;
  const ext = doc.file_name ? "." + doc.file_name.split(".").pop() : ".bin";
  await enqueueMedia(ctx, {
    kind: "document",
    fileId: doc.file_id,
    ext,
    fileName: doc.file_name,
    caption: ctx.message.caption || null,
  });
});

// Handle video
bot.on("message:video", async (ctx) => {
  if (!isOwner(ctx)) return;
  await enqueueMedia(ctx, {
    kind: "video",
    fileId: ctx.message.video.file_id,
    ext: ".mp4",
    caption: ctx.message.caption || null,
  });
});

// Handle text messages
// Общий обработчик текста → Claude.
// Используется и в bot.on("message:text"), и в bot.command(...) из commands-menu.js
// (там slash-команды инжектят готовый промпт-шаблон вместо сырого текста).
export async function processUserText(ctx, text) {
  const userId = String(ctx.from.id);

  const thinkingMsg = await ctx.reply(nextThinkingPhrase());
  const typingInterval = setInterval(() => {
    if (!isGloballyRateLimited()) {
      ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => {});
    }
  }, 4000);

  const phraseInterval = setInterval(() => {
    if (!isGloballyRateLimited()) {
      ctx.api.editMessageText(ctx.chat.id, thinkingMsg.message_id, nextThinkingPhrase()).catch(() => {});
    }
  }, 3000);

  try {
    const urlContext = await prefetchUrls(text);
    const enrichedPrompt = urlContext ? text + urlContext : text;

    const sessionId = sessions.get(userId) || null;
    const result = await callClaude(enrichedPrompt, sessionId);

    if (result.sessionId) {
      sessions.set(userId, result.sessionId);
      saveSessions();
    }

    clearInterval(typingInterval);
    clearInterval(phraseInterval);
    await ctx.api.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => {});
    await sendResponse(ctx, result.text);
  } catch (err) {
    clearInterval(typingInterval);
    clearInterval(phraseInterval);
    await ctx.api.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => {});
    console.error("[error]", err.message);

    const match = err.message.match(/retry.after.*?(\d+)/i);
    if (match) setGlobalRateLimit(parseInt(match[1]));

    const friendly = humanizeError(err.message);
    await ctx.reply(friendly || "Произошла ошибка. Попробуй ещё раз или нажми 🔄 Новый диалог.", { reply_markup: mainKeyboard });
  }
}

bot.on("message:text", async (ctx) => {
  if (!isOwner(ctx)) return;

  // Если ждём ввод секрета — обработать и не передавать в Claude
  if (await handlePendingInput(ctx)) return;

  await processUserText(ctx, ctx.message.text);
});

// Handle voice messages
bot.on("message:voice", async (ctx) => {
  if (!isOwner(ctx)) return;

  const thinkingMsg = await ctx.reply("Слушаю голосовое... 🎤");
  const typingInterval = setInterval(() => {
    if (!isGloballyRateLimited()) {
      ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => {});
    }
  }, 4000);

  try {
    const file = await ctx.getFile();
    const tmpPath = `/tmp/voice_${ctx.from.id}_${Date.now()}.ogg`;
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    await downloadTgFile(fileUrl, tmpPath);

    const transcript = await transcribeVoice(tmpPath);
    try { unlinkSync(tmpPath); } catch {}

    if (!transcript) {
      clearInterval(typingInterval);
      await ctx.api.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => {});

      // Если ни Deepgram, ни Whisper не подключены — показываем интерактивное меню.
      // Иначе расшифровка просто провалилась один раз — обычная ошибка.
      if (!hasAnyTranscriber()) {
        return ctx.reply(VOICE_FALLBACK_PROMPT, {
          parse_mode: "HTML",
          reply_markup: voiceFallbackKeyboard(),
        });
      }

      return ctx.reply(
        "Не получилось распознать на этот раз. Попробуй ещё раз или отправь текстом.",
        { reply_markup: mainKeyboard }
      );
    }

    await ctx.api.editMessageText(ctx.chat.id, thinkingMsg.message_id,
      `Распознано: "${transcript.slice(0, 100)}${transcript.length > 100 ? "..." : ""}"\n\n${nextThinkingPhrase()}`);

    const userId = String(ctx.from.id);
    const sessionId = sessions.get(userId) || null;
    const result = await callClaude(transcript, sessionId);

    if (result.sessionId) {
      sessions.set(userId, result.sessionId);
      saveSessions();
    }

    clearInterval(typingInterval);
    await ctx.api.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => {});
    await sendResponse(ctx, result.text);
  } catch (err) {
    clearInterval(typingInterval);
    await ctx.api.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => {});
    console.error("[voice-error]", err.message);
    const friendly = humanizeError(err.message);
    await ctx.reply(friendly || "Ошибка обработки голосового. Попробуй текстом.", { reply_markup: mainKeyboard });
  }
});

// ─── START ────────────────────────────────────────────────────────────────────

bot.catch((err) => {
  console.error("[bot-error]", err.message);
  // Detect rate limit from bot framework
  const match = String(err.message).match(/retry.after.*?(\d+)/i);
  if (match) setGlobalRateLimit(parseInt(match[1]));
});

bot.start({
  onStart: async () => {
    await bot.api.setMyCommands([
      { command: "start",      description: "Меню" },
      { command: "stop",       description: "Прервать текущую задачу" },
      { command: "reset",      description: "Новая сессия" },
      { command: "status",     description: "Статус агента" },
      { command: "settings",   description: "Настройки: модель, режим, env, часовой пояс" },
      { command: "reload",     description: "Перечитать DNA-файлы (SOUL/MEMORY/GOALS)" },
      { command: "remember",   description: "Сохранить факт в долгосрочную память" },
      { command: "diagnose",   description: "Диагностика: PM2, логи, диск" },
      { command: "media",      description: "Скачать видео/аудио по ссылке (yt-dlp)" },
      { command: "web",        description: "Открыть ссылку и пересказать суть" },
      { command: "transcript", description: "Расшифровать YouTube-видео в текст" },
      { command: "digest",     description: "Дайджест AI-новостей или разбор темы" },
      { command: "monitor",    description: "Поиск по своей базе знаний" },
      { command: "parser",     description: "Парсер участников чатов" },
      { command: "sales",      description: "Sales Manager — AI-продавец" },
    ]);
    // Принудительно обновляем reply keyboard у владельца (новые кнопки 🎯 Парсер / 💼 Продажи)
    if (_ownerId) {
      try {
        await bot.api.sendMessage(_ownerId, "🔧 Меню обновлено: добавлены кнопки 🎯 Парсер и 💼 Продажи", { reply_markup: mainKeyboard });
      } catch {}
    }
    console.log(`Agent bot started (workspace: ${WORKSPACE}, projects: ${PROJECTS})`);
    if (_ownerId) console.log(`Owner: ${_ownerId} (only owner can use bot)`);
    else console.log("No owner yet — first /start will auto-lock");
  },
  drop_pending_updates: true,
});
