---
name: trend-search
description: Use when Alexander asks about trends/что взлетает/тренды/trending in a niche. Делает поиск восходящих запросов и обсуждений по нише через Google Trends и Reddit (бесплатно, без auth) и предлагает написать пост по найденному тренду.
---

# Поиск по трендам (Google Trends + Reddit)

Когда Александр спрашивает в общем чате «что сейчас в трендах по X», «какие хайповые темы в нише Y», «найди тренды про нейросети» — используй этот скилл вместо обычного Claude-ответа из общих знаний. Тренды — это living data, общие знания тут не помогут.

## Что доступно

Сервис content-agent (`http://127.0.0.1:3002`) принимает `POST /api/trends`:

```
POST /api/trends
Body: {
  niche: string,                                  // обязательно: "нейросети", "AI agents", "копирайтинг"
  period?: "today" | "3days" | "week" | "month",  // дефолт "week"
  sources?: ["google_trends", "reddit"],          // дефолт оба
  geo?: "RU" | "US" | ""                          // дефолт RU
}
Headers: x-auth-token: <hmac(secret, password)>
```

Возвращает `{ digest_id, count, items, errors }`. Каждый item: `{ id, platform, title, summary, url, metrics: {reactions, comments, ...} }`.

## Когда НЕ запускать

- Если Александр уже пользуется кнопкой «🔥 Поиск по трендам» в боте — кнопка сама зовёт этот API через мастер, ты не нужен.
- Если он спрашивает что-то общее («объясни тренд X», «расскажи про Y») — это не тренды, отвечай как обычно.

## Связь с написанием поста

Каждый найденный тренд — это `digest_item`. Поэтому работает существующий поток: `POST /api/posts {origin:"digest_item", digest_item_id:<id>}` сгенерирует пост в стиле Александра на основе этого тренда (использует `data/style/*.md`).

## Источники

- **Google Trends** (`lib/trends/google-trends.js`) — `relatedQueries` с `geo=RU`, фильтр rising. Бесплатно через unofficial-обёртку.
- **Reddit** (`lib/trends/reddit.js`) — `/search.json?sort=top&t=<period>`. Бесплатно, без auth. UA: `content-agent/0.1`.

Apify (платный) пока не подключён — добавим если упрёмся в нехватку источников.