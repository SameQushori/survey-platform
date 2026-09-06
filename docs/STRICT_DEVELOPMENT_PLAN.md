# Vecta — строгий план разработки

Статус: Phase 0–10 и Phase 12 закрыты; автономная часть Phase 11 завершена, внешние auth/performance/deploy gates отложены владельцем
Дата фиксации: 2026-08-29; актуализировано 2026-09-06

## 1. Назначение документа

Этот документ является обязательным маршрутом полного ревампа Survey Platform в продукт Vecta. Реализация идёт только по фазам ниже. Любое предложение, не входящее в текущую фазу, переносится в backlog и не реализуется без явного согласования с владельцем продукта.

## 2. Зафиксированные решения

- Бренд: **Vecta**.
- Продукт: assessment-first платформа для корпоративных тестов и проверки знаний.
- Основной язык первой версии: русский.
- Frontend: React + TypeScript strict + Vite.
- Runtime и hosting: Cloudflare Workers со Static Assets через Cloudflare Vite plugin.
- API: Cloudflare Worker; UI не обращается напрямую к D1, R2 или другим bindings.
- Основная БД: Cloudflare D1.
- Файлы и тяжёлые выгрузки: Cloudflare R2 только при фактической необходимости.
- Защита публичных форм: Turnstile с обязательной серверной Siteverify-проверкой.
- Ограничение злоупотреблений: Workers Rate Limiting плюс серверные ограничения в D1.
- Тестирование обязательно; фаза не закрывается при падающих проверках.
- Финал: staging, production-hosting на Cloudflare, очистка репозитория, обновление `.gitignore`, затем один большой Pull Request.
- Существующие Firebase-опросы и ответы не переносятся; Vecta начинает работу с чистой D1.
- Участие поддерживает два режима: открытый и контролируемый.
- Результат участника скрыт по умолчанию и показывается только при включённой организатором настройке.
- GitHub: `https://github.com/SameQushori/survey-platform`, base branch: `main`.

## 3. Запреты на отклонение

1. Не добавлять функции, отсутствующие в разделе MVP Scope.
2. Не переходить к следующей фазе, пока не выполнены acceptance criteria текущей.
3. Не менять согласованный стек без отдельного решения владельца продукта.
4. Не устанавливать новую зависимость без конкретной технической причины и записи в Decision Log.
5. Не хранить пароли, токены, API keys, `.env`, `.dev.vars`, дампы и production-данные в Git.
6. Не выполнять прямые клиентские операции с D1 или R2.
7. Не реализовывать собственное хранение пользовательских паролей.
8. Не отправлять участнику правильные ответы до завершения разрешённого продуктом момента.
9. Не изменять production-данные без резервной копии и проверенного migration plan.
10. Не деплоить production при падающих lint, typecheck, tests, build, E2E или security checks.
11. Не отправлять изменения напрямую в `main`; финальная доставка идёт через Pull Request.
12. При неоднозначности, влияющей на UX, безопасность, данные или scope, остановиться и запросить решение пользователя.

## 4. MVP Scope

### 4.1 Роли

- Organizer: самостоятельная регистрация по подтверждённому email и работа только в личном workspace.
- Organizer: создание, публикация и анализ тестов.
- Participant: вход по коду или ссылке без постоянной учётной записи.

### 4.2 Жизненный цикл теста

`draft -> published -> closed -> archived`

- Draft можно редактировать.
- При публикации создаётся неизменяемая версия теста.
- Новая редакция создаёт новую версию, но не меняет уже начатые попытки.
- Closed запрещает новые попытки, но сохраняет аналитику.
- Archived скрывает тест из рабочего списка без удаления данных.

### 4.3 Типы вопросов первой версии

- Один вариант ответа.
- Несколько вариантов ответа.
- Оценка по шкале.

Текстовые ответы, новые типы, ветвление, матрицы, загрузка файлов и AI-генерация вопросов не входят в MVP. Текстовый ответ сохранён в post-MVP backlog до отдельного решения по проверке и оцениванию.

### 4.4 Режимы участия

- **Открытый:** вход по общей ссылке или коду, участник вводит отображаемое имя; повторные попытки разрешены политикой теста.
- **Контролируемый:** персональная одноразовая ссылка/токен; одна завершённая попытка на приглашение.
- В обоих режимах сервер, а не клиент, определяет допустимость старта и повторной попытки.
- Постоянный аккаунт участника в MVP не создаётся.

### 4.5 Результат участника

- Настройка `showParticipantResult` выключена по умолчанию для каждого теста.
- Если организатор включает настройку, после успешной отправки показываются набранный и максимальный баллы.
- Правильные ответы и answer key участнику в MVP не раскрываются.
- Если настройка выключена, участник видит только подтверждение завершения.

