import { runOutboundTick, processApprovedDrafts } from "./lib/outbound.js";
import { createInboundProcessor } from "./lib/inbound.js";

export function createWorker({ db, telegram, askClaude, notifyAlexander = null, tickIntervalMs = 60_000, batchWindowMs = 60_000 }) {
  let timer = null;
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
    timer = setInterval(() => { tick().catch((err) => console.error("tick error:", err)); }, tickIntervalMs);
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
    timer = null;
    await telegram.disconnect();
  }

  return { start, stop, tick, runTickNow };
}

