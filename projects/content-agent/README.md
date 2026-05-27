# Контент-Агент (Фаза 1: стиль + посты)

Сервис генерации контента в стиле Александра. HTTP API на :3002, управление — через раздел «✍ Контент» в @flash_gideon_bot.

## Запуск
1. `cp .env.example .env` и заполнить (CA_PASSWORD/CA_SECRET — те же, что у парсера; CLAUDE_CLI_PATH, AGENT_HOME).
2. Установка: `powershell -Command '$env:PATH = "C:\Users\Administrator\nodejs;" + $env:PATH; npm install'`
3. Тесты: `npm test`
4. PM2: `pm2 start ecosystem.config.cjs`

## Эндпоинты (x-auth-token, кроме /health и /auth)
- `GET /api/health`
- `POST /api/auth {password}` → `{token}`
- `GET /api/style/status`
- `POST /api/style/interview/start|answer|material|finish`, `POST /api/style/retrain`
- `POST /api/posts {user_prompt}`, `POST /api/posts/:id/variant {mode}`, `POST /api/posts/:id/approve`, `GET /api/posts/:id`
- `GET/PUT /api/settings`

Профиль стиля — 5 md в `data/style/`. БД — `data/content-agent.db`.
