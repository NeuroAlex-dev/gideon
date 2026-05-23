import { getLead, getCampaign, getOrCreateConversation, listMessages, addMessage, logEvent, setLeadStatus, listCampaigns } from "./db.js";
import { buildOutboundSystemPrompt } from "./prompts.js";
import { extractJson } from "./ai.js";
import { nextTypingDuration, classifyTelegramError } from "./safety.js";

const MATERIALS_RE = /\[файл:|https?:\/\/|youtu|конспект|разбор|посмотри|видео/i;
const CLOSING_RE = /склад|присоедин|участи|вступ|подключ|готовы?\s+к нам|готовы?\s+зайти|записаться/i;

/**
 * Сканирует все активные диалоги, находит «молчунов» — лидов которым AI
 * отправил материалы, но не упомянул складчину, прошло достаточно времени и
 * мы ещё не делали force-followup в последние 24 часа. Для каждого триггерит sendForceFollowup.
 */
export async function autoFollowupSweep({ db, askClaude, telegram, minSilenceMs = 15 * 60_000, cooldownMs = 24 * 3600_000 }) {
  const now = Date.now();
  const sentRecentMap = new Map();
  // мапа последних force-followup по лиду за окно cooldown
  const recent = db.prepare(`
    SELECT lead_id, MAX(ts) as ts FROM events
    WHERE type = 'sent' AND payload_json LIKE '%force-followup%' AND ts >= ?
    GROUP BY lead_id
  `).all(now - cooldownMs);
  for (const r of recent) sentRecentMap.set(r.lead_id, r.ts);

  const runningCampaigns = listCampaigns(db).filter((c) => c.status === "running");
  const results = { checked: 0, candidates: [], triggered: [], skipped: [] };
  for (const campaign of runningCampaigns) {
    const convs = db.prepare(`
      SELECT c.id as conv_id, l.id as lead_id, l.tg_username, l.first_name
      FROM conversations c
      JOIN leads l ON l.id = c.lead_id
      WHERE c.campaign_id = ?
        AND l.status NOT IN ('unsubscribed','blocked','lost','won','human_takeover','queued')
    `).all(campaign.id);
    for (const c of convs) {
      results.checked++;
      const msgs = db.prepare("SELECT role, body, sent_at FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 8").all(c.conv_id).reverse();
      if (!msgs.length) continue;
      const last = msgs[msgs.length - 1];
      // Только если последнее сообщение — наше исходящее (мы ждём ответ от лида и не получили)
      if (last.role !== "outbound") continue;
      // Должно пройти достаточно времени с последнего нашего сообщения
      if (!last.sent_at || (now - last.sent_at) < minSilenceMs) continue;
      // Cooldown: уже делали force-followup в последние 24ч
      if (sentRecentMap.has(c.lead_id)) continue;
      const lastOut = msgs.filter((m) => m.role === "outbound").slice(-4);
      const hasMaterials = lastOut.some((m) => MATERIALS_RE.test(m.body || ""));
      const hasClosing = lastOut.some((m) => CLOSING_RE.test(m.body || ""));
      if (!hasMaterials || hasClosing) {
        results.skipped.push({ leadId: c.lead_id, reason: !hasMaterials ? "нет материалов" : "складчина уже упомянута" });
        continue;
      }
      results.candidates.push({ leadId: c.lead_id, username: c.tg_username });
      try {
        const r = await sendForceFollowup({ db, askClaude, telegram, leadId: c.lead_id });
        results.triggered.push({ leadId: c.lead_id, username: c.tg_username, messageId: r.messageId });
        console.log(`[auto-followup] sent to lead ${c.lead_id} @${c.tg_username}: ${(r.text || "").slice(0, 80)}`);
      } catch (err) {
        console.error(`[auto-followup] failed for lead ${c.lead_id}:`, err.message);
      }
    }
  }
  return results;
}

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
