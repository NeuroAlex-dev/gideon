// Packages the crawled site (raw-source/) into a static public/ tree ready for Vercel.
// - Pages: pages/<slug>.html → public/<slug>/index.html
// - Assets: assets/_next, assets/images, assets/api → public/_next, public/images, public/api
// - Strips the login page and the password form, since deployed copy is open.
// - Re-routes any href="/login" to href="/" to avoid dead links.

const fs = require('fs');
const path = require('path');

const RAW = path.join(__dirname, '..', 'raw-source');
const PAGES = path.join(RAW, 'pages');
const ASSETS = path.join(RAW, 'assets');
const OUT = path.join(__dirname, '..', 'public');

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      count += copyDir(s, d);
    } else {
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(s, d);
      count++;
    }
  }
  return count;
}

function cleanPublic() {
  if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
}

function rewritePageHtml(html) {
  let out = html;

  // 0) Anti-FOUC: inject a synchronous script that applies the saved theme on
  //    <html> before the body is painted. The site stores the theme in
  //    localStorage.theme as "light" | "dark" and toggles via
  //    document.documentElement.setAttribute("data-theme", value).
  //
  //    Some pages (e.g. /solutions, /glossary) have a React effect that resets the
  //    attribute to the default ("dark") at mount before reading localStorage —
  //    causing a brief dark flash on light theme. A MutationObserver pins the
  //    attribute to the saved preference whenever it disagrees.
  const themeInit =
    '<script>(function(){try{' +
      'var t=localStorage.getItem("theme");' +
      'if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t);' +
      'new MutationObserver(function(){' +
        'try{' +
          'var saved=localStorage.getItem("theme");' +
          'if(!saved)return;' +
          'var cur=document.documentElement.getAttribute("data-theme");' +
          'if(cur!==saved)document.documentElement.setAttribute("data-theme",saved);' +
        '}catch(e){}' +
      '}).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});' +
    '}catch(e){}})();</script>';
  out = out.replace(/<head>/, '<head>' + themeInit);

  // 1) Remove entire <a href="/login">…</a> elements (the "Войти" / "Уже учусь" CTAs).
  out = out.replace(/<a\b[^>]*?href="\/login"[^>]*>[\s\S]*?<\/a>/gi, '');

  // 2) Defensive: any other absolute /login references that escaped, point them at home.
  out = out.replace(/href="\/login"/g, 'href="/"');

  // 3) Strip POST form actions that would 405 on a static host.
  out = out.replace(/<form([^>]*?)action="([^"]*)"([^>]*)method="POST"([^>]*)>/gi,
    '<form$1action="javascript:void(0)"$3$4>');

  // 3b) Remove the entire <form> that wraps the "Выйти" logout button (recognisable
  //     by the lucide-log-out icon inside). Two copies typically: desktop nav + mobile menu.
  //     The form already had its server action stripped, so it's a no-op button — drop it.
  out = out.replace(/<form\b[^>]*>[\s\S]*?lucide-log-out[\s\S]*?<\/form>/g, '');

  // 3c) Remove the site-wide <footer> (copyright + social links + "Meta признана…").
  //     This footer is from the original course site; it doesn't make sense on the
  //     standalone mirror. The author's hero bio elsewhere on the page stays intact.
  out = out.replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, '');

  // 4) Next.js inlines an RSC payload as a serialized JS string containing escaped
  //    JSON. The header "Войти" button shows up there as \"/login\". Replace it with
  //    a self-link so the hydrated client doesn't navigate to a 404.
  out = out.replace(/\\"\/login\\"/g, '\\"/\\"');

  // 5) Belt-and-braces. The server HTML is now clean, but the inlined RSC payload
  //    still describes the logout form and the "Войти" CTA — when React hydrates it
  //    will re-render them. Two countermeasures:
  //
  //    a) CSS: hide anything containing the logout icon plus the rewritten login CTAs.
  //       Uses :has() (Chrome 105+, Safari 15.4+) which the target browsers support.
  //
  //    b) JS MutationObserver: actively strip the elements as soon as React inserts
  //       them. Runs as a synchronous inline script before any chunks load, so it's
  //       installed before hydration starts.
  const styleTag =
    '<style id="vibecoder-static-overrides">' +
    'header a[href="/"].cta-primary,' +
    'header a[href="/login"].cta-primary,' +
    'form:has(svg.lucide-log-out),' +
    'button:has(svg.lucide-log-out){display:none!important;}' +
    // Server HTML always emits <header class="header-dark">; React swaps the class
    // to .header-light on hydration. Without this override, light theme flashes a
    // dark header before hydration completes. Force the light background whenever
    // data-theme=light is set (the anti-FOUC script sets that before paint).
    '[data-theme=light] header.header-dark{background:#f8f9fad9!important;}' +
    '</style>';
  const scriptTag =
    '<script id="vibecoder-static-cleanup">' +
    '(function(){' +
      'function clean(){' +
        'document.querySelectorAll("svg.lucide-log-out").forEach(function(svg){' +
          'var host=svg.closest("form,button,a");' +
          'if(host)host.remove();' +
        '});' +
      '}' +
      'if(document.readyState!=="loading")clean();' +
      'document.addEventListener("DOMContentLoaded",clean);' +
      'new MutationObserver(clean).observe(document.documentElement,{childList:true,subtree:true});' +
    '})();' +
    '</script>';
  out = out.replace(/<\/head>/, styleTag + scriptTag + '</head>');

  return out;
}

