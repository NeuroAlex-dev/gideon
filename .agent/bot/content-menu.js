// .agent/bot/content-menu.js
// Раздел «✍ Контент» в @flash_gideon_bot — управление Контент-Агентом.
// Сервис content-agent живёт на http://127.0.0.1:3002.
import { InlineKeyboard } from "grammy";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { unlinkSync } from "node:fs";

function loadCaEnv() {
  const candidates = [
    process.env.CA_ENV_PATH,
    "C:/Users/Administrator/Documents/Projects/gideon/projects/content-agent/.env",
    path.resolve(process.cwd(), "../../projects/content-agent/.env"),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const out = {};
      for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
        if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
      return out;
    } catch {}
  }
  return {};
}
const caEnv = loadCaEnv();
const CA_API_BASE = process.env.CA_API_BASE || `http://127.0.0.1:${caEnv.CA_PORT || 3002}/api`;
const CA_PASSWORD = process.env.CA_PASSWORD || caEnv.CA_PASSWORD || "change-me";
const CA_SECRET = process.env.CA_SECRET || caEnv.CA_SECRET || "change-me-secret";
const AUTH_TOKEN = crypto.createHmac("sha256", CA_SECRET).update(CA_PASSWORD).digest("hex");

async function api(method, p, body) {
  const res = await fetch(`${CA_API_BASE}${p}`, {
    method,
    headers: { "x-auth-token": AUTH_TOKEN, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`content-agent API ${method} ${p}: ${res.status} ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function esc(s) { return String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])); }

// chatId → состояние мастера
const wizards = new Map();

const INSTRUCTION = `<b>ℹ️ Контент-Агент</b>

Я учусь твоему стилю и пишу посты как ты.

<b>🎭 Мой стиль</b> — пройди интервью (10 вопросов, отвечай голосом). Я проанализирую речь и создам профиль стиля. Все посты дальше — в нём.

<b>✍ Написать пост</b> — пришли тему текстом или голосом, я напишу пост и предложу варианты (экспертнее, проще, с юмором, короче, призыв).

<b>🔍 Найти информацию</b>, <b>📆 Дайджест</b>, <b>📖 Контент-план</b>, <b>📡 Источники</b> — появятся в следующих фазах.`;

export function registerContentHandlers(bot, isOwner, deps = {}) {
  const { transcribeVoice, downloadTgFile } = deps;
  async function showMainMenu(ctx) {
    const kb = new InlineKeyboard()
      .text("🎭 Мой стиль", "ca:style").text("✍ Написать пост", "ca:write").row()
      .text("🔍 Найти информацию", "ca:find").text("📆 Дайджест", "ca:soon").row()
      .text("📖 Контент-план", "ca:soon").text("📡 Источники", "ca:sources").row()
      .text("⚙ Настройки", "ca:settings").text("ℹ️ Инструкция", "ca:help");
    await ctx.reply("✍ <b>Контент-Агент</b> — что делаем?", { parse_mode: "HTML", reply_markup: kb });
  }

  bot.command("content", async (ctx) => {
    if (!isOwner(ctx)) return;
    await showMainMenu(ctx);
  });

  bot.callbackQuery(/^ca:menu$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    await showMainMenu(ctx);
  });

  bot.callbackQuery(/^ca:help$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    await ctx.reply(INSTRUCTION, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("🏠 Меню", "ca:menu") });
  });

  bot.callbackQuery(/^ca:soon$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery({ text: "Скоро — в следующих фазах" });
  });

  bot.callbackQuery(/^ca:settings$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    try {
      const s = await api("GET", "/settings");
      await ctx.answerCallbackQuery();
      await ctx.reply(
        `⚙ <b>Настройки Контент-Агента</b>\n\n` +
        `VK токен: ${s.vk_token ? "задан" : "—"}\n` +
        `YouTube ключ: ${s.youtube_api_key ? "задан" : "—"}\n\n` +
        `<i>Понадобятся в Фазе 3 (мониторинг VK/YouTube).</i>`,
        { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("🏠 Меню", "ca:menu") },
      );
    } catch (e) {
      await ctx.answerCallbackQuery({ text: "Сервис недоступен" });
      await ctx.reply(`⚠️ ${esc(e.message)}\n\nПроверь, что content-agent запущен (pm2).`);
    }
  });

  registerStyleHandlers(bot, isOwner, { api, wizards, esc, transcribeVoice, downloadTgFile });
  registerWriteHandlers(bot, isOwner, { api, wizards, esc, transcribeVoice, downloadTgFile });
  registerSourcesHandlers(bot, isOwner, { api, wizards, esc });
  registerFindHandlers(bot, isOwner, { api, wizards, esc });
}

// === Мастер «🎭 Мой стиль» ===
function registerStyleHandlers(bot, isOwner, { api, wizards, esc, transcribeVoice, downloadTgFile }) {
  bot.callbackQuery(/^ca:style$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    try {
      const status = await api("GET", "/style/status");
      const kb = new InlineKeyboard();
      if (status.present) {
        kb.text("🔄 Переобучить стиль", "ca:style-start").row();
      } else {
        kb.text("🚀 Начать интервью", "ca:style-start").row();
      }
      kb.text("🏠 Меню", "ca:menu");
      await ctx.reply(
        `🎭 <b>Мой стиль</b>\n\n` +
        (status.present ? "Профиль стиля обучен. Можно переобучить заново.\n\n" : "Профиль ещё не обучен.\n\n") +
        `Интервью: 10 вопросов, отвечаешь голосом. Потом можно прислать доп.материалы (транскрипты, выгрузку постов). В конце я создам 5 файлов профиля.`,
        { parse_mode: "HTML", reply_markup: kb },
      );
    } catch (e) {
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  });

  bot.callbackQuery(/^ca:style-start$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    try {
      const r = await api("POST", "/style/interview/start");
      wizards.set(ctx.chat.id, { mode: "style_interview", step: r.step, total: r.total });
      await ctx.reply(
        `🎭 <b>Вопрос ${r.step + 1}/${r.total}</b>\n\n${esc(r.question)}\n\n<i>Ответь голосовым (лучше) или текстом.</i>`,
        { parse_mode: "HTML" },
      );
    } catch (e) {
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  });

  async function submitAnswer(ctx, transcript) {
    try {
      const r = await api("POST", "/style/interview/answer", { transcript });
      if (r.questions_done) {
        wizards.set(ctx.chat.id, { mode: "style_materials" });
        const kb = new InlineKeyboard()
          .text("➕ Прислать ещё инфо", "ca:style-more").row()
          .text("✅ Закончить и создать профиль", "ca:style-finish");
        await ctx.reply(
          "Отлично, 10 вопросов готово! ✅\n\nМожешь прислать доп.материалы (текстом или голосом): транскрипты, куски постов. Или сразу создать профиль.",
          { reply_markup: kb },
        );
        return;
      }
      const w = wizards.get(ctx.chat.id);
      if (w) w.step = r.step;
      await ctx.reply(
        `🎭 <b>Вопрос ${r.step + 1}/${r.total}</b>\n\n${esc(r.question)}\n\n<i>Ответь голосовым или текстом.</i>`,
        { parse_mode: "HTML" },
      );
    } catch (e) {
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  }

  bot.callbackQuery(/^ca:style-more$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    wizards.set(ctx.chat.id, { mode: "style_materials" });
    await ctx.reply("Шли материалы (текст или голос). Когда закончишь — нажми «✅ Закончить».", {
      reply_markup: new InlineKeyboard().text("✅ Закончить и создать профиль", "ca:style-finish"),
    });
  });

  bot.callbackQuery(/^ca:style-finish$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    wizards.delete(ctx.chat.id);
    const wait = await ctx.reply("Анализирую твой стиль и пишу профиль (5 документов)... это займёт минуту ⏳");
    try {
      const r = await api("POST", "/style/interview/finish");
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      await ctx.reply(
        `✅ Профиль стиля создан!\n\nФайлы: ${r.files.join(", ")}\n\nТеперь все посты будут в твоём стиле. Жми «✍ Написать пост».`,
        { reply_markup: new InlineKeyboard().text("✍ Написать пост", "ca:write").row().text("🏠 Меню", "ca:menu") },
      );
    } catch (e) {
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      await ctx.reply(`⚠️ Не получилось создать профиль: ${esc(e.message)}`);
    }
  });

  bot.on("message:voice", async (ctx, next) => {
    if (!isOwner(ctx)) return next();
    const w = wizards.get(ctx.chat.id);
    if (!w || (w.mode !== "style_interview" && w.mode !== "style_materials")) return next();

    const note = await ctx.reply("Слушаю голосовое... 🎤");
    try {
      const file = await ctx.getFile();
      const tmp = `/tmp/ca_voice_${ctx.from.id}_${Date.now()}.ogg`;
      const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
      await downloadTgFile(url, tmp);
      const transcript = await transcribeVoice(tmp);
      try { unlinkSync(tmp); } catch {}
      await ctx.api.deleteMessage(ctx.chat.id, note.message_id).catch(() => {});
      if (!transcript) {
        await ctx.reply("Не распознал голос. Пришли текстом, пожалуйста.");
        return;
      }
      if (w.mode === "style_interview") {
        await ctx.reply(`Записал: "${transcript.slice(0, 80)}${transcript.length > 80 ? "…" : ""}"`);
        await submitAnswer(ctx, transcript);
      } else {
        await api("POST", "/style/interview/material", { type: "voice", text: transcript });
        await ctx.reply("📎 Материал добавлен. Шли ещё или нажми «✅ Закончить».", {
          reply_markup: new InlineKeyboard().text("✅ Закончить и создать профиль", "ca:style-finish"),
        });
      }
    } catch (e) {
      await ctx.api.deleteMessage(ctx.chat.id, note.message_id).catch(() => {});
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  });

  bot.on("message:text", async (ctx, next) => {
    if (!isOwner(ctx)) return next();
    const w = wizards.get(ctx.chat.id);
    if (!w || (w.mode !== "style_interview" && w.mode !== "style_materials")) return next();
    const text = ctx.message.text.trim();
    if (w.mode === "style_interview") {
      await submitAnswer(ctx, text);
    } else {
      try {
        await api("POST", "/style/interview/material", { type: "text", text });
        await ctx.reply("📎 Материал добавлен. Шли ещё или «✅ Закончить».", {
          reply_markup: new InlineKeyboard().text("✅ Закончить и создать профиль", "ca:style-finish"),
        });
      } catch (e) {
        await ctx.reply(`⚠️ ${esc(e.message)}`);
      }
    }
  });
}

// === Мастер «✍ Написать пост» ===
function registerWriteHandlers(bot, isOwner, { api, wizards, esc, transcribeVoice, downloadTgFile }) {
  function postKeyboard(id) {
    return new InlineKeyboard()
      .text("✅ Сохранить", `ca:post-approve:${id}`).text("🔄 Переписать", `ca:post-var:${id}:rewrite`).row()
      .text("✂️ Короче", `ca:post-var:${id}:shorter`).text("📈 Экспертнее", `ca:post-var:${id}:expert`).row()
      .text("🙂 Проще", `ca:post-var:${id}:simpler`).text("😂 Юмор", `ca:post-var:${id}:humor`).row()
      .text("🎯 Призыв", `ca:post-var:${id}:cta`).row()
      .text("🏠 Меню", "ca:menu");
  }

  bot.callbackQuery(/^ca:write$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    wizards.set(ctx.chat.id, { mode: "post_prompt" });
    await ctx.reply("✍ О чём написать пост? Пришли тему текстом или голосом.\n\n<i>Например: «как предпринимателю выбрать нейросеть для бизнеса».</i>", { parse_mode: "HTML" });
  });

  async function generateAndSend(ctx, userPrompt) {
    const wait = await ctx.reply("Пишу пост в твоём стиле... ✍️ (до минуты)");
    try {
      const r = await api("POST", "/posts", { user_prompt: userPrompt });
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      await ctx.reply(r.draft_text || "(пусто)", { reply_markup: postKeyboard(r.id) });
    } catch (e) {
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  }

  bot.callbackQuery(/^ca:post-var:(\d+):(\w+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const [, id, mode] = ctx.match;
    await ctx.answerCallbackQuery({ text: "Переписываю..." });
    const wait = await ctx.reply("Переписываю... ✍️");
    try {
      const r = await api("POST", `/posts/${id}/variant`, { mode });
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      await ctx.reply(r.draft_text || "(пусто)", { reply_markup: postKeyboard(id) });
    } catch (e) {
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  });

  bot.callbackQuery(/^ca:news-post:(\d+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const itemId = ctx.match[1];
    await ctx.answerCallbackQuery({ text: "Пишу пост..." });
    const wait = await ctx.reply("Пишу пост по новости в твоём стиле... ✍️ (до минуты)");
    try {
      const r = await api("POST", "/posts", { origin: "digest_item", digest_item_id: Number(itemId) });
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      await ctx.reply(r.draft_text || "(пусто)", { reply_markup: postKeyboard(r.id) });
    } catch (e) {
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  });

  bot.callbackQuery(/^ca:post-approve:(\d+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const id = ctx.match[1];
    try {
      await api("POST", `/posts/${id}/approve`);
      await ctx.answerCallbackQuery({ text: "Сохранено" });
      await ctx.reply("✅ Пост сохранён. (Автопостинг во все соцсети — в Фазе 5.)", {
        reply_markup: new InlineKeyboard().text("✍ Ещё пост", "ca:write").row().text("🏠 Меню", "ca:menu"),
      });
    } catch (e) {
      await ctx.answerCallbackQuery({ text: "Ошибка" });
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  });

  bot.on("message:text", async (ctx, next) => {
    if (!isOwner(ctx)) return next();
    const w = wizards.get(ctx.chat.id);
    if (!w || w.mode !== "post_prompt") return next();
    wizards.delete(ctx.chat.id);
    await generateAndSend(ctx, ctx.message.text.trim());
  });

  bot.on("message:voice", async (ctx, next) => {
    if (!isOwner(ctx)) return next();
    const w = wizards.get(ctx.chat.id);
    if (!w || w.mode !== "post_prompt") return next();
    const note = await ctx.reply("Слушаю тему... 🎤");
    try {
      const file = await ctx.getFile();
      const tmp = `/tmp/ca_topic_${ctx.from.id}_${Date.now()}.ogg`;
      const url = `https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${file.file_path}`;
      await downloadTgFile(url, tmp);
      const transcript = await transcribeVoice(tmp);
      try { unlinkSync(tmp); } catch {}
      await ctx.api.deleteMessage(ctx.chat.id, note.message_id).catch(() => {});
      if (!transcript) { await ctx.reply("Не распознал. Пришли тему текстом."); return; }
      wizards.delete(ctx.chat.id);
      await ctx.reply(`Тема: "${transcript.slice(0, 80)}${transcript.length > 80 ? "…" : ""}"`);
      await generateAndSend(ctx, transcript);
    } catch (e) {
      await ctx.api.deleteMessage(ctx.chat.id, note.message_id).catch(() => {});
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  });
}

// === «📡 Источники» (Фаза 2) ===
function registerSourcesHandlers(bot, isOwner, { api, wizards, esc }) {
  async function showSources(ctx) {
    let sources = [];
    try { sources = await api("GET", "/sources"); } catch (e) {
      await ctx.reply(`⚠️ ${esc(e.message)}`); return;
    }
    const tg = sources.filter((s) => s.platform === "telegram");
    const lines = ["📡 <b>Источники мониторинга</b>", "", `Telegram-каналы (${tg.length}):`];
    for (const s of tg) lines.push(`• ${esc(s.ref)}${s.title ? " — " + esc(s.title) : ""}`);
    if (!tg.length) lines.push("<i>пока пусто</i>");
    const kb = new InlineKeyboard().text("➕ Добавить TG-канал", "ca:src-add").row();
    for (const s of tg) kb.text(`❌ ${s.ref}`, `ca:src-del:${s.id}`).row();
    kb.text("🏠 Меню", "ca:menu");
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML", reply_markup: kb });
  }

  bot.callbackQuery(/^ca:sources$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    await showSources(ctx);
  });

  bot.callbackQuery(/^ca:src-add$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    wizards.set(ctx.chat.id, { mode: "src_add" });
    await ctx.reply("Пришли @username канала или ссылку (например <code>@durov</code> или <code>https://t.me/durov</code>):", { parse_mode: "HTML" });
  });

  bot.callbackQuery(/^ca:src-del:(\d+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const id = ctx.match[1];
    try {
      await api("DELETE", `/sources/${id}`);
      await ctx.answerCallbackQuery({ text: "Удалён" });
      await showSources(ctx);
    } catch (e) {
      await ctx.answerCallbackQuery({ text: "Ошибка" });
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  });

  bot.on("message:text", async (ctx, next) => {
    if (!isOwner(ctx)) return next();
    const w = wizards.get(ctx.chat.id);
    if (!w || w.mode !== "src_add") return next();
    wizards.delete(ctx.chat.id);
    let ref = ctx.message.text.trim();
    const m = ref.match(/t\.me\/(@?[\w\d_]+)/i);
    if (m) ref = m[1];
    if (!ref.startsWith("@") && !/^[\w\d_]+$/.test(ref)) {
      await ctx.reply("Не похоже на канал. Пришли @username или ссылку t.me/...");
      return;
    }
    if (!ref.startsWith("@")) ref = "@" + ref;
    try {
      await api("POST", "/sources", { platform: "telegram", ref });
      await ctx.reply(`✅ Канал ${esc(ref)} добавлен в мониторинг.`,
        { reply_markup: new InlineKeyboard().text("📡 К источникам", "ca:sources").row().text("🏠 Меню", "ca:menu") });
    } catch (e) {
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  });
}

// === «🔍 Найти информацию» + дайджест (Фаза 2) ===
function registerFindHandlers(bot, isOwner, { api, wizards, esc }) {
  const PERIODS = [["Сегодня", "today"], ["3 дня", "3days"], ["Неделя", "week"], ["Месяц", "month"]];

  bot.callbackQuery(/^ca:find$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    wizards.set(ctx.chat.id, { mode: "find", platforms: ["telegram"] });
    const kb = new InlineKeyboard();
    for (const [label, val] of PERIODS) kb.text(label, `ca:find-period:${val}`);
    kb.row().text("🏠 Меню", "ca:menu");
    await ctx.reply("🔍 <b>Найти информацию</b> (Telegram)\n\nЗа какой период искать?", { parse_mode: "HTML", reply_markup: kb });
  });

  bot.callbackQuery(/^ca:find-period:(\w+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const period = ctx.match[1];
    const w = wizards.get(ctx.chat.id) || { mode: "find", platforms: ["telegram"] };
    w.period = period;
    w.mode = "find_keywords";
    wizards.set(ctx.chat.id, w);
    await ctx.answerCallbackQuery();
    await ctx.reply("Ключевые слова через запятую (или «-» чтобы искать по сохранённым/всем):", {
      reply_markup: new InlineKeyboard().text("Искать по всем", "ca:find-go:all"),
    });
  });

  bot.callbackQuery(/^ca:find-go:all$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    const w = wizards.get(ctx.chat.id);
    if (!w) return;
    await runSearch(ctx, w, []);
  });

  async function runSearch(ctx, w, keywords) {
    wizards.delete(ctx.chat.id);
    const wait = await ctx.reply("Ищу по каналам... 🔍 (до минуты)");
    try {
      const r = await api("POST", "/search", { platforms: w.platforms || ["telegram"], period: w.period || "week", keywords });
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      if (!r.count) {
        await ctx.reply("Ничего не нашёл по заданным условиям. Проверь список источников (📡) и ключевые слова.",
          { reply_markup: new InlineKeyboard().text("📡 Источники", "ca:sources").row().text("🏠 Меню", "ca:menu") });
        return;
      }
      await sendDigest(ctx, r.digest_id, r.items);
    } catch (e) {
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  }

  async function sendDigest(ctx, digestId, items) {
    await ctx.reply(`📰 <b>Дайджест</b> — найдено ${items.length}`, { parse_mode: "HTML" });
    for (const it of items) {
      const m = it.metrics || {};
      const text = `<b>${esc(it.title)}</b>\n${esc(it.summary || "")}\n\n` +
        `👁 ${m.views || 0} · ❤️ ${m.reactions || 0} · 💬 ${m.comments || 0} · 🔁 ${m.forwards || 0}` +
        (it.url ? `\n${esc(it.url)}` : "");
      const kb = new InlineKeyboard().text("✍ Пост из этой новости", `ca:news-post:${it.id}`);
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
    }
    const kb = new InlineKeyboard()
      .text("✂️ Короче", `ca:dig-reshape:${digestId}:shorter`).text("➕ Детальнее", `ca:dig-reshape:${digestId}:detailed`).row()
      .text("💾 Сохранить дайджест", `ca:dig-save:${digestId}`).row()
      .text("🏠 Меню", "ca:menu");
    await ctx.reply("Действия с дайджестом:", { reply_markup: kb });
  }

  bot.callbackQuery(/^ca:dig-reshape:(\d+):(\w+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const [, id, mode] = ctx.match;
    await ctx.answerCallbackQuery({ text: "Переписываю..." });
    const wait = await ctx.reply("Переписываю дайджест... ✍️");
    try {
      const r = await api("POST", `/digests/${id}/reshape`, { mode });
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      const kb = new InlineKeyboard()
        .text("✂️ Короче", `ca:dig-reshape:${id}:shorter`).text("➕ Детальнее", `ca:dig-reshape:${id}:detailed`).row()
        .text("💾 Сохранить", `ca:dig-save:${id}`).text("🏠 Меню", "ca:menu");
      const body = (r.rendered_text || "(пусто)").slice(0, 3800);
      await ctx.reply(body, { reply_markup: kb });
    } catch (e) {
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  });

  bot.callbackQuery(/^ca:dig-save:(\d+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const id = ctx.match[1];
    try {
      await api("POST", `/digests/${id}/save`);
      await ctx.answerCallbackQuery({ text: "Сохранено" });
      await ctx.reply("💾 Дайджест сохранён.");
    } catch (e) {
      await ctx.answerCallbackQuery({ text: "Ошибка" });
    }
  });

  bot.on("message:text", async (ctx, next) => {
    if (!isOwner(ctx)) return next();
    const w = wizards.get(ctx.chat.id);
    if (!w || w.mode !== "find_keywords") return next();
    const raw = ctx.message.text.trim();
    const keywords = raw === "-" ? [] : raw.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
    await runSearch(ctx, w, keywords);
  });
}
