import express from "express";
import { authMiddleware, makeToken } from "./lib/auth.js";
import {
  listCampaigns, getCampaign, createCampaign, updateCampaign, setCampaignStatus,
  addLeads, listLeads, campaignStats, getDraft, resolveDraft,
  getOrCreateConversation, listMessages, getLead, listEvents, logEvent,
  hardDeleteCampaign,
} from "./lib/db.js";
import { extractText } from "./lib/file-extractor.js";
import { isAttachmentSafe } from "./lib/telegram.js";
import { listAccounts } from "./lib/sessions-manager.js";

export function createServer({ db, password, secret }) {
  const app = express();
  app.use(express.json({ limit: "5mb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.get("/api/accounts", authMiddleware({ secret, password }), (_req, res) => {
    res.json(listAccounts());
  });

  app.post("/api/extract", authMiddleware({ secret, password }), async (req, res) => {
    const filePath = req.body?.path;
    if (!filePath) return res.status(400).json({ error: "path required" });
    if (!isAttachmentSafe(filePath)) return res.status(400).json({ error: "path вне data/materials/ или файл не найден" });
    const result = await extractText(filePath);
    res.json(result);
  });

  app.post("/api/auth", (req, res) => {
    if (req.body?.password !== password) return res.status(401).json({ error: "bad password" });
    res.json({ token: makeToken(secret, password) });
  });

  const auth = authMiddleware({ secret, password });
  app.use("/api/campaigns", auth);
  app.use("/api/leads", auth);
  app.use("/api/drafts", auth);
  app.use("/api/conversations", auth);
  app.use("/api/events", auth);

  app.get("/api/campaigns", (req, res) => {
    const includeArchived = req.query.includeArchived === "1";
    res.json(listCampaigns(db, { includeArchived }));
  });

  app.get("/api/campaigns/:id", (req, res) => {
    const c = getCampaign(db, Number(req.params.id));
    if (!c) return res.status(404).json({ error: "not found" });
    res.json(c);
  });

  app.post("/api/campaigns", (req, res) => {
    const id = createCampaign(db, req.body || {});
    res.status(201).json(getCampaign(db, id));
  });

  app.put("/api/campaigns/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!getCampaign(db, id)) return res.status(404).json({ error: "not found" });
    updateCampaign(db, id, req.body || {});
    res.json(getCampaign(db, id));
  });

  app.delete("/api/campaigns/:id", (req, res) => {
    const id = Number(req.params.id);
    const c = getCampaign(db, id);
    if (!c) return res.status(404).json({ error: "not found" });
    if (req.query.hard === "1") {
      const changes = hardDeleteCampaign(db, id);
      return res.json({ ok: true, deleted: changes, name: c.name });
    }
    setCampaignStatus(db, id, "archived");
    res.status(204).end();
  });

  app.post("/api/campaigns/:id/leads", (req, res) => {
    const id = Number(req.params.id);
    const leads = (req.body?.leads || []);
    if (!Array.isArray(leads)) return res.status(400).json({ error: "leads must be array" });
    const inserted = addLeads(db, id, leads);
    res.json({ inserted, total: listLeads(db, id).length });
  });

  app.get("/api/campaigns/:id/leads", (req, res) => {
    res.json(listLeads(db, Number(req.params.id), { status: req.query.status || null }));
  });

  app.post("/api/campaigns/:id/start", (req, res) => {
    const id = Number(req.params.id);
    if (!getCampaign(db, id)) return res.status(404).json({ error: "not found" });
    setCampaignStatus(db, id, "running");
    res.json(getCampaign(db, id));
  });

  app.post("/api/campaigns/:id/pause", (req, res) => {
    const id = Number(req.params.id);
    if (!getCampaign(db, id)) return res.status(404).json({ error: "not found" });
    setCampaignStatus(db, id, "paused");
    res.json(getCampaign(db, id));
  });

  app.get("/api/campaigns/:id/stats", (req, res) => {
    res.json(campaignStats(db, Number(req.params.id)));
  });

  app.post("/api/conversations/:lead_id/force-followup", (req, res) => {
    const leadId = Number(req.params.lead_id);
    const lead = getLead(db, leadId);
    if (!lead) return res.status(404).json({ error: "lead not found" });
    const conv = db.prepare("SELECT * FROM conversations WHERE lead_id = ?").get(leadId);
    if (!conv) return res.status(404).json({ error: "no conversation" });
    logEvent(db, { type: "force_followup_request", campaign_id: conv.campaign_id, lead_id: leadId });
    res.json({ ok: true, message: "worker подхватит в течение 3 секунд" });
  });

  app.post("/api/campaigns/:id/send-now", (req, res) => {
    const id = Number(req.params.id);
    const c = getCampaign(db, id);
    if (!c) return res.status(404).json({ error: "not found" });
    if (c.status !== "running") return res.status(409).json({ error: `кампания не в статусе running (сейчас ${c.status})` });
    // Снимаем next_action_at чтобы лиды стали "доступны сейчас"
    db.prepare("UPDATE leads SET next_action_at = 0 WHERE campaign_id = ? AND status = 'queued'").run(id);
    const all = req.query.all === "1" || req.body?.all === true;
    logEvent(db, { type: "force_send_request", campaign_id: id, payload: { processAll: all } });
    res.json({ ok: true, message: "worker подхватит в течение 3 секунд", processAll: all });
  });

  app.post("/api/drafts/:id/approve", (req, res) => {
    const id = Number(req.params.id);
    const draft = getDraft(db, id);
    if (!draft) return res.status(404).json({ error: "not found" });
    resolveDraft(db, id, "approved");
    res.json({ ok: true, draftId: id, messageId: draft.message_id });
  });

  app.post("/api/drafts/:id/reject", (req, res) => {
    const id = Number(req.params.id);
    const draft = getDraft(db, id);
    if (!draft) return res.status(404).json({ error: "not found" });
    resolveDraft(db, id, "rejected");
    res.json({ ok: true });
  });

  app.post("/api/drafts/:id/edit", (req, res) => {
    const id = Number(req.params.id);
    const draft = getDraft(db, id);
    if (!draft) return res.status(404).json({ error: "not found" });
    const newText = String(req.body?.text || "").trim();
    if (!newText) return res.status(400).json({ error: "text required" });
    resolveDraft(db, id, "edited", newText);
    db.prepare("UPDATE messages SET body = ? WHERE id = ?").run(newText, draft.message_id);
    res.json({ ok: true });
  });

  app.get("/api/conversations/:lead_id", (req, res) => {
    const leadId = Number(req.params.lead_id);
    const lead = getLead(db, leadId);
    if (!lead) return res.status(404).json({ error: "not found" });
    const conv = db.prepare("SELECT * FROM conversations WHERE lead_id = ?").get(leadId);
    const messages = conv ? listMessages(db, conv.id) : [];
    res.json({ lead, conversation: conv, messages });
  });

  app.get("/api/events", (req, res) => {
    res.json(listEvents(db, { campaignId: req.query.campaign_id ? Number(req.query.campaign_id) : null }));
  });

  return app;
}

