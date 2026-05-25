# jarvis-docs

Воссозданная база знаний по Джарвису. Исходник — выгрузка HTML в `../jarvis-website/jarvis/`.

## Структура

```
jarvis-docs/
├── public/           # деплой (статический сайт)
│   ├── index.html
│   ├── style.css
│   ├── script.js
│   └── <section>/<slug>.html
├── scripts/
│   ├── build.js     # парсер + генератор
│   └── templates.js  # HTML-шаблоны (без движка)
├── vercel.json
└── README.md
```

## Как пересобрать

```
node scripts/build.js
```

Читает `../jarvis-website/jarvis/*.html`, парсит, переписывает ссылки `/docs/...` → `/...`, генерирует:
- `public/index.html` — главная
- `public/<section>/index.html` — индекс каждого раздела (11 разделов)
- `public/<section>/<slug>.html` — статьи

## Локальный просмотр

```
npx serve public
```

## Деплой

```
cd jarvis-docs
npx vercel --prod
```

При первом деплое Vercel спросит имя проекта (например `jarvis-docs`).
