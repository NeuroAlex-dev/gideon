# Spec: Контент-Агент — личный AI для контента

- **Дата:** 2026-05-27
- **Автор:** Гидеон (по согласованию с Александром)
- **Статус:** Approved (по итогам brainstorming-сессии)
- **Папка реализации:** `projects/content-agent/`
- **Интеграция с ботом:** новый модуль `.agent/bot/content-menu.js` + минимальные правки в `.agent/bot/index.js`
- **Интеграция с парсером:** только чтение Telegram-сессии (`projects/parser/data/session.txt`) для коннектора TG-мониторинга
- **AI-ядро:** Claude Code CLI по OAuth-подписке (как бот и sales-manager), без платных API

---

## 1. Цель

Дать Александру (эксперт по нейросетям) личного «контент-сотрудника» в Telegram, который:
1. Мониторит соцсети конкурентов/коллег и находит залетевший контент по метрикам вовлечённости.
2. Собирает структурированный дайджест по AI/нейросетям.
3. Обучается стилю Александра и пишет посты/контент-планы в этом стиле.
4. Публикует контент во все соцсети через одобрение (draft → approve → publish).

Управление — **только кнопки и пошаговые мастера** в @flash_gideon_bot, без работы с кодом.

## 2. Скоуп и ограничения

**В скоупе (вся система, строится фазами — см. раздел 9):**
- Раздел «✍ Контент» в @flash_gideon_bot (inline-меню + мастера)
- Обучение стилю: интервью 10 вопросов голосом + доп.материалы → 5 md-профилей
- Написание постов в стиле: из новости дайджеста ИЛИ по текстовому/голосовому запросу, с кнопками вариантов
- Мониторинг источников (плагины): Telegram, VK, YouTube, vc.ru/dtf.ru, Tenchat/Instagram
- Дайджест с метриками виральности + кнопки (короче/детальнее/сохранить/пост из новости)
- Контент-план с учётом стиля и ЦА
- Автопостинг через одобрение: Telegram, VK (+ Tenchat best-effort)
- HTTP API `:3002`, SQLite БД, воркер на расписании + очередь публикаций

**Честные технические ограничения (не скрываем от пользователя):**
- **Tenchat и Instagram не имеют публичного API.** Только парсинг HTML — хрупкий, ломается при смене вёрстки, метрики (лайки/репосты) часто закрыты без авторизации. Реализуем в последнюю очередь как best-effort с явной пометкой «может не работать».
- **VK и YouTube требуют бесплатных API-ключей.** Александр заводит токен VK и ключ Google API, сохраняет через `/settings`. Без ключа коннектор отключён.
- **Telegram-метрики:** просмотры и реакции доступны для каналов, к которым имеет доступ сессия; количество комментариев — из привязанного чата обсуждений (если он есть).
- **Автопостинг в Telegram:** бот должен быть админом целевого канала. **VK:** токен с правом `wall`.
- **Голосовое интервью:** использует существующий пайплайн бота (Deepgram при наличии ключа → локальный Whisper → текстовый ввод как fallback).

**Вне скоупа полностью:**
- Парсинг участников чатов (это делает `projects/parser/`)
- Аккаунты-доноры, виртуальные SIM, накрутка
- Платные API любого рода

## 3. Архитектурные решения

| # | Решение | Причина |
|---|---|---|
| 1 | Отдельный сервис `projects/content-agent/` | Изоляция: мониторинг и публикации — свой жизненный цикл, не должны валить парсер/sales |
| 2 | Стек: Node.js v20 + Express + better-sqlite3 (+ GramJS для TG-коннектора) | Согласован со стеком парсера/sales/бота |
| 3 | Два процесса PM2: `agent-content-server` (:3002) и `agent-content-worker` | Воркер (опрос источников, очередь публикаций) не блокирует HTTP |
| 4 | AI-ядро: Claude Code CLI по подписке | Без API-ключа, без расходов (паттерн из `bot/`, `sales-manager/`) |
| 5 | БД: SQLite (`projects/content-agent/data/content-agent.db`) | Один пользователь, локальный сервис |
| 6 | Источники — плагины с единым интерфейсом `fetchPosts()` | Новые сети добавляются без переписывания ядра |
| 7 | Публикаторы — плагины с единым интерфейсом `publish()` | Та же причина для исходящих каналов |
| 8 | Профиль стиля — 5 md-файлов на диске (`data/style/`), не в БД | Их редактирует Claude, читает каждый промпт; файлы удобнее версионировать и переобучать |
| 9 | TG-коннектор читает сессию парсера (`parser/data/session.txt`) | Один TG-аккаунт = одна сессия, дублировать логин нельзя |
| 10 | Авторизация HTTP API — HMAC-токен (паттерн из sales/parser) | Тот же пользователь, та же схема |
| 11 | Все настройки/команды через бота, без ручного редактирования кода | Прямое требование ТЗ |

