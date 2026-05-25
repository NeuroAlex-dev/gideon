// HTML templates as functions. No template engine — just tagged template literals.

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function navHtml(sections, activeId) {
  const main = sections.filter(s => !s.inMore);
  const more = sections.filter(s => s.inMore);
  const link = (s) => `<a href="/${s.id}"${s.id === activeId ? ' class="is-active"' : ''}>${esc(s.navLabel)}</a>`;
  const moreMenu = more.map(link).join('\n          ');
  return `<nav>
        <a href="/"${activeId === '__home__' ? ' class="is-active"' : ''}>База знаний</a>
        ${main.map(link).join('\n        ')}
        <details class="nav-more">
          <summary>Ещё</summary>
          <div class="nav-more__menu">
          ${moreMenu}
          </div>
        </details>
      </nav>`;
}

function layout({ title, sections, activeId, main, ogDescription }) {
  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex,nofollow" />
    <title>${esc(title)} · База знаний</title>${ogDescription ? `
    <meta name="description" content="${esc(ogDescription)}" />` : ''}
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" />
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <header>
      <a href="/" class="brand">База знаний</a>
      ${navHtml(sections, activeId)}
    </header>
${main}
    <script src="/script.js" defer></script>
  </body>
</html>
`;
}

function readingTimeFromMeta(meta) {
  // meta like "3 мин · обновлено 2026-05-10" — extract leading time chunk
  if (!meta) return null;
  const m = meta.match(/^([^·]+?)(?:\s*·|$)/);
  return m ? m[1].trim() : null;
}

function renderArticle({ article, section, sections, sectionArticles }) {
  const breadcrumb = section ? `<nav class="article-breadcrumb">
    <a href="/">База знаний</a>
    <span class="article-breadcrumb__sep">/</span>
    <a href="/${section.id}">${esc(section.navLabel)}</a>
    <span class="article-breadcrumb__sep">/</span>
    <span>${esc(article.title)}</span>
  </nav>` : `<nav class="article-breadcrumb">
    <a href="/">База знаний</a>
    <span class="article-breadcrumb__sep">/</span>
    <span>${esc(article.title)}</span>
  </nav>`;

  let siblings = '';
  if (sectionArticles.length > 1) {
    const items = sectionArticles.map(s => s.title === article.title
      ? `<li class="article-siblings__item article-siblings__item--current"><span>${esc(s.title)}</span></li>`
      : `<li class="article-siblings__item"><a href="${s.url}">${esc(s.title)}</a></li>`
    ).join('');
    siblings = `<nav class="article-siblings">
    <p class="article-siblings__title">В этом разделе</p>
    <ul class="article-siblings__list">${items}</ul>
  </nav>`;
  }

  const meta = article.pageMeta ? `<div class="page-meta">${article.pageMeta}</div>` : '';
  const metaphor = article.metaphor ? `<aside class="metaphor">${article.metaphor}</aside>` : '';

  const main = `    <main>
      <article class="prose">
        ${breadcrumb}
        <h1>${esc(article.title)}</h1>
        ${meta}
        ${metaphor}
${article.body}
        ${siblings}
      </article>
    </main>`;

  return layout({
    title: article.title,
    sections,
    activeId: section ? section.id : null,
    main,
    ogDescription: article.metaphor ? article.metaphor.replace(/<[^>]+>/g, '') : null,
  });
}

function renderSection({ section, sections, articles }) {
  const cards = articles.map(a => {
    const time = readingTimeFromMeta(a.pageMeta);
    const meta = a.metaphor ? a.metaphor.replace(/<[^>]+>/g, '') : '';
    return `<a href="${a.url}" class="article-card">
      <div class="article-card__header">
        <h3>${esc(a.title)}</h3>${time ? `
        <span class="article-card__time">${esc(time)}</span>` : ''}
      </div>${meta ? `
      <p class="article-card__meta">${esc(meta)}</p>` : ''}
    </a>`;
  }).join('');

  const empty = articles.length === 0
    ? `<p class="empty-state">В этом разделе пока нет статей.</p>` : '';

  const main = `    <main class="catalog-main">
      <nav class="article-breadcrumb">
        <a href="/">База знаний</a>
        <span class="article-breadcrumb__sep">/</span>
        <span>${esc(section.navLabel)}</span>
      </nav>
      <header class="section-header">
        <span class="section-header__icon">${section.icon}</span>
        <h1>${esc(section.title)}</h1>
        <p class="section-header__count">${articles.length} ${pluralArticles(articles.length)}</p>
      </header>
      <section class="index-section">
        <div class="article-grid">${cards}</div>
        ${empty}
      </section>
    </main>`;

  return layout({
    title: section.title,
    sections,
    activeId: section.id,
    main,
  });
}

function pluralArticles(n) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'статья';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'статьи';
  return 'статей';
}

function renderHome({ sections, sectionCounts, startArticles }) {
  const startCards = startArticles.map(a => {
    const time = readingTimeFromMeta(a.pageMeta);
    const meta = a.metaphor ? a.metaphor.replace(/<[^>]+>/g, '') : '';
    return `<a href="${a.url}" class="article-card">
        <div class="article-card__header">
          <h3>${esc(a.title)}</h3>${time ? `
          <span class="article-card__time">${esc(time)}</span>` : ''}
        </div>${meta ? `
        <p class="article-card__meta">${esc(meta)}</p>` : ''}
      </a>`;
  }).join('');

  const categoryCards = sectionCounts
    .filter(s => s.id !== 'start')
    .map(s => `<a href="/${s.id}" class="category-card">
        <span class="category-card__icon">${s.icon}</span>
        <div class="category-card__body">
          <h3>${esc(s.title)}</h3>
          <span class="category-card__count">${s.count} ${pluralArticles(s.count)}</span>
        </div>
      </a>`).join('');

  const main = `    <main class="catalog-main">
      <header class="home-hero">
        <h1>База знаний по Джарвису</h1>
        <p class="home-hero__lead">Гид по работе с персональным AI-агентом: установка, архитектура, память, скиллы и интеграции.</p>
      </header>
      <section class="index-section">
        <h2 class="section-title">С чего начать</h2>
        <div class="article-grid">${startCards}</div>
      </section>
      <section class="index-section">
        <h2 class="section-title">Все разделы</h2>
        <div class="category-grid">${categoryCards}</div>
      </section>
    </main>`;

  return layout({
    title: 'База знаний',
    sections,
    activeId: '__home__',
    main,
    ogDescription: 'База знаний по работе с персональным AI-агентом Джарвисом: установка, архитектура, память, команда скиллов, MCP-интеграции, безопасность.',
  });
}

module.exports = { renderHome, renderSection, renderArticle };
