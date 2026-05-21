import { runOutboundTick, processApprovedDrafts } from "./lib/outbound.js";
import { createInboundProcessor } from "./lib/inbound.js";

export function createWorker({ db, telegram, askClaude, notifyAlexander = null, tickIntervalMs = 60_000, batchWindowMs = 60_000, forceCheckIntervalMs = 3_000 }) {
  let timer = null;
  let forceTimer = null;
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

    // Recovery: на старте обработать inbound-ы которые остались без ответа (после крэша/рестарта)
    recoverPendingInbound().catch((err) => console.error("recover error:", err));
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
    const rows = db.prepare("SELECT id, campaign_id FROM events WHERE type = 'force_send_request' AND id > ? ORDER BY id ASC").all(lastForceEventId);
    if (!rows.length) return;
    for (const row of rows) {
      lastForceEventId = row.id;
      console.log(`[worker] force-send request for campaign ${row.campaign_id}`);
      try {
        await runOutboundTick({ db, askClaude, telegram, force: true, campaignFilter: row.campaign_id });
      } catch (err) {
        console.error(`[worker] force-send failed for campaign ${row.campaign_id}:`, err);
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
    timer = null;
    forceTimer = null;
    await telegram.disconnect();
  }

  return { start, stop, tick, runTickNow, checkForceTriggers };
}

