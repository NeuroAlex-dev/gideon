# Spec: Парсер участников Telegram-чатов

- **Дата:** 2026-05-18
- **Автор:** Гидеон (по согласованию с Александром)
- **Статус:** Approved (по итогам brainstorming-сессии)
- **Папка реализации:** `parser/` в корне проекта gideon
- **Интеграция с ботом:** `bot/parser-menu.js` + минимальные правки в `bot/index.js`

---

## 1. Цель

Дать Александру простой инструмент: «спарсить @username'ы участников группового Telegram-чата». Две точки входа — веб-приложение по ссылке и Telegram-бот @flash_gideon_bot. Одно общее ядро парсинга.

## 2. Скоуп и ограничения

**В скоупе:**
- Парсинг **групповых чатов** (group, supergroup), где Александр сам состоит.
- Размер чата — **до 10 000 участников** (один запрос `getParticipants`, без постранички).
- Сбор только публичного признака — `@username`. Участников без username пропускаем.
- Два UI: веб (по ссылке, защищён `AUTH_TOKEN`) и Telegram-бот (команда `/parser`).

**Вне скоупа:**
- Каналы (channels) — Telegram скрывает их участников от не-админов.
- Чаты, в которых Александр не состоит.
- Чаты больше 10 000 участников (потребуют другой алгоритм — поиск по подстрокам, фильтры).
- Сбор телефонов, имён, фамилий, статусов онлайн, дат вступления.
- Хранение истории парсингов, БД, кеш на диск.
- HTTPS для Telegram Web App Menu-кнопки — отложено, на старте только inline-ссылка.

## 3. Архитектурные решения

| # | Решение | Причина |
|---|---|---|
| 1 | Стек: Node.js v20 + GramJS + Express + ванильный HTML/CSS/JS | Тот же стек что и у бота, без новых рантаймов, без билд-системы |
| 2 | Парсер — отдельный сервис на порту 3000 под PM2 | Слабая связь с ботом; парсер может работать когда бот выключен |
| 3 | Бот ходит в парсер по HTTP на `localhost:3000` | Никаких импортов между папками; интеграция через REST |
| 4 | Защита веб-доступа: `AUTH_TOKEN` в URL + loopback-исключение | One-user-приложение, не нужны cookie/сессии |
| 5 | Telegram User API (MTProto), не Bot API | Bot API не отдаёт список участников группы |
| 6 | Авторизация Telegram через веб-форму, session в `data/session.txt` | Визуально, один раз при первом запуске |
| 7 | Результаты не хранятся на диске; кеш в памяти 10 минут | «Простенький парсер», без БД |
| 8 | Антифлуд: 1 сек между запросами, обработка FloodWait, лимит 1 активный парсинг на пользователя | Защита от блокировки Telegram |

**Архитектурная схема:**

```
┌────────────────────┐        ┌────────────────────────────────┐
│  Браузер           │        │  @flash_gideon_bot (Grammy)    │
│  http://VPS:3000   │        │  /parser + inline-кнопки       │
│  ?token=AUTH_TOKEN │        │  → registerParserHandlers      │
└─────────┬──────────┘        └──────────────┬─────────────────┘
          │ HTTP REST                        │ HTTP REST (localhost)
          ▼                                  ▼
┌─────────────────────────────────────────────────────────────┐
│             parser/server.js (Express, :3000)               │
│  /api/health  /api/auth/*  /api/chats  /api/parse           │
│  /api/export.txt                                            │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
              ┌─────────────────────────────┐
              │  parser/lib/telegram.js     │
              │  GramJS, User API, MTProto  │
              └──────────────┬──────────────┘
                             │
                             ▼
              ┌─────────────────────────────┐
              │  Telegram MTProto API       │
              └─────────────────────────────┘
```

## 4. Структура файлов