### 4.6 Обязательные поверхности

- Публичная главная Vecta.
- Вход и состояние отсутствия доступа.
- Платформенная панель Super Admin (исключена решением от 2026-09-05).
- Панель Organizer.
- Список тестов и состояния empty/loading/error.
- Создание и редактирование draft.
- Preview и публикация.
- Страница распространения: ссылка, код, QR.
- Вход участника.
- Инструкция перед стартом.
- Экран вопроса.
- Подтверждение отправки.
- Экран результата участника.
- Обзор результатов организатора.
- Анализ вопросов.
- Список попыток.
- Экспорт результатов.
- 404, expired/invalid code, closed test, rate-limited и network error.
- Desktop и mobile states для всех ключевых сценариев.

## 5. Целевая архитектура

### 5.1 Приложение

- `src/` — React UI.
- `worker/` — Cloudflare Worker API.
- `shared/` — общие TypeScript-типы и схемы, не содержащие секретной логики.
- `migrations/` — последовательные D1 migrations.
- `tests/` — unit, integration и E2E.
- `docs/` — продуктовые и архитектурные решения.

### 5.2 Cloudflare

- Worker Static Assets обслуживает React SPA.
- `/api/*` обрабатывается Worker.
- D1 binding доступен только Worker.
- R2 binding добавляется только при реализации файлового экспорта.
- Turnstile проверяется Worker до создания публичной попытки.
- Rate Limiting применяется к organizer login, проверке participant-кодов и отправке попытки.
- Organizer identity — открытая регистрация по email + одноразовый код; Worker создаёт личный workspace после подтверждения, хранит только HMAC digest OTP/session и проверяет D1 membership.
- Workers Logs используются без записи ответов, токенов и персональных данных.

### 5.3 Предварительные таблицы D1

- `organizations`
- `users`
- `memberships`
- `assessments`
- `assessment_versions`
- `questions`
- `question_options`
- `publications`
- `attempts`
- `answers`
- `results`
- `audit_log`
- `idempotency_keys`

Окончательные поля утверждаются в Phase 2 на основе закрытых продуктовых правил. Auth-поля уточняются после выбора managed auth перед Phase 5.

## 6. Маршрут разработки

## Phase 0 — Product Rules Freeze

### Работы

- Закрыть продуктовые вопросы Decision Gate 0 и явно зафиксировать допустимое отложенное auth-решение.
- Сформировать `docs/PRODUCT_SPEC.md`.
- Зафиксировать роли, права и participant policies.
- Зафиксировать scoring rules и результат участника.
- Зафиксировать data retention и работу с текущими Firebase-данными.

### Acceptance criteria

- На продуктовые вопросы Decision Gate 0 есть однозначный ответ; auth-вариант вынесен в отдельный обязательный gate перед Phase 5.
- В Product Spec отсутствуют взаимоисключающие правила.
- MVP Scope подтверждён владельцем продукта.

### Запрещено в этой фазе

- Менять production-код.
- Создавать Cloudflare production-ресурсы.
- Генерировать финальный дизайн.

## Phase 1 — Repository Baseline and Hygiene

### Работы

- Восстановить полноценный Git working tree и подключить `origin` к `https://github.com/SameQushori/survey-platform`.
- Зафиксировать baseline старого приложения.
- Создать рабочую ветку полного ревампа от/с объединением истории `origin/main`; прямые изменения в `main` запрещены.
- Обновить `.gitignore` для `.env*`, `.dev.vars*`, `.wrangler/`, coverage, test artifacts, generated design artifacts, AI/Codex working files и локальных дампов.
- Оставить versioned `.env.example`/`.dev.vars.example` только с именами переменных.
- Добавить Decision Log и Architecture Decision Records.

### Acceptance criteria

- `git status` работает.
- Remote и base branch известны.
- В tracked-файлах нет секретов и generated artifacts.
- Старое приложение можно собрать до начала миграции.

## Phase 2 — Domain, API and Database Contract

### Работы

- Описать TypeScript domain types.
- Создать D1 ER model и миграции.
- Зафиксировать API endpoints и OpenAPI-like contract.
- Определить public/private DTO; answer key отсутствует в participant DTO.
- Описать auth, authorization, signed attempt token и idempotency.
- Написать unit-тесты scoring и validation до UI.

### Acceptance criteria

- Миграции применяются к пустой локальной D1.
- Повторное применение не повреждает данные.
- API contract покрывает весь MVP Scope.
- Permission matrix покрывает каждую роль и endpoint.
- Unit-тесты domain logic проходят.

