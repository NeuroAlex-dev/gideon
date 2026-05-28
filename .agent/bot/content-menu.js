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

async function api(method, p, body, opts = {}) {
  // По умолчанию 90 секунд. Для долгих операций (генерация профиля,
  // дайджест с AI-саммари) вызывающий должен передать больший timeoutMs.
  const timeoutMs = opts.timeoutMs || 90000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${CA_API_BASE}${p}`, {
      method,
      headers: { "x-auth-token": AUTH_TOKEN, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`content-agent API ${method} ${p}: ${res.status} ${text.slice(0, 200)}`);
    }
    if (res.status === 204) return null;
    return await res.json();
  } catch (e) {
    if (e.name === "AbortError") throw new Error(`content-agent API ${method} ${p}: таймаут ${timeoutMs/1000}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function esc(s) { return String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])); }

// chatId → состояние мастера
const wizards = new Map();

const INSTRUCTION = `<b>ℹ️ Контент-Агент</b>

Я учусь твоему стилю и пишу посты как ты.

<b>🎭 Мой стиль</b> — пройди интервью (10 вопросов, отвечай голосом). Я проанализирую речь и создам профиль стиля. Все посты дальше — в нём.

<b>✍ Написать пост</b> — пришли тему текстом или голосом, я напишу пост и предложу варианты (экспертнее, проще, с юмором, короче, призыв).

<b>📡 Источники</b> — добавь каналы конкурентов в Telegram и VK (для VK нужен токен — заведи в ⚙ Настройках). У каждого источника можно настроить тему (ключевые слова) — тогда из него будут идти только посты по этой теме.

<b>🔍 Найти информацию</b> — собираю дайджест по твоим источникам с метриками виральности. Под каждой новостью — кнопка «✍ Пост из этой новости» (рерайт в твоём стиле).

<b>🔥 Поиск по трендам</b> — ищу что взлетает в нише прямо сейчас: восходящие запросы Google Trends + топ-обсуждения Reddit. Под каждым трендом — кнопка «✍ Пост по этому тренду».

<b>📆 Дайджест</b>, <b>📖 Контент-план</b> — появятся в следующих фазах.`;

