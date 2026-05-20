# Spec: Sales Manager — AI-продавец на Telegram

- **Дата:** 2026-05-21
- **Автор:** Гидеон (по согласованию с Александром)
- **Статус:** Approved (по итогам brainstorming-сессии)
- **Папка реализации:** `sales-manager/` в корне проекта gideon
- **Интеграция с ботом:** новый модуль `bot/sales-menu.js` + минимальные правки в `bot/index.js`
- **Интеграция с парсером:** только чтение `parser/data/session.txt` + опционально импорт лидов через HTTP `parser` API
- **Веб-UI:** расширение существующего фронта `gideon-bay.vercel.app` (новые вкладки)

---

## 1. Цель

Дать Александру универсальный конструктор «AI-продавца»: бот ведёт переписки в Telegram от его личного аккаунта, грамотно презентует офферы исходя из болей ЦА и закрывает в сделку. **Без массового спама** — тёплый качественный аутрич 10-20 первых сообщений в день, с акцентом на релевантность и человеческую подачу.

## 2. Скоуп и ограничения

**В скоупе (MVP, фаза 1):**
- Создание и управление кампаниями через диалог с @flash_gideon_bot
- Веб-UI: список кампаний, детали (бриф + лиды + метрики)
- Outbound: шедулинг первых сообщений с задержками, лимитами, рабочими часами
- Inbound: подписка на updates, батч-окно, AI-ответы
- Два режима автономии: `full_auto` и `draft_approval`
- Загрузка лидов: из парсера (HTTP) и CSV-файлом
- Анти-бан уровни 1-4 (см. раздел 7)
- HTTP API `:3001`
- SQLite БД, миграции

**Вне скоупа MVP (фаза 2+):**
- Режимы `qualify_then_handoff` и `hybrid` (с триггерами)
- Вкладка «Переписки» в веб-UI с human-takeover
- AI-самопроверка драфтов перед отправкой (уровень 5 анти-бана)
- Шаблоны кампаний (пресеты «коучи», «эксперты»)
- Несколько TG-аккаунтов
- A/B-тесты первых сообщений
- Интеграция с Calendly/Notion

**Вне скоупа полностью:**
- Использование аккаунтов-доноров / виртуальных SIM
- Парсинг новых чатов (это делает существующий `parser/`)
- Bot API (используем User API через GramJS, как и парсер)

## 3. Архитектурные решения

| # | Решение | Причина |
|---|---|---|
| 1 | Отдельный сервис `sales-manager/`, не внутри `parser/` | Изоляция: длинноживущие диалоги и шедулинг — другой жизненный цикл, не должны валить парсер |
| 2 | Стек: Node.js v20 + GramJS + Express + better-sqlite3 | Согласован со стеком парсера и бота |
| 3 | Шаринг TG-сессии через файл `parser/data/session.txt` | Один Telegram-аккаунт = одна сессия; дублировать логин нельзя |
| 4 | Два процесса PM2: `agent-sales-manager-server` (:3001) и `agent-sales-manager-worker` | Воркер не блокирует HTTP, HTTP не блокирует воркер |
| 5 | Один воркер для outbound + inbound (не два) | Telegram плохо терпит две сессии одного аккаунта; внутри Node.js — это просто разные модули |
| 6 | AI-ядро: Claude Code CLI через OAuth-подписку (паттерн из `bot/`) | Без API-ключа, без отдельных расходов |
| 7 | БД: SQLite (`sales-manager/data/sales-manager.db`) | Один пользователь, локальный сервис, не нужен Postgres |
| 8 | Брифинг кампаний — в @flash_gideon_bot диалогом | Самый быстрый способ для Александра ввести данные, без форм |
| 9 | Правки и просмотр — в веб-UI парсера | Визуально удобнее формы, переписки, метрики |
| 10 | Авторизация веб-UI — переиспользуем модуль из парсера (пароль + HMAC-токен) | Тот же пользователь, та же сессия |

## 4. Структура папок

