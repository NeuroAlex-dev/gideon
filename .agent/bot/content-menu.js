// .agent/bot/content-menu.js
// Раздел «✍ Контент» в @flash_gideon_bot — управление Контент-Агентом.
// Сервис content-agent живёт на http://127.0.0.1:3002.
import { InlineKeyboard } from "grammy";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { unlinkSync } from "node:fs";
import { downloadTgFile, transcribeVoice } from "./index.js";

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

export function registerContentHandlers(bot, isOwner) {
  async function showMainMenu(ctx) {
    const kb = new InlineKeyboard()
      .text("🎭 Мой стиль", "ca:style").text("✍ Написать пост", "ca:write").row()
      .text("🔍 Найти информацию", "ca:soon").text("📆 Дайджест", "ca:soon").row()
      .text("📖 Контент-план", "ca:soon").text("📡 Источники", "ca:soon").row()
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

  registerStyleHandlers(bot, isOwner, { api, wizards, esc });
  registerWriteHandlers(bot, isOwner, { api, wizards, esc });
}

// === Мастер «🎭 Мой стиль» ===
function registerStyleHandlers(bot, isOwner, { api, wizards, esc }) {
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
function registerWriteHandlers(bot, isOwner, { api, wizards, esc }) {
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
