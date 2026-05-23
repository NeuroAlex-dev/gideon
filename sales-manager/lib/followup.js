import { getLead, getCampaign, getOrCreateConversation, listMessages, addMessage, logEvent, setLeadStatus } from "./db.js";
import { buildOutboundSystemPrompt } from "./prompts.js";
import { extractJson } from "./ai.js";
import { nextTypingDuration, classifyTelegramError } from "./safety.js";

/**
 * Принудительная отправка closing-follow-up:
 * AI пишет короткое сообщение лиду с приглашением в складчину и условиями,
 * не дожидаясь ответа от лида. Используется когда AI ранее отправил материалы,
 * но забыл закрыть в продажу.
 */
export async function sendForceFollowup({ db, askClaude, telegram, leadId }) {
  const lead = getLead(db, leadId);
  if (!lead) throw new Error(`lead ${leadId} not found`);
  const campaign = getCampaign(db, lead.campaign_id);
  if (!campaign) throw new Error(`campaign ${lead.campaign_id} not found`);
  const conv = getOrCreateConversation(db, lead.id, campaign.id);
  const history = listMessages(db, conv.id, { limit: 50 });

  const system = buildOutboundSystemPrompt(campaign);
  const aiHistory = history.map((m) => ({
    role: m.role === "outbound" || m.role === "human_takeover" ? "assistant" : "user",
    content: m.body,
  }));

  const userMessage = `Лид не ответил после твоих последних сообщений (видимо ты отправил материалы, но не позвал в складчину).

Напиши ОДНО короткое follow-up сообщение которое:
1. Деликатно возвращается к теме (не извиняйся за «беспокою»)
2. Кратко напоминает суть оффера в цифрах из offer_text: 50 000 ₽ официально → 5 000 ₽ через складчину → можно 2500+2500 в рассрочку
3. Ставит прямой вопрос про участие («Что скажете насчёт участия в складчине?» / «Готовы зайти к нам?»)

Ответь СТРОГО в JSON:
{
  "text": "сообщение лиду",
  "reason": "коротко зачем именно так"
}`;

  const ai = await askClaude({ systemPrompt: system, history: aiHistory, userMessage });
  let parsed;
  try {
    parsed = JSON.parse(extractJson(ai.text));
  } catch (e) {
    throw new Error(`force-followup: AI вернул не-JSON: ${ai.text?.slice(0, 100)}`);
  }
  if (!parsed.text) throw new Error("force-followup: AI вернул пустой text");

  const peer = lead.tg_username || lead.tg_user_id;
  const typingMs = nextTypingDuration();
  try {
    const tgMsgId = await telegram.sendMessage({ peer, text: parsed.text, typingMs });
    const sentAt = Date.now();
    const messageId = addMessage(db, {
      conversation_id: conv.id, role: "outbound", body: parsed.text, status: "sent",
      tg_message_id: tgMsgId, sent_at: sentAt, ai_tokens_in: ai.tokensIn, ai_tokens_out: ai.tokensOut,
    });
    if (lead.status === "first_sent") setLeadStatus(db, lead.id, "in_dialog");
    logEvent(db, { type: "sent", campaign_id: campaign.id, lead_id: lead.id, payload: { message_id: messageId, source: "force-followup" } });
    return { ok: true, messageId, text: parsed.text };
  } catch (e) {
    const cls = classifyTelegramError(e);
    logEvent(db, { type: "error", campaign_id: campaign.id, lead_id: lead.id, payload: { stage: "force-followup-send", message: e.message, ...cls } });
    throw e;
  }
}
