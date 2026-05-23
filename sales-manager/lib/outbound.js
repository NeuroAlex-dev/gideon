import {
  listCampaigns, nextLeadToContact, setLeadStatus,
  getOrCreateConversation, addMessage, isLeadBlocked, logEvent,
  countOutboundFirstMessagesSince, setCampaignStatus, updateMessageStatus, getLead,
} from "./db.js";
import { canSendNow, nextOutboundDelay, nextTypingDuration, classifyTelegramError, dayKeyInTimezone } from "./safety.js";
import { buildOutboundSystemPrompt, buildFirstMessageUserPrompt } from "./prompts.js";
import { extractJson } from "./ai.js";
import { filterSafeAttachments } from "./telegram.js";

export async function runOutboundTick({ db, now = Date.now(), askClaude, telegram, getTelegramFor, rng = Math.random, force = false, campaignFilter = null, processAll = false }) {
  // Backward compat: если передан один telegram — заворачиваем
  if (!getTelegramFor && telegram) getTelegramFor = () => telegram;
  const result = { sent: [], skipped: [], errors: [] };
  let runningCampaigns = listCampaigns(db).filter((c) => c.status === "running");
  if (campaignFilter) runningCampaigns = runningCampaigns.filter((c) => c.id === campaignFilter);

  const dayStart = startOfDayMs(now, "Europe/Moscow");
  // В force+processAll режиме обрабатываем всех queued лидов подряд (для bulk-операций типа "догнать оставшихся")
  const shouldProcessAll = force && processAll;

  for (const campaign of runningCampaigns) {
    // В force-режиме сбрасываем next_action_at чтобы лиды были "сейчас или раньше"
    if (force) {
      db.prepare("UPDATE leads SET next_action_at = 0 WHERE campaign_id = ? AND status = 'queued'").run(campaign.id);
    }
    // Per-account daily count — считаем только сообщения от того же аккаунта
    const sentTodayForAccount = countOutboundFirstMessagesSince(db, dayStart, campaign.session_id);
    let processedInCampaign = 0;
    while (true) {
      const queryNow = force ? Date.now() + 60_000 : now;
      const lead = nextLeadToContact(db, campaign.id, queryNow);
      if (!lead) { break; }
      const campaignTelegram = getTelegramFor(campaign.session_id);
      const sendResult = await processSingleLead({ db, campaign, lead, now: Date.now(), askClaude, telegram: campaignTelegram, rng, force, sentTodayGlobal: sentTodayForAccount + result.sent.length, runningCampaigns, result });
      processedInCampaign++;
      if (sendResult === "stop") break; // флуд-сигнал или другая критическая ошибка
      if (!shouldProcessAll) break; // обычный тик — только один лид за вызов
    }
    if (processedInCampaign > 0) console.log(`[outbound] campaign ${campaign.id}: processed ${processedInCampaign} lead(s)`);
  }
  return result;
}

