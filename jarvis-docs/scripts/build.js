#!/usr/bin/env node
// Generates the jarvis-docs static site from the original HTML export
// in ../jarvis-website/jarvis/ into ./public/.

const fs = require('fs');
const path = require('path');
const { renderHome, renderSection, renderArticle } = require('./templates');

const SOURCE_DIR = path.join(__dirname, '..', '..', 'jarvis-website', 'jarvis');
const OUT_DIR = path.join(__dirname, '..', 'public');

// Section metadata (id → display config). Order matters: nav + home use it.
const SECTIONS = [
  { id: 'start',           navLabel: 'Старт',          title: 'С чего начать',           icon: '🚀', featured: true  },
  { id: 'architecture',    navLabel: 'Архитектура',    title: 'Как устроен Агент',        icon: '🧠' },
  { id: 'bot',             navLabel: 'Бот',            title: 'Бот в Telegram',           icon: '💬' },
  { id: 'memory',          navLabel: 'Память',         title: 'Память Агента',            icon: '📂' },
  { id: 'skills',          navLabel: 'Скиллы',         title: 'Команда специалистов',     icon: '🛠️' },
  { id: 'projects',        navLabel: 'Проекты',        title: 'Проекты и деплой',         icon: '📁', inMore: true },
  { id: 'mcp',             navLabel: 'MCP',            title: 'Интеграции через MCP',     icon: '🔌', inMore: true },
  { id: 'vscode',          navLabel: 'VS Code',        title: 'VS Code Tunnel',           icon: '🖥️', inMore: true },
  { id: 'monitoring',      navLabel: 'Мониторинг',     title: 'Мониторинг и тренды',      icon: '🔍', inMore: true },
  { id: 'security',        navLabel: 'Безопасность',   title: 'Безопасность',             icon: '🛡️', inMore: true },
  { id: 'troubleshooting', navLabel: 'Подводные камни', title: 'Подводные камни',         icon: '⚠️', inMore: true },
];
const SECTION_BY_ID = Object.fromEntries(SECTIONS.map(s => [s.id, s]));

// ---------- parsing helpers ----------

function readSource(file) {
  return fs.readFileSync(path.join(SOURCE_DIR, file), 'utf8');
}

function extractTitle(html) {
  const m = html.match(/<title>(.*?)<\/title>/s);
  if (!m) return null;
  return m[1].replace(/\s*·\s*База знаний\s*$/u, '').trim();
}

function extractBreadcrumb(html) {
  // <nav class="article-breadcrumb">...<a href="/docs/start">Старт</a>...
  const block = html.match(/<nav class="article-breadcrumb">([\s\S]*?)<\/nav>/);
  if (!block) return null;
  const links = [...block[1].matchAll(/<a href="(\/docs(?:\/([^"]+))?)"[^>]*>([^<]+)<\/a>/g)];
  // first link is /docs (root), second is the section
  const section = links[1];
  if (!section) return null;
  return { sectionId: section[2], sectionTitle: section[3].trim() };
}

function extractSiblings(html) {
  // <nav class="article-siblings">...<ul>...<li><a href="/docs/x/y">Title</a></li>...
  const block = html.match(/<nav class="article-siblings">([\s\S]*?)<\/nav>/);
  if (!block) return [];
  const out = [];
  const itemRe = /<li class="article-siblings__item[^"]*">([\s\S]*?)<\/li>/g;
  let m;
  while ((m = itemRe.exec(block[1]))) {
    const inner = m[1];
    const linkM = inner.match(/<a href="(\/docs\/([^"]+))">([^<]+)<\/a>/);
    if (linkM) {
      out.push({ url: linkM[1], pathTail: linkM[2], title: linkM[3].trim(), current: false });
    } else {
      const spanM = inner.match(/<span>([^<]+)<\/span>/);
      if (spanM) out.push({ url: null, pathTail: null, title: spanM[1].trim(), current: true });
    }
  }
  return out;
}

function extractPageMeta(html) {
  const m = html.match(/<div class="page-meta">([\s\S]*?)<\/div>/);
  return m ? m[1].trim() : null;
}

function extractMetaphor(html) {
  const m = html.match(/<aside class="metaphor">([\s\S]*?)<\/aside>/);
  return m ? m[1].trim() : null;
}

function extractArticleBody(html) {
  // Inside <article class="prose">...</article>: drop breadcrumb, h1, page-meta,
  // metaphor and siblings — leave just the article body.
  const art = html.match(/<article class="prose">([\s\S]*?)<\/article>/);
  if (!art) return '';
  let body = art[1];
  body = body.replace(/<nav class="article-breadcrumb">[\s\S]*?<\/nav>/, '');
  body = body.replace(/<h1>[\s\S]*?<\/h1>/, '');
  body = body.replace(/<div class="page-meta">[\s\S]*?<\/div>/, '');
  body = body.replace(/<aside class="metaphor">[\s\S]*?<\/aside>/, '');
  body = body.replace(/<nav class="article-siblings">[\s\S]*?<\/nav>/, '');
  return body.trim();
}

// Fix two known artefacts of the original markdown→HTML pipeline:
//  1) literal "<p>&lt;/div&gt;</p>" inserted where a </div> should close a card,
//  2) absolute /docs/... links — rewrite to root-relative for the new domain.
function cleanContent(html) {
  let out = html.replace(/<p>&lt;\/div&gt;<\/p>/g, '</div>');
  out = out.replace(/href="\/docs(\/[^"]*)?"/g, (_, tail) => `href="${tail || '/'}"`);
  out = out.replace(/href="\/docs"/g, 'href="/"');
  return out;
}

