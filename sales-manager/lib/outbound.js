import {
  listCampaigns, nextLeadToContact, setLeadStatus,
  getOrCreateConversation, addMessage, isLeadBlocked, logEvent,
  countOutboundFirstMessagesSince, setCampaignStatus, updateMessageStatus, getLead,
} from "./db.js";
import { canSendNow, nextOutboundDelay, nextTypingDuration, classifyTelegramError, dayKeyInTimezone } from "./safety.js";
import { buildOutboundSystemPrompt, buildFirstMessageUserPrompt } from "./prompts.js";
import { extractJson } from "./ai.js";
import { filterSafeAttachments } from "./telegram.js";

export async function runOutboundTick({ db, now = Date.now(), askClaude, telegram, rng = Math.random, force = false, campaignFilter = null }) {
  const result = { sent: [], skipped: [], errors: [] };
  let runningCampaigns = listCampaigns(db).filter((c) => c.status === "running");
  if (campaignFilter) runningCampaigns = runningCampaigns.filter((c) => c.id === campaignFilter);

  const dayStart = startOfDayMs(now, "Europe/Moscow");
  const sentTodayGlobal = countOutboundFirstMessagesSince(db, dayStart);

  for (const campaign of runningCampaigns) {
    // В force-режиме сбрасываем next_action_at чтобы лид был "сейчас или раньше"
    const queryNow = force ? Date.now() + 60_000 : now;
    const lead = nextLeadToContact(db, campaign.id, queryNow);
    if (!lead) { continue; }

    if (lead.tg_user_id && isLeadBlocked(db, lead.tg_user_id)) {
      setLeadStatus(db, lead.id, "blocked");
      logEvent(db, { type: "skip_blocked", campaign_id: campaign.id, lead_id: lead.id });
      result.skipped.push({ leadId: lead.id, reason: "blocklist" });
      continue;
    }

    const lastSent = db.prepare(`
      SELECT MAX(m.sent_at) as last FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.campaign_id = ? AND m.role = 'outbound' AND m.status = 'sent'
    `).get(campaign.id).last;
    const sentLastHour = db.prepare(`
      SELECT COUNT(*) as n FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.campaign_id = ? AND m.role = 'outbound' AND m.status = 'sent' AND m.sent_at >= ?
    `).get(campaign.id, now - 3600_000).n;

    const check = force ? { ok: true } : canSendNow({
      now, campaign,
      sentTodayCount: sentTodayGlobal,
      sentLastHourCount: sentLastHour,
      lastSentAt: lastSent,
    });
    if (!check.ok) {
      console.log(`[outbound] skip lead ${lead.id} (campaign ${campaign.id}): ${check.reason}`);
      result.skipped.push({ leadId: lead.id, reason: check.reason });
      setLeadStatus(db, lead.id, "queued", now + nextOutboundDelay(rng));
      continue;
    }

    let aiText;
    let aiAttachments = [];
    try {
      const ai = await askClaude({
        systemPrompt: buildOutboundSystemPrompt(campaign),
        history: [],
        userMessage: buildFirstMessageUserPrompt(lead),
      });
      const parsed = JSON.parse(extractJson(ai.text));
      aiText = parsed.text;
      aiAttachments = filterSafeAttachments(parsed.attachments);
      if (!aiText) throw new Error("AI вернул пустой text");
    } catch (e) {
      logEvent(db, { type: "error", campaign_id: campaign.id, lead_id: lead.id, payload: { stage: "ai", message: e.message } });
      result.errors.push({ leadId: lead.id, error: e.message });
      setLeadStatus(db, lead.id, "queued", now + nextOutboundDelay(rng));
      continue;
    }

    const conv = getOrCreateConversation(db, lead.id, campaign.id);
    const peer = lead.tg_username || lead.tg_user_id;
    const typingMs = force ? 0 : nextTypingDuration(rng);

    try {
      const tgMsgId = await telegram.sendMessage({ peer, text: aiText, typingMs });
      const sentAt = Date.now();
      const messageId = addMessage(db, {
        conversation_id: conv.id, role: "outbound", body: aiText,
        status: "sent", tg_message_id: tgMsgId, sent_at: sentAt,
      });
      // Отправляем приложения (если AI указал и они валидны)
      for (const att of aiAttachments) {
        try {
          const attMsgId = await telegram.sendFile({ peer, filePath: att, typingMs: 0 });
          addMessage(db, {
            conversation_id: conv.id, role: "outbound", body: `[файл: ${att}]`,
            status: "sent", tg_message_id: attMsgId, sent_at: Date.now(),
          });
          logEvent(db, { type: "sent_file", campaign_id: campaign.id, lead_id: lead.id, payload: { path: att } });
        } catch (err) {
          logEvent(db, { type: "error", campaign_id: campaign.id, lead_id: lead.id, payload: { stage: "send-file", path: att, message: err.message } });
        }
      }
      setLeadStatus(db, lead.id, "first_sent");
      logEvent(db, { type: "sent", campaign_id: campaign.id, lead_id: lead.id, payload: { message_id: messageId } });
      result.sent.push({ leadId: lead.id, messageId });
      return result;
    } catch (e) {
      const cls = classifyTelegramError(e);
      logEvent(db, { type: "ban_signal", campaign_id: campaign.id, lead_id: lead.id, payload: { ...cls, message: e.message } });
      result.errors.push({ leadId: lead.id, error: e.message, classified: cls });
      if (cls.kind === "ban" || cls.kind === "deactivated" || cls.kind === "privacy") {
        setLeadStatus(db, lead.id, "blocked");
      } else if (cls.kind === "flood_wait" || cls.kind === "flood") {
        for (const c of runningCampaigns) setCampaignStatus(db, c.id, "paused");
        return result;
      } else {
        setLeadStatus(db, lead.id, "queued", now + nextOutboundDelay(rng));
      }
    }
  }
  return result;
}

export async function processApprovedDrafts({ db, telegram, rng = Math.random }) {
  const rows = db.prepare(`
    SELECT d.id as draft_id, d.status as draft_status, m.id as message_id, m.body, m.conversation_id, c.lead_id, c.campaign_id
    FROM drafts d
    JOIN messages m ON m.id = d.message_id
    JOIN conversations c ON c.id = m.conversation_id
    WHERE d.status IN ('approved', 'edited') AND m.status = 'pending_approval'
  `).all();

  for (const r of rows) {
    const lead = getLead(db, r.lead_id);
    const peer = lead.tg_username || lead.tg_user_id;
    const typingMs = nextTypingDuration(rng);
    try {
      const tgMsgId = await telegram.sendMessage({ peer, text: r.body, typingMs });
      const sentAt = Date.now();
      updateMessageStatus(db, r.message_id, "sent", { sent_at: sentAt, tg_message_id: tgMsgId });
      setLeadStatus(db, lead.id, "in_dialog");
      logEvent(db, { type: "sent", campaign_id: r.campaign_id, lead_id: lead.id, payload: { message_id: r.message_id, source: "draft" } });
    } catch (e) {
      logEvent(db, { type: "error", campaign_id: r.campaign_id, lead_id: lead.id, payload: { stage: "send-approved-draft", message: e.message } });
    }
  }
}

function startOfDayMs(ts, tz) {
  const key = dayKeyInTimezone(ts, tz);
  return new Date(`${key}T00:00:00Z`).getTime();
}
