
# MEMORY.md — долгосрочная память Агента

> Что Агент знает обо мне на длинной дистанции: профиль, проекты, инфраструктура, стек, предпочтения. Читается в начале каждой сессии. Лимит — 200 строк.

---

## Кто я

- **Имя:** Александр
- **Роль:** Вайб-кодер
- **Чем занимаюсь:** Специализируюсь на создании сайтов, Telegram приложений, контент-агентов и автоматизаций через вайб-кодинг.

## Контакты и аккаунты

- **Email (Git, основной):** alexpiterlair@gmail.com
- **GitHub:** github.com/NeuroAlex-dev

---

## Активные проекты

- **Парсер участников Telegram-чатов** (`parser/`). Node.js + GramJS + Express. Работает под PM2 как `agent-parser` на порту 3000. Команда `/parser` в @flash_gideon_bot вызывает его по HTTP на localhost (loopback bypass — без пароля). Веб-доступ — через Vercel на красивый URL (см. раздел «Инфраструктура» → Vercel + nip.io). Авторизация: пароль через UI, токен сессии — HMAC в localStorage. Спека: `docs/superpowers/specs/2026-05-18-telegram-parser-design.md`. План: `docs/superpowers/plans/2026-05-18-telegram-parser.md`.
- **Sales Manager — AI-продавец** (`sales-manager/`). Node.js + GramJS + Express + better-sqlite3. Два процесса PM2: `agent-sales-manager-server` (HTTP API на :3001) и `agent-sales-manager-worker` (outbound scheduler + inbound NewMessage listener). Шарит TG-сессию с парсером через `parser/data/session.txt`. AI через Claude CLI по подписке (как бот). Брифинг кампаний в `/sales` в @flash_gideon_bot, метрики в `gideon-bay.vercel.app/sales.html` (rewrite `/api/sales/*` → sales.138-16-178-94.nip.io). MVP: режимы `full_auto` + `draft_approval`, тёплый аутрич 10-20 первых сообщений/день, многоуровневый анти-бан. Спека: `docs/superpowers/specs/2026-05-21-sales-manager-design.md`. План: `docs/superpowers/plans/2026-05-21-sales-manager.md`. 54/54 тестов проходят.
- **jarvis-docs — база знаний по Джарвису** (`jarvis-docs/`). Статический сайт на чистом HTML+CSS, без фреймворков. Исходник — выгрузка 40 HTML в `jarvis-website/jarvis/`. Генератор `scripts/build.js` + `scripts/templates.js` (чистый Node, без npm-зависимостей): парсит regex'ами, переписывает ссылки `/docs/...` → `/...`, пишет файлы как `<section>/<slug>/index.html`. Содержит 39 статей в 11 разделах. Деплой: `https://jarvis-docs-two.vercel.app` (имя `jarvis-docs` было занято, Vercel выдал `-two`). Vercel dashboard: `vercel.com/neuroalex-devs-projects/jarvis-docs`. Пересборка: `node scripts/build.js`, передеплой: `vercel deploy --prod --yes` из папки.
- **vibecoder-platform — зеркало lesson.viberost.ru** (`vibecoder-platform/`). Статическая копия собственного курса Александра «Профессия: Вайбкодер» (Next.js + Iron Session логин по паролю). Рипнут через Playwright crawler с авторизованной сессией: 125 страниц в 5 разделах (Главная, Шпаргалки, Материалы, Knowledge/Claude Code, 100 решений, Словарь). `scripts/crawl.js` (BFS-обход + сохранение HTML/ассетов), `scripts/login-interactive.js` (headed-логин для захвата сессии — cookie привязан к IP, поэтому логин надо делать с того же сервера), `scripts/build.js` (адаптер: выпиливает /login, кнопки «Войти»/«Выйти», anti-FOUC скрипт для темы, header CSS-override). storage-state.json — секрет, в .gitignore. raw-source/ закоммичена для воспроизводимости. Деплой: `https://vibecoder-platform.vercel.app`. Vercel dashboard: `vercel.com/neuroalex-devs-projects/vibecoder-platform`. Пересборка: `node scripts/build.js` (если raw-source свежий) или `node scripts/crawl.js` (новый рип с актуальной storage-state).

---

## Инфраструктура

