/**
 * Sales Menu — команды бота для управления AI-продавцом (sales-manager).
 * Подключается из bot/index.js через registerSalesHandlers(bot, isOwner).
 * sales-manager живёт отдельным сервисом на http://localhost:3001.
 */
import { InlineKeyboard } from "grammy";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function loadSmEnv() {
  const candidates = [
    process.env.SM_ENV_PATH,
    path.resolve(process.cwd(), "../sales-manager/.env"),
    "C:/Users/Administrator/Documents/Projects/gideon/sales-manager/.env",
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
const smEnv = loadSmEnv();
const SM_API_BASE = process.env.SM_API_BASE || smEnv.SM_API_BASE || `http://127.0.0.1:${smEnv.SM_PORT || 3001}/api`;
const SM_PASSWORD = process.env.SM_PASSWORD || smEnv.SM_PASSWORD || "change-me";
const SM_SECRET = process.env.SM_SECRET || smEnv.SM_SECRET || "change-me-secret";
const AUTH_TOKEN = crypto.createHmac("sha256", SM_SECRET).update(SM_PASSWORD).digest("hex");

const FIELDS = [
  { key: "name", q: "Как назовём кампанию?" },
  { key: "offer_text", q: "Что предлагаем и в чём суть?" },
  { key: "offer_url", q: "Ссылка на оффер (сайт / прайс)?" },
  { key: "target_audience", q: "Кто эти лиды, по какой боли мы попадаем?" },
  { key: "goal_ikr", q: "Идеальный конечный результат — что считаем закрытием?" },
  { key: "tone", q: "Тон? (можно пропустить — введи `-`)", optional: true },
  { key: "stop_phrases", q: "Стоп-фразы — чего точно не говорим? (`-` если пропустить)", optional: true },
];

// chatId → { mode, step, data, campaignId, draftId }
const wizards = new Map();

async function api(method, path, body) {
  const res = await fetch(`${SM_API_BASE}${path}`, {
    method,
    headers: { "x-auth-token": AUTH_TOKEN, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`sales-manager API ${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function esc(s) { return String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])); }

export function registerSalesHandlers(bot, isOwner) {
  bot.command("sales", async (ctx) => {
    if (!isOwner(ctx)) return;
    const kb = new InlineKeyboard()
      .text("➕ Новая кампания", "sm:new").row()
      .text("📋 Мои кампании", "sm:list").row()
      .text("📊 Статус", "sm:status");
    await ctx.reply("Sales Manager — что делаем?", { reply_markup: kb });
  });

  bot.callbackQuery(/^sm:list$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    try {
      const list = await api("GET", "/campaigns");
      if (!list.length) { await ctx.answerCallbackQuery(); await ctx.reply("Кампаний пока нет."); return; }
      const text = list.map((c) => `<b>${esc(c.name)}</b> · ${esc(c.status)} · ${esc(c.mode || "—")}`).join("\n");
      await ctx.answerCallbackQuery();
      await ctx.reply(text, { parse_mode: "HTML" });
    } catch (e) {
      await ctx.answerCallbackQuery({ text: "Ошибка API" });
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  });

  bot.callbackQuery(/^sm:status$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    try {
      const list = await api("GET", "/campaigns");
      const running = list.filter((c) => c.status === "running").length;
      await ctx.answerCallbackQuery();
      await ctx.reply(`Активных кампаний: ${running} из ${list.length}`);
    } catch (e) {
      await ctx.answerCallbackQuery({ text: "Ошибка API" });
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  });

  bot.callbackQuery(/^sm:new$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    wizards.set(ctx.chat.id, { mode: "brief", step: 0, data: {} });
    await ctx.answerCallbackQuery();
    await ctx.reply(FIELDS[0].q);
  });

  bot.callbackQuery(/^sm:mode:(\d+):(\w+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const [, id, mode] = ctx.match;
    try {
      await api("PUT", `/campaigns/${id}`, { mode });
      await ctx.answerCallbackQuery();
      const kb = new InlineKeyboard()
        .text("📥 Загрузить лидов", `sm:leads:${id}`).row()
        .text("🚀 Запустить", `sm:start:${id}`);
      await ctx.reply(`Режим: ${esc(mode)}. Что дальше?`, { reply_markup: kb });
    } catch (e) {
      await ctx.answerCallbackQuery({ text: "Ошибка" });
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  });

  bot.callbackQuery(/^sm:start:(\d+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const id = ctx.match[1];
    try {
      await api("POST", `/campaigns/${id}/start`);
      await ctx.answerCallbackQuery();
      await ctx.reply(`🚀 Кампания #${id} запущена.`);
    } catch (e) {
      await ctx.answerCallbackQuery({ text: "Ошибка" });
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  });

  bot.callbackQuery(/^sm:leads:(\d+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const id = ctx.match[1];
    wizards.set(ctx.chat.id, { mode: "manual_leads", campaignId: Number(id) });
    await ctx.answerCallbackQuery();
    await ctx.reply("Пришли список юзернеймов через запятую или пробел (`@vasya @petya`):");
  });

  bot.callbackQuery(/^sm:approve:(\d+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const draftId = ctx.match[1];
    try {
      await api("POST", `/drafts/${draftId}/approve`);
      await ctx.answerCallbackQuery({ text: "Одобрено — отправит воркер" });
      await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    } catch (e) {
      await ctx.answerCallbackQuery({ text: "Ошибка" });
    }
  });

  bot.callbackQuery(/^sm:reject:(\d+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const draftId = ctx.match[1];
    try {
      await api("POST", `/drafts/${draftId}/reject`);
      await ctx.answerCallbackQuery({ text: "Пропущено" });
      await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
    } catch (e) {
      await ctx.answerCallbackQuery({ text: "Ошибка" });
    }
  });

  bot.callbackQuery(/^sm:edit:(\d+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const draftId = ctx.match[1];
    wizards.set(ctx.chat.id, { mode: "edit_draft", draftId: Number(draftId) });
    await ctx.answerCallbackQuery();
    await ctx.reply("Пришли свой текст — отправлю его вместо AI-варианта:");
  });

  bot.on("message:text", async (ctx, next) => {
    if (!isOwner(ctx)) return next();
    const w = wizards.get(ctx.chat.id);
    if (!w) return next();

    if (w.mode === "manual_leads") {
      wizards.delete(ctx.chat.id);
      const usernames = ctx.message.text.split(/[\s,]+/).map((s) => s.replace(/^@/, "")).filter(Boolean);
      const leads = usernames.map((u) => ({ tg_username: u }));
      try {
        const res = await api("POST", `/campaigns/${w.campaignId}/leads`, { leads });
        await ctx.reply(`Добавлено лидов: ${res.inserted}. Всего в кампании: ${res.total}.`);
      } catch (e) {
        await ctx.reply(`⚠️ ${esc(e.message)}`);
      }
      return;
    }

    if (w.mode === "edit_draft") {
      wizards.delete(ctx.chat.id);
      try {
        await api("POST", `/drafts/${w.draftId}/edit`, { text: ctx.message.text });
        await ctx.reply("Готово — отредактированный текст отправлен.");
      } catch (e) {
        await ctx.reply(`⚠️ ${esc(e.message)}`);
      }
      return;
    }

    if (w.mode === "brief") {
      const field = FIELDS[w.step];
      let val = ctx.message.text.trim();
      if (field.optional && val === "-") val = null;
      w.data[field.key] = val;
      w.step++;
      if (w.step < FIELDS.length) {
        await ctx.reply(FIELDS[w.step].q);
        return;
      }
      wizards.delete(ctx.chat.id);
      const summary = FIELDS.map((f) => `<b>${esc(f.q)}</b>\n${esc(w.data[f.key] || "—")}`).join("\n\n");
      try {
        const created = await api("POST", "/campaigns", w.data);
        const kb = new InlineKeyboard()
          .text("🤖 Полная автономия", `sm:mode:${created.id}:full_auto`).row()
          .text("🎯 Автономная квалификация", `sm:mode:${created.id}:qualify_then_handoff`).row()
          .text("✋ Драфты на одобрение", `sm:mode:${created.id}:draft_approval`).row()
          .text("⚡ Гибрид (auto + драфт на «цене»)", `sm:mode:${created.id}:hybrid`);
        await ctx.reply(`<b>Кампания создана</b>\n\n${summary}\n\nВыбери режим:`, { parse_mode: "HTML", reply_markup: kb });
      } catch (e) {
        await ctx.reply(`⚠️ ${esc(e.message)}`);
      }
      return;
    }

    return next();
  });
}