## 4. Структура папок

```
projects/content-agent/
├── lib/
│   ├── db.js                 # SQLite — схема, миграции, query-helpers
│   ├── ai.js                 # Обёртка над claude CLI
│   ├── auth.js               # HMAC-токен (как sales-manager)
│   ├── bot-notifier.js       # Пуш уведомлений в бота
│   ├── sources/
│   │   ├── index.js          # Реестр коннекторов + диспетчер fetchPosts()
│   │   ├── telegram.js       # GramJS: посты канала, просмотры, реакции, комменты
│   │   ├── vk.js             # VK API: wall.get + likes/reposts/comments
│   │   ├── youtube.js        # YouTube Data API: search + statistics
│   │   ├── web-rss.js        # vc.ru/dtf.ru через RSS
│   │   ├── tenchat.js        # best-effort парсинг (хрупко)
│   │   └── instagram.js      # best-effort парсинг (хрупко)
│   ├── publishers/
│   │   ├── index.js          # Реестр публикаторов + диспетчер publish()
│   │   ├── telegram.js       # Постинг в канал (бот-админ)
│   │   ├── vk.js             # wall.post
│   │   └── tenchat.js        # best-effort
│   ├── digest.js             # Сборка/структурирование дайджеста, AI-резюме
│   ├── style.js              # Интервью, ингест материалов, генерация 5 md
│   ├── writer.js             # Генерация постов по стилю (из новости / промпта)
│   └── content-plan.js       # Генерация контент-планов
├── data/
│   ├── content-agent.db      # SQLite (в .gitignore)
│   └── style/                # 5 md-профилей стиля (в .gitignore — личные)
│       ├── tone-of-voice.md
│       ├── brand-code.md
│       ├── content-system.md
│       ├── personal-phrasebook.md
│       └── ideal-post-structure.md
├── bin/
│   ├── start-server.js       # PM2 entry — server
│   └── start-worker.js       # PM2 entry — worker
├── server.js                 # HTTP API на :3002
├── worker.js                 # Воркер: опрос источников + очередь публикаций
├── ecosystem.config.cjs      # PM2 конфиг
├── test/                     # юнит и интеграционные тесты
├── .env / .env.example
├── package.json
└── README.md

.agent/bot/content-menu.js    # registerContentHandlers(bot, isOwner)
```

## 5. Модель данных (SQLite)

```
sources
  id, platform, ref, title, discussion_chat_ref (nullable, для TG),
  active (bool), created_at

keywords
  id, term, scope ('include'|'exclude'), created_at
  # глобальные ключевики для фильтрации по заголовку/тексту

digests
  id, created_at, period, query_keywords (json), platforms (json), status

digest_items
  id, digest_id, platform, source_ref, url, title, summary,
  raw_text, metrics (json: views/likes/comments/reposts), published_at,
  saved (bool)

posts
  id, created_at, origin ('digest_item'|'prompt'),
  digest_item_id (nullable), user_prompt (nullable),
  draft_text, variants (json), status ('draft'|'approved'|'published'),
  approved_at, published_at

publish_queue
  id, post_id, platform, target, scheduled_at, status ('pending'|'sent'|'failed'),
  published_url, error, created_at

content_plans
  id, created_at, period, channel, audience, formats (json), payload (json), status

style_interview
  id, created_at, status ('in_progress'|'done'), step,
  qa (json: вопрос→транскрипт), extra_materials (json)

settings
  key, value   # vk_token, youtube_api_key, publish_targets и т.п.
```

Профиль стиля (5 md) хранится в `data/style/` как файлы, не в БД. В БД только метаданные через `settings` (версия, дата переобучения).

## 6. HTTP API (`:3002`, HMAC-авторизация)