```
sales-manager/
├── lib/
│   ├── db.js              # SQLite — схема, миграции, query-helpers
│   ├── telegram.js        # GramJS-клиент, читает parser/data/session.txt
│   ├── ai.js              # Обёртка над claude CLI
│   ├── outbound.js        # Шедулер первых сообщений, выбор лида, задержки
│   ├── inbound.js         # Подписка на NewMessage, очередь, батч-окно
│   ├── dialog-engine.js   # Что AI отвечает; применяет режим автономии
│   └── safety.js          # Лимиты, рабочие часы, рандом, обнаружение бан-сигналов
├── server.js              # HTTP API на :3001
├── worker.js              # Воркер: тик outbound + слушатель inbound
├── data/sales-manager.db  # SQLite БД (не в git, добавить в .gitignore)
├── ecosystem.config.cjs   # PM2 конфиг
├── public/                # (фаза 2) собственные статические страницы если понадобятся
├── test/                  # юнит и интеграционные тесты
├── package.json
└── README.md
```

## 5. Жизненный цикл кампании

### 5.1. Состояния

`draft` → `ready` → `running` ↔ `paused` → `completed` → `archived`

- `draft` — бриф в процессе сбора через бот
- `ready` — бриф готов, режим выбран, лидов ещё нет или ждёт запуска
- `running` — активная работа (шедулер обрабатывает)
- `paused` — Александр поставил на стоп вручную или сработал авто-стоп безопасности
- `completed` — все лиды доведены до терминальных статусов (won / lost / unsubscribed / blocked)
- `archived` — убрана из списка активных, доступна только в истории

### 5.2. Брифинг через @flash_gideon_bot

Диалоговый мастер (паттерн скилла `discovery-interview`):

| Поле | Вопрос Гидеона | Обязательность |
|---|---|---|
| `name` | «Как назовём кампанию для отчётов?» | required |
| `offer_text` | «Что предлагаем и в чём суть?» | required |
| `offer_url` | «Ссылка куда вести лида в конце (сайт / прайс / Notion)?» | required |
| `target_audience` | «Кто эти лиды, по какой боли мы попадаем?» | required |
| `goal_ikr` | «Идеальный конечный результат — что считаем закрытием?» | required |
| `tone` | «Как пишем? Дружески на ты, формально на вы?» | optional, default: «дружески на ты» |
| `stop_phrases` | «Что точно не говорим?» | optional |

После сбора Гидеон показывает саммари → Александр подтверждает или правит конкретное поле → кампания создаётся в `draft`.

### 5.3. Выбор режима автономии

После подтверждения брифа — inline-кнопки:

- 🤖 **Полная автономия** (`full_auto`)
- 🎯 **Автономная квалификация** (`qualify_then_handoff`) — _фаза 2_
- ✋ **Драфты на одобрение** (`draft_approval`)
- ⚡ **Гибрид** (`hybrid`) — _фаза 2_

Выбор → сохраняется в `campaigns.mode` → статус кампании становится `ready`.

### 5.4. Загрузка лидов

- **Из парсера** — HTTP-запрос в `parser` API: список доступных парсингов (chat + date), Александр выбирает, лиды импортируются в `leads`
- **CSV** — Александр шлёт файл в бот, парсим колонки `username, first_name, source_chat`
- **Вручную** — список юзернеймов в боте: `@vasya, @petya, @kolya`

### 5.5. Запуск

Гидеон показывает финальное саммари (кампания, кол-во лидов, режим, лимиты, рабочие часы) → кнопка `🚀 Запустить` → статус `running`.

## 6. Модель данных (SQLite)

