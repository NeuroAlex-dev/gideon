import express from "express";
import { authMiddleware, makeToken } from "./lib/auth.js";
import {
  listCampaigns, getCampaign, createCampaign, updateCampaign, setCampaignStatus,
  addLeads, listLeads, campaignStats, getDraft, resolveDraft,
  getOrCreateConversation, listMessages, getLead, listEvents,
} from "./lib/db.js";

export function createServer({ db, password, secret }) {
  const app = express();
  app.use(express.json({ limit: "5mb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

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
    if (!getCampaign(db, id)) return res.status(404).json({ error: "not found" });
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const dotenv = await import("dotenv");
  dotenv.config();
  const { openDb } = await import("./lib/db.js");
  const db = openDb(process.env.SM_DB_PATH || "./data/sales-manager.db");
  const password = process.env.SM_PASSWORD || "change-me";
  const secret = process.env.SM_SECRET || "change-me-secret";
  const port = Number(process.env.SM_PORT || 3001);
  const app = createServer({ db, password, secret });
  app.listen(port, () => console.log(`sales-manager server on :${port}`));
}