## Phase 3 — UX Logic and Visual Direction

### Работы

- Составить route map и user flows.
- Создать low-fidelity wireflows всех обязательных поверхностей.
- Через GPT Image 2 создать ровно три визуальных направления Vecta на основе текущих экранов и Product Spec.
- Пользователь выбирает одно направление и вносит правки.
- Сгенерировать согласованный набор desktop/mobile экранов и состояний.
- Зафиксировать tokens: typography, color, spacing, radius, elevation, icons.

### Acceptance criteria

- Владелец продукта выбрал одно направление.
- Есть утверждённые макеты всех обязательных поверхностей.
- Empty/loading/error/disabled/focus/mobile состояния заданы.
- Дизайн не содержит неона, glassmorphism, emoji-иконок и декоративной AI-геометрии.

### Запрещено в этой фазе

- Начинать production UI до утверждения визуального направления.
- Добавлять новые продуктовые функции из визуальных концептов.

## Phase 4 — Cloudflare Foundation

### Работы

- Перевести проект на React + TypeScript strict.
- Подключить Cloudflare Vite plugin и Worker API.
- Настроить `wrangler.jsonc`, локальные environments и bindings.
- Подключить D1 и применить локальные миграции.
- Создать API shell, validation, error model, request IDs и security headers.
- Настроить Vitest с Cloudflare Workers test environment.

### Acceptance criteria

- `npm run dev` запускает React и Worker локально.
- `npm run typecheck`, `lint`, `test` и `build` проходят.
- `/api/health` проверяет Worker без раскрытия конфигурации.
- Локальная D1 доступна только через API.
- Секреты отсутствуют в репозитории.

## Phase 5 — Identity and Administration Vertical Slice

### Обязательный gate перед началом

- Владелец продукта выбирает один production-вариант входа организаторов: Cloudflare Access с IdP, email one-time code или другой managed auth.
- До выбора разрешена только изолированная тестовая identity-заглушка для локальной разработки; она не деплоится и не используется как production-аутентификация.

### Работы

- Интегрировать подтверждённый auth-вариант организаторов.
- Реализовать server-side role checks.
- Реализовать organization membership.
- Реализовать Organizer navigation/shell; platform-wide administration удалено решением от 2026-09-05.
- Добавить audit log административных действий.

### Acceptance criteria

- Клиентская подмена роли не даёт доступа.
- Неавторизованные запросы получают 401, запросы без права — 403.
- Пароли не хранятся и не отображаются Vecta.
- E2E auth/authorization сценарии проходят.

## Phase 6 — Assessment Authoring and Publishing

### Работы

- Список тестов и состояния.
- Создание/редактирование draft.
- Question builder для трёх утверждённых типов.
- Preview.
- Immutable version publishing.
- Open/close/archive.
- Код, ссылка и QR.

### Acceptance criteria

- Невалидный assessment нельзя опубликовать.
- Published version неизменяема.
- Код уникален и генерируется криптографически.
- QR ведёт на корректный production-independent route.
- Unit, integration и E2E сценарии проходят.

## Phase 7 — Participant Attempt Vertical Slice

### Работы

- Проверка кода.
- Turnstile и rate limits.
- Создание Attempt и подписанного короткоживущего токена.
- Инструкция и старт.
- Серверный timer/deadline.
- Ответы и навигация.
- Idempotent submit.
- Результат согласно Product Spec.
- Применение открытого или контролируемого режима участия.
- Выдача результата только при включённой организатором настройке.

### Acceptance criteria

- Правильные ответы отсутствуют в participant payload.
- Изменение клиентского времени не продлевает попытку.
- Повторная отправка не создаёт дубль.
- Invalid/expired/closed/rate-limited состояния протестированы.
- Незавершённая попытка обрабатывается по утверждённому правилу.

## Phase 8 — Results, Analytics and Export

Статус: **завершена 2026-09-01**. Реализация, fixture validation, tenant isolation, CSV neutralization и desktop/mobile QA зафиксированы в `PROJECT_STATUS.md`.

### Работы

- Overview результатов.
- Question analysis.
- Attempts list и detail.
- Корректные агрегаты и scoring.
- CSV export с защитой от spreadsheet formula injection.
- R2 используется только если экспорт становится асинхронным или тяжёлым.

### Acceptance criteria

- Агрегаты сверены с fixture datasets.
- Организатор видит только данные своей организации.
- Экспорт не раскрывает данные другой организации.
- Формулы в CSV нейтрализованы.

## Phase 9 — Hardening and Quality Gate

