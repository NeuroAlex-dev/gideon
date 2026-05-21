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
      try {
        const sender = await m.getSender();
        const tgUserId = sender?.id ? Number(sender.id) : null;
        const tgUsername = sender?.username || null;
        const tgMessageId = m.id;
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