```
parser/                              ← новая папка
├── package.json                     зависимости: telegram (GramJS), express, dotenv
├── .env.example                     шаблон секретов
├── .env                             заполняется руками, в .gitignore
├── .gitignore                       data/, .env, node_modules/
├── README.md                        как запустить, как авторизоваться
├── ecosystem.config.cjs             PM2-конфиг (process name: agent-parser)
│
├── server.js                        Express, маршруты, статика public/
├── parse.js                         CLI: node parse.js @chatname → .txt (для отладки)
│
├── lib/
│   ├── telegram.js                  GramJS клиент, getParticipants(chatRef)
│   ├── auth.js                      sendCode / signIn / 2FA — флоу авторизации
│   ├── session.js                   StringSession: load/save в data/session.txt
│   └── chats.js                     getDialogs() — список групп owner'а
│
├── public/                          фронтенд без билда
│   ├── index.html                   две вкладки: «Авторизация» / «Парсер»
│   ├── style.css                    тёмная тема
│   └── app.js                       fetch к /api/*, рендер, copy, download
│
└── data/                            runtime, в .gitignore
    ├── .gitkeep
    └── session.txt                  StringSession Telegram (создаётся после авторизации)


bot/                                 ← существующий код, минимальные правки
├── index.js                         + import { registerParserHandlers } from "./parser-menu.js";
│                                    + registerParserHandlers(bot, isOwner);
│                                    + в setMyCommands: { command: "parser", description: "Парсер участников чатов" }
└── parser-menu.js                   НОВЫЙ файл. Команды, callback'и, FSM, fetch к парсеру.
```

## 5. REST API

Все защищённые маршруты требуют либо `?token=AUTH_TOKEN` в URL, либо запроса с loopback (`127.0.0.1` / `::1`). Иначе — `401`.

### Публичные

| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/` | `public/index.html` |
| `GET` | `/style.css`, `/app.js` | статика |
| `GET` | `/api/health` | `{ ok: true, version: "1.0.0" }` |

### Авторизация Telegram (одноразовая)

```
GET  /api/auth/status
  → { authorized: boolean, hasCredentials: boolean }
  • authorized: есть ли валидная session
  • hasCredentials: заполнены ли API_ID/API_HASH в .env

POST /api/auth/send-code
  Body: { phone: "+79991234567" }
  → { phoneCodeHash: string, timeout: number }
  Под капотом: client.sendCode(...)

POST /api/auth/sign-in
  Body: { phone, phoneCodeHash, code, password? }
  → { ok: true, user: { id, username, firstName } }
  Если 2FA включена и password не передан → 400 + { error: "2fa_required" }
  При успехе: session.save() → data/session.txt

POST /api/auth/logout
  → стирает data/session.txt
```

### Парсинг

```
GET  /api/chats
  → { chats: [
       { id, title, username|null, membersCount, type: "group"|"supergroup" },
       ...
     ] }
  • Только групповые чаты (каналы исключены).
  • Сортировка по membersCount DESC.

POST /api/parse
  Body: { chatRef: "@username" | "https://t.me/..." | "-100123..." }
  → {
      chat: { id, title, membersCount },
      usernames: ["@ivan", "@petr", ...],
      stats: { total, withUsername, withoutUsername, bots },
      durationMs
    }
  • resolveChat() → getParticipants() → фильтр hasUsername → массив строк.

GET  /api/export.txt?chatId=...&jobId=...
  → text/plain, по одному @username в строке
  Content-Disposition: attachment; filename="<chatRef>-YYYY-MM-DD.txt"
  • Кеш последнего парсинга держим в памяти 10 минут.
