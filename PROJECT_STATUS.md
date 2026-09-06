# Vecta — Project Status / Handoff

Последнее обновление: 2026-09-06

Версия: **1.0.0 release candidate**

Текущая фаза: **Phase 11 external UAT; Phase 12 завершена**

Этот файл — каноническая точка продолжения в другом чате. Сначала прочитать его, затем `docs/STRICT_DEVELOPMENT_PLAN.md`, `docs/DECISIONS.md` и проверить фактический `git status`.

## Зафиксированный продукт

- Бренд: **Vecta**.
- Assessment-first платформа корпоративного тестирования, основной язык MVP — русский.
- Backend/hosting: Cloudflare Workers + Static Assets, D1, Turnstile и Rate Limiting.
- Organizer identity: открытая регистрация по email → шестизначный OTP → личное пространство → 12-часовая revocable HttpOnly session.
- Общей Super Admin-роли и платформенной панели администрирования нет; каждый подтверждённый пользователь — организатор только своего пространства.
- Participant modes: общий код/ссылка и контролируемое одноразовое приглашение.
- Результат участника скрыт по умолчанию; при включении показываются только score/maxScore.
- Типы вопросов MVP: один вариант, несколько вариантов, шкала.
- Старые Firebase-опросы и аккаунты не мигрируются.

## Выполнено в коде

- Полностью удалены legacy JSX/Firebase runtime, setup и зависимости.
- Реализованы responsive onboarding, self-service регистрация, organizer workspace, Kanban, authoring, publishing, participant lifecycle, results, analytics и CSV.
- Доска поддерживает forward/reopen/revise без изменения immutable исторических публикаций и результатов.
- Реализованы email OTP, автоматическое provision личного пространства, HMAC-only challenges/sessions, бесплатный Turnstile, IP/email rate limits, CSRF/same-origin boundary и tenant-safe authorization.
- Исправлены autosave race, публикация, participant exit, auth handoff, modal states, шестиячеечный OTP и обратные lifecycle-переходы.
- Удалён production URL-переключатель mock loading/empty/error states.
- Dependency stack обновлён в пределах текущих major; полный audit — 0 vulnerabilities.
- Добавлен GitHub Actions quality gate и документация deployment/rollback/release.

## Автоматический release gate

На 2026-09-06 проходит:

- `npm run typecheck`;
- `npm run lint`;
- 32 unit tests в 8 файлах;
- 35 Worker/D1 integration tests в 6 файлах;
- `npm run build`;
- `npm audit --audit-level=moderate` — 0 vulnerabilities;
- post-build scan — `.env*`/`.dev.vars*` отсутствуют в `dist`.

## Cloudflare inventory

### Staging

- D1: `vecta-staging`, ID `fcbe1d68-f3ec-4d9b-966e-202a288fe8fc`, 6 migrations / 18 tables; legacy privileged users: `0`, foreign keys clean.
- Public: <https://vecta-staging-public.alimbekov1234567890.workers.dev>, version `fcf05337-9b5c-4410-8d2b-fde5b4261680`.
- Organizer: <https://vecta-staging-organizer.alimbekov1234567890.workers.dev>, version `702e7110-7566-4fe2-85fa-1b614b8a6ed2`.
- Единственный owner email исправлен на подтверждённый пользователем адрес; PII не хранится в Git.

### Production — подготовлено, но Worker deploy намеренно не выполнен

- D1: `vecta-production`, ID `44ad08b1-d7e0-49d7-ad25-9594f50a1227`, регион WEUR.
- Применены все 6 migrations, создано 18 application tables, legacy privileged users: `0`, `PRAGMA foreign_key_check` чистый.
- Существующий production owner сохранён как обычный Organizer; migration `0006` обнуляет legacy platform role.
- `wrangler.jsonc` содержит отдельные `production-public` / `production-organizer`, Worker names `vecta-public` / `vecta-organizer`, отдельные rate-limit namespaces и D1 binding.
- Production Workers не публикуются до настройки secrets и успешного OTP UAT: deploy без Turnstile/рабочего email provider создал бы заведомо неработающий или небезопасный вход.

## Внешние release-gates

1. Подтвердить выбранный sender в Brevo, интерактивно установить staging `AUTH_EMAIL_FROM` и `BREVO_API_KEY`, затем развернуть новую Organizer version.
2. Owner проходит staging вход на отдельный тестовый адрес: Turnstile → письмо → OTP → `/app` → logout → повторный вход.
3. После успеха удалить устаревший staging secret `ORGANIZER_ACCESS_CODE`.
4. Добавить production hostnames в Turnstile, переключить production config на проверенный Brevo sender и интерактивно задать production secrets.
5. Снять LCP/CLS/INP через Chrome DevTools MCP или вручную в DevTools. В текущей среде DevTools MCP не подключён, поэтому метрики не вымышлялись.

## Точный следующий маршрут

1. Завершить Brevo sender/API-key setup, deploy staging Organizer и выполнить OTP UAT по `docs/ORGANIZER_AUTH_RUNBOOK.md`.
2. После подтверждённой доставки переключить production Organizer на Brevo и настроить четыре production secrets только интерактивно, без shell history/Git.
3. Выполнить `build:production:public` → dry-run → deploy, затем `build:production:organizer` → dry-run → deploy.
4. Проверить health, anonymous session `401`, login/OTP, authoring/publish, participant submit, results/export и rollback.
5. Провести review PR #1 и merge только по решению владельца.

## Фазы

- [x] Phase 0 — Product Rules Freeze
- [x] Phase 1 — Repository Baseline and Hygiene
- [x] Phase 2 — Domain, API and Database Contract
- [x] Phase 3 — UX Logic and Visual Direction
- [x] Phase 4 — Cloudflare Foundation
- [x] Phase 5 — Identity and tenant authorization
- [x] Phase 6 — Assessment Authoring and Publishing
- [x] Phase 7 — Participant Attempt
- [x] Phase 8 — Results, Analytics and Export
- [x] Phase 9 — Hardening and Quality Gate
- [x] Phase 10 — Firebase Retirement
- [ ] Phase 11 — code/resources ready; external OTP/performance UAT and production secrets/deploy remain
- [x] Phase 12 — repository finalized; branch pushed, PR #1 открыт, GitHub Actions зелёный

Профильный репозиторий `SameQushori/SameQushori` обновлён: Vecta добавлена первой в Featured Projects, commit `9442d3f` отправлен в `main`.

Основной репозиторий: открытая регистрация и удаление Super Admin зафиксированы commit `7b6bc0c` в `feat/vecta-rebuild`; PR <https://github.com/SameQushori/survey-platform/pull/1> открыт в `main`, mergeable, оба quality checks прошли. PR не merge-ился.

## Правила продолжения

- Не добавлять новые MVP-фичи без решения владельца.
- Не ослаблять Turnstile/auth ради deploy.
- Не сохранять email владельца, secrets, `.env*`, `.dev.vars*`, D1 dumps, `.wrangler`, coverage или AI/Codex artifacts.
- После каждого release-действия обновлять этот файл фактическими URL/version IDs и результатами проверок.
