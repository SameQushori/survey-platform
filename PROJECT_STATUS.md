# Vecta — Project Status / Handoff

Последнее обновление: 2026-09-05

Версия: **1.0.0 release candidate**

Текущая фаза: **Phase 11 external UAT + Phase 12 delivery**

Этот файл — каноническая точка продолжения в другом чате. Сначала прочитать его, затем `docs/STRICT_DEVELOPMENT_PLAN.md`, `docs/DECISIONS.md` и проверить фактический `git status`.

## Зафиксированный продукт

- Бренд: **Vecta**.
- Assessment-first платформа корпоративного тестирования, основной язык MVP — русский.
- Backend/hosting: Cloudflare Workers + Static Assets, D1, Turnstile и Rate Limiting.
- Organizer identity: allow-listed email → шестизначный OTP → 12-часовая revocable HttpOnly session.
- Participant modes: общий код/ссылка и контролируемое одноразовое приглашение.
- Результат участника скрыт по умолчанию; при включении показываются только score/maxScore.
- Типы вопросов MVP: один вариант, несколько вариантов, шкала.
- Старые Firebase-опросы и аккаунты не мигрируются.

## Выполнено в коде

- Полностью удалены legacy JSX/Firebase runtime, setup и зависимости.
- Реализованы responsive onboarding, organizer workspace, Kanban, authoring, publishing, participant lifecycle, results, analytics, CSV и administration.
- Доска поддерживает forward/reopen/revise без изменения immutable исторических публикаций и результатов.
- Реализованы email OTP, anti-enumeration, HMAC-only challenges/sessions, Turnstile, rate limits, CSRF/same-origin boundary и tenant-safe authorization.
- Исправлены autosave race, публикация, participant exit, auth handoff, modal states, шестиячеечный OTP и обратные lifecycle-переходы.
- Удалён production URL-переключатель mock loading/empty/error states.
- Dependency stack обновлён в пределах текущих major; полный audit — 0 vulnerabilities.
- Добавлен GitHub Actions quality gate и документация deployment/rollback/release.

## Автоматический release gate

На 2026-09-05 проходит:

- `npm run typecheck`;
- `npm run lint`;
- 32 unit tests в 8 файлах;
- 36 Worker/D1 integration tests в 6 файлах;
- `npm run build`;
- `npm audit --audit-level=moderate` — 0 vulnerabilities;
- post-build scan — `.env*`/`.dev.vars*` отсутствуют в `dist`.

## Cloudflare inventory

### Staging

- D1: `vecta-staging`, ID `fcbe1d68-f3ec-4d9b-966e-202a288fe8fc`, 5 migrations / 18 tables.
- Public: <https://vecta-staging-public.alimbekov1234567890.workers.dev>, version `b2fe70e8-ace3-423c-9081-7122d20be2a1`.
- Organizer: <https://vecta-staging-organizer.alimbekov1234567890.workers.dev>, version `edf2a88c-8fd3-404b-8850-73ae3d23f99a`.
- Единственный owner email исправлен на подтверждённый пользователем адрес; PII не хранится в Git.

### Production — подготовлено, но Worker deploy намеренно не выполнен

- D1: `vecta-production`, ID `44ad08b1-d7e0-49d7-ad25-9594f50a1227`, регион WEUR.
- Применены все 5 migrations, создано 18 application tables, `PRAGMA foreign_key_check` чистый.
- Создан единственный production Super Admin/Organizer с подтверждённым email вне Git.
- `wrangler.jsonc` содержит отдельные `production-public` / `production-organizer`, Worker names `vecta-public` / `vecta-organizer`, отдельные rate-limit namespaces и D1 binding.
- Production Workers не публикуются до настройки их secrets и успешного OTP UAT: deploy без Turnstile/Resend создал бы заведомо неработающий или небезопасный вход.

## Внешние release-gates

1. Owner проходит staging вход: Turnstile → письмо → OTP → `/app` → logout → повторный вход.
2. После успеха удалить устаревший staging secret `ORGANIZER_ACCESS_CODE`.
3. Добавить production hostnames в Turnstile и интерактивно задать production secrets: `TURNSTILE_SECRET`, `ATTEMPT_TOKEN_SECRET`, `AUTH_TOKEN_SECRET`, `RESEND_API_KEY`.
4. Resend `onboarding@resend.dev` может отправлять только на email владельца Resend. Для публичной рассылки нужен собственный verified sending domain; домена сейчас нет.
5. Снять LCP/CLS/INP через Chrome DevTools MCP или вручную в DevTools. В текущей среде DevTools MCP не подключён, поэтому метрики не вымышлялись.

## Точный следующий маршрут

1. Выполнить ручной staging OTP UAT по `docs/ORGANIZER_AUTH_RUNBOOK.md`.
2. Настроить четыре production secrets только интерактивно, без shell history/Git.
3. Выполнить `build:production:public` → dry-run → deploy, затем `build:production:organizer` → dry-run → deploy.
4. Проверить health, anonymous session `401`, login/OTP, authoring/publish, participant submit, results/export и rollback.
5. Git: commit/push `feat/vecta-rebuild`, открыть один breaking-change PR в `main`; CI должен быть зелёным, merge только после review.

## Фазы

- [x] Phase 0 — Product Rules Freeze
- [x] Phase 1 — Repository Baseline and Hygiene
- [x] Phase 2 — Domain, API and Database Contract
- [x] Phase 3 — UX Logic and Visual Direction
- [x] Phase 4 — Cloudflare Foundation
- [x] Phase 5 — Identity and Administration
- [x] Phase 6 — Assessment Authoring and Publishing
- [x] Phase 7 — Participant Attempt
- [x] Phase 8 — Results, Analytics and Export
- [x] Phase 9 — Hardening and Quality Gate
- [x] Phase 10 — Firebase Retirement
- [ ] Phase 11 — code/resources ready; external OTP/performance UAT and production secrets/deploy remain
- [ ] Phase 12 — docs/CI/profile README ready; main repository commit/push/PR remain

Профильный репозиторий `SameQushori/SameQushori` обновлён: Vecta добавлена первой в Featured Projects, commit `9442d3f` отправлен в `main`.

## Правила продолжения

- Не добавлять новые MVP-фичи без решения владельца.
- Не ослаблять Turnstile/auth ради deploy.
- Не сохранять email владельца, secrets, `.env*`, `.dev.vars*`, D1 dumps, `.wrangler`, coverage или AI/Codex artifacts.
- После каждого release-действия обновлять этот файл фактическими URL/version IDs и результатами проверок.