```sql
CREATE TABLE campaigns (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',  -- draft|ready|running|paused|completed|archived
  mode TEXT,                              -- full_auto|qualify_then_handoff|draft_approval|hybrid
  offer_text TEXT,
  offer_url TEXT,
  target_audience TEXT,
  goal_ikr TEXT,
  tone TEXT,
  stop_phrases TEXT,
  daily_message_limit INTEGER DEFAULT 15,
  working_hours_start INTEGER DEFAULT 10,
  working_hours_end INTEGER DEFAULT 21,
  timezone TEXT DEFAULT 'Europe/Moscow',
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  paused_at INTEGER,
  completed_at INTEGER
);

CREATE TABLE leads (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  tg_user_id INTEGER,
  tg_username TEXT,
  first_name TEXT,
  last_name TEXT,
  bio TEXT,
  source_chat_title TEXT,
  source_parse_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued',  -- queued|first_sent|in_dialog|qualified|won|lost|unsubscribed|blocked|human_takeover
  next_action_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_leads_schedule ON leads(campaign_id, status, next_action_at);

CREATE TABLE conversations (
  id INTEGER PRIMARY KEY,
  lead_id INTEGER NOT NULL REFERENCES leads(id),
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  stage TEXT NOT NULL DEFAULT 'intro',  -- intro|discovery|pitch|objection|closing|post_close
  last_inbound_at INTEGER,
  last_outbound_at INTEGER,
  message_count INTEGER DEFAULT 0
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL,  -- outbound|inbound|system|human_takeover
  body TEXT NOT NULL,
  tg_message_id INTEGER,
  status TEXT NOT NULL,  -- drafted|pending_approval|scheduled|sent|failed|received
  scheduled_for INTEGER,
  sent_at INTEGER,
  received_at INTEGER,
  ai_model TEXT,
  ai_tokens_in INTEGER,
  ai_tokens_out INTEGER
);
CREATE INDEX idx_messages_conv ON messages(conversation_id, sent_at);

CREATE TABLE drafts (
  id INTEGER PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES messages(id),
  telegram_bot_message_id INTEGER,  -- сообщение с inline-кнопками в @flash_gideon_bot
  status TEXT NOT NULL DEFAULT 'waiting',  -- waiting|approved|edited|rejected
  human_edit_text TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,  -- sent|received|error|ban_signal|handoff|campaign_paused
  lead_id INTEGER,
  campaign_id INTEGER,
  payload_json TEXT
);

CREATE TABLE leads_blocked (
  tg_user_id INTEGER PRIMARY KEY,
  reason TEXT,
  blocked_at INTEGER NOT NULL
);
```

## 7. Безопасность и анти-бан

### Уровень 1 — Жёсткие лимиты (`safety.js`)
- Не более `daily_message_limit` (default **15**) исходящих **первых** сообщений в сутки на всю систему (сумма по всем кампаниям)
- Не более **3 первых сообщений в час**
- Между двумя любыми исходящими — рандом-задержка **5-40 минут**
- Только в рабочие часы кампании (по timezone)

### Уровень 2 — Имитация человека
- Перед отправкой: `client.sendTyping(peer)` на **2-8 секунд** (рандом)
- Перед чтением входящего: задержка **30-180 сек**
- Варьируемая длина сообщений; не идеальная пунктуация (опционально опечатки — фаза 2)
- Не пишем ночью и в воскресенье (флаг кампании)

### Уровень 3 — Сигналы опасности (early warning)
- ≥2 жалобы / блокировки в день (`USER_DEACTIVATED_BAN` / `PEER_FLOOD`) — **авто-пауза всех кампаний** + алерт в @flash_gideon_bot
- `FLOOD_WAIT_X` — стоп на `X+30` сек, лог в `events`
- 5 лидов подряд не ответили за 7 дней — алерт «возможно качество базы плохое»

### Уровень 4 — Чёрный список
- Сообщения «спам / отстань / unsubscribe / не пиши» — мгновенный статус `unsubscribed`
- Глобальный `leads_blocked` — если лид заблокирован в одной кампании, не пишем из других

### Уровень 5 — AI-самопроверка драфта _(фаза 2)_
- AI ревьюит свой драфт по чек-листу (нет продажи в лоб, упомянут контекст знакомства). Проваливает → генерирует заново (до 2 попыток) → эскалация на драфт-одобрение.

## 8. Outbound — поток исходящих