```
# Источники
GET    /api/sources                 список
POST   /api/sources                 {platform, ref}
DELETE /api/sources/:id

# Ключевики
GET    /api/keywords
POST   /api/keywords                {term, scope}
DELETE /api/keywords/:id

# Поиск / дайджест
POST   /api/search                  {platforms, period, keywords} → создаёт digest, запускает воркер
GET    /api/digests                 список
GET    /api/digests/:id             дайджест + items
POST   /api/digests/:id/reshape     {mode:'shorter'|'detailed'} → AI пересобирает
POST   /api/digest-items/:id/save

# Стиль
GET    /api/style/status            какие md есть, версия
POST   /api/style/interview/start
POST   /api/style/interview/answer  {transcript}
POST   /api/style/interview/material {type, text}
POST   /api/style/interview/finish  → AI генерирует 5 md
POST   /api/style/retrain

# Посты
POST   /api/posts                   {origin, digest_item_id?|user_prompt?} → draft
POST   /api/posts/:id/variant       {mode:'expert'|'simpler'|'humor'|'cta'|'shorter'|'rewrite'}
POST   /api/posts/:id/approve
GET    /api/posts/:id

# Контент-план
POST   /api/content-plans           {period, channel, audience, formats} → plan
GET    /api/content-plans/:id

# Публикация
POST   /api/publish                 {post_id, platforms[], scheduled_at?} → ставит в очередь
GET    /api/publish-queue

# Настройки
GET/PUT /api/settings
POST   /api/extract                 извлечение текста из файла (как в sales-manager)
```

## 7. UX в боте

Команда `/content` и кнопка **✍ Контент** в главном меню открывают inline-меню:

```
🔍 Найти информацию    📆 Дайджест
📖 Контент-план        ✍ Написать пост
🎭 Мой стиль           📡 Источники
ℹ️ Инструкция          ⚙ Настройки
```

Ключевые сценарии (все — пошаговые мастера в стиле sales-menu.js):

- **📡 Источники:** выбор соцсети → добавить/удалить ссылку. Список с фильтром по платформе.
- **🔍 Найти информацию:** выбор платформ (мультивыбор) → период (сегодня/3 дня/неделя/месяц) → ключевые слова → запуск поиска → дайджест.
- **📆 Дайджест:** формат «Платформа / N найдено / ссылка / заголовок / краткое содержание». Кнопки под дайджестом: `Короче` `Детальнее` `💾 Сохранить` `✍ Пост из новости` (с выбором конкретной новости).
- **🎭 Мой стиль:** 10 вопросов по одному (голосом, распознаётся) → «прислать ещё / закончить» → доп.материалы → Claude пишет 5 md → подтверждение. Кнопки переобучения и режимов.
- **📖 Контент-план:** период → канал/тема → форматы → план в сообщении, под каждым пунктом `✍ Написать` `Изменить тему` `Детали`.
- **✍ Написать пост:** из новости (Фаза 2) или по запросу (текст/голос) → 1-2 уточнения → 1-3 варианта. Кнопки: `✅ Сохранить` `🔄 Переписать` `✂️ Короче` `📈 Экспертнее` `😂 Юмор/стёб` `🎯 Призыв`. После сохранения → `📣 Опубликовать` (выбор платформ → очередь).

Ответы структурированы: заголовки, списки, аккуратные абзацы, Telegram-HTML. Всё на русском.

## 8. Генерация контента (как используется стиль)

Каждый вызов `writer.js` / `content-plan.js` строит промпт для Claude CLI из:
1. Пяти md-профилей стиля (`data/style/*.md`).
2. Контекста задачи (новость из дайджеста / запрос пользователя / параметры плана).
3. Инструкции по формату и платформе.

Если профиль стиля ещё не создан — бот предлагает сначала пройти «🎭 Мой стиль» (но позволяет генерить и без него, с пометкой «стиль не обучен»).

## 9. Порядок сборки (фазы)

Каждая фаза — рабочий инкремент, проходит свой план реализации (writing-plans) и проверку.

| Фаза | Содержание | Зависит от |
|---|---|---|
| **1. Мозг** | Каркас сервиса (db, server :3002, worker, PM2, auth, content-menu.js, главное меню) + стиль (интервью+голос+5 md) + написание постов по запросу + кнопки вариантов | Claude, голос |
| **2. TG-мониторинг + дайджест** | Источники (TG), ключевики, «Найти информацию» (TG), дайджест, «пост из новости» → Фаза 1 | TG-сессия |
| **3. VK + YouTube** | Коннекторы vk.js/youtube.js + метрики виральности в дайджесте | API-ключи |
| **4. Контент-план** | Генератор плана с учётом стиля и ЦА | Фаза 1 |
| **5. Автопостинг** | publishers/ (telegram, vk), очередь публикаций через одобрение | Фаза 1, 3 |
| **6. Хрупкие источники** | web-rss (vc.ru/dtf), tenchat/instagram best-effort | — |

**Фаза 1 строится первой по этой спеке.** Последующие фазы детализируются отдельными планами по мере подхода.

## 10. Открытые вопросы / решения по ходу

- Какой целевой Telegram-канал(ы) Александра для автопостинга — уточнить в Фазе 5.
- Получение токена VK и ключа YouTube — инструкция в Фазе 3.
- Лимиты опроса источников (частота) и анти-бан для TG-коннектора — задать консервативно в Фазе 2.