```

### Коды ошибок

| Код | Условие | Тело |
|---|---|---|
| 400 | невалидный `chatRef`, отсутствует поле | `{ error, hint }` |
| 401 | нет/неверный токен | `{ error: "unauthorized" }` |
| 403 | нет session, или не член чата | `{ error, hint }` |
| 404 | чат не найден | `{ error: "chat_not_found" }` |
| 409 | уже идёт парсинг для этого пользователя | `{ error: "parse_in_progress" }` |
| 429 | FloodWait от Telegram | `{ retryAfter: number }` |
| 500 | внутренняя ошибка | `{ error: "internal" }` |
| 504 | парсинг > 60 сек | `{ error: "timeout" }` |

## 6. Flow в браузере

`public/index.html` — SPA на ванильном JS. Два экрана, переключаются на `GET /api/auth/status`.

**Экран A — Авторизация** (`authorized: false`):
1. Если `hasCredentials: false` — инструкция: «Зайди на my.telegram.org, создай приложение, скопируй API_ID и API_HASH в файл `parser/.env`, перезапусти сервис командой `pm2 restart agent-parser`». **Без веб-формы для API_ID/API_HASH** — эти ключи редактируются вручную, через RDP. Это упрощает код и убирает класс уязвимостей (запись в `.env` через HTTP).
2. Поле «номер телефона» → `POST /api/auth/send-code`.
3. Поле «код из Telegram» → `POST /api/auth/sign-in`. При ответе `2fa_required` показать поле пароля и повторить с `password`.
4. После успеха перезагрузка страницы → экран B.

**Экран B — Парсер** (`authorized: true`):
- Радио: «Из моих чатов» / «По ссылке/@username».
- Если «Из моих чатов» — список с поиском по названию (клиентский фильтр), сортировка по членам.
- Кнопка «Спарсить» → `POST /api/parse` → результат: статистика + список + кнопки `Копировать всё` / `Скачать .txt` / `Новый парсинг`.

**Состояния UI:** `loading`, `auth-needed`, `ready`, `parsing`, `done`, `error`, `flood-wait`.

## 7. Flow в боте

Новый файл `bot/parser-menu.js`. Состояние диалога — `Map<userId, {step, data}>` в памяти процесса.

```
/parser
  → главное меню: [📋 Из моих чатов] [🔗 По ссылке/@username]
                  [🌐 Открыть в браузере] [❌ Отмена]

📋 Из моих чатов
  → GET /api/chats → InlineKeyboard, пагинация по 8 на страницу
  → клик на чат → callback parser_chat_<id> → парсинг

🔗 По ссылке/@username
  → state: awaiting-chat-ref
  → bot.on("message:text") валидирует и переходит к парсингу

Парсинг
  → typing-индикатор каждые 4 сек
  → POST /api/parse (с обработкой FloodWait: автоповтор через retryAfter)
  → результат: статистика текстом + .txt файл через InputFile
  → кнопки: [🔁 Спарсить ещё] [📋 Главное меню]