async function processSingleLead({ db, campaign, lead, now, askClaude, telegram, rng, force, sentTodayGlobal, runningCampaigns, result }) {

    if (lead.tg_user_id && isLeadBlocked(db, lead.tg_user_id)) {
      setLeadStatus(db, lead.id, "blocked");
      logEvent(db, { type: "skip_blocked", campaign_id: campaign.id, lead_id: lead.id });
      result.skipped.push({ leadId: lead.id, reason: "blocklist" });
      return "continue";
    }

    // Учитываем только ПЕРВЫЕ сообщения (создание новых диалогов), а не ответы AI в уже идущих
    const lastSent = db.prepare(`
      SELECT MAX(m.sent_at) as last FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.campaign_id = ? AND m.role = 'outbound' AND m.status = 'sent'
        AND m.id = (SELECT MIN(id) FROM messages WHERE conversation_id = m.conversation_id)
    `).get(campaign.id).last;
    const sentLastHour = db.prepare(`
      SELECT COUNT(*) as n FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE c.campaign_id = ? AND m.role = 'outbound' AND m.status = 'sent' AND m.sent_at >= ?
        AND m.id = (SELECT MIN(id) FROM messages WHERE conversation_id = m.conversation_id)
    `).get(campaign.id, now - 3600_000).n;

    const check = force ? { ok: true } : canSendNow({
      now, campaign,
      sentTodayCount: sentTodayGlobal,
      sentLastHourCount: sentLastHour,
      lastSentAt: lastSent,
    });
    if (!check.ok) {
      console.log(`[outbound] skip lead ${lead.id} (campaign ${campaign.id}): ${check.reason} (force=${force})`);
      result.skipped.push({ leadId: lead.id, reason: check.reason });
      setLeadStatus(db, lead.id, "queued", now + nextOutboundDelay(rng));
      return "stop";
    }

    // Подтягиваем реальный first_name/bio из TG если их ещё нет в БД
    let leadEnriched = lead;
    if ((!lead.first_name || !lead.bio) && telegram.getUserProfile) {
      try {
        const profile = await telegram.getUserProfile(lead.tg_username || lead.tg_user_id);
        if (profile) {
          const patch = {};
          if (!lead.first_name && profile.firstName) patch.first_name = profile.firstName;
          if (!lead.last_name && profile.lastName) patch.last_name = profile.lastName;
          if (!lead.bio && profile.bio) patch.bio = profile.bio;
          if (!lead.tg_user_id && profile.tgUserId) patch.tg_user_id = profile.tgUserId;
          if (Object.keys(patch).length) {
            const sets = Object.keys(patch).map((k) => `${k} = ?`).join(", ");
            db.prepare(`UPDATE leads SET ${sets} WHERE id = ?`).run(...Object.values(patch), lead.id);
            leadEnriched = { ...lead, ...patch };
            console.log(`[outbound] enriched lead ${lead.id}: ${Object.keys(patch).join(", ")}`);
          }
        }
      } catch (e) {
        console.warn(`[outbound] не смог получить профиль лида ${lead.id}: ${e.message}`);
      }
    }

    let aiText;
    let aiAttachments = [];
    try {
      const ai = await askClaude({
        systemPrompt: buildOutboundSystemPrompt(campaign),
        history: [],
        userMessage: buildFirstMessageUserPrompt(leadEnriched),
      });
      const parsed = JSON.parse(extractJson(ai.text));
      aiText = parsed.text;
      aiAttachments = filterSafeAttachments(parsed.attachments);
      if (!aiText) throw new Error("AI вернул пустой text");
    } catch (e) {
      logEvent(db, { type: "error", campaign_id: campaign.id, lead_id: lead.id, payload: { stage: "ai", message: e.message } });
      result.errors.push({ leadId: lead.id, error: e.message });
      setLeadStatus(db, lead.id, "queued", now + nextOutboundDelay(rng));
      return "continue";
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
      return "ok";
    } catch (e) {
      const cls = classifyTelegramError(e);
      logEvent(db, { type: "ban_signal", campaign_id: campaign.id, lead_id: lead.id, payload: { ...cls, message: e.message } });
      result.errors.push({ leadId: lead.id, error: e.message, classified: cls });
      if (cls.kind === "ban" || cls.kind === "deactivated" || cls.kind === "privacy") {
        setLeadStatus(db, lead.id, "blocked");
        return "continue";
      } else if (cls.kind === "flood_wait" || cls.kind === "flood") {
        for (const c of runningCampaigns) setCampaignStatus(db, c.id, "paused");
        return "stop";
      } else {
        setLeadStatus(db, lead.id, "queued", now + nextOutboundDelay(rng));
        return "continue";
      }
    }
}

export async function processApprovedDrafts({ db, telegram, getTelegramFor, rng = Math.random }) {
  if (!getTelegramFor && telegram) getTelegramFor = () => telegram;
  const rows = db.prepare(`
    SELECT d.id as draft_id, d.status as draft_status, m.id as message_id, m.body, m.conversation_id, c.lead_id, c.campaign_id
    FROM drafts d
    JOIN messages m ON m.id = d.message_id
    JOIN conversations c ON c.id = m.conversation_id
    WHERE d.status IN ('approved', 'edited') AND m.status = 'pending_approval'
  `).all();

  for (const r of rows) {
    const lead = getLead(db, r.lead_id);
    const camp = db.prepare("SELECT session_id FROM campaigns WHERE id = ?").get(r.campaign_id);
    const tg = getTelegramFor(camp?.session_id);
    const peer = lead.tg_username || lead.tg_user_id;
    const typingMs = nextTypingDuration(rng);
    try {
      const tgMsgId = await tg.sendMessage({ peer, text: r.body, typingMs });
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