- **VPS:** vdsina.ru, Windows Server 2022, пользователь Administrator. **Inbound IP (на сетевом интерфейсе): `138.16.178.94`** — то что нужно для DNS A-записей и прокси (поправлено 2026-05-20: ранее в MEMORY стояло 165.231.33.74, это outbound NAT, на нём сидит чужая машина). **Outbound IP (что видят api.ipify.org и т.п.): `165.231.33.74`** — это NAT-адрес для исходящего трафика.
- **Веб-доступ к парсеру (production):** `https://gideon-bay.vercel.app/` — это **постоянный production URL** Vercel-проекта. Всегда указывает на последний deploy в main. URL вида `gideon-XXXXXX-neuroalex-devs-projects.vercel.app` — preview deployments конкретного коммита, не использовать.
- **Архитектура веб-доступа:** Vercel-фронт + rewrites на nip.io бэкенд. `vercel.json` в корне репы шлёт `/api/*` на `https://parser.138-16-178-94.nip.io/api/*`. Vercel автоматически передеплоит при push в main.
- **nip.io** заменил DuckDNS — DuckDNS глючил с пропагацией A-записи. nip.io это wildcard DNS: `*.138-16-178-94.nip.io` → 138.16.178.94 автоматически. Без регистрации.
- **Caddyfile** (запущен из `C:\Users\Administrator\projects\voice-input\Caddyfile`): блок `parser.138-16-178-94.nip.io { reverse_proxy localhost:3000 }`. Сертификат Let's Encrypt автоматически.
- ~~Публичный URL парсера: `https://gideon-parser.duckdns.org`~~ — устарело, DuckDNS отключаем, блок в Caddyfile пока висит но не используется.
- **Рабочее место:** VS Code Desktop запущен на сервере, Александр подключается к серверу через RDP (mstsc). Локального VS Code на ноутбуке нет — все расширения и проекты живут на сервере.
- **Telegram-бот:** @flash_gideon_bot (https://t.me/flash_gideon_bot, токен настроен). Запускается напрямую через node из `C:\Users\Administrator\.agent\start-bot.bat` (не через PM2). PM2 установлен глобально, но для бота не используется
- **Автозапуск бота:** задача `GideonBot` в Планировщике Windows, действие — start-bot.bat, триггер по логону пользователя
- **Парсер:** `parser/` в этом проекте, запускается через `pm2 start parser/ecosystem.config.cjs`, имя процесса `agent-parser`
- **Node.js:** v20.19.1, путь `C:\Users\Administrator\nodejs\`. **Не в системном PATH** — для глобальных npm-установок с native post-install скриптами (esbuild и др.) нужно явно подставлять PATH: `powershell -Command '$env:PATH = "C:\Users\Administrator\nodejs;" + $env:PATH; npm i -g <package>'`
- **Vercel CLI:** установлен глобально (`C:\Users\Administrator\nodejs\vercel.cmd`), залогинен как `neuroalex-dev`. Для запуска из bash: тот же приём с PATH через PowerShell
- **Python:** 3.12.7, путь `C:\Program Files\Python312\` (в системном PATH, установлен 18.05.2026 для расширения Claude Voice в VS Code)
- **Claude CLI:** `C:\Users\Administrator\.vscode\extensions\anthropic.claude-code-2.1.143-win32-x64\resources\native-binary\claude.exe`
- **Бот:** `C:\Users\Administrator\.agent\bot\` (ecosystem.config.cjs, PM2)
- **Workspace:** `C:\Users\Administrator\workspace\` (junction → gideon project)
- **Автозапуск:** Планировщик задач Windows, задача GideonBot

---

## Стек и инструменты

> Дописывайте по мере выбора: что используете для frontend, backend, AI, deploy, дизайна. Локальные утилиты на компьютере (например yt-dlp, ffmpeg) — тоже сюда.

*Пока пусто. Появится по мере появления конкретного стека.*

---

## Скиллы и плагины (установлено 17.05.2026)

Глобальные скиллы `~/.claude/skills/` — работают во всех проектах:
- `discovery-interview` — интервью для сбора ТЗ из размытой идеи
- `content-creator` — посты, статьи, email, маркетинговые тексты
- `frontend-design` — продакшн UI с нестандартной эстетикой (официальный от Anthropic)
- `fullstack-developer` — React, Next.js, Node.js, TypeScript, PostgreSQL

Глобальные плагины `~/.claude/plugins/`:
- `superpowers` v5.1.0 — 10 скиллов для цикла разработки: brainstorming, writing-plans, systematic-debugging, tdd, verification-before-completion, code-review, executing-plans и др.
- `code-review` — ревью pull request'ов (`/review`)

---

## Предпочтения

- **Обращение:** ты
- **Стиль ответов:** Подробные ответы с примерами и пошаговой логикой
- **Язык общения:** Русский для общения и ответов, английский для кода и разработки
- **Что бесит в общении ИИ:**
  - Отсутствие конкретики и чёткости
  - Вода — лишние слова и долгие объяснения
  - Повторение одного и того же по нескольку раз

---

## Ключевые решения

> Решения, которые приняты один раз и не обсуждаются повторно. Например: «работаем только по предоплате», «программу лояльности не делаем в этом квартале», «фронтенд только на React». Чтобы каждую неделю не возвращаться к одному и тому же.

*Пока пусто. Появится по мере работы.*

---

## Ссылки на knowledge/

> Карта справочников из папки `knowledge/`. Когда добавите туда новый файл — дайте здесь ссылку и одну строку «когда читать».

Пример формата:
> `knowledge/brandbook.md` — стиль и голос автора. Читать когда пишу пост, презентацию или любой публичный текст.

*Пока пусто.*

---

## Правила работы с этим файлом (для Агента)

- **Дописывай в конец нужного раздела**, не переписывай файл целиком.
- **Файл ≤ 200 строк.** Если разрастается — консолидируй: удали устаревшее, объедини дубликаты, длинные блоки выноси в отдельный файл `knowledge/`.
- **Дневные заметки** идут в `memory/YYYY-MM-DD.md`, не сюда. Здесь только то, что пригодится через месяц.
- **Большие справочники** идут в `knowledge/`, не сюда. Здесь только короткая ссылка.
- **Перед каждой сессией** — перечитай этот файл. Без него ты не Ваш Агент, а обычный чат.
- **Если узнал постоянный факт о человеке** (новый проект, новая инфраструктура, изменение предпочтения) — сразу зафиксируй в нужном разделе.
