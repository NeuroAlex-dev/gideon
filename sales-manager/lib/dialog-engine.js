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
  if (campaign.mode === "full_auto") {
    return { ...decision, action: "send_now" };
  }
  return { ...decision, action: "send_now" };
}
