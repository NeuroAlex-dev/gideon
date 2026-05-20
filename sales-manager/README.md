# sales-manager

AI-продавец на Telegram. Outbound (исходящие с задержками) + inbound (AI-ответы) для тёплого аутрича от личного аккаунта.

Спека: `docs/superpowers/specs/2026-05-21-sales-manager-design.md`
План: `docs/superpowers/plans/2026-05-21-sales-manager.md`

## Запуск
- HTTP API: `npm run start:server` (порт 3001)
- Worker: `npm run start:worker`
- PM2: `pm2 start ecosystem.config.cjs`

## Тесты
`npm test`