Статус: **завершена 2026-09-01**. Evidence: `docs/PHASE_9_QUALITY_GATE.md` и `docs/SECURITY_THREAT_MODEL.md`.

### Работы

- Полный lint/typecheck/unit/integration/E2E.
- Accessibility QA по WCAG 2.2 AA.
- Keyboard и screen-reader smoke tests.
- Responsive QA.
- Bundle/image optimization.
- Threat-model review.
- Rate limit, Turnstile и auth abuse tests.
- Dependency audit.

### Acceptance criteria

- Все проверки зелёные.
- Нет critical/high dependency vulnerabilities.
- Нет известных P0/P1 security defects.
- Ключевые сценарии проходят desktop и mobile.
- Нет console logs с PII, ответами или токенами.

## Phase 10 — Firebase Retirement

Статус: **завершена 2026-09-01** без миграции и архива legacy-данных по подтверждённому решению владельца. Evidence: `docs/PHASE_10_FIREBASE_RETIREMENT.md`.

### Работы

- Не переносить существующие опросы, ответы и организаторов в D1.
- Перед удалением интеграции при необходимости сделать read-only архив Firebase для аварийного возврата; архив не коммитить в Git.
- Убедиться, что Vecta использует чистую D1 и не читает Firebase во время работы.
- Удалить Firebase-код, конфигурацию и зависимости.
- Проверить отсутствие Firebase secrets и generated config в tracked-файлах и истории нового PR.

### Acceptance criteria

- Решение о чистом старте отражено в документации и release notes.
- Если архив создавался, он проверен и хранится вне Git.
- Vecta больше не зависит от Firebase runtime.

## Phase 11 — Cloudflare Staging and Production

Статус: **автономная часть завершена 2026-09-06; внешние gates отложены владельцем**. Staging развёрнут; production D1, migrations, environment-конфигурация и атомарные dry-run deploy-команды готовы. OTP UAT, production secrets/Turnstile hostnames, Core Web Vitals и реальный production deploy требуют внешнего доступа/решения. Evidence: `docs/PHASE_11_STAGING.md`, `docs/DEPLOYMENT.md`.

### Работы

- Создать staging Worker/D1/R2/Turnstile resources.
- Применить migrations к staging.
- Провести E2E и ручной UAT.
- Настроить production resources и secrets.
- Выполнить production deploy.
- Проверить health, migrations, rollback и observability.

### Acceptance criteria

- Staging утверждён владельцем продукта.
- Production deploy воспроизводим одной documented-командой/CI job.
- Rollback проверен.
- Секреты находятся только в Cloudflare Secrets/CI secrets.
- Публичный URL и основные сценарии проверены.

## Phase 12 — Repository Finalization and Pull Request

Статус: **завершена 2026-09-06**. CI, README, deployment/rollback, release notes, Git/release scan, PR #1 и профильный README готовы; merge остаётся решением владельца.

### Работы

- Проверить, что удалённые в Phase 10 obsolete Firebase/demo файлы не вернулись и чистый Cloudflare runtime успешно прошёл staging.
- Финально проверить `.gitignore` и untracked artifacts.
- Обновить README, architecture, setup, deployment и migration docs.
- Сформировать один большой Pull Request с breaking-change summary.
- Приложить test evidence, screenshots, security notes и rollback plan.

### Acceptance criteria

- Working tree содержит только осознанные изменения.
- PR не содержит секретов, локальных дампов, AI/Codex artifacts и generated caches.
- CI PR зелёный.
- PR готов к review и не merge-ится без решения владельца продукта.

## 7. Decision Gate 0 — результат

1. **Данные:** Vecta начинает с чистой D1; старые Firebase-данные не мигрируются.
2. **Вход организаторов:** решение 2026-08-30 заменено 2026-09-01 — встроенный email One-time Code, HMAC digests и HttpOnly server-side session; Worker валидирует D1 membership.
3. **Попытки:** добавляются открытый и контролируемый режимы участия согласно разделу 4.4.
4. **Результат участника:** по умолчанию скрыт; при включении организатором показывается балл, но не answer key.
5. **Текстовые ответы:** перенесены в post-MVP backlog и сейчас не реализуются.

Phase 1 разрешена. Phase 5 запрещено начинать без закрытия пункта 2.

## 8. Контроль изменений

Любое новое решение записывается в `docs/DECISIONS.md` со следующими полями:

- дата;
- вопрос;
- принятое решение;
- причина;
- затронутые фазы;
- требуется ли изменение этого плана.

Если решение меняет MVP Scope, безопасность, модель данных или утверждённый дизайн, работа останавливается до подтверждения владельца продукта.
