# Vecta — Legacy Baseline Audit

Дата проверки: 2026-08-29

Проверенная ветка: `feat/vecta-rebuild`
Legacy baseline tag: `local-baseline-before-origin`

## Резюме

Legacy-приложение пригодно только как функциональная и визуальная ссылка для ревампа. Оно собирается, но не является безопасным для staging или production. Исправления выполняются по фазам строгого плана; текущая Firebase-архитектура не переносится.

## Git и репозиторий

- Remote: `https://github.com/SameQushori/survey-platform.git`.
- Base branch: `origin/main`.
- Рабочая ветка: `feat/vecta-rebuild`.
- Истории local baseline и `origin/main` объединены merge-коммитом.
- `node_modules`, `dist`, environment-файлы, Cloudflare local state, test output и AI-agent artifacts игнорируются.
- Файлы с названиями `.env`, credentials, service account или private key в tracked history текущей проверки не обнаружены.

## Воспроизводимость

- `npm run build`: проходит.
- Vite: `7.3.6`, 98 modules transformed.
- Основной JS chunk: `691.94 kB` minified / `212.16 kB` gzip; превышает warning threshold 500 kB.
- Основное изображение: около `1.18 MB`.
- `npm run lint`: не проходит — 16 errors, 7 warnings.
- Test script и автоматические тесты отсутствуют.
- TypeScript фактически не настроен: source использует JS/JSX, `tsconfig` отсутствует.

## Dependency audit

- `npm audit --audit-level=moderate`: 2 moderate vulnerabilities.
- Затронуты `react-router` / `react-router-dom` 6.x.
- Автоматическое исправление требует breaking upgrade до 7.x; `npm audit fix --force` не использовать.
- Устранение выполняется в новой архитектуре с тестами маршрутов.

## Блокирующие security findings

### Critical — полностью открытый Firestore

`firestore.rules` разрешает анонимное чтение и запись любого документа. Это позволяет читать ответы и администраторов, изменять тесты и результаты и удалять данные.

### Critical — клиентская авторизация и подмена роли

Сессия и роль хранятся в `localStorage` и проверяются клиентом. Пользователь может самостоятельно сформировать admin session и получить административный UI.

### Critical — обратимое хранение паролей

Legacy auth кодирует пароль через Base64 с фиксированной строкой и содержит функцию обратного восстановления. Интерфейс Super Admin умеет отображать пароли организаторов. Такая модель не переносится в Vecta.

### Critical — общий встроенный Super Admin

В baseline tag и истории `origin/main` находится одинаковая известная пара логин/пароль для автоматического создания Super Admin. Автоматический bootstrap удалён из рабочей ветки, однако legacy-приложение всё равно нельзя публиковать даже как временный production build.

### High — публичный клиент имеет прямой доступ к данным

React напрямую обращается к Firestore. Нельзя надёжно скрыть answer key, обеспечить tenant isolation, неизменяемость версии, server deadline или идемпотентность submit.

### High — небезопасные токены

Session token создаётся через `Math.random()` и timestamp и не проверяется доверенным сервером.

### High — потенциальная утечка данных в логах

Legacy-код пишет диагностические объекты и результаты операций в browser console. Перед production логирование будет заменено структурированными событиями без PII, ответов и токенов.

### Medium — CSV formula injection

Экспорт строится на клиенте из пользовательских значений без обязательной нейтрализации spreadsheet-формул.

### Medium — supply-chain findings

React Router содержит две известные moderate-уязвимости. Breaking upgrade выполняется контролируемо, с E2E-тестами.

## Product и UX findings

- README описывает TypeScript, Redux Toolkit, Axios, CSS Modules, Chart.js и Recharts, которых нет в фактическом проекте.
- Навигация построена на `HashRouter`; целевой продукт использует обычные routes через Cloudflare SPA fallback.
- Состояния loading/error/empty реализованы непоследовательно.
- Доступ участника и ограничение повторных попыток доверяют браузеру.
- Тексты смешивают «опрос» и «тест»; Vecta использует assessment-first терминологию.
- В UI присутствуют emoji как системные иконки; в новом design system они запрещены.
- В репозитории находятся файлы Segoe UI. Перед релизом их нужно заменить на легально разрешённый webfont или системный stack и проверить лицензию.
- Bundle требует code splitting, а крупное hero-изображение — оптимизации и responsive formats.

## Решение

- Legacy runtime не деплоить.
- Не исправлять Firebase security как промежуточную production-архитектуру.
- Использовать legacy только как reference до завершения соответствующего vertical slice.
- Новые Worker/D1 endpoints проектировать с deny-by-default authorization и тестами tenant isolation.