1. Шедулер в `worker.js` тикает раз в ~60 секунд
2. Запрос к БД: `SELECT * FROM leads WHERE status='queued' AND next_action_at <= NOW() ORDER BY next_action_at`
3. Берём первого подходящего, проверяем `safety.js`:
   - Дневной/часовой лимит не превышен?
   - Сейчас рабочий час?
   - Между сообщениями прошло достаточно времени?
4. Если ок:
   - `ai.js` генерирует первое сообщение под профиль лида (имя, био, source_chat, оффер, ИКР, тон)
   - `telegram.js` имитирует typing 2-8 сек → отправляет
   - В `messages` запись `status=sent, role=outbound`
   - Лид переводится в `status=first_sent`
5. Если safety запретил — лид остаётся в `queued`, `next_action_at` сдвигается на следующее окно

## 9. Inbound — поток входящих

1. При старте `worker.js`: `client.addEventHandler(handler, new NewMessage({}))`
2. На каждое входящее: проверка — это лид в активной кампании?
3. Если да — кладём в in-memory очередь `pending_inbound`, ставим таймер 30-120 сек
4. Если в течение окна лид написал ещё — продлеваем таймер, дописываем в батч
5. Когда таймер сработал — собираем все сообщения батча, передаём в `dialog-engine.js`
6. Dialog engine:
   - Загружает контекст: бриф кампании + история диалога + новые входящие
   - Применяет режим автономии (см. раздел 10)
   - Возвращает действие: `send_now` / `create_draft` / `handoff` / `mark_unsubscribed` / `escalate_error`
7. Если `send_now` — таймер typing → отправка → запись в `messages`
8. Если `create_draft` — `drafts` запись + сообщение в @flash_gideon_bot с inline-кнопками `[Отправить] [Правка] [Пропустить]`

## 10. Режимы автономии (dialog-engine)

**Кто переводит `conversation.stage`:** dialog-engine при каждом ответе AI оценивает текущую стадию (intro/discovery/pitch/objection/closing/post_close) на основе полной истории и обновляет `conversations.stage`. Стадия — input для следующих решений (например, hybrid использует её как триггер).

### `full_auto`
AI всегда отвечает сам, всегда отправляем. Handoff только при явных триггерах: лид просит «дайте оператора», «человек на связи?», или AI 3 раза подряд не смог понять смысл.

### `draft_approval`
AI готовит ответ → `drafts` → ждёт Александра. Александр:
- `[Отправить]` → отправляем как есть
- `[Правка]` → бот спрашивает «напиши свой текст», отправляем введённое
- `[Пропустить]` → не отвечаем (лид остаётся в активном статусе, можно вернуться позже)

### `qualify_then_handoff` _(фаза 2)_
AI ведёт до достижения стадии `qualified` (определяется dialog-engine по правилам или AI-оценке). Затем — handoff в @flash_gideon_bot: «Лид Х готов, переписка ниже, бери в ручную работу». AI больше не пишет.

### `hybrid` _(фаза 2)_
AI ведёт сам, **но** при триггерах переключается в режим `draft_approval` для конкретного сообщения. Триггеры (настраиваются на кампанию):
- В входящем есть слова из списка (`цена | сколько | оплата | договор | счёт`)
- Стадия достигла `pitch` или `closing`
- AI неуверен (low confidence в self-eval)

