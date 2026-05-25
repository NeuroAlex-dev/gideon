// One-shot interactive login helper.
// Opens chromium in a visible window pointed at /login. The operator (Александр) types
// the password into the real form. As soon as the URL leaves /login we capture the full
// storage state (cookies + localStorage) to scripts/storage-state.json so the crawler
// can resume as that logged-in user.

const { chromium } = require('playwright');
const path = require('path');

const SITE = 'https://lesson.viberost.ru';
const STATE_FILE = path.join(__dirname, 'storage-state.json');

(async () => {
  console.log('→ launching visible chromium window…');
  console.log('   In the window: introduce the access password and press the "Войти" button.');
  console.log('   I\'ll capture the session automatically once you are past /login.\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(SITE + '/login');

  // Wait up to 5 minutes for the operator to log in.
  try {
    await page.waitForURL(u => !u.toString().includes('/login'), { timeout: 5 * 60 * 1000 });
  } catch {
    console.error('✗ Timed out waiting for login. Closing.');
    await browser.close();
    process.exit(1);
  }

  console.log('  ✓ Logged in. Current URL:', page.url());
  await context.storageState({ path: STATE_FILE });
  console.log('  ✓ Session saved to', STATE_FILE);

  await browser.close();
  console.log('\n→ Now run:  node scripts/crawl.js   (it will pick up the session automatically)');
})();
