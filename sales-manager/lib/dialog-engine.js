import { buildInboundSystemPrompt } from "./prompts.js";
import { isUnsubscribeMessage } from "./safety.js";

export async function decideInboundAction({ campaign, lead, conversation, history, inboundText, askClaude }) {
  if (isUnsubscribeMessage(inboundText)) {
    return { action: "mark_unsubscribed", reason: "локальный unsubscribe-детектор" };
  }

  const system = buildInboundSystemPrompt(campaign);
  const aiHistory = history.map((m) => ({
    role: m.role === "outbound" || m.role === "human_takeover" ? "assistant" : "user",
    content: m.body,
  }));

  const res = await askClaude({ systemPrompt: system, history: aiHistory, userMessage: inboundText });
  let parsed;
  try {
    parsed = JSON.parse(res.text);
  } catch {
    return { action: "escalate_error", reason: `AI вернул не-JSON: ${res.text?.slice(0, 100)}` };
  }

  if (parsed.intent === "unsubscribe") return { action: "mark_unsubscribed", reason: parsed.reason || "" };
  if (parsed.intent === "handoff") return { action: "handoff", reason: parsed.reason || "" };

  const decision = {
    text: parsed.text,
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
