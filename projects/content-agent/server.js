import express from "express";
import { authMiddleware, makeToken } from "./lib/auth.js";
import {
  getSetting, setSetting,
  createInterview, getInterview, getActiveInterview,
  addInterviewAnswer, addInterviewMaterial, finishInterview,
  createPost, getPost, updatePostDraft, setPostStatus,
} from "./lib/db.js";
import { INTERVIEW_QUESTIONS, buildCorpus, generateStyleProfile, STYLE_DOCS } from "./lib/style.js";
import { loadStyleProfile, generatePost } from "./lib/writer.js";

const SETTING_KEYS = ["vk_token", "youtube_api_key", "publish_targets"];

export function createServer({ db, password, secret, styleDir, runner, model }) {
  const app = express();
  app.use(express.json({ limit: "5mb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.post("/api/auth", (req, res) => {
    if (String(req.body?.password || "") === password) {
      return res.json({ token: makeToken(secret, password) });
    }
    return res.status(401).json({ error: "wrong password" });
  });

  const auth = authMiddleware({ password, secret });
  app.use("/api/style", auth);
  app.use("/api/posts", auth);
  app.use("/api/settings", auth);

  // ── Стиль ──────────────────────────────────────────────
  app.get("/api/style/status", (_req, res) => {
    const profile = loadStyleProfile(styleDir);
    const active = getActiveInterview(db);
    res.json({
      present: profile.present,
      files: STYLE_DOCS.map((d) => d.filename),
      interview_active: active ? active.id : null,
      interview_step: active ? active.step : 0,
    });
  });

  app.post("/api/style/interview/start", (_req, res) => {
    const id = createInterview(db);
    res.json({ id, step: 0, total: INTERVIEW_QUESTIONS.length, question: INTERVIEW_QUESTIONS[0] });
  });

  app.post("/api/style/interview/answer", (req, res) => {
    const iv = getActiveInterview(db);
    if (!iv) return res.status(404).json({ error: "нет активного интервью" });
    const transcript = String(req.body?.transcript || "").trim();
    if (!transcript) return res.status(400).json({ error: "transcript required" });
    const question = INTERVIEW_QUESTIONS[iv.step];
    const count = addInterviewAnswer(db, iv.id, question, transcript);
    if (count < INTERVIEW_QUESTIONS.length) {
      return res.json({ step: count, total: INTERVIEW_QUESTIONS.length, question: INTERVIEW_QUESTIONS[count] });
    }
    res.json({ questions_done: true });
  });

  app.post("/api/style/interview/material", (req, res) => {
    const iv = getActiveInterview(db);
    if (!iv) return res.status(404).json({ error: "нет активного интервью" });
    const type = String(req.body?.type || "text");
    const text = String(req.body?.text || "").trim();
    if (!text) return res.status(400).json({ error: "text required" });
    const count = addInterviewMaterial(db, iv.id, type, text);
    res.json({ materials: count });
  });

  app.post("/api/style/interview/finish", async (req, res) => {
    const iv = getActiveInterview(db);
    if (!iv) return res.status(404).json({ error: "нет активного интервью" });
    try {
      const corpus = buildCorpus({
        answers: JSON.parse(iv.answers_json),
        materials: JSON.parse(iv.materials_json),
      });
      const files = await generateStyleProfile({ corpus, styleDir, runner, model });
      finishInterview(db, iv.id);
      res.json({ files });
    } catch (e) {
      res.status(500).json({ error: String(e.message) });
    }
  });

  app.post("/api/style/retrain", (_req, res) => {
    const id = createInterview(db);
    res.json({ id, step: 0, total: INTERVIEW_QUESTIONS.length, question: INTERVIEW_QUESTIONS[0] });
  });

  // ── Посты ──────────────────────────────────────────────
  app.post("/api/posts", async (req, res) => {
    const userPrompt = String(req.body?.user_prompt || "").trim();
    if (!userPrompt) return res.status(400).json({ error: "user_prompt required" });
    const id = createPost(db, { origin: "prompt", user_prompt: userPrompt });
    try {
      const styleText = loadStyleProfile(styleDir).text;
      const text = await generatePost({ styleText, userPrompt, runner, model });
      updatePostDraft(db, id, text);
      res.status(201).json({ id, draft_text: text });
    } catch (e) {
      res.status(500).json({ error: String(e.message), id });
    }
  });

  app.post("/api/posts/:id/variant", async (req, res) => {
    const id = Number(req.params.id);
    const post = getPost(db, id);
    if (!post) return res.status(404).json({ error: "not found" });
    const mode = String(req.body?.mode || "rewrite");
    try {
      const styleText = loadStyleProfile(styleDir).text;
      const text = await generatePost({ styleText, userPrompt: post.user_prompt, variantMode: mode, runner, model });
      updatePostDraft(db, id, text);
      res.json({ id, draft_text: text });
    } catch (e) {
      res.status(500).json({ error: String(e.message) });
    }
  });

  app.get("/api/posts/:id", (req, res) => {
    const post = getPost(db, Number(req.params.id));
    if (!post) return res.status(404).json({ error: "not found" });
    res.json(post);
  });

  app.post("/api/posts/:id/approve", (req, res) => {
    const id = Number(req.params.id);
    if (!getPost(db, id)) return res.status(404).json({ error: "not found" });
    setPostStatus(db, id, "approved");
    res.json({ ok: true, id });
  });

  // ── Настройки ──────────────────────────────────────────
  app.get("/api/settings", (_req, res) => {
    const out = {};
    for (const k of SETTING_KEYS) out[k] = getSetting(db, k);
    res.json(out);
  });

  app.put("/api/settings", (req, res) => {
    const { key, value } = req.body || {};
    if (!SETTING_KEYS.includes(key)) return res.status(400).json({ error: "unknown key" });
    setSetting(db, key, String(value ?? ""));
    res.json({ ok: true });
  });

  return app;
}
