// Headless crawler for lesson.viberost.ru.
// 1. Logs in via the password form.
// 2. BFS-traverses all internal links, saves rendered HTML.
// 3. Downloads every static asset that pages reference (CSS, JS, images, fonts, video).
// 4. Persists a manifest mapping URL → local file.
// Resumable: skips pages and assets that are already saved.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const SITE = 'https://lesson.viberost.ru';
const PASSWORD = 'vibecoder2026';
const OUT = path.join(__dirname, '..', 'raw-source');
const PAGES_DIR = path.join(OUT, 'pages');
const ASSETS_DIR = path.join(OUT, 'assets');
const MANIFEST_FILE = path.join(OUT, 'manifest.json');

// Files larger than this just get a note in the manifest (we won't download big videos blindly).
const MAX_ASSET_BYTES = 50 * 1024 * 1024; // 50 MB hard cap per asset
const HOST = new URL(SITE).host;

fs.mkdirSync(PAGES_DIR, { recursive: true });
fs.mkdirSync(ASSETS_DIR, { recursive: true });

// --- manifest ---
const manifest = fs.existsSync(MANIFEST_FILE)
  ? JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'))
  : { pages: {}, assets: {}, errors: [], startedAt: new Date().toISOString() };

function persistManifest() {
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
}

// --- path helpers ---
function urlToPageFile(u) {
  const url = new URL(u, SITE);
  let p = url.pathname.replace(/\/+$/, '');
  if (p === '') p = '/index';
  // safe slug: keep slashes for nested folders, strip ?query
  return path.join(PAGES_DIR, p.slice(1) + '.html');
}

function urlToAssetFile(u) {
  const url = new URL(u, SITE);
  // mirror real path, drop query
  const local = url.pathname.replace(/^\/+/, '');
  return path.join(ASSETS_DIR, local || 'root.bin');
}

