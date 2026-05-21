/**
 * Sales Menu — команды бота для управления AI-продавцом (sales-manager).
 * Подключается из bot/index.js через registerSalesHandlers(bot, isOwner).
 * sales-manager живёт отдельным сервисом на http://localhost:3001.
 */
import { InlineKeyboard } from "grammy";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import https from "node:https";

const MATERIALS_DIR = process.env.SM_MATERIALS_DIR || "C:/Users/Administrator/Documents/Projects/gideon/sales-manager/data/materials";

function ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

function downloadToFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (res) => {
      if (res.statusCode !== 200) { file.close(); fs.unlinkSync(dest); return reject(new Error(`download status ${res.statusCode}`)); }
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", (err) => { file.close(); try { fs.unlinkSync(dest); } catch {} reject(err); });
  });
}

const KIND_LABEL = {
  file: "Файл",
  photo: "Фото",
  video: "Видео",
  audio: "Аудио",
  voice: "Голосовое",
  animation: "GIF",
  video_note: "Видеокружок",
  sticker: "Стикер",
  link: "Ссылка",
};

const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;

function extractUrls(text) {
  if (!text) return [];
  const matches = text.match(URL_RE);
  return matches ? [...new Set(matches)] : [];
}

function renderMaterials(items) {
  if (!items.length) return "";
  return items.map((it) => {
    if (it.kind === "text") return `- ${it.text}`;
    if (it.kind === "link") return `- Ссылка: ${it.url}${it.description ? ` — ${it.description}` : ""}`;
    const label = KIND_LABEL[it.kind] || "Файл";
    const name = it.filename ? `«${it.filename}» ` : "";
    let line = `- ${label} ${name}(${it.path})${it.caption ? `: ${it.caption}` : ""}`;
    if (it.extracted_text) {
      // Содержимое файла внутри блока, чтобы AI отличал от ссылок/описаний
      line += `\n  Содержимое:\n  """\n${it.extracted_text.split("\n").map((l) => "  " + l).join("\n")}\n  """`;
    }
    return line;
  }).filter(Boolean).join("\n");
}

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
  { key: "conversation_context", q: "Контекст переписки — с кем общаемся и на какую тему? Опиши кратко предысторию, чтобы AI понимал поле игры. (`-` если не нужно)", optional: true },
  { key: "first_message_template", q: "Шаблон/описание первого сообщения — как оно должно выглядеть? AI возьмёт это как ориентир и адаптирует под каждого лида. (`-` если пусть AI сам решает)", optional: true },
  { key: "supporting_materials", q: "Доп. материалы — присылай несколькими сообщениями:\n• Текст / описание\n• 🔗 Ссылки (URL распознаётся автоматически)\n• 📎 Файлы любого типа (документы, фото, видео, аудио, голосовые, GIF, кружочки, стикеры)\n\nКогда закончишь — нажми «✅ Готово» или напиши `готово`. Пропустить — `-`.", optional: true, multiMessage: true },
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

const FIELD_LABELS = {
  name: "Название",
  offer_text: "Оффер",
  offer_url: "Ссылка",
  target_audience: "ЦА",
  goal_ikr: "ИКР",
  conversation_context: "Контекст",
  first_message_template: "Шаблон 1-го",
  supporting_materials: "Материалы",
  tone: "Тон",
  stop_phrases: "Стоп-фразы",
};
function shortLabel(key) { return FIELD_LABELS[key] || key; }

function clip(s, n) {
  if (!s) return "—";
  const v = String(s);
  if (v.length <= n) return esc(v);
  return esc(v.slice(0, n)) + `… <i>(всего ${v.length} симв.)</i>`;
}