// ---------- main ----------

function loadAllArticles() {
  const files = fs.readdirSync(SOURCE_DIR).filter(f => f.endsWith('.html'));
  const articles = [];
  let homeFile = null;

  for (const file of files) {
    const html = readSource(file);
    const title = extractTitle(html);
    if (title === 'База знаний') { homeFile = file; continue; }
    const bc = extractBreadcrumb(html);
    articles.push({
      file,
      title,
      sectionId: bc ? bc.sectionId : null,
      sectionTitle: bc ? bc.sectionTitle : null,
      siblings: extractSiblings(html),
      pageMeta: extractPageMeta(html),
      metaphor: extractMetaphor(html),
      body: cleanContent(extractArticleBody(html)),
    });
  }

  // Resolve each article's slug by looking it up in others' siblings lists.
  const titleToUrl = new Map();
  for (const a of articles) {
    for (const sib of a.siblings) {
      if (sib.url) titleToUrl.set(sib.title, sib.url);
    }
  }
  for (const a of articles) {
    const url = titleToUrl.get(a.title);
    if (!url) {
      console.warn(`[warn] no URL resolved for: ${a.title}`);
      a.slug = null;
      a.url = null;
      continue;
    }
    // url like "/docs/start/welcome" → slug "welcome"
    const parts = url.replace(/^\/docs\//, '').split('/');
    a.slug = parts[parts.length - 1];
    a.url = url.replace(/^\/docs/, '') || '/'; // → "/start/welcome"
  }

  return { articles, homeFile };
}

function cleanGenerated() {
  // Remove generated section folders and the old root index.html / orphan slug files.
  // Preserve hand-written static assets (style.css, script.js, etc.).
  if (!fs.existsSync(OUT_DIR)) return;
  const sectionIds = new Set(SECTIONS.map(s => s.id));
  for (const entry of fs.readdirSync(OUT_DIR, { withFileTypes: true })) {
    const full = path.join(OUT_DIR, entry.name);
    if (entry.isDirectory()) {
      // Remove anything that looks like our content tree, leave node_modules etc. alone.
      // We err on the side of removing all subfolders (Glossary/FAQ live at root too).
      fs.rmSync(full, { recursive: true, force: true });
    } else if (entry.name === 'index.html') {
      fs.unlinkSync(full);
    } else if (entry.name.endsWith('.html')) {
      // Orphan html files from a previous build layout.
      fs.unlinkSync(full);
    }
  }
}

function build() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  cleanGenerated();

  const { articles } = loadAllArticles();

  // Group by sectionId
  const bySection = new Map();
  const orphans = [];
  for (const a of articles) {
    if (!a.sectionId || !SECTION_BY_ID[a.sectionId]) {
      orphans.push(a);
      continue;
    }
    if (!bySection.has(a.sectionId)) bySection.set(a.sectionId, []);
    bySection.get(a.sectionId).push(a);
  }

  // Sort articles within each section by their order in the first sibling list
  // we can find that contains them (any sibling list of that section preserves order).
  for (const [secId, list] of bySection) {
    // grab a sample siblings array from any article in this section
    const sample = list[0].siblings;
    if (sample && sample.length) {
      const orderByTitle = new Map(sample.map((s, i) => [s.title, i]));
      list.sort((a, b) => (orderByTitle.get(a.title) ?? 999) - (orderByTitle.get(b.title) ?? 999));
    }
  }

  // --- write articles ---
  let count = 0;
  for (const a of articles) {
    if (!a.url) continue;
    const section = SECTION_BY_ID[a.sectionId];
    const sectionArticles = bySection.get(a.sectionId) || [];
    const html = renderArticle({ article: a, section, sections: SECTIONS, sectionArticles });
    // Write as <slug>/index.html so the clean URL works on any static server.
    const outPath = path.join(OUT_DIR, a.url.replace(/^\//, ''), 'index.html');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html);
    count++;
  }

  // --- write section index pages ---
  for (const section of SECTIONS) {
    const list = bySection.get(section.id) || [];
    const html = renderSection({ section, sections: SECTIONS, articles: list });
    const outPath = path.join(OUT_DIR, section.id, 'index.html');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html);
  }

  // --- write home ---
  const startList = bySection.get('start') || [];
  const home = renderHome({ sections: SECTIONS, sectionCounts: SECTIONS.map(s => ({
    ...s, count: (bySection.get(s.id) || []).length,
  })), startArticles: startList });
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), home);

  // --- orphans (Glossary, FAQ — not in any nav section) ---
  for (const a of orphans) {
    if (!a.url) continue;
    const html = renderArticle({ article: a, section: null, sections: SECTIONS, sectionArticles: [] });
    const outPath = path.join(OUT_DIR, a.url.replace(/^\//, ''), 'index.html');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html);
  }

  console.log(`✓ wrote ${count} articles, ${SECTIONS.length} section indexes, 1 home`);
  console.log(`  orphans (rendered at root): ${orphans.map(o => o.title).join(', ') || 'none'}`);
  console.log('\nSection breakdown:');
  for (const s of SECTIONS) {
    const list = bySection.get(s.id) || [];
    console.log(`  ${s.icon} ${s.title.padEnd(28)} (${s.id})  ${list.length} articles`);
  }
}

build();
