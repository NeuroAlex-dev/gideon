import { buildInboundSystemPrompt } from "./prompts.js";
import { isUnsubscribeMessage } from "./safety.js";
import { extractJson } from "./ai.js";

export async function decideInboundAction({ campaign, lead, conversation, history, inboundText, askClaude }) {
  if (isUnsubscribeMessage(inboundText)) {
    return { action: "mark_unsubscribed", reason: "локальный unsubscribe-детектор" };
  }

  const system = buildInboundSystemPrompt(campaign);
  const aiHistory = history.map((m) => ({
    role: m.role === "outbound" || m.role === "human_takeover" ? "assistant" : "user",
    content: m.body,
  }));

  let res = await askClaude({ systemPrompt: system, history: aiHistory, userMessage: inboundText });
  let parsed;
  try {
    parsed = JSON.parse(extractJson(res.text));
  } catch {
    return { action: "escalate_error", reason: `AI вернул не-JSON: ${res.text?.slice(0, 100)}` };
  }

  // Closing-guard: если мы на pitch/closing стадии или AI приложил файл — проверяем, что есть CTA на складчину/участие.
  // Если AI скатился в абстрактный вопрос — заставляем переделать с жёсткой инструкцией.
  const stage = parsed.new_stage || conversation.stage;
  const isClosingMoment = ["pitch", "objection", "closing"].includes(stage)
    || (Array.isArray(parsed.attachments) && parsed.attachments.length > 0)
    || hasRecentMaterialsSent(history);
  if (isClosingMoment && parsed.text && violatesClosingRule(parsed.text, campaign)) {
    const retryHint = `\n\n🚨 ПЕРЕДЕЛАЙ: предыдущий вариант был абстрактным (вроде «что больше откликнулось»). Заверши ответ КОНКРЕТНЫМ вопросом про участие в складчине. Упомяни цифры из offer_text (50 000 ₽ автор / 5 000 ₽ в складчине / можно 2500+2500 в рассрочку). Пример: «Что скажете насчёт участия?» / «Готовы зайти к нам?» / «Тема? Можем подключить.»`;
    res = await askClaude({ systemPrompt: system + retryHint, history: aiHistory, userMessage: inboundText });
    try {
      parsed = JSON.parse(extractJson(res.text));
    } catch {
      // если retry дал не-JSON — оставляем первый вариант
    }
  }

  if (parsed.intent === "unsubscribe") return { action: "mark_unsubscribed", reason: parsed.reason || "" };
  if (parsed.intent === "handoff") return { action: "handoff", reason: parsed.reason || "" };

  const decision = {
    text: parsed.text,
    attachments: Array.isArray(parsed.attachments) ? parsed.attachments : [],
    newStage: parsed.new_stage,
    intent: parsed.intent,
    reason: parsed.reason || "",
    tokensIn: res.tokensIn,
    tokensOut: res.tokensOut,
  };

  if (!parsed.text) return { action: "escalate_error", reason: "AI вернул пустой text" };

  if (campaign.mode === "draft_approval") {
    return { ...decision, action: "create_draft" };
  }
  if (campaign.mode === "qualify_then_handoff") {
    if (parsed.intent === "qualified") {
      return { action: "handoff", reason: parsed.reason || "AI отметил лида как qualified" };
    }
    return { ...decision, action: "send_now" };
  }
  if (campaign.mode === "hybrid") {
    if (shouldEscalateToDraft({ inboundText, stage: parsed.new_stage, intent: parsed.intent })) {
      return { ...decision, action: "create_draft" };
    }
    return { ...decision, action: "send_now" };
  }
  // По умолчанию (full_auto и неизвестные режимы)
  return { ...decision, action: "send_now" };
}

const HYBRID_TRIGGER_WORDS = /цена|сколько\s*стоит|оплат|договор|счёт|реквизит|карт[ау]|перевод|купить/i;
const HYBRID_TRIGGER_STAGES = new Set(["pitch", "objection", "closing"]);

function shouldEscalateToDraft({ inboundText, stage, intent }) {
  if (HYBRID_TRIGGER_WORDS.test(inboundText || "")) return true;
  if (HYBRID_TRIGGER_STAGES.has(stage)) return true;
  if (intent === "qualified" || intent === "won") return true;
  return false;
}

// Список слов, которые явно сигналят про CTA на участие / складчину
const CTA_SIGNAL_RE = /склад|присоедин|участ|зайдёшь|зайдешь|зайти|вступ|подключ|готов(ы|)\s+(к нам|в группу|записаться)|интересно\?|тема\?/i;

// Запрещённые формулировки финала (абстрактные вопросы вместо CTA)
const ABSTRACT_TAIL_RE = /(что|чем)\s+(?:больше|вам|тебе|из этого)\s+(?:зашло|откликн|откликает|понравил|интересн|зацепил|ближе)|что\s+скажете\?$|как\s+вам\?$|что\s+думае(те|шь)\?$|что\s+ближе\?$/i;

export function violatesClosingRule(text, campaign) {
  if (!text) return false;
  const t = text.trim();
  // Если в тексте уже упомянуты ключевые элементы складчины — норм
  if (CTA_SIGNAL_RE.test(t)) return false;
  // Если последние 200 символов содержат абстрактный «отвлечённый» вопрос без CTA — нарушение
  const tail = t.slice(-250);
  return ABSTRACT_TAIL_RE.test(tail);
}

// Эвристика: были ли в недавней истории отправлены материалы (ссылка, attachment, длинный pitch)
export function hasRecentMaterialsSent(history) {
  if (!history?.length) return false;
  const recentOutbound = history.filter((m) => m.role === "outbound").slice(-3);
  return recentOutbound.some((m) =>
    /\[файл:|https?:\/\/|конспект|видео|разбор|youtu/i.test(m.body || "")
  );
}
