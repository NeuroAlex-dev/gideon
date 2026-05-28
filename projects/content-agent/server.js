import express from "express";
import { authMiddleware, makeToken } from "./lib/auth.js";
import {
  getSetting, setSetting,
  createInterview, getInterview, getActiveInterview,
  addInterviewAnswer, addInterviewMaterial, finishInterview,
  createPost, getPost, updatePostDraft, setPostStatus,
  addSource, listSources, getSource, updateSourceKeywords, removeSource,
  addKeyword, listKeywords, removeKeyword,
  createDigest, addDigestItems, getDigest, listDigestItems, getDigestItem, setDigestRendered, saveDigest,
} from "./lib/db.js";
import { INTERVIEW_QUESTIONS, buildCorpus, generateStyleProfile, STYLE_DOCS } from "./lib/style.js";
import { loadStyleProfile, generatePost } from "./lib/writer.js";
import { extractiveSummary, sortByEngagement, reshapeDigest, aiSummarize } from "./lib/digest.js";
import { fetchFromChannels, periodToSinceTs } from "./lib/sources/telegram.js";
import { fetchVkWall, validateVkToken } from "./lib/sources/vk.js";
import { fetchYouTubeChannel, validateYtKey } from "./lib/sources/youtube.js";
import { fetchGoogleTrends } from "./lib/trends/google-trends.js";
import { fetchRedditTrends } from "./lib/trends/reddit.js";
import { expandNiche } from "./lib/trends/keyword-expander.js";

const SETTING_KEYS = ["vk_token", "publish_targets"];