## 11. HTTP API (`:3001`)

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/campaigns` | Создать кампанию |
| GET | `/api/campaigns` | Список |
| GET | `/api/campaigns/:id` | Детали |
| PUT | `/api/campaigns/:id` | Правка полей брифа |
| DELETE | `/api/campaigns/:id` | Архивация (soft delete) |
| POST | `/api/campaigns/:id/leads` | Добавить лидов (массив) |
| GET | `/api/campaigns/:id/leads` | Список лидов |
| POST | `/api/campaigns/:id/start` | Запустить |
| POST | `/api/campaigns/:id/pause` | Поставить на паузу |
| GET | `/api/campaigns/:id/stats` | Метрики (отправлено / ответили / квалифицированы / закрыты) |
| GET | `/api/conversations/:lead_id` | Полная переписка с лидом |
| POST | `/api/drafts/:msg_id/approve` | Одобрить драфт |
| POST | `/api/drafts/:msg_id/reject` | Отклонить |
| POST | `/api/drafts/:msg_id/edit` | Заменить текст и отправить |
| GET | `/api/events?campaign_id=X` | Лог событий (дебаг) |

Авторизация — переиспользуем middleware из `parser/server.js` (HMAC-токен в заголовке).

## 12. Веб-UI расширения (`gideon-bay.vercel.app`)

### Вкладка «Кампании»
Список карточек: имя, статус, режим, прогресс (отправлено / ответили / квалиф), кнопки `[Открыть] [Пауза] [Метрики]`.

### Вкладка «Кампания / детали» — три таба
- **Бриф** — поля кампании, inline-редактирование, сохранение через `PUT /api/campaigns/:id`
- **Лиды** — таблица (имя, статус, последнее сообщение, источник), кнопка «открыть переписку» _(фаза 2)_
- **Метрики** — отправлено, ответили, квалифицированы, в ИКР; воронка

### Вкладка «Переписки» _(фаза 2)_
Окно как в Telegram: AI-сообщения слева, лид справа. Поле ввода «написать от руки» → `role=human_takeover`, лид → `status=human_takeover`, AI больше не пишет автоматически.

## 13. Интеграция с @flash_gideon_bot

Новый модуль `bot/sales-menu.js`:
- Команда `/sales` — главное меню
- Подкоманды: `новая_кампания`, `мои_кампании`, `статус`, `пауза`
- Диалоговый мастер брифинга (state machine)
- Обработчик inline-кнопок для драфтов
- Алерты от воркера в личку Александра: воркер напрямую дёргает Telegram Bot API (`sendMessage`) с токеном бота — авто-пауза, флуд-вейт, лид готов к handoff, нужен драфт-апрув

Все запросы от бота к sales-manager — HTTP на `localhost:3001`. Воркер sales-manager НЕ ходит в бот через HTTP — он шлёт алерты Александру через TG Bot API напрямую, чтобы не плодить лишние зависимости.

## 14. Тестирование

- `lib/safety.js`, `lib/outbound.js`, `lib/inbound.js`, `lib/dialog-engine.js` — юнит-тесты с моками AI и Telegram
- `lib/db.js` — интеграционные тесты на временной SQLite (`:memory:` или `tmp.db`)
- E2E «прогон кампании» — мок TG-клиент с заскриптованными ответами лида + мок AI; проверяем переход `queued → first_sent → in_dialog → won` за 50 сообщений
- HTTP API — supertest на каждый endpoint
- **Боевой smoke** перед первой реальной кампанией: кампания с 1 лидом (второй TG-аккаунт)

## 15. Деплой и автозапуск

- `ecosystem.config.cjs` в `sales-manager/`: два процесса — `agent-sales-manager-server` и `agent-sales-manager-worker`
- Запуск: `pm2 start sales-manager/ecosystem.config.cjs`
- Автозапуск — через ту же задачу Планировщика Windows, что уже запускает бота (добавить вторую команду)
- Veрcel-фронт автоматически передеплоится при push в main (как сейчас с парсером)
- Caddy в `voice-input/Caddyfile` — добавить блок `sales.138-16-178-94.nip.io { reverse_proxy localhost:3001 }`
- `vercel.json` — добавить rewrite `/api/sales/*` → `https://sales.138-16-178-94.nip.io/api/*`

## 16. Открытые вопросы (на будущее)

- Где брать второй TG-аккаунт для smoke-теста (виртуальная SIM или второй личный)
- Как технически детектировать достижение ИКР (если ИКР = «записался на созвон»): парсить ссылки в исходящих + ждать подтверждение от лида? Интеграция с Calendly?
- Промпт-шаблон для AI: единый для всех кампаний с подстановкой полей, или per-mode? Уточняется на этапе writing-plans.
- Что делать с лидами в `queued` если кампания была на паузе 2 недели — пересобрать профили (био могло измениться)?
