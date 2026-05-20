import {
  listCampaigns, getOrCreateConversation, addMessage, listMessages,
  setLeadStatus, setConversationStage, createDraft, logEvent,
} from "./db.js";
import { decideInboundAction } from "./dialog-engine.js";
import { nextTypingDuration } from "./safety.js";

export function createInboundProcessor({ db, askClaude, telegram, notifyAlexander = null, rng = Math.random, batchWindowMs = 60_000 }) {
  const buffers = new Map();

  async function onInbound({ tgUserId, tgUsername, text, tgMessageId }) {
    const found = findActiveLead({ db, tgUserId, tgUsername });
    if (!found) return;

    const { lead, campaign } = found;
    const conv = getOrCreateConversation(db, lead.id, campaign.id);
    addMessage(db, {
      conversation_id: conv.id, role: "inbound", body: text,
      status: "received", tg_message_id: tgMessageId, received_at: Date.now(),
    });

    const peer = tgUsername || tgUserId;
    let buf = buffers.get(lead.id);
    if (!buf) {
      buf = { texts: [], peer, conv, lead, campaign };
      buffers.set(lead.id, buf);
    }
    buf.texts.push(text);

    if (buf.timer) clearTimeout(buf.timer);
    buf.timer = setTimeout(() => { processBatch(lead.id).catch((err) => {
      logEvent(db, { type: "error", lead_id: lead.id, campaign_id: campaign.id, payload: { stage: "inbound-batch", message: err.message } });
    }); }, batchWindowMs);
  }

  async function processBatch(leadId) {
    const buf = buffers.get(leadId);
    if (!buf) return;
    buffers.delete(leadId);

    const { lead, campaign, conv, peer } = buf;
    const combined = buf.texts.join("\n");
    const history = listMessages(db, conv.id).filter((m) => m.body !== combined);

    const dec = await decideInboundAction({ campaign, lead, conversation: conv, history, inboundText: combined, askClaude });

    if (dec.action === "mark_unsubscribed") {
      setLeadStatus(db, lead.id, "unsubscribed");
      logEvent(db, { type: "unsubscribed", campaign_id: campaign.id, lead_id: lead.id, payload: { reason: dec.reason } });
      return;
    }
    if (dec.action === "handoff") {
      setLeadStatus(db, lead.id, "qualified");
      logEvent(db, { type: "handoff", campaign_id: campaign.id, lead_id: lead.id, payload: { reason: dec.reason } });
      if (notifyAlexander) await notifyAlexander({ kind: "handoff", payload: { campaign, lead, reason: dec.reason } });
      return;
    }
    if (dec.action === "escalate_error") {
      logEvent(db, { type: "error", campaign_id: campaign.id, lead_id: lead.id, payload: { stage: "dialog-engine", message: dec.reason } });
      if (notifyAlexander) await notifyAlexander({ kind: "engine_error", payload: { campaign, lead, reason: dec.reason } });
      return;
    }

    if (dec.newStage) setConversationStage(db, conv.id, dec.newStage);

    if (dec.action === "create_draft") {
      const messageId = addMessage(db, {
        conversation_id: conv.id, role: "outbound", body: dec.text,
        status: "pending_approval", ai_tokens_in: dec.tokensIn, ai_tokens_out: dec.tokensOut,
      });
      const draftId = createDraft(db, messageId);
      logEvent(db, { type: "draft_created", campaign_id: campaign.id, lead_id: lead.id, payload: { message_id: messageId, draft_id: draftId } });
      if (notifyAlexander) {
        const botMsgId = await notifyAlexander({ kind: "draft_pending", payload: { campaign, lead, conv, text: dec.text, draftId, messageId } });
        if (botMsgId) db.prepare("UPDATE drafts SET telegram_bot_message_id = ? WHERE id = ?").run(botMsgId, draftId);
      }
      return;
    }

    if (dec.action === "send_now") {
      const typingMs = nextTypingDuration(rng);
      try {
        const tgMsgId = await telegram.sendMessage({ peer, text: dec.text, typingMs });
        const sentAt = Date.now();
        const messageId = addMessage(db, {
          conversation_id: conv.id, role: "outbound", body: dec.text, status: "sent",
          tg_message_id: tgMsgId, sent_at: sentAt, ai_tokens_in: dec.tokensIn, ai_tokens_out: dec.tokensOut,
        });
        setLeadStatus(db, lead.id, "in_dialog");
        logEvent(db, { type: "sent", campaign_id: campaign.id, lead_id: lead.id, payload: { message_id: messageId } });
      } catch (e) {
        logEvent(db, { type: "error", campaign_id: campaign.id, lead_id: lead.id, payload: { stage: "send-reply", message: e.message } });
      }
    }
  }

  return { onInbound, _processBatchForTest: processBatch };
}

function findActiveLead({ db, tgUserId, tgUsername }) {
  const runningCampaigns = listCampaigns(db).filter((c) => c.status === "running");
  for (const campaign of runningCampaigns) {
    const sql = tgUserId
      ? "SELECT * FROM leads WHERE campaign_id = ? AND tg_user_id = ? AND status NOT IN ('unsubscribed','blocked','human_takeover') LIMIT 1"
      : "SELECT * FROM leads WHERE campaign_id = ? AND tg_username = ? AND status NOT IN ('unsubscribed','blocked','human_takeover') LIMIT 1";
    const lead = tgUserId ? db.prepare(sql).get(campaign.id, tgUserId) : db.prepare(sql).get(campaign.id, tgUsername);
    if (lead) return { lead, campaign };
  }
  return null;
}
