# Phase 10 — Firebase Retirement

Дата закрытия: 2026-09-01
Результат: clean start, без миграции legacy-данных.

## Решение о данных

Владелец продукта подтвердил, что старые Firebase-опросы, ответы и организаторы не нужны. Read-only архив не создавался: он не требуется для продукта и не должен попадать в Git. Единственный источник runtime-данных Vecta — новая D1 schema из `migrations/`.

## Удалено

- Firebase bootstrap и managers: `src/firebase.js`, legacy `src/utils/`.
- Старое JSX-приложение: `src/App.jsx`, `src/main.jsx`, legacy `src/components/` и `src/pages/`.
- Старые CSS, изображения, шрифты и starter asset Vite, которые не использовались Vecta.
- Устаревшие Firebase setup/quick-fix документы.
- Dependencies `firebase`, `file-saver` и `gh-pages` вместе с их lockfile graph.
- ESLint-исключения для legacy-кода.

## Проверка retirement

- Active entry point — только `src/main.tsx` → `src/vecta/VectaApp.tsx`.
- В `package.json`/`package-lock.json` нет Firebase, FileSaver или GitHub Pages runtime.
- В active source, Worker, shared contracts, migrations и tests нет Firebase imports или endpoint references.
- В tracked runtime-конфигурации нет Firebase credentials/generated config.
- Production bundle не содержит Firebase SDK markers/endpoints.
- Полный typecheck, lint, unit, Worker/D1 integration, build и dependency audit проходят после удаления.

## Breaking-change note

Это намеренный breaking clean start: legacy Firebase приложение и данные несовместимы с Vecta и не поддерживаются. Rollback к legacy runtime в рамках новой ветки не предусмотрен; исторический baseline остаётся доступен в Git tag `local-baseline-before-origin`.
