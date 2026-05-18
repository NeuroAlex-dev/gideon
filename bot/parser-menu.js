/**
 * Parser Menu — команды бота для парсера участников Telegram-чатов.
 * Подключается из bot/index.js через registerParserHandlers(bot, isOwner).
 * Парсер живёт отдельным сервисом на http://localhost:3000.
 */
import { InlineKeyboard, InputFile } from "grammy";

const PARSER_URL = process.env.PARSER_URL || "http://localhost:3000";

function chunkByLines(text, maxLen) {
  const lines = text.split("\n");
  const chunks = [];
  let current = "";
  for (const line of lines) {
    const candidate = current ? current + "\n" + line : line;
    if (candidate.length > maxLen && current) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [""];
}

// FSM: userId -> { step, data }
const states = new Map();

function setState(userId, step, data = {}) {
  states.set(String(userId), { step, data });
}
function getState(userId) {
  return states.get(String(userId)) || null;
}
function clearState(userId) {
  states.delete(String(userId));
}

async function parserFetch(path, options = {}) {
  const res = await fetch(`${PARSER_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function mainMenuKeyboard() {
  return new InlineKeyboard()
    .text("📋 Из моих чатов", "parser_source_list").row()
    .text("🔗 По ссылке/@username", "parser_source_ref").row()
    .text("🌐 Открыть в браузере", "parser_open_web").row()
    .text("❌ Отмена", "parser_cancel");
}

export function registerParserHandlers(bot, isOwner) {
  bot.command("parser", async (ctx) => {
    if (!isOwner(ctx)) return;
    clearState(ctx.from.id);
    await ctx.reply(
      "🔎 Парсер участников Telegram-чатов\n\nОткуда взять чат?",
      { reply_markup: mainMenuKeyboard() }
    );
  });

  bot.callbackQuery("parser_cancel", async (ctx) => {
    if (!isOwner(ctx)) return;
    await ctx.answerCallbackQuery();
    clearState(ctx.from.id);
    try { await ctx.editMessageText("Отменено."); } catch {}
  });

  bot.callbackQuery("parser_open_web", async (ctx) => {
    if (!isOwner(ctx)) return;
    await ctx.answerCallbackQuery();
    const token = process.env.PARSER_AUTH_TOKEN || "";
    if (!token) {
      await ctx.reply(
        "Не задан PARSER_AUTH_TOKEN в окружении бота. Возьми токен из логов парсера (`pm2 logs agent-parser`) и положи в `~/.agent/.env` как `PARSER_AUTH_TOKEN=...`, потом перезапусти бота."
      );
      return;
    }
    const host = process.env.PARSER_PUBLIC_HOST || "138.16.178.94";
    const url = `http://${host}:3000?token=${token}`;
    await ctx.reply(`Открой в браузере:\n${url}`);
  });

  bot.callbackQuery("parser_source_list", async (ctx) => {
    if (!isOwner(ctx)) return;
    await ctx.answerCallbackQuery();
    try { await ctx.editMessageText("⏳ Загружаю твои чаты…"); } catch {}

    const { status, body } = await parserFetch("/api/chats");
    if (status === 403) {
      await ctx.reply(
        "Парсер не авторизован в Telegram. Открой веб-интерфейс и пройди вход (телефон → код → 2FA). Команда: «🌐 Открыть в браузере» из /parser."
      );
      return;
    }
    if (status !== 200) {
      await ctx.reply(`Ошибка парсера: ${body.error || status}`);
      return;
    }
    const chats = body.chats || [];
    if (chats.length === 0) {
      await ctx.reply("У тебя нет групповых чатов или парсер их не видит.");
      return;
    }
    setState(ctx.from.id, "browsing-chats", { chats, page: 0 });
    await renderChatsPage(ctx, chats, 0);
  });

  async function renderChatsPage(ctx, chats, page) {
    const perPage = 8;
    const total = chats.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const start = page * perPage;
    const slice = chats.slice(start, start + perPage);

    const kb = new InlineKeyboard();
    for (const c of slice) {
      const label = `${c.title.slice(0, 35)} · ${c.membersCount}`;
      kb.text(label, `parser_chat_${c.id}`).row();
    }
    if (totalPages > 1) {
      if (page > 0) kb.text("⬅️", `parser_page_${page - 1}`);
      kb.text(`${page + 1}/${totalPages}`, "parser_noop");
      if (page < totalPages - 1) kb.text("➡️", `parser_page_${page + 1}`);
      kb.row();
    }
    kb.text("❌ Отмена", "parser_cancel");

    const text = `Выбери чат (всего ${total}):`;
    try {
      await ctx.editMessageText(text, { reply_markup: kb });
    } catch {
      await ctx.reply(text, { reply_markup: kb });
    }
  }

  bot.callbackQuery(/^parser_page_(\d+)$/, async (ctx) => {
    if (!isOwner(ctx)) return;
    await ctx.answerCallbackQuery();
    const page = Number(ctx.match[1]);
    const st = getState(ctx.from.id);
    if (!st || st.step !== "browsing-chats") return;
    st.data.page = page;
    await renderChatsPage(ctx, st.data.chats, page);
  });

  bot.callbackQuery("parser_noop", async (ctx) => {
    if (!isOwner(ctx)) return;
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^parser_chat_(.+)$/, async (ctx) => {
    if (!isOwner(ctx)) return;
    await ctx.answerCallbackQuery();
    const chatId = ctx.match[1];
    const st = getState(ctx.from.id);
    const chat = st?.data?.chats?.find((c) => c.id === chatId);
    const chatRef = chat?.username ? "@" + chat.username : chatId;
    await runParse(ctx, chatRef, chat?.title);
  });

  bot.callbackQuery("parser_source_ref", async (ctx) => {
    if (!isOwner(ctx)) return;
    await ctx.answerCallbackQuery();
    setState(ctx.from.id, "awaiting-chat-ref");
    try {
      await ctx.editMessageText(
        "Пришли @username чата или ссылку. Форматы:\n" +
        "• @vibe_course — публичный чат\n" +
        "• https://t.me/vibe_course — публичный чат\n" +
        "• https://t.me/+abcd1234 — приватный по invite (парсер вступит и выйдет)\n\n" +
        "Для отмены — /cancel."
      );
    } catch {
      await ctx.reply(
        "Пришли @username чата или ссылку. Форматы:\n" +
        "• @vibe_course — публичный чат\n" +
        "• https://t.me/vibe_course — публичный чат\n" +
        "• https://t.me/+abcd1234 — приватный по invite (парсер вступит и выйдет)\n\n" +
        "Для отмены — /cancel."
      );
    }
  });

  bot.on("message:text", async (ctx, next) => {
    if (!isOwner(ctx)) return;
    const st = getState(ctx.from.id);
    if (!st || st.step !== "awaiting-chat-ref") return next();
    const text = ctx.message.text.trim();
    if (text.startsWith("/")) return next();
    clearState(ctx.from.id);
    await runParse(ctx, text, text);
  });

  bot.command("cancel", async (ctx) => {
    if (!isOwner(ctx)) return;
    const st = getState(ctx.from.id);
    if (st) {
      clearState(ctx.from.id);
      await ctx.reply("Отменено.");
    }
  });

  bot.callbackQuery("parser_again", async (ctx) => {
    if (!isOwner(ctx)) return;
    await ctx.answerCallbackQuery();
    await ctx.reply(
      "🔎 Парсер участников Telegram-чатов\n\nОткуда взять чат?",
      { reply_markup: mainMenuKeyboard() }
    );
  });

  async function runParse(ctx, chatRef, title) {
    const statusMsg = await ctx.reply(`🔍 Парсю «${title || chatRef}»…`);
    const typingTimer = setInterval(() => {
      ctx.api.sendChatAction(ctx.chat.id, "typing").catch(() => {});
    }, 4000);

    try {
      let attempt = 0;
      while (true) {
        attempt++;
        const { status, body } = await parserFetch("/api/parse", {
          method: "POST",
          body: JSON.stringify({ chatRef }),
        });

        if (status === 429 && attempt === 1) {
          const wait = Number(body.retryAfter) || 5;
          await ctx.api.editMessageText(
            ctx.chat.id, statusMsg.message_id,
            `Telegram попросил подождать ${wait} сек. Повторю автоматически.`
          ).catch(() => {});
          await new Promise((r) => setTimeout(r, wait * 1000));
          continue;
        }

        if (status === 403 && body.error === "not_authorized") {
          await ctx.reply(
            "Парсер не авторизован в Telegram. Открой веб-интерфейс через «🌐 Открыть в браузере» и пройди авторизацию."
          );
          return;
        }
        if (status === 404) {
          await ctx.reply("Чат не найден или ты в нём не состоишь.");
          return;
        }
        if (status === 403) {
          await ctx.reply(body.hint || "Нет доступа к чату.");
          return;
        }
        if (status === 504) {
          await ctx.reply("Слишком долго. Повтори позже.");
          return;
        }
        if (status === 409) {
          await ctx.reply("Сейчас уже идёт другой парсинг. Подожди и повтори.");
          return;
        }
        if (status !== 200) {
          await ctx.reply(`Ошибка: ${body.error || body.message || status}`);
          return;
        }

        const stats = body.stats;
        const summary =
          `✅ Готово!\n\n📊 ${body.chat.title}\n` +
          `Всего: ${stats.total} · С username: ${stats.withUsername} · Без: ${stats.withoutUsername}`;

        await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, summary).catch(() => {});

        const safe = String(body.chat.title).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
        const date = new Date().toISOString().slice(0, 10);
        const filename = `${safe || "chat"}-${date}.txt`;

        // Send .txt file first (no buttons — buttons go under the last message)
        const numberedTxt = body.numberedList || body.usernames.map((u, i) => `${i + 1}. ${u}`).join("\n");
        await ctx.replyWithDocument(new InputFile(Buffer.from(numberedTxt, "utf8"), filename));

        // Send numbered list as text messages, chunked at line boundaries (≤3900 chars per chunk)
        const chunks = chunkByLines(numberedTxt, 3900);
        for (let i = 0; i < chunks.length - 1; i++) {
          await ctx.reply(chunks[i]);
          await new Promise((r) => setTimeout(r, 250)); // gentle pacing to avoid FloodWait
        }
        // Last chunk carries the action buttons
        await ctx.reply(chunks[chunks.length - 1], {
          reply_markup: new InlineKeyboard()
            .text("🔁 Спарсить ещё", "parser_again").row()
            .text("📋 Главное меню", "parser_again"),
        });
        return;
      }
    } catch (e) {
      console.error("[parser/runParse]", e);
      await ctx.reply("Не удалось связаться с парсером. Проверь, что сервис запущен (`pm2 status`).");
    } finally {
      clearInterval(typingTimer);
    }
  }
}