export function createServer({ db, password, secret, styleDir, runner, model, tgFetch, vkFetch, ytFetch, vkValidate, ytValidate, gtFetch, redditFetch }) {
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  const doTgFetch = tgFetch || (({ channels, sinceTs, keywords }) => fetchFromChannels({ channels, sinceTs, keywords }));
  const doVkFetch = vkFetch || (async ({ refs, token, sinceTs }) => {
    const out = [];
    for (const ref of refs) {
      try { out.push(...await fetchVkWall({ screenName: ref, token, sinceTs })); }
      catch (e) { out.push({ platform: "vk", source_ref: ref, error: e.message }); }
    }
    return out;
  });
  const doYtFetch = ytFetch || (async ({ refs, apiKey, sinceTs }) => {
    const out = [];
    for (const ref of refs) {
      try { out.push(...await fetchYouTubeChannel({ ref, apiKey, sinceTs })); }
      catch (e) { out.push({ platform: "youtube", source_ref: ref, error: e.message }); }
    }
    return out;
  });
  const doVkValidate = vkValidate || validateVkToken;
  const doYtValidate = ytValidate || validateYtKey;
  const doGtFetch = gtFetch || (({ niche, period, geo }) => fetchGoogleTrends({ niche, period, geo }));
  const doRedditFetch = redditFetch || (({ niche, period, limit }) => fetchRedditTrends({ niche, period, limit }));

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
  app.use("/api/sources", auth);
  app.use("/api/keywords", auth);
  app.use("/api/search", auth);
  app.use("/api/digests", auth);
  app.use("/api/trends", auth);

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
    const origin = req.body?.origin === "digest_item" ? "digest_item" : "prompt";
    let userPrompt;
    if (origin === "digest_item") {
      const item = getDigestItem(db, Number(req.body?.digest_item_id));
      if (!item) return res.status(404).json({ error: "digest_item не найден" });
      userPrompt = `Сделай рерайт этой новости в моём стиле как авторский пост (не копируй дословно, добавь свой экспертный взгляд).\n\nЗаголовок: ${item.title}\nТекст: ${item.raw_text}\nИсточник: ${item.url || "—"}`;
    } else {
      userPrompt = String(req.body?.user_prompt || "").trim();
      if (!userPrompt) return res.status(400).json({ error: "user_prompt required" });
    }
    const id = createPost(db, { origin, user_prompt: userPrompt });
    try {
      const styleText = loadStyleProfile(styleDir).text;
      const text = await generatePost({ styleText, userPrompt, runner, model });
      updatePostDraft(db, id, text);
      res.status(201).json({ id, draft_text: text });
    } catch (e) {
      res.status(500).json({ error: String(e.message), id });
    }
  });

  // ── Источники ──────────────────────────────────────────
  app.get("/api/sources", (req, res) => res.json(listSources(db, { platform: req.query.platform || null })));
  app.post("/api/sources", (req, res) => {
    const { platform, ref, title, keywords } = req.body || {};
    if (!platform || !ref) return res.status(400).json({ error: "platform и ref обязательны" });
    const id = addSource(db, { platform, ref, title: title || null, keywords: Array.isArray(keywords) ? keywords : null });
    res.status(201).json(getSource(db, id));
  });
  app.put("/api/sources/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!getSource(db, id)) return res.status(404).json({ error: "not found" });
    if (req.body && Array.isArray(req.body.keywords) || req.body?.keywords === null) {
      updateSourceKeywords(db, id, req.body.keywords);
    }
    res.json(getSource(db, id));
  });
  app.delete("/api/sources/:id", (req, res) => {
    removeSource(db, Number(req.params.id));
    res.json({ ok: true });
  });

  // ── Ключевики ──────────────────────────────────────────
  app.get("/api/keywords", (_req, res) => res.json(listKeywords(db)));
  app.post("/api/keywords", (req, res) => {
    const term = String(req.body?.term || "").trim();
    const scope = req.body?.scope === "exclude" ? "exclude" : "include";
    if (!term) return res.status(400).json({ error: "term обязателен" });
    const id = addKeyword(db, { term, scope });
    res.status(201).json({ id, term, scope });
  });
  app.delete("/api/keywords/:id", (req, res) => {
    removeKeyword(db, Number(req.params.id));
    res.json({ ok: true });
  });

  // ── Поиск → дайджест ───────────────────────────────────
  app.post("/api/search", async (req, res) => {
    const period = req.body?.period || "week";
    const adHoc = Array.isArray(req.body?.keywords) ? req.body.keywords : [];
    try {
      const saved = listKeywords(db);
      const include = [...adHoc, ...saved.filter((k) => k.scope === "include").map((k) => k.term)];
      const exclude = saved.filter((k) => k.scope === "exclude").map((k) => k.term);
      const sinceTs = periodToSinceTs(period);
      const platformsUsed = [];
      let items = [];

      // Карта per-source ключевиков (по source_ref для фильтра постов)
      const tgSources = listSources(db, { platform: "telegram" });
      const vkSources = listSources(db, { platform: "vk" });
      const perSourceKw = new Map();
      for (const s of [...tgSources, ...vkSources]) {
        perSourceKw.set(s.ref, Array.isArray(s.keywords) ? s.keywords : []);
      }
      const filterItem = (item) => {
        const srcKw = perSourceKw.get(item.source_ref) || [];
        // Глобальный фильтр (include/exclude) + источник-специфичный (срабатывает только если у источника заданы свои)
        if (!matchesText(item, include, exclude)) return false;
        if (srcKw.length && !matchesText(item, srcKw, [])) return false;
        return true;
      };

      // Telegram (фильтрация целиком на сервере, чтобы поддержать per-source)
      if (tgSources.length) {
        platformsUsed.push("telegram");
        const fetched = await doTgFetch({ channels: tgSources.map((s) => s.ref), sinceTs });
        items.push(...fetched.filter((x) => !x.error && filterItem(x)));
      }

      // VK
      const vkToken = getSetting(db, "vk_token");
      if (vkSources.length && vkToken) {
        platformsUsed.push("vk");
        const fetched = await doVkFetch({ refs: vkSources.map((s) => s.ref), token: vkToken, sinceTs });
        items.push(...fetched.filter((x) => !x.error && filterItem(x)));
      }

      items = sortByEngagement(items).slice(0, 20);
      // AI-саммари одной пачкой; при любой ошибке — fallback на extractive,
      // чтобы поиск всегда возвращал дайджест, даже если Claude капризничает.
      let summaries = null;
      try {
        summaries = await aiSummarize({ items, runner, model });
      } catch (e) {
        console.warn("[search] aiSummarize fallback to extractive:", e.message);
      }
      items.forEach((it, i) => {
        it.summary = (summaries && summaries[i]) ? summaries[i] : extractiveSummary(it.text);
      });

      const digestId = createDigest(db, { period, keywords: include, platforms: platformsUsed });
      addDigestItems(db, digestId, items);
      const stored = listDigestItems(db, digestId);
      res.status(201).json({ digest_id: digestId, count: stored.length, items: stored.map(mapItem) });
    } catch (e) {
      res.status(500).json({ error: String(e.message) });
    }
  });

  app.get("/api/digests/:id", (req, res) => {
    const d = getDigest(db, Number(req.params.id));
    if (!d) return res.status(404).json({ error: "not found" });
    res.json({ ...d, items: listDigestItems(db, d.id).map(mapItem) });
  });

  app.post("/api/digests/:id/reshape", async (req, res) => {
    const d = getDigest(db, Number(req.params.id));
    if (!d) return res.status(404).json({ error: "not found" });
    const mode = req.body?.mode === "detailed" ? "detailed" : "shorter";
    try {
      const base = d.rendered_text || renderDigestText(d, listDigestItems(db, d.id));
      const text = await reshapeDigest({ currentText: base, mode, runner, model });
      setDigestRendered(db, d.id, text);
      res.json({ digest_id: d.id, rendered_text: text });
    } catch (e) {
      res.status(500).json({ error: String(e.message) });
    }
  });

  app.post("/api/digests/:id/save", (req, res) => {
    if (!getDigest(db, Number(req.params.id))) return res.status(404).json({ error: "not found" });
    saveDigest(db, Number(req.params.id));
    res.json({ ok: true });
  });

  // ── Поиск по трендам (бесплатно: Google Trends + Reddit) ──
  app.post("/api/trends", async (req, res) => {
    const niche = String(req.body?.niche || "").trim();
    if (!niche) return res.status(400).json({ error: "niche обязателен" });
    const period = req.body?.period || "week";
    const sources = Array.isArray(req.body?.sources) && req.body.sources.length
      ? req.body.sources
      : ["google_trends", "reddit"];
    const geo = String(req.body?.geo || "RU");
    try {
      const errors = [];
      // AI разворачивает узкую нишу в 6-8 коротких запросов — GT работает только с такими.
      const terms = await expandNiche({ niche, runner, model });
      let items = [];
      const seenUrls = new Set();
      if (sources.includes("google_trends")) {
        for (const term of terms) {
          try {
            const fetched = await doGtFetch({ niche: term, period, geo });
            for (const it of fetched) {
              if (it.url && seenUrls.has(it.url)) continue;
              if (it.url) seenUrls.add(it.url);
              items.push(it);
            }
          } catch (e) {
            errors.push({ source: "google_trends", term, error: e.message });
          }
        }
      }
      if (sources.includes("reddit")) {
        for (const term of terms) {
          try {
            const fetched = await doRedditFetch({ niche: term, period, limit: 25 });
            for (const it of fetched) {
              if (it.url && seenUrls.has(it.url)) continue;
              if (it.url) seenUrls.add(it.url);
              items.push(it);
            }
          } catch (e) {
            errors.push({ source: "reddit", term, error: e.message });
            break; // на Reddit anti-bot нет смысла повторять для каждого term
          }
        }
      }
      items = sortByEngagement(items).slice(0, 20);
      // AI-саммари (с fallback на текст коннектора — он у нас уже структурирован)
      let summaries = null;
      try {
        summaries = await aiSummarize({ items, runner, model });
      } catch (e) {
        console.warn("[trends] aiSummarize fallback:", e.message);
      }
      items.forEach((it, i) => {
        it.summary = (summaries && summaries[i]) ? summaries[i] : extractiveSummary(it.text);
      });
      const digestId = createDigest(db, { period, keywords: terms, platforms: sources });
      addDigestItems(db, digestId, items);
      const stored = listDigestItems(db, digestId);
      res.status(201).json({ digest_id: digestId, count: stored.length, items: stored.map(mapItem), terms, errors });
    } catch (e) {
      res.status(500).json({ error: String(e.message) });
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

  app.put("/api/settings", async (req, res) => {
    const { key, value } = req.body || {};
    if (!SETTING_KEYS.includes(key)) return res.status(400).json({ error: "unknown key" });
    const v = String(value ?? "");
    if (v) {
      if (key === "vk_token") {
        const ok = await doVkValidate(v);
        if (!ok) return res.status(400).json({ error: "VK токен не работает (проверь scope=wall и валидность)" });
      }
      if (key === "youtube_api_key") {
        const ok = await doYtValidate(v);
        if (!ok) return res.status(400).json({ error: "YouTube API ключ не работает (проверь, что YouTube Data API v3 включён в проекте)" });
      }
    }
    setSetting(db, key, v);
    res.json({ ok: true });
  });

  return app;
}

function matchesText(item, include, exclude) {
  const t = ((item.title || "") + " " + (item.text || "")).toLowerCase();
  for (const ex of exclude) if (ex && t.includes(String(ex).toLowerCase())) return false;
  if (!include.length) return true;
  return include.some((k) => k && t.includes(String(k).toLowerCase()));
}

function mapItem(row) {
  let metrics = {};
  try { metrics = JSON.parse(row.metrics_json || "{}"); } catch {}
  return {
    id: row.id, platform: row.platform, url: row.url, title: row.title,
    summary: row.summary, metrics, source_ref: row.source_ref,
  };
}

export function renderDigestText(digest, items) {
  const lines = [`📰 Дайджест (${items.length} новостей)`, ""];
  let n = 1;
  for (const it of items) {
    let m = {}; try { m = JSON.parse(it.metrics_json || "{}"); } catch {}
    lines.push(`${n}. ${it.title}`);
    if (it.summary) lines.push(it.summary);
    lines.push(`👁 ${m.views || 0} · ❤️ ${m.reactions || 0} · 💬 ${m.comments || 0} · 🔁 ${m.forwards || 0}`);
    if (it.url) lines.push(it.url);
    lines.push("");
    n++;
  }
  return lines.join("\n");
}