function walkPagesDir(dir, base = '') {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...walkPagesDir(full, rel));
    } else if (entry.name.endsWith('.html')) {
      results.push({ full, rel: rel.replace(/\.html$/, '') });
    }
  }
  return results;
}

function build() {
  console.log('→ cleaning public/');
  cleanPublic();

  // --- 1. Copy real static assets only.
  //    The crawler also captured RSC-prefetch payloads under assets/guides etc. — those
  //    are duplicate page snapshots, not assets. We copy only the real static dirs and
  //    explicit known API responses.
  console.log('→ copying assets');
  const nextCount = copyDir(path.join(ASSETS, '_next'), path.join(OUT, '_next'));
  const imgCount = copyDir(path.join(ASSETS, 'images'), path.join(OUT, 'images'));

  // The /solutions catalog page fetches /api/solutions-catalog at mount.
  // Without it the page stays in a "Загрузка..." state forever — surface the captured JSON.
  const apiSrc = path.join(ASSETS, 'api', 'solutions-catalog');
  let apiCount = 0;
  if (fs.existsSync(apiSrc)) {
    const apiDst = path.join(OUT, 'api', 'solutions-catalog');
    fs.mkdirSync(path.dirname(apiDst), { recursive: true });
    fs.copyFileSync(apiSrc, apiDst);
    apiCount = 1;
  }
  console.log(`  _next: ${nextCount}, images: ${imgCount}, api: ${apiCount}`);

  // --- 2. Copy pages, dropping /login ---
  console.log('→ copying pages');
  const pages = walkPagesDir(PAGES);
  let pageCount = 0, skipped = 0;

  for (const { full, rel } of pages) {
    // Skip the login page entirely (open access on this deploy).
    if (rel === 'login') { skipped++; continue; }

    const html = rewritePageHtml(fs.readFileSync(full, 'utf8'));

    // Map: pages/<slug>.html → public/<slug>/index.html
    // Special case: pages/index.html → public/index.html
    let outPath;
    if (rel === 'index') {
      outPath = path.join(OUT, 'index.html');
    } else {
      outPath = path.join(OUT, rel, 'index.html');
    }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html);
    pageCount++;
  }
  console.log(`  pages: ${pageCount} written, ${skipped} skipped (login)`);

  // --- 3. vercel.json: clean URLs + caching headers for static assets ---
  const vercel = {
    cleanUrls: true,
    trailingSlash: false,
    headers: [
      {
        source: '/_next/(.*)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/images/(.*)',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=86400' }],
      },
    ],
  };
  fs.writeFileSync(
    path.join(__dirname, '..', 'vercel.json'),
    JSON.stringify(vercel, null, 2),
  );

  console.log('\n✓ build complete →', OUT);
  console.log(`  ${pageCount} pages, ${nextCount + imgCount} static files`);
}

build();
