export function createBotNotifier({ botToken, chatId }) {
  if (!botToken || !chatId) {
    return async () => null;
  }
  return async function notify({ kind, payload }) {
    const text = formatAlert(kind, payload);
    const body = {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    };
    if (kind === "draft_pending") {
      body.reply_markup = {
        inline_keyboard: [[
          { text: "✅ Отправить", callback_data: `sm:approve:${payload.draftId}` },
          { text: "✏️ Правка", callback_data: `sm:edit:${payload.draftId}` },
          { text: "⏭ Пропустить", callback_data: `sm:reject:${payload.draftId}` },
        ]],
      };
    }
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return data?.result?.message_id ?? null;
  };
}

function formatAlert(kind, payload) {
  if (kind === "draft_pending") {
    return `<b>Драфт ожидает</b>\nКампания: ${esc(payload.campaign.name)}\nЛид: @${esc(payload.lead.tg_username || "")}\n\n${esc(payload.text)}`;
  }
  if (kind === "handoff") {
    return `<b>🎯 Лид готов к handoff</b>\nКампания: ${esc(payload.campaign.name)}\nЛид: @${esc(payload.lead.tg_username || "")}\nПричина: ${esc(payload.reason || "")}`;
  }
  if (kind === "engine_error") {
    return `<b>⚠️ Ошибка dialog-engine</b>\nКампания: ${esc(payload.campaign.name)}\nЛид: @${esc(payload.lead.tg_username || "")}\n${esc(payload.reason || "")}`;
  }
  if (kind === "auto_paused") {
    return `<b>🛑 Все кампании на автопаузе</b>\nПричина: ${esc(payload.reason || "")}`;
  }
  return `<b>${esc(kind)}</b>\n${esc(JSON.stringify(payload))}`;
}

function esc(s) { return String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])); }