function isInternalPage(u) {
  try {
    const url = new URL(u, SITE);
    if (url.host !== HOST) return false;
    // skip mailto, tel, anchors etc.
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    // skip asset-looking URLs (we handle them via the asset pipeline)
    if (url.pathname.startsWith('/_next/')) return false;
    if (/\.(css|js|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|mp4|mp3|webm|pdf)$/i.test(url.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

function isAssetUrl(u) {
  try {
    const url = new URL(u, SITE);
    if (url.host !== HOST) {
      // CDN/external assets — usually fine to ignore (Google Fonts CSS will be inlined by the browser),
      // but we WILL keep external CDN assets if pages reference them. Save under assets/_external/<host>/...
      return true;
    }
    return true;
  } catch {
    return false;
  }
}

// --- HTTP downloader (uses the context cookie jar) ---
async function downloadAsset(context, u) {
  if (manifest.assets[u]) return manifest.assets[u]; // already done
  try {
    const url = new URL(u, SITE);
    const dest = url.host === HOST
      ? urlToAssetFile(u)
      : path.join(ASSETS_DIR, '_external', url.host, url.pathname.replace(/^\/+/, '') || 'root.bin');

    // Don't re-download if file exists on disk.
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
      manifest.assets[u] = path.relative(OUT, dest).replace(/\\/g, '/');
      return manifest.assets[u];
    }

    // Use playwright's request API — it shares cookies with the browser context.
    const response = await context.request.get(u, { failOnStatusCode: false, timeout: 30000 });
    if (!response.ok()) {
      manifest.errors.push({ kind: 'asset', url: u, status: response.status() });
      return null;
    }
    const body = await response.body();
    if (body.length > MAX_ASSET_BYTES) {
      manifest.errors.push({ kind: 'asset-too-large', url: u, bytes: body.length });
      return null;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, body);
    manifest.assets[u] = path.relative(OUT, dest).replace(/\\/g, '/');
    return manifest.assets[u];
  } catch (e) {
    manifest.errors.push({ kind: 'asset-exception', url: u, message: e.message });
    return null;
  }
}

// --- main ---
(async () => {
  // Use the storage state captured by login-interactive.js if present — that gives us
  // a real authenticated session. Falls back to anonymous browsing (good enough for the
  // public sections that we already scraped).
  const STATE_FILE = path.join(__dirname, 'storage-state.json');
  const hasState = fs.existsSync(STATE_FILE);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    ...(hasState ? { storageState: STATE_FILE } : {}),
  });
  const page = await context.newPage();

  if (hasState) {
    console.log('→ using saved session from', STATE_FILE);
    await page.goto(SITE + '/', { waitUntil: 'networkidle' });
    console.log('  landed at:', page.url());
  } else {
    console.log('→ no saved session, crawling as guest (only public pages will succeed)');
  }

  // Seed: homepage + explicit hidden sections that aren't linked from the unauthenticated nav.
  // Without these the BFS never reaches /cheatsheets or /courses (the "Шпаргалки" and "Материалы"
  // sections), because they redirect to /login for guests and we only discovered the guest nav.
  const queue = ['/', '/cheatsheets', '/courses'];
  const seen = new Set(queue);
  Object.keys(manifest.pages).forEach(u => seen.add(u));

  let pageCount = 0;
  while (queue.length) {
    const pathRel = queue.shift();
    const absUrl = new URL(pathRel, SITE).toString();
    if (manifest.pages[pathRel] && fs.existsSync(path.join(OUT, manifest.pages[pathRel]))) {
      console.log(`  ✓ skip ${pathRel} (cached)`);
      continue;
    }

    try {
      console.log(`→ ${pathRel}`);
      const collected = [];
      const assetUrls = new Set();

      // Intercept all subresource requests to also remember them as assets.
      const reqListener = (req) => {
        const u = req.url();
        const rt = req.resourceType();
        if (rt === 'xhr' || rt === 'fetch' || rt === 'document') {
          // these often hit /_next/data/... and API endpoints — also save them
          if (new URL(u).host === HOST) assetUrls.add(u);
          return;
        }
        if (['stylesheet', 'script', 'image', 'font', 'media'].includes(rt)) {
          assetUrls.add(u);
        }
      };
      page.on('request', reqListener);

      const resp = await page.goto(absUrl, { waitUntil: 'networkidle', timeout: 30000 });
      // Wait a moment for any late hydration to settle.
      await page.waitForTimeout(500);

      page.off('request', reqListener);

      if (!resp || resp.status() >= 400) {
        manifest.errors.push({ kind: 'page', url: pathRel, status: resp ? resp.status() : 'no-response' });
        continue;
      }

      // Pull links from the rendered DOM for BFS.
      const found = await page.$$eval('a[href]', as => as.map(a => a.getAttribute('href')));
      for (const href of found) {
        if (!href) continue;
        try {
          const abs = new URL(href, absUrl);
          if (abs.host !== HOST) continue;
          if (!isInternalPage(abs.toString())) continue;
          const rel = abs.pathname + (abs.search || '');
          if (!seen.has(rel)) {
            seen.add(rel);
            queue.push(rel);
          }
        } catch {}
      }

      // Save rendered HTML.
      const html = await page.content();
      const outFile = urlToPageFile(absUrl);
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, html);
      manifest.pages[pathRel] = path.relative(OUT, outFile).replace(/\\/g, '/');
      pageCount++;

      // Download the assets observed during this page load.
      for (const u of assetUrls) {
        await downloadAsset(context, u);
      }

      persistManifest();
      if (pageCount % 5 === 0) console.log(`  … ${pageCount} pages saved, queue=${queue.length}`);
    } catch (e) {
      console.warn(`  ✗ ${pathRel}: ${e.message}`);
      manifest.errors.push({ kind: 'page-exception', url: pathRel, message: e.message });
    }
  }

  manifest.finishedAt = new Date().toISOString();
  manifest.pageCount = pageCount;
  manifest.assetCount = Object.keys(manifest.assets).length;
  persistManifest();
  console.log(`\n✓ done. pages=${pageCount}, assets=${Object.keys(manifest.assets).length}, errors=${manifest.errors.length}`);

  await browser.close();
})().catch(err => {
  console.error('FATAL:', err);
  manifest.errors.push({ kind: 'fatal', message: err.message, stack: err.stack });
  persistManifest();
  process.exit(1);
});