export function registerContentHandlers(bot, isOwner, deps = {}) {
  const { transcribeVoice, downloadTgFile } = deps;
  async function showMainMenu(ctx) {
    const kb = new InlineKeyboard()
      .text("🎭 Мой стиль", "ca:style").text("✍ Написать пост", "ca:write").row()
      .text("🔍 Найти информацию", "ca:find").text("🔥 Поиск по трендам", "ca:trends").row()
      .text("📖 Контент-план", "ca:soon").text("📡 Источники", "ca:sources").row()
      .text("⚙ Настройки", "ca:settings").text("ℹ️ Инструкция", "ca:help");
    await ctx.reply("✍ <b>Контент-Агент</b> — что делаем?", { parse_mode: "HTML", reply_markup: kb });
  }

  bot.command("content", async (ctx) => {
    if (!isOwner(ctx)) return;
    wizards.delete(ctx.chat.id); // защита: команда сбрасывает любой активный мастер
    await showMainMenu(ctx);
  });

  bot.callbackQuery(/^ca:menu$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    wizards.delete(ctx.chat.id); // защита: возврат в меню сбрасывает любой активный мастер
    await showMainMenu(ctx);
  });

  bot.callbackQuery(/^ca:help$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    await ctx.reply(INSTRUCTION, {
      parse_mode: "HTML",
      reply_markup: new InlineKeyboard()
        .text("🎭 Мой стиль", "ca:style").text("✍ Написать пост", "ca:write").row()
        .text("📡 Источники", "ca:sources").text("🔍 Найти инфо", "ca:find").row()
        .text("🏠 Меню", "ca:menu"),
    });
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
      const kb = new InlineKeyboard()
        .text(s.vk_token ? "🔄 Заменить VK токен" : "➕ Задать VK токен", "ca:set-vk").row();
      if (s.vk_token) kb.text("🗑 Очистить VK", "ca:clear-vk").row();
      kb.text("🏠 Меню", "ca:menu");
      await ctx.reply(
        `⚙ <b>Настройки</b>\n\n` +
        `VK токен: ${s.vk_token ? "✅ задан" : "—"}\n\n` +
        `<i>Где взять VK-токен:</i>\n` +
        `Используй готовый client_id Kate Mobile через OAuth (без создания собственного приложения и ИНН).\n` +
        `Ссылка для авторизации: <code>oauth.vk.com/authorize?client_id=2685278&display=page&redirect_uri=https://oauth.vk.com/blank.html&scope=offline,wall,groups&response_type=token&v=5.199</code>\n` +
        `После «Разрешить» в URL появится <code>access_token=…</code> — скопируй и вставь сюда.`,
        { parse_mode: "HTML", reply_markup: kb },
      );
    } catch (e) {
      await ctx.answerCallbackQuery({ text: "Сервис недоступен" });
      await ctx.reply(`⚠️ ${esc(e.message)}\n\nПроверь, что content-agent запущен (pm2).`);
    }
  });

  bot.callbackQuery(/^ca:set-vk$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    wizards.set(ctx.chat.id, { mode: "set_key", which: "vk" });
    await ctx.answerCallbackQuery();
    await ctx.reply(
      "Пришли VK токен (длинная строка, никому не показывай). Проверю одним запросом и сохраню.",
      { reply_markup: new InlineKeyboard().text("🏠 Меню", "ca:menu") },
    );
  });

  bot.callbackQuery(/^ca:clear-vk$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const which = "vk";
    const key = "vk_token";
    try {
      await api("PUT", "/settings", { key, value: "" });
      await ctx.answerCallbackQuery({ text: "Очищено" });
      await ctx.reply("🗑 Удалено.", { reply_markup: new InlineKeyboard().text("⚙ Настройки", "ca:settings").row().text("🏠 Меню", "ca:menu") });
    } catch (e) {
      await ctx.answerCallbackQuery({ text: "Ошибка" });
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  });

  // Приём ключа в set_key wizard
  bot.on("message:text", async (ctx, next) => {
    if (!isOwner(ctx)) return next();
    const w = wizards.get(ctx.chat.id);
    if (!w || w.mode !== "set_key") return next();
    const value = ctx.message.text.trim();
    const key = "vk_token";
    const wait = await ctx.reply("Проверяю ключ... ⏳");
    try {
      await api("PUT", "/settings", { key, value });
      wizards.delete(ctx.chat.id);
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      await ctx.reply(`✅ VK токен сохранён и проверен.`,
        { reply_markup: new InlineKeyboard().text("📡 Источники", "ca:sources").text("🔍 Найти инфо", "ca:find").row().text("⚙ Настройки", "ca:settings").row().text("🏠 Меню", "ca:menu") });
    } catch (e) {
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      await ctx.reply(`⚠️ ${esc(e.message)}\n\nПришли ключ ещё раз или нажми Меню.`,
        { reply_markup: new InlineKeyboard().text("🏠 Меню", "ca:menu") });
    }
  });

  registerStyleHandlers(bot, isOwner, { api, wizards, esc, transcribeVoice, downloadTgFile });
  registerWriteHandlers(bot, isOwner, { api, wizards, esc, transcribeVoice, downloadTgFile });
  registerSourcesHandlers(bot, isOwner, { api, wizards, esc });
  registerFindHandlers(bot, isOwner, { api, wizards, esc });
  registerTrendsHandlers(bot, isOwner, { api, wizards, esc });
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
        kb.text("✍ Написать пост", "ca:write").text("🔄 Переобучить стиль", "ca:style-start").row();
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
        { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("🏠 Меню", "ca:menu") },
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
          .text("✅ Закончить и создать профиль", "ca:style-finish").row()
          .text("🏠 Меню", "ca:menu");
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
        { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("🏠 Меню", "ca:menu") },
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
      reply_markup: new InlineKeyboard().text("✅ Закончить и создать профиль", "ca:style-finish").row().text("🏠 Меню", "ca:menu"),
    });
  });

  bot.callbackQuery(/^ca:style-finish$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    wizards.delete(ctx.chat.id);
    const wait = await ctx.reply("Анализирую твой стиль и пишу профиль (5 документов параллельно). Это ~1-2 минуты ⏳");
    try {
      const r = await api("POST", "/style/interview/finish", null, { timeoutMs: 600000 });
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      await ctx.reply(
        `✅ Профиль стиля создан!\n\nФайлы: ${r.files.join(", ")}\n\nТеперь все посты будут в твоём стиле. Жми «✍ Написать пост».`,
        { reply_markup: new InlineKeyboard().text("✍ Написать пост", "ca:write").text("🔍 Найти инфо", "ca:find").row().text("🏠 Меню", "ca:menu") },
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
          reply_markup: new InlineKeyboard().text("✅ Закончить и создать профиль", "ca:style-finish").row().text("🏠 Меню", "ca:menu"),
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
          reply_markup: new InlineKeyboard().text("✅ Закончить и создать профиль", "ca:style-finish").row().text("🏠 Меню", "ca:menu"),
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
    await ctx.reply("✍ О чём написать пост? Пришли тему текстом или голосом.\n\n<i>Например: «как предпринимателю выбрать нейросеть для бизнеса».</i>", { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("🏠 Меню", "ca:menu") });
  });

  async function generateAndSend(ctx, userPrompt) {
    const wait = await ctx.reply("Пишу пост в твоём стиле... ✍️ (до минуты)");
    try {
      const r = await api("POST", "/posts", { user_prompt: userPrompt }, { timeoutMs: 300000 });
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
      const r = await api("POST", `/posts/${id}/variant`, { mode }, { timeoutMs: 300000 });
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
      const r = await api("POST", "/posts", { origin: "digest_item", digest_item_id: Number(itemId) }, { timeoutMs: 300000 });
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
  const ICON = { telegram: "📨", vk: "🅥" };

  async function showSources(ctx) {
    let sources = [];
    try { sources = await api("GET", "/sources"); } catch (e) {
      await ctx.reply(`⚠️ ${esc(e.message)}`); return;
    }
    const lines = ["📡 <b>Источники мониторинга</b>", "", `Всего: ${sources.length}`];
    for (const s of sources) {
      const ic = ICON[s.platform] || "•";
      const kw = Array.isArray(s.keywords) && s.keywords.length ? ` — тема: <i>${esc(s.keywords.join(", "))}</i>` : "";
      lines.push(`${ic} ${esc(s.ref)}${kw}`);
    }
    if (!sources.length) lines.push("<i>пока пусто</i>");
    const kb = new InlineKeyboard().text("➕ Добавить источник", "ca:src-platform").row();
    for (const s of sources) {
      kb.text(`✏ ${ICON[s.platform] || ""} ${s.ref}`, `ca:src-kw-edit:${s.id}`)
        .text(`❌`, `ca:src-del:${s.id}`).row();
    }
    if (sources.length) kb.text("🔍 Найти информацию", "ca:find").row();
    kb.text("🏠 Меню", "ca:menu");
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML", reply_markup: kb });
  }

  bot.callbackQuery(/^ca:sources$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    await showSources(ctx);
  });

  bot.callbackQuery(/^ca:src-platform$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    let s = {};
    try { s = await api("GET", "/settings"); } catch {}
    const kb = new InlineKeyboard().text("📨 Telegram", "ca:src-add:telegram").row();
    kb.text(s.vk_token ? "🅥 VK" : "🅥 VK (нет токена — задать)", s.vk_token ? "ca:src-add:vk" : "ca:set-vk").row();
    kb.text("🏠 Меню", "ca:menu");
    await ctx.reply("Какая платформа?", { reply_markup: kb });
  });

  bot.callbackQuery(/^ca:src-add:(\w+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const platform = ctx.match[1];
    await ctx.answerCallbackQuery();
    wizards.set(ctx.chat.id, { mode: "src_add", platform });
    const prompt = platform === "telegram"
      ? "Пришли @username TG-канала или ссылку (<code>@durov</code> или <code>https://t.me/durov</code>):"
      : "Пришли короткое имя VK-сообщества или ссылку (<code>durov</code> или <code>https://vk.com/durov</code>):";
    await ctx.reply(prompt, { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("🏠 Меню", "ca:menu") });
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
    const platform = w.platform || "telegram";
    let ref = ctx.message.text.trim();
    if (platform === "telegram") {
      const m = ref.match(/t\.me\/(@?[\w\d_]+)/i);
      if (m) ref = m[1];
      if (!ref.startsWith("@") && !/^[\w\d_]+$/.test(ref)) {
        await ctx.reply("Не похоже на TG-канал. Пришли @username или ссылку t.me/... — или нажми «Меню».",
          { reply_markup: new InlineKeyboard().text("🏠 Меню", "ca:menu") });
        return;
      }
      if (!ref.startsWith("@")) ref = "@" + ref;
    } else if (platform === "vk") {
      ref = ref.replace(/^https?:\/\/(?:www\.)?vk\.com\//i, "").replace(/^@/, "").split(/[/?#]/)[0];
      if (!/^[\w\d_.-]+$/.test(ref)) {
        await ctx.reply("Не похоже на VK-сообщество. Пришли короткое имя (<code>durov</code>) или ссылку.",
          { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("🏠 Меню", "ca:menu") });
        return;
      }
    }
    try {
      const created = await api("POST", "/sources", { platform, ref });
      wizards.set(ctx.chat.id, { mode: "src_keywords", sourceId: created.id });
      await ctx.reply(
        `✅ Источник ${ICON[platform]} ${esc(ref)} добавлен.\n\n` +
        `Хочешь сузить тему для этого источника? Пришли ключевые слова через запятую (например: <code>AI, нейросети, GPT</code>) — буду брать только посты с этими словами.\n\n` +
        `Или нажми «Пропустить» — будут идти все посты подряд.`,
        { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("⏭ Пропустить", `ca:src-kw-skip:${created.id}`).row().text("🏠 Меню", "ca:menu") },
      );
    } catch (e) {
      wizards.delete(ctx.chat.id);
      await ctx.reply(`⚠️ ${esc(e.message)}`,
        { reply_markup: new InlineKeyboard().text("➕ Попробовать ещё", "ca:src-platform").row().text("🏠 Меню", "ca:menu") });
    }
  });

  // Пропустить ввод ключевиков для нового источника
  bot.callbackQuery(/^ca:src-kw-skip:(\d+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    wizards.delete(ctx.chat.id);
    await ctx.answerCallbackQuery();
    await ctx.reply("Ок, фильтра нет — все посты этого источника пойдут в дайджест.",
      { reply_markup: new InlineKeyboard().text("🔍 Найти информацию", "ca:find").text("📡 Источники", "ca:sources").row().text("➕ Ещё источник", "ca:src-platform").row().text("🏠 Меню", "ca:menu") });
  });

  // Открыть редактор ключевиков для существующего источника
  bot.callbackQuery(/^ca:src-kw-edit:(\d+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const id = Number(ctx.match[1]);
    wizards.set(ctx.chat.id, { mode: "src_keywords", sourceId: id });
    await ctx.answerCallbackQuery();
    let cur = [];
    try { const all = await api("GET", "/sources"); cur = all.find((s) => s.id === id)?.keywords || []; } catch {}
    await ctx.reply(
      `🔎 <b>Ключевые слова для источника</b>\n\n` +
      `Сейчас: ${cur.length ? esc(cur.join(", ")) : "<i>фильтра нет (все посты)</i>"}\n\n` +
      `Пришли новый список через запятую (например <code>AI, нейросети</code>) — или «<code>-</code>» чтобы убрать фильтр совсем.`,
      { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("🏠 Меню", "ca:menu") },
    );
  });

  // Обработчик ввода списка ключевиков для нового или существующего источника
  bot.on("message:text", async (ctx, next) => {
    if (!isOwner(ctx)) return next();
    const w = wizards.get(ctx.chat.id);
    if (!w || w.mode !== "src_keywords") return next();
    const raw = ctx.message.text.trim();
    const keywords = raw === "-" ? null : raw.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
    wizards.delete(ctx.chat.id);
    try {
      await api("PUT", `/sources/${w.sourceId}`, { keywords });
      await ctx.reply(
        keywords && keywords.length
          ? `✅ Тема сохранена: ${esc(keywords.join(", "))}.\nИз этого источника теперь будут идти только посты с этими словами.`
          : "✅ Фильтр снят — все посты источника пойдут в дайджест.",
        { reply_markup: new InlineKeyboard().text("🔍 Найти информацию", "ca:find").text("📡 Источники", "ca:sources").row().text("🏠 Меню", "ca:menu") },
      );
    } catch (e) {
      await ctx.reply(`⚠️ ${esc(e.message)}`, { reply_markup: new InlineKeyboard().text("🏠 Меню", "ca:menu") });
    }
  });
}

// === «🔍 Найти информацию» + дайджест (Фаза 2) ===
function registerFindHandlers(bot, isOwner, { api, wizards, esc }) {
  const PERIODS = [
    ["Сегодня", "today"], ["3 дня", "3days"], ["Неделя", "week"], ["Месяц", "month"],
    ["2 мес.", "2months"], ["3 мес.", "3months"], ["Полгода", "halfyear"], ["Год", "year"],
  ];

  bot.callbackQuery(/^ca:find$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    wizards.set(ctx.chat.id, { mode: "find" });
    const counts = { telegram: 0, vk: 0 };
    try {
      const all = await api("GET", "/sources");
      for (const s of all) counts[s.platform] = (counts[s.platform] || 0) + 1;
    } catch {}
    const total = counts.telegram + counts.vk;
    const kb = new InlineKeyboard().text("➕ Добавить источник", "ca:src-platform").row();
    // 8 периодов в 2 ряда по 4
    PERIODS.forEach(([label, val], i) => {
      kb.text(label, `ca:find-period:${val}`);
      if ((i + 1) % 4 === 0) kb.row();
    });
    kb.text("🏠 Меню", "ca:menu");
    const breakdown = `📨 ${counts.telegram} · 🅥 ${counts.vk}`;
    const head = total
      ? `🔍 <b>Найти информацию</b>\n\nИсточников: ${breakdown}. За какой период искать?`
      : `🔍 <b>Найти информацию</b>\n\n<i>Пока нет источников.</i> Сначала добавь — потом выбери период.`;
    await ctx.reply(head, { parse_mode: "HTML", reply_markup: kb });
  });

  bot.callbackQuery(/^ca:find-period:(\w+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const period = ctx.match[1];
    const w = wizards.get(ctx.chat.id) || { mode: "find" };
    w.period = period;
    w.mode = "find_scope";
    wizards.set(ctx.chat.id, w);
    await ctx.answerCallbackQuery();
    // Шаг scope: «везде» или конкретный источник
    let sources = [];
    try { sources = await api("GET", "/sources"); } catch {}
    const ICON = { telegram: "📨", vk: "🅥" };
    const kb = new InlineKeyboard().text("🌐 Везде (все источники)", "ca:find-scope:all").row();
    for (const s of sources) {
      kb.text(`${ICON[s.platform] || "•"} ${s.ref}`, `ca:find-scope:src:${s.id}`).row();
    }
    kb.text("🏠 Меню", "ca:menu");
    await ctx.reply("Где искать? Везде или в конкретном источнике?", { reply_markup: kb });
  });

  bot.callbackQuery(/^ca:find-scope:(all|src:\d+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const raw = ctx.match[1];
    const w = wizards.get(ctx.chat.id);
    if (!w) { await ctx.answerCallbackQuery({ text: "Сначала период" }); return; }
    w.sourceId = raw === "all" ? null : Number(raw.split(":")[1]);
    w.mode = "find_keywords";
    wizards.set(ctx.chat.id, w);
    await ctx.answerCallbackQuery();
    let scopeLabel = "по всем источникам";
    if (w.sourceId) {
      try {
        const all = await api("GET", "/sources");
        const s = all.find((x) => x.id === w.sourceId);
        if (s) scopeLabel = `только в ${s.ref}`;
      } catch {}
    }
    await ctx.reply(
      `Ищу <b>${esc(scopeLabel)}</b>. Пришли ключевые слова через запятую (или «-» чтобы искать по сохранённым/всем):`,
      { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("🔍 Искать по всем словам", "ca:find-go:all").row().text("🏠 Меню", "ca:menu") },
    );
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
      const r = await api("POST", "/search", { period: w.period || "week", keywords, source_id: w.sourceId || null }, { timeoutMs: 300000 });
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
    const PLAT = { telegram: "📨", vk: "🅥" };
    await ctx.reply(`📰 <b>Дайджест</b> — найдено ${items.length}`, { parse_mode: "HTML" });
    for (const it of items) {
      const m = it.metrics || {};
      const ic = PLAT[it.platform] || "•";
      const text = `${ic} <b>${esc(it.title)}</b>\n${esc(it.summary || "")}\n\n` +
        `👁 ${m.views || 0} · ❤️ ${m.reactions || 0} · 💬 ${m.comments || 0} · 🔁 ${m.forwards || 0}` +
        (it.url ? `\n${esc(it.url)}` : "");
      const kb = new InlineKeyboard().text("✍ Пост из этой новости", `ca:news-post:${it.id}`);
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
    }
    const kb = new InlineKeyboard()
      .text("✂️ Короче", `ca:dig-reshape:${digestId}:shorter`).text("➕ Детальнее", `ca:dig-reshape:${digestId}:detailed`).row()
      .text("💾 Сохранить дайджест", `ca:dig-save:${digestId}`).row()
      .text("🔍 Новый поиск", "ca:find").text("🏠 Меню", "ca:menu");
    await ctx.reply("Действия с дайджестом:", { reply_markup: kb });
  }

  bot.callbackQuery(/^ca:dig-reshape:(\d+):(\w+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const [, id, mode] = ctx.match;
    await ctx.answerCallbackQuery({ text: "Переписываю..." });
    const wait = await ctx.reply("Переписываю дайджест... ✍️");
    try {
      const r = await api("POST", `/digests/${id}/reshape`, { mode }, { timeoutMs: 300000 });
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      const kb = new InlineKeyboard()
        .text("✂️ Короче", `ca:dig-reshape:${id}:shorter`).text("➕ Детальнее", `ca:dig-reshape:${id}:detailed`).row()
        .text("💾 Сохранить", `ca:dig-save:${id}`).row()
        .text("🔍 Новый поиск", "ca:find").text("🏠 Меню", "ca:menu");
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
      await ctx.reply("💾 Дайджест сохранён.", {
        reply_markup: new InlineKeyboard().text("🔍 Новый поиск", "ca:find").text("📡 Источники", "ca:sources").row().text("🏠 Меню", "ca:menu"),
      });
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

// === «🔥 Поиск по трендам» (Google Trends + Reddit, бесплатно) ===
function registerTrendsHandlers(bot, isOwner, { api, wizards, esc }) {
  const PERIODS = [
    ["Сегодня", "today"], ["3 дня", "3days"], ["Неделя", "week"], ["Месяц", "month"],
    ["2 мес.", "2months"], ["3 мес.", "3months"], ["Полгода", "halfyear"], ["Год", "year"],
  ];
  const PLAT_ICON = { google_trends: "📈", reddit: "👽" };
  const PLAT_LABEL = { google_trends: "Google Trends", reddit: "Reddit" };

  bot.callbackQuery(/^ca:trends$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    await ctx.answerCallbackQuery();
    wizards.set(ctx.chat.id, { mode: "trends_niche" });
    await ctx.reply(
      "🔥 <b>Поиск по трендам</b>\n\nПо какой нише/направлению ищем тренды?\nНапиши тему — например <code>нейросети</code>, <code>AI для бизнеса</code>, <code>копирайтинг</code>.",
      { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("🏠 Меню", "ca:menu") },
    );
  });

  bot.callbackQuery(/^ca:trends-period:(\w+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const period = ctx.match[1];
    const w = wizards.get(ctx.chat.id);
    if (!w || !w.niche) { await ctx.answerCallbackQuery({ text: "Сначала ниша" }); return; }
    w.period = period;
    wizards.set(ctx.chat.id, w);
    await ctx.answerCallbackQuery();
    await runTrendsSearch(ctx, w);
  });

  async function runTrendsSearch(ctx, w) {
    wizards.delete(ctx.chat.id);
    const wait = await ctx.reply("Ищу тренды... 🔥 (Google Trends + Reddit, до минуты)");
    try {
      const r = await api("POST", "/trends", { niche: w.niche, period: w.period || "week" }, { timeoutMs: 300000 });
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      if (!r.count) {
        const triedLine = Array.isArray(r.terms) && r.terms.length > 1
          ? `\n<i>Пробовал по ${r.terms.length} ключевикам:</i> ${r.terms.map(esc).join(", ")}`
          : "";
        const errLines = (r.errors || []).slice(0, 3).map((e) => `${PLAT_LABEL[e.source] || e.source}: ${e.error}`).join("\n");
        await ctx.reply(
          `Не нашёл трендов по «${esc(w.niche)}».${triedLine}\n\nПопробуй ещё раз с другой нишей или периодом.${errLines ? "\n\n<i>Технические ошибки:</i>\n" + esc(errLines) : ""}`,
          { parse_mode: "HTML", reply_markup: new InlineKeyboard().text("🔥 Попробовать ещё", "ca:trends").row().text("🏠 Меню", "ca:menu") },
        );
        return;
      }
      await sendTrendsDigest(ctx, r);
    } catch (e) {
      await ctx.api.deleteMessage(ctx.chat.id, wait.message_id).catch(() => {});
      await ctx.reply(`⚠️ ${esc(e.message)}`, { reply_markup: new InlineKeyboard().text("🏠 Меню", "ca:menu") });
    }
  }

  async function sendTrendsDigest(ctx, r) {
    const termsLine = Array.isArray(r.terms) && r.terms.length > 1
      ? `\n<i>Искал по ${r.terms.length} ключевикам:</i> ${r.terms.map(esc).join(", ")}`
      : "";
    await ctx.reply(`🔥 <b>Тренды по нише</b> — найдено ${r.count}${termsLine}`, { parse_mode: "HTML" });
    for (const it of r.items) {
      const m = it.metrics || {};
      const ic = PLAT_ICON[it.platform] || "•";
      const label = PLAT_LABEL[it.platform] || it.platform;
      const metricLine = it.platform === "google_trends"
        ? `📈 Рост: ${m.reactions || 0}`
        : `⬆️ ${m.reactions || 0} · 💬 ${m.comments || 0}`;
      const text = `${ic} <b>${esc(it.title)}</b> <i>(${esc(label)})</i>\n${esc(it.summary || "")}\n\n${metricLine}` +
        (it.url ? `\n${esc(it.url)}` : "");
      const kb = new InlineKeyboard().text("✍ Пост по этому тренду", `ca:news-post:${it.id}`);
      await ctx.reply(text, { parse_mode: "HTML", reply_markup: kb });
    }
    if (r.errors && r.errors.length) {
      const errLines = r.errors.map((e) => `${PLAT_LABEL[e.source] || e.source}: ${e.error}`).join("\n");
      await ctx.reply(`<i>Не все источники сработали:</i>\n${esc(errLines)}`, { parse_mode: "HTML" });
    }
    const kb = new InlineKeyboard()
      .text("🔥 Новый поиск трендов", "ca:trends").row()
      .text("🔍 Найти новости", "ca:find").text("🏠 Меню", "ca:menu");
    await ctx.reply("Действия:", { reply_markup: kb });
  }

  bot.on("message:text", async (ctx, next) => {
    if (!isOwner(ctx)) return next();
    const w = wizards.get(ctx.chat.id);
    if (!w || w.mode !== "trends_niche") return next();
    const niche = ctx.message.text.trim();
    if (!niche) { await ctx.reply("Пусто. Пришли тему."); return; }
    w.niche = niche;
    wizards.set(ctx.chat.id, w);
    const kb = new InlineKeyboard();
    PERIODS.forEach(([label, val], i) => {
      kb.text(label, `ca:trends-period:${val}`);
      if ((i + 1) % 4 === 0) kb.row();
    });
    kb.text("🏠 Меню", "ca:menu");
    await ctx.reply(`Ниша: <b>${esc(niche)}</b>. За какой период смотреть тренды?`, { parse_mode: "HTML", reply_markup: kb });
  });
}