/cancel → сброс state, главное меню
```

**Команды и меню:**
- Добавить в `setMyCommands`: `{ command: "parser", description: "Парсер участников чатов" }`.
- Menu-кнопку через `setChatMenuButton` с `type: "web_app"` **не добавлять на старте** (требует HTTPS). Альтернатива — inline-кнопка «Открыть в браузере» с обычным URL.

**Защита:** все хендлеры `parser-menu.js` начинаются с `if (!isOwner(ctx)) return;` — паттерн как в остальном коде бота.

## 8. Безопасность

### Секреты
| Что | Где | В git? |
|---|---|---|
| `BOT_TOKEN` | `~/.agent/.env` (заблокированная зона) | нет |
| `API_ID`, `API_HASH` | `parser/.env` | нет |
| `AUTH_TOKEN` | `parser/.env` (генерится автоматически если пуст) | нет |
| `OWNER_PHONE` (опционально) | `parser/.env` | нет |
| Telegram StringSession | `parser/data/session.txt` (chmod 0600) | нет |

`parser/.env.example` коммитим (пустые ключи + комментарии).

### Защита API
- Все защищённые маршруты: `AUTH_TOKEN` ИЛИ loopback.
- `AUTH_TOKEN` = `crypto.randomBytes(16).toString("hex")` если не задан.
- Никаких cookie/сессий на стороне браузера. Токен только в URL и в памяти `app.js`.

### Защита Telegram-сессии
- `session.txt` с правами `0600`.
- `POST /api/auth/logout` → стирает файл и обнуляет in-memory StringSession.
- При старте session читается в память один раз.

### Лимиты
- **FloodWait:** ловим `FloodWaitError`, возвращаем `429 { retryAfter }`. Бот сам ждёт и повторяет 1 раз. Веб — пользователь жмёт «повторить» после таймера.
- **Антифлуд:** ≥1 сек между последовательными запросами одного пользователя.
- **Один активный парсинг на пользователя:** второй запрос → `409`.
- **Hard timeout** парсинга: 60 сек → `504`.

### Логирование
- PM2 logs для бота и для `agent-parser`.
- **Не логируем:** телефон, код, 2FA, session, API_HASH, AUTH_TOKEN, username'ы участников.
- **Логируем:** метод+путь, статус, длительность, ID чата, число участников.

### Этические рамки
Парсер собирает только публичный признак (@username) и только в группах где Александр сам состоит. Что делать со списком — ответственность Александра. Массовые холодные DM Telegram бьёт быстро — это не вопрос кода, а вопрос применения.

## 9. Изменение в CLAUDE.md

В разделе «Заблокированные зоны»:
- **Было:** `~/.agent/bot/ — код бота (read-only)`
- **Станет:** `~/.agent/bot/ — продакшн копия (read-only). Менять код бота — только в gideon/bot/, потом синхронизация на сервер.`

Это нужно потому что для парсера в `bot/index.js` добавляются 2 строки, и появляется новый файл `bot/parser-menu.js`.

## 10. Что НЕ делаем (антискоуп)

- Не делаем БД, не делаем историю парсингов.
- Не делаем мульти-юзер: только `owner`.
- Не делаем экспорт в CSV/JSON (только .txt).
- Не делаем сбор полей кроме `@username`.
- Не делаем парсинг больших чатов (>10K) — отдельная задача если понадобится.
- Не делаем HTTPS на старте — Menu-кнопка через WebApp отложена.
- Не делаем рассылку, антидетект, прокси, мультиаккаунты.

## 11. Критерии приёмки

1. На VPS можно запустить `pm2 start parser/ecosystem.config.cjs` и парсер слушает порт 3000.
2. По адресу `http://138.16.178.94:3000?token=<AUTH_TOKEN>` открывается экран авторизации.
3. После ручного заполнения `API_ID`/`API_HASH` в `parser/.env` и прохождения веб-авторизации (телефон → код → 2FA если есть) сохраняется `data/session.txt`.
4. На главном экране отображается список групповых чатов Александра, отсортированный по членам.
5. Выбор чата → кнопка «Спарсить» → за <15 сек приходит список `@username`'ов, кнопки `Копировать` и `Скачать .txt` работают.
6. В @flash_gideon_bot команда `/parser` показывает inline-меню; выбор чата → бот присылает .txt файл.
7. Поле «По ссылке/@username» в боте и в вебе принимает форматы: `@xxx`, `t.me/xxx`, `https://t.me/xxx`, `t.me/joinchat/yyy`.
8. FloodWait отрабатывается: пользователь видит таймер и сообщение, не сырой stacktrace.
9. Без `AUTH_TOKEN` веб возвращает 401. С неправильным токеном — тоже 401.
10. `parser/.env` и `parser/data/` отсутствуют в `git status` после первого запуска.

## 12. План вытекающих задач (для writing-plans)

Следующий шаг — детальный план реализации по шагам с TDD:
1. Скаффолд `parser/` (package.json, .env.example, .gitignore, ecosystem.config.cjs).
2. `lib/session.js` + тесты.
3. `lib/telegram.js` (resolveChat, getParticipants) + тесты с моками.
4. `lib/auth.js` + тесты.
5. `lib/chats.js` + тесты.
6. `server.js` — middleware auth, маршруты `/api/health`, `/api/auth/*`.
7. `server.js` — маршруты `/api/chats`, `/api/parse`, `/api/export.txt`.
8. `public/` — HTML, CSS, app.js (экран A → B → результат).
9. Запуск под PM2, ручное тестирование с реальным аккаунтом на тестовом чате.
10. `bot/parser-menu.js` + правки `bot/index.js`.
11. Синхронизация бота на `~/.agent/bot/`, перезапуск PM2.
12. E2E проверка: реальный чат до 10K, через веб и через бота.
13. Обновление CLAUDE.md (пункт 9), MEMORY.md (новый раздел про парсер).
