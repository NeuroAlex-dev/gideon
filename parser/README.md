# Gideon Parser

Парсер участников Telegram-чатов. Часть проекта Gideon.

## Быстрый старт

1. `cd parser && npm install`
2. На https://my.telegram.org → API development tools → создай приложение
3. Скопируй `API_ID` и `API_HASH` в `parser/.env` (см. `.env.example`)
4. `npm start`
5. Открой `http://localhost:3000?token=<AUTH_TOKEN>` (токен в логах при первом запуске)
6. Пройди авторизацию: телефон → код → 2FA если есть
7. Готово. Можешь парсить участников групп где состоишь.

## Команды

- `npm start` — запуск сервера
- `npm run dev` — с авто-перезапуском при изменении
- `npm test` — юнит-тесты
- `npm run cli -- @chatname` — CLI парсинг для отладки

## Запуск под PM2

`pm2 start ecosystem.config.cjs`

См. полную спеку: `../docs/superpowers/specs/2026-05-18-telegram-parser-design.md`
