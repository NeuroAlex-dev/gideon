import { runOutboundTick, processApprovedDrafts } from "./lib/outbound.js";
import { createInboundProcessor } from "./lib/inbound.js";
import { sendForceFollowup, autoFollowupSweep } from "./lib/followup.js";

export function createWorker({ db, telegram, askClaude, notifyAlexander = null, tickIntervalMs = 60_000, batchWindowMs = 25_000, forceCheckIntervalMs = 3_000, missedFetchIntervalMs = 5 * 60_000, autoFollowupIntervalMs = 15 * 60_000 }) {
  let timer = null;
  let forceTimer = null;
  let missedTimer = null;
  let followupTimer = null;
  let lastForceEventId = 0;
  const processor = createInboundProcessor({ db, askClaude, telegram, notifyAlexander, batchWindowMs });

  async function start() {
    await telegram.connect();
    telegram.onNewMessage(async (event) => {
      const m = event.message;
      if (!m?.message) return;
      // Игнорируем исходящие от своего же аккаунта (наш AI их же шлёт)
      if (m.out) return;
      try {
        const sender = await m.getSender();
        const tgUserId = sender?.id ? Number(sender.id) : null;
        const tgUsername = sender?.username || null;
        const tgMessageId = m.id;
        console.log(`[worker] new TG message from id=${tgUserId} @${tgUsername || "—"}: "${m.message.slice(0, 60)}"`);
        await processor.onInbound({ tgUserId, tgUsername, text: m.message, tgMessageId });
      } catch (err) {
        console.error("inbound handler error:", err);
      }
    });
    // Изначально пропускаем все существующие force-события — реагируем только на новые
    const latest = db.prepare("SELECT MAX(id) as id FROM events WHERE type = 'force_send_request'").get();
    lastForceEventId = latest?.id || 0;
    timer = setInterval(() => { tick().catch((err) => console.error("tick error:", err)); }, tickIntervalMs);
    forceTimer = setInterval(() => { checkForceTriggers().catch((err) => console.error("force-tick error:", err)); }, forceCheckIntervalMs);
    // Периодический fetch-missed: защита от пропусков NewMessage event при gramjs reconnect-loop без рестарта процесса
    missedTimer = setInterval(() => { fetchMissedFromTelegram().catch((err) => console.error("periodic fetch-missed error:", err)); }, missedFetchIntervalMs);
    // Auto-followup: каждые 15 минут проверяем «молчунов» (AI отправил материалы, не сказал про складчину, прошло ≥15 мин)
    followupTimer = setInterval(() => { autoFollowupSweep({ db, askClaude, telegram }).catch((err) => console.error("auto-followup error:", err)); }, autoFollowupIntervalMs);

    // Recovery: на старте обработать inbound-ы которые остались без ответа (после крэша/рестарта)
    recoverPendingInbound().catch((err) => console.error("recover error:", err));
    // Recovery 2: подтянуть из TG сообщения которые могли быть пропущены пока worker был offline/reconnecting
    fetchMissedFromTelegram().catch((err) => console.error("fetch-missed error:", err));
  }

  async function fetchMissedFromTelegram() {
    if (!telegram.getRecentMessages) return;
    const activeLeads = db.prepare(`
      SELECT l.id, l.tg_user_id, l.tg_username, l.status, c.id as campaign_id, c.name as campaign_name
      FROM leads l
      JOIN campaigns c ON c.id = l.campaign_id
      WHERE c.status = 'running'
        AND l.status NOT IN ('queued','unsubscribed','blocked','human_takeover','lost','won')
    `).all();
    if (!activeLeads.length) return;
    console.log(`[worker] fetch-missed: проверяю ${activeLeads.length} активных лидов на пропущенные входящие из TG`);
    for (const lead of activeLeads) {
      const peer = lead.tg_username || lead.tg_user_id;
      if (!peer) continue;
      try {
        // Берём timestamp нашего последнего ИСХОДЯЩЕГО — пропускать всё что было раньше или равно ему
        const conv = db.prepare("SELECT id FROM conversations WHERE lead_id = ? AND campaign_id = ?").get(lead.id, lead.campaign_id);
        if (!conv) continue;
        const lastOut = db.prepare("SELECT MAX(sent_at) as ts FROM messages WHERE conversation_id = ? AND role = 'outbound' AND status = 'sent'").get(conv.id);
        const cutoff = lastOut?.ts || 0;
        const tgMsgs = await telegram.getRecentMessages(peer, 15);
        const known = new Set(
          db.prepare("SELECT tg_message_id FROM messages WHERE conversation_id = ? AND tg_message_id IS NOT NULL").all(conv.id).map((r) => r.tg_message_id)
        );
        // Только входящие СТРОГО ПОСЛЕ нашего последнего исходящего (старый диалог — мимо, мы уже ответили)
        // tgMsgs идут от новых к старым — реверсим для хронологического порядка
        const missing = tgMsgs
          .filter((m) => !m.out && m.text && !known.has(m.id) && m.date && m.date > cutoff)
          .reverse();
        if (missing.length) {
          console.log(`[worker] fetch-missed: лид ${lead.id} (@${lead.tg_username}) — пропущено ${missing.length} новых входящих (после ${new Date(cutoff).toISOString()})`);
          for (const m of missing) {
            await processor.onInbound({ tgUserId: lead.tg_user_id, tgUsername: lead.tg_username, text: m.text, tgMessageId: m.id });
          }
        }
      } catch (e) {
        console.warn(`[worker] fetch-missed для лида ${lead.id}: ${e.message}`);
      }
    }
  }

  async function recoverPendingInbound() {
    const orphans = db.prepare(`
      SELECT m.id, m.conversation_id, m.body, m.received_at, c.lead_id, c.campaign_id, l.tg_user_id, l.tg_username
      FROM messages m
      JOIN conversations c ON c.id = m.conversation_id
      JOIN leads l ON l.id = c.lead_id
      JOIN campaigns camp ON camp.id = c.campaign_id
      WHERE m.role = 'inbound'
        AND camp.status = 'running'
        AND l.status NOT IN ('unsubscribed','blocked','human_takeover')
        AND NOT EXISTS (
          SELECT 1 FROM messages m2
          WHERE m2.conversation_id = m.conversation_id
            AND m2.id > m.id
            AND m2.role IN ('outbound','human_takeover')
        )
        AND m.received_at > ?
      ORDER BY m.id ASC
    `).all(Date.now() - 24 * 3600_000);
    if (!orphans.length) return;
    console.log(`[worker] recovery: ${orphans.length} unanswered inbound message(s), processing...`);
    for (const o of orphans) {
      try {
        await processor.onInbound({ tgUserId: o.tg_user_id, tgUsername: o.tg_username, text: o.body, tgMessageId: null, skipPersist: true });
      } catch (err) {
        console.error("[worker] recovery error for message", o.id, err);
      }
    }
  }

  async function checkForceTriggers() {
    const rows = db.prepare("SELECT id, type, campaign_id, lead_id FROM events WHERE type IN ('force_send_request','force_followup_request') AND id > ? ORDER BY id ASC").all(lastForceEventId);
    if (!rows.length) return;
    for (const row of rows) {
      lastForceEventId = row.id;
      if (row.type === "force_send_request") {
        console.log(`[worker] force-send request for campaign ${row.campaign_id}`);
        try {
          await runOutboundTick({ db, askClaude, telegram, force: true, campaignFilter: row.campaign_id });
        } catch (err) {
          console.error(`[worker] force-send failed for campaign ${row.campaign_id}:`, err);
        }
      } else if (row.type === "force_followup_request") {
        console.log(`[worker] force-followup for lead ${row.lead_id}`);
        try {
          await sendForceFollowup({ db, askClaude, telegram, leadId: row.lead_id });
        } catch (err) {
          console.error(`[worker] force-followup failed for lead ${row.lead_id}:`, err);
        }
      }
    }
  }

  async function tick(now = Date.now()) {
    const out = await runOutboundTick({ db, askClaude, telegram, now });
    if (notifyAlexander) {
      for (const e of out.errors || []) {
        if (e.classified?.kind === "flood_wait" || e.classified?.kind === "flood") {
          await notifyAlexander({ kind: "auto_paused", payload: { reason: `${e.classified.kind}${e.classified.waitSec ? " " + e.classified.waitSec + "s" : ""}` } });
          break;
        }
      }
    }
    await processApprovedDrafts({ db, telegram });
  }

  async function runTickNow(now = Date.now()) {
    await tick(now);
  }

  async function stop() {
    if (timer) clearInterval(timer);
    if (forceTimer) clearInterval(forceTimer);
    if (missedTimer) clearInterval(missedTimer);
    if (followupTimer) clearInterval(followupTimer);
    timer = null;
    forceTimer = null;
    missedTimer = null;
    followupTimer = null;
    await telegram.disconnect();
  }

  return { start, stop, tick, runTickNow, checkForceTriggers };
}