function formatCampaignSummary(c, stats) {
  const lines = [
    `<b>#${c.id} ${esc(c.name)}</b>`,
    `Статус: ${esc(c.status)} · Режим: ${esc(c.mode || "—")}`,
    "",
    `<b>Оффер:</b> ${clip(c.offer_text, 400)}`,
    `<b>Ссылка:</b> ${esc(c.offer_url || "—")}`,
    `<b>ЦА:</b> ${clip(c.target_audience, 300)}`,
    `<b>ИКР:</b> ${clip(c.goal_ikr, 300)}`,
  ];
  if (c.conversation_context) lines.push(`<b>Контекст:</b> ${clip(c.conversation_context, 400)}`);
  if (c.first_message_template) lines.push(`<b>Шаблон 1-го:</b> ${clip(c.first_message_template, 400)}`);
  if (c.supporting_materials) {
    const blocks = c.supporting_materials.split("\n").filter((l) => l.startsWith("- ")).length;
    lines.push(`<b>Материалы:</b> ${blocks} блок(ов), всего ${c.supporting_materials.length} симв. — открой ✏️ Редактировать → Материалы`);
  }
  if (c.tone) lines.push(`<b>Тон:</b> ${clip(c.tone, 200)}`);
  if (c.stop_phrases) lines.push(`<b>Стоп:</b> ${clip(c.stop_phrases, 200)}`);
  if (stats) {
    lines.push("", `<b>Лидов:</b> ${stats.leads_total} · Отправлено: ${stats.messages_outbound} · Ответили: ${stats.messages_inbound}`);
  }
  let text = lines.join("\n");
  // Финальная защита — лимит Telegram 4096
  if (text.length > 3800) text = text.slice(0, 3800) + "\n\n…[обрезано]";
  return text;
}

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
      await ctx.answerCallbackQuery();
      for (const c of list) {
        const kb = new InlineKeyboard().text("⚙️ Управление", `sm:manage:${c.id}`);
        await ctx.reply(`<b>#${c.id} ${esc(c.name)}</b>\nСтатус: ${esc(c.status)} · Режим: ${esc(c.mode || "—")}`, { parse_mode: "HTML", reply_markup: kb });
      }
    } catch (e) {
      await ctx.answerCallbackQuery({ text: "Ошибка API" });
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  });

  bot.callbackQuery(/^sm:manage:(\d+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const id = ctx.match[1];
    try {
      const c = await api("GET", `/campaigns/${id}`);
      const stats = await api("GET", `/campaigns/${id}/stats`).catch(() => null);
      const kb = new InlineKeyboard()
        .text("✏️ Редактировать", `sm:editmenu:${id}`).row()
        .text(c.status === "running" ? "⏸ Пауза" : "▶️ Запустить", c.status === "running" ? `sm:pause:${id}` : `sm:start:${id}`)
        .text("📨 Сейчас", `sm:sendnow:${id}`).row()
        .text("📥 Лиды", `sm:leads:${id}`)
        .text("📊 Метрики", `sm:stats:${id}`).row()
        .text("🗑 В архив", `sm:archive:${id}`);
      const summary = formatCampaignSummary(c, stats);
      await ctx.answerCallbackQuery();
      await ctx.reply(summary, { parse_mode: "HTML", reply_markup: kb });
    } catch (e) {
      await ctx.answerCallbackQuery({ text: "Ошибка" });
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  });

  bot.callbackQuery(/^sm:editmenu:(\d+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const id = ctx.match[1];
    const kb = new InlineKeyboard();
    for (let i = 0; i < FIELDS.length; i += 2) {
      kb.text(`✏️ ${shortLabel(FIELDS[i].key)}`, `sm:editfield:${id}:${FIELDS[i].key}`);
      if (FIELDS[i + 1]) kb.text(`✏️ ${shortLabel(FIELDS[i + 1].key)}`, `sm:editfield:${id}:${FIELDS[i + 1].key}`);
      kb.row();
    }
    kb.text("⬅️ Назад", `sm:manage:${id}`);
    await ctx.answerCallbackQuery();
    await ctx.reply(`<b>Кампания #${id}</b> — что правим?`, { parse_mode: "HTML", reply_markup: kb });
  });

  bot.callbackQuery(/^sm:editfield:(\d+):(\w+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const [, id, field] = ctx.match;
    try {
      const c = await api("GET", `/campaigns/${id}`);
      const current = c[field];
      await ctx.answerCallbackQuery();
      // Спец-режим для supporting_materials — сбор нескольких сообщений + файлы
      if (field === "supporting_materials") {
        const kb = new InlineKeyboard()
          .text("📝 Дописать к существующим", `sm:matedit:${id}:append`)
          .text("🆕 Заменить с нуля", `sm:matedit:${id}:replace`).row()
          .text("🗑 Очистить", `sm:matedit:${id}:clear`);
        await ctx.reply(`<b>Материалы кампании #${id}</b>\n\nСейчас:\n${esc(current || "—")}\n\nЧто делаем?`, { parse_mode: "HTML", reply_markup: kb });
        return;
      }
      wizards.set(ctx.chat.id, { mode: "edit_field", campaignId: Number(id), field });
      const fieldDef = FIELDS.find((f) => f.key === field);
      await ctx.reply(
        `<b>Поле:</b> ${esc(shortLabel(field))}\n<b>Сейчас:</b> ${esc(current || "—")}\n\n` +
        `Пришли новое значение (или «-» чтобы очистить):\n\n<i>${esc(fieldDef?.q || "")}</i>`,
        { parse_mode: "HTML" },
      );
    } catch (e) {
      await ctx.answerCallbackQuery({ text: "Ошибка" });
    }
  });

  bot.callbackQuery(/^sm:matedit:(\d+):(append|replace|clear)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const [, id, action] = ctx.match;
    const cid = Number(id);
    await ctx.answerCallbackQuery();
    if (action === "clear") {
      try {
        await api("PUT", `/campaigns/${cid}`, { supporting_materials: null });
        const kb = new InlineKeyboard().text("⬅️ К кампании", `sm:manage:${cid}`);
        await ctx.reply("🗑 Материалы очищены.", { reply_markup: kb });
      } catch (e) { await ctx.reply(`⚠️ ${esc(e.message)}`); }
      return;
    }
    let appendTo = null;
    if (action === "append") {
      try { const c = await api("GET", `/campaigns/${cid}`); appendTo = c.supporting_materials || null; }
      catch (e) { await ctx.reply(`⚠️ ${esc(e.message)}`); return; }
    }
    wizards.set(ctx.chat.id, { mode: "materials_edit", campaignId: cid, materials: [], appendTo });
    await ctx.reply(`Шли материалы:\n• Текст / описание\n• 🔗 Ссылки (URL автоматически распознаётся)\n• 📎 Файлы любого типа (документы, фото, видео, аудио, голосовые, GIF, кружочки, стикеры)\n\nКогда закончишь — кнопка «✅ Готово» или напиши «готово». «-» = очистить.`,
      { reply_markup: new InlineKeyboard().text("✅ Готово", "sm:materials-done") });
  });

  bot.callbackQuery(/^sm:pause:(\d+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const id = ctx.match[1];
    try {
      await api("POST", `/campaigns/${id}/pause`);
      await ctx.answerCallbackQuery({ text: "На паузе" });
      await ctx.reply(`⏸ Кампания #${id} приостановлена.`);
    } catch (e) {
      await ctx.answerCallbackQuery({ text: "Ошибка" });
    }
  });

  bot.callbackQuery(/^sm:archive:(\d+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const id = ctx.match[1];
    try {
      await api("DELETE", `/campaigns/${id}`);
      await ctx.answerCallbackQuery({ text: "Архивирована" });
      await ctx.reply(`🗑 Кампания #${id} в архиве.`);
    } catch (e) {
      await ctx.answerCallbackQuery({ text: "Ошибка" });
    }
  });

  bot.callbackQuery(/^sm:stats:(\d+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const id = ctx.match[1];
    try {
      const s = await api("GET", `/campaigns/${id}/stats`);
      const text = `<b>Метрики кампании #${id}</b>\n\n` +
        `Лидов всего: ${s.leads_total}\n` +
        `Отправлено: ${s.messages_outbound}\n` +
        `Ответили: ${s.messages_inbound}\n\n` +
        `<b>По статусам:</b>\n${Object.entries(s.leads_by_status).map(([k, v]) => `  ${esc(k)}: ${v}`).join("\n") || "  —"}`;
      await ctx.answerCallbackQuery();
      await ctx.reply(text, { parse_mode: "HTML" });
    } catch (e) {
      await ctx.answerCallbackQuery({ text: "Ошибка" });
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
      const kb = new InlineKeyboard()
        .text("📨 Отправить первое сейчас", `sm:sendnow:${id}`);
      await ctx.reply(`🚀 Кампания #${id} запущена.\n\nПо умолчанию ждёт рандом-окна 5-40 мин и рабочих часов. Жми кнопку, чтобы отправить ближайший лид немедленно (для smoke-теста):`, { reply_markup: kb });
    } catch (e) {
      await ctx.answerCallbackQuery({ text: "Ошибка" });
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  });

  bot.callbackQuery(/^sm:sendnow:(\d+)$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const id = ctx.match[1];
    try {
      await api("POST", `/campaigns/${id}/send-now`);
      await ctx.answerCallbackQuery({ text: "Триггер отправлен" });
      await ctx.reply(`📨 Запрос на немедленную отправку отправлен. Воркер выполнит в течение 3 секунд (если есть queued лиды).`);
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

  function addTextOrLinks(items, val) {
    const urls = extractUrls(val);
    if (urls.length === 0) {
      items.push({ kind: "text", text: val });
      return { summary: "📝 Текст добавлен" };
    }
    // Если есть URL — каждая ссылка отдельным элементом, остальной текст становится описанием первой ссылки
    let description = val;
    for (const u of urls) description = description.split(u).join(" ");
    description = description.trim().replace(/\s+/g, " ");
    for (let i = 0; i < urls.length; i++) {
      items.push({ kind: "link", url: urls[i], description: i === 0 ? description : "" });
    }
    return { summary: `🔗 Ссылок добавлено: ${urls.length}` };
  }

  async function advanceBrief(ctx, w) {
    w.step++;
    delete w.materials;
    if (w.step < FIELDS.length) {
      await ctx.reply(FIELDS[w.step].q);
      return;
    }
    wizards.delete(ctx.chat.id);
    const summary = FIELDS.map((f) => `<b>${esc(f.q.slice(0, 60))}</b>\n${esc((w.data[f.key] || "—").slice(0, 200))}`).join("\n\n");
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
  }

  // Извлекает file_id и предлагаемое имя из любого типа медиа в сообщении
  function extractMediaInfo(message) {
    if (message.document) {
      return { kind: "file", fileId: message.document.file_id, filename: message.document.file_name || `doc_${Date.now()}`, mime: message.document.mime_type };
    }
    if (message.photo) {
      const p = message.photo[message.photo.length - 1];
      return { kind: "photo", fileId: p.file_id, filename: `photo_${Date.now()}.jpg`, mime: "image/jpeg" };
    }
    if (message.video) {
      return { kind: "video", fileId: message.video.file_id, filename: message.video.file_name || `video_${Date.now()}.mp4`, mime: message.video.mime_type || "video/mp4" };
    }
    if (message.audio) {
      return { kind: "audio", fileId: message.audio.file_id, filename: message.audio.file_name || `audio_${Date.now()}.mp3`, mime: message.audio.mime_type || "audio/mpeg" };
    }
    if (message.voice) {
      return { kind: "voice", fileId: message.voice.file_id, filename: `voice_${Date.now()}.ogg`, mime: message.voice.mime_type || "audio/ogg" };
    }
    if (message.animation) {
      return { kind: "animation", fileId: message.animation.file_id, filename: message.animation.file_name || `anim_${Date.now()}.mp4`, mime: message.animation.mime_type || "video/mp4" };
    }
    if (message.video_note) {
      return { kind: "video_note", fileId: message.video_note.file_id, filename: `vnote_${Date.now()}.mp4`, mime: "video/mp4" };
    }
    if (message.sticker) {
      const ext = message.sticker.is_animated ? "tgs" : (message.sticker.is_video ? "webm" : "webp");
      return { kind: "sticker", fileId: message.sticker.file_id, filename: `sticker_${Date.now()}.${ext}`, mime: null };
    }
    return null;
  }

  async function handleAttachment(ctx, w) {
    const info = extractMediaInfo(ctx.message);
    if (!info) {
      await ctx.reply("⚠️ Не распознал тип файла. Пришли как документ (📎 → файл).");
      return;
    }
    const caption = ctx.message.caption || null;
    try {
      const file = await ctx.api.getFile(info.fileId);
      const token = process.env.BOT_TOKEN;
      const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
      const campaignKey = w.campaignId ? `campaign-${w.campaignId}` : `brief-${Date.now()}`;
      const dir = path.join(MATERIALS_DIR, campaignKey);
      ensureDir(dir);
      const dest = path.join(dir, `${Date.now()}_${info.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
      await downloadToFile(url, dest);
      if (!w.materials) w.materials = [];
      const item = { kind: info.kind, filename: info.filename, path: dest, caption, mime: info.mime };
      // Извлекаем текст для PDF/DOCX/TXT/MD/HTML — AI будет видеть содержимое
      try {
        const extractRes = await api("POST", "/extract", { path: dest });
        if (extractRes?.text) {
          item.extracted_text = extractRes.text;
          item.extracted_length = extractRes.length;
          item.extracted_truncated = extractRes.truncated;
        }
      } catch {}
      w.materials.push(item);
      let extractedNote = "";
      if (item.extracted_text) {
        extractedNote = `\n📖 Содержимое распознано (${item.extracted_length} симв.${item.extracted_truncated ? ", обрезано до 8000" : ""}) — AI будет использовать.`;
      }
      await ctx.reply(`📎 Сохранён (${info.kind}): ${esc(info.filename)} (всего: ${w.materials.length}).${extractedNote}\nШли ещё или «готово».`,
        { reply_markup: new InlineKeyboard().text("✅ Готово", w.mode === "brief" ? "sm:brief:materials-done" : "sm:materials-done") });
    } catch (e) {
      await ctx.reply(`⚠️ Не смог сохранить файл: ${esc(e.message)}`);
    }
  }

  function isInMaterialsCollect(w) {
    if (!w) return false;
    if (w.mode === "materials_edit") return true;
    if (w.mode === "brief" && FIELDS[w.step]?.multiMessage) return true;
    return false;
  }

  // Текстовые поля брифинга, которые могут принимать файл как значение (через caption + extract)
  function isTextFieldStep(w) {
    if (!w || w.mode !== "brief") return false;
    const field = FIELDS[w.step];
    return field && !field.multiMessage;
  }

  async function handleFileForTextField(ctx, w) {
    const info = extractMediaInfo(ctx.message);
    const caption = (ctx.message.caption || "").trim();
    if (!info) {
      // нет известного медиа — попросим текст
      await ctx.reply("На этом шаге нужно текстовое описание. Если хочешь приложить материалы — это будет шаг «Доп. материалы» дальше. Пришли просто текст.");
      return;
    }
    // Если это текстовый файл — скачиваем и извлекаем
    const ext = (info.filename || "").toLowerCase().split(".").pop();
    const extractable = ["txt", "md", "csv", "log", "json", "html", "htm", "pdf", "docx"];
    let extracted = "";
    let savedPath = null;
    if (extractable.includes(ext)) {
      try {
        const file = await ctx.api.getFile(info.fileId);
        const token = process.env.BOT_TOKEN;
        const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
        const dir = path.join(MATERIALS_DIR, "brief-text-fields");
        ensureDir(dir);
        savedPath = path.join(dir, `${Date.now()}_${info.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
        await downloadToFile(url, savedPath);
        const er = await api("POST", "/extract", { path: savedPath });
        if (er?.text) extracted = er.text;
      } catch (e) {
        await ctx.reply(`⚠️ Не смог извлечь содержимое файла: ${esc(e.message)}. Использую только подпись/имя файла.`);
      }
    }
    // Собираем значение поля: caption + содержимое файла (если извлеклось)
    const parts = [];
    if (caption) parts.push(caption);
    if (extracted) parts.push(`\n[содержимое файла «${info.filename}»]\n${extracted}`);
    if (!caption && !extracted) parts.push(`[приложенный файл: ${info.filename}]`);
    const value = parts.join("\n").trim();
    const field = FIELDS[w.step];
    w.data[field.key] = value;
    await ctx.reply(`📎 Файл принят как значение поля «${esc(shortLabel(field.key))}»${extracted ? ` (содержимое распознано: ${extracted.length} симв.)` : ""}.`);
    await advanceBrief(ctx, w);
  }

  // Один универсальный handler на все типы медиа
  for (const filter of ["message:document", "message:photo", "message:video", "message:audio", "message:voice", "message:animation", "message:video_note", "message:sticker"]) {
    bot.on(filter, async (ctx, next) => {
      if (!isOwner(ctx)) return next();
      const w = wizards.get(ctx.chat.id);
      if (!w) return next();
      // 1) В режиме сбора материалов — стандартный аплоад
      if (isInMaterialsCollect(w)) return handleAttachment(ctx, w);
      // 2) В режиме редактирования одного поля (edit_field) или текстового шага брифинга — извлекаем содержимое/caption как значение
      if (w.mode === "edit_field" || isTextFieldStep(w)) {
        if (w.mode === "edit_field") {
          // переиспользуем логику текстового поля: считаем что step указывает на field через w.field
          return handleFileForEditField(ctx, w);
        }
        return handleFileForTextField(ctx, w);
      }
      // 3) Прочие режимы (manual_leads, edit_draft) — файл не подходит, скажем
      await ctx.reply("На этом шаге жду текст, не файл. Пришли текстом.");
    });
  }

  async function handleFileForEditField(ctx, w) {
    const info = extractMediaInfo(ctx.message);
    const caption = (ctx.message.caption || "").trim();
    if (!info) { await ctx.reply("Жду текст."); return; }
    const ext = (info.filename || "").toLowerCase().split(".").pop();
    const extractable = ["txt", "md", "csv", "log", "json", "html", "htm", "pdf", "docx"];
    let extracted = "";
    if (extractable.includes(ext)) {
      try {
        const file = await ctx.api.getFile(info.fileId);
        const token = process.env.BOT_TOKEN;
        const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
        const dir = path.join(MATERIALS_DIR, "brief-text-fields");
        ensureDir(dir);
        const savedPath = path.join(dir, `${Date.now()}_${info.filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
        await downloadToFile(url, savedPath);
        const er = await api("POST", "/extract", { path: savedPath });
        if (er?.text) extracted = er.text;
      } catch (e) {
        await ctx.reply(`⚠️ Не смог извлечь: ${esc(e.message)}`);
      }
    }
    const parts = [];
    if (caption) parts.push(caption);
    if (extracted) parts.push(`\n[содержимое файла «${info.filename}»]\n${extracted}`);
    if (!caption && !extracted) parts.push(`[приложенный файл: ${info.filename}]`);
    const value = parts.join("\n").trim();
    wizards.delete(ctx.chat.id);
    try {
      await api("PUT", `/campaigns/${w.campaignId}`, { [w.field]: value });
      const kb = new InlineKeyboard().text("⬅️ К кампании", `sm:manage:${w.campaignId}`);
      await ctx.reply(`✅ Поле «${esc(shortLabel(w.field))}» обновлено${extracted ? ` (распознано ${extracted.length} симв. из файла)` : ""}.`, { reply_markup: kb });
    } catch (e) {
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
  }

  bot.callbackQuery(/^sm:brief:materials-done$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const w = wizards.get(ctx.chat.id);
    if (!w || w.mode !== "brief") return ctx.answerCallbackQuery();
    const field = FIELDS[w.step];
    w.data[field.key] = w.materials?.length ? renderMaterials(w.materials) : null;
    await ctx.answerCallbackQuery({ text: "Готово" });
    await advanceBrief(ctx, w);
  });

  bot.callbackQuery(/^sm:materials-done$/, async (ctx) => {
    if (!isOwner(ctx)) return ctx.answerCallbackQuery();
    const w = wizards.get(ctx.chat.id);
    if (!w || w.mode !== "materials_edit") return ctx.answerCallbackQuery();
    const combined = w.appendTo ? `${w.appendTo}\n${renderMaterials(w.materials || [])}` : renderMaterials(w.materials || []);
    wizards.delete(ctx.chat.id);
    try {
      await api("PUT", `/campaigns/${w.campaignId}`, { supporting_materials: combined || null });
      await ctx.answerCallbackQuery({ text: "Сохранено" });
      const kb = new InlineKeyboard().text("⬅️ К кампании", `sm:manage:${w.campaignId}`);
      await ctx.reply(`✅ Материалы сохранены.`, { reply_markup: kb });
    } catch (e) {
      await ctx.answerCallbackQuery({ text: "Ошибка" });
      await ctx.reply(`⚠️ ${esc(e.message)}`);
    }
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

    if (w.mode === "edit_field") {
      wizards.delete(ctx.chat.id);
      let val = ctx.message.text.trim();
      if (val === "-") val = null;
      try {
        await api("PUT", `/campaigns/${w.campaignId}`, { [w.field]: val });
        const kb = new InlineKeyboard().text("⬅️ К кампании", `sm:manage:${w.campaignId}`);
        await ctx.reply(`✅ Поле «${esc(shortLabel(w.field))}» обновлено.`, { reply_markup: kb });
      } catch (e) {
        await ctx.reply(`⚠️ ${esc(e.message)}`);
      }
      return;
    }

    if (w.mode === "brief") {
      const field = FIELDS[w.step];
      let val = ctx.message.text.trim();
      // Multi-message режим (например supporting_materials) — собираем элементы пока не "готово"
      if (field.multiMessage) {
        if (!w.materials) w.materials = [];
        if (val === "-" && !w.materials.length) {
          w.data[field.key] = null;
          return advanceBrief(ctx, w);
        }
        if (/^готово$/i.test(val)) {
          w.data[field.key] = w.materials.length ? renderMaterials(w.materials) : null;
          return advanceBrief(ctx, w);
        }
        const added = addTextOrLinks(w.materials, val);
        await ctx.reply(`${added.summary} (всего: ${w.materials.length}). Шли ещё или напиши «готово».`,
          { reply_markup: new InlineKeyboard().text("✅ Готово", "sm:brief:materials-done") });
        return;
      }
      if (field.optional && val === "-") val = null;
      w.data[field.key] = val;
      return advanceBrief(ctx, w);
    }

    if (w.mode === "materials_edit") {
      let val = ctx.message.text.trim();
      if (!w.materials) w.materials = [];
      if (/^готово$/i.test(val)) {
        const combined = w.appendTo ? `${w.appendTo}\n${renderMaterials(w.materials)}` : renderMaterials(w.materials);
        wizards.delete(ctx.chat.id);
        try {
          await api("PUT", `/campaigns/${w.campaignId}`, { supporting_materials: combined || null });
          const kb = new InlineKeyboard().text("⬅️ К кампании", `sm:manage:${w.campaignId}`);
          await ctx.reply(`✅ Материалы сохранены (всего блоков: ${w.materials.length}${w.appendTo ? " новых + старые" : ""}).`, { reply_markup: kb });
        } catch (e) {
          await ctx.reply(`⚠️ ${esc(e.message)}`);
        }
        return;
      }
      if (val === "-") {
        wizards.delete(ctx.chat.id);
        await api("PUT", `/campaigns/${w.campaignId}`, { supporting_materials: null });
        await ctx.reply("Материалы очищены.");
        return;
      }
      const added = addTextOrLinks(w.materials, val);
      await ctx.reply(`${added.summary} (всего новых: ${w.materials.length}). Шли ещё или напиши «готово».`,
        { reply_markup: new InlineKeyboard().text("✅ Готово", "sm:materials-done") });
      return;
    }

    return next();
  });
}
