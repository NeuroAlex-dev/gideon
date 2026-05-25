// Mini fetcher to recover a single page that timed out during the main crawl.
// Uses the saved authenticated storage state.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SITE = 'https://lesson.viberost.ru';
const STATE_FILE = path.join(__dirname, 'storage-state.json');
const OUT = path.join(__dirname, '..', 'raw-source', 'pages', 'glossary.html');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: STATE_FILE });
  const page = await context.newPage();

  console.log('→ fetching /glossary…');
  // Use 'load' (full document + all sub-resources finished), then explicitly wait
  // for hydration: when the React tree is mounted, the page swells past ~70KB and
  // the dark/light toggle button is present in the DOM. We poll for that instead
  // of relying on networkidle (which times out on this page) or domcontentloaded
  // (which fires too early — saves a half-rendered shell).
  await page.goto(SITE + '/glossary', { waitUntil: 'load', timeout: 60000 });
  // Wait for a hydrated marker — the theme toggle is a button with a sun/moon icon
  // present once client React mounts the layout.
  try {
    await page.waitForSelector('button[aria-label*="тем" i], button svg.lucide-sun, button svg.lucide-moon', { timeout: 15000 });
  } catch {
    console.warn('  ! theme-toggle marker not seen, hydration may still be incomplete');
  }
  await page.waitForTimeout(2500);

  const html = await page.content();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html);

  // Patch manifest so the build script picks it up.
  const manifestPath = path.join(__dirname, '..', 'raw-source', 'manifest.json');
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  m.pages['/glossary'] = 'pages/glossary.html';
  m.errors = m.errors.filter(e => !(e.kind === 'page-exception' && e.url === '/glossary'));
  fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2));

  console.log('  ✓ saved', OUT, `(${html.length} bytes)`);
  await browser.close();
})();
