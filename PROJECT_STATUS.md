# Vecta — Project Status / Handoff

Последнее обновление: 2026-09-06

Версия: **1.0.0 release candidate**

Текущая фаза: **вся автономная разработка завершена; Phase 11 оставлена на внешние release-gates**

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
- Добавлены атомарные Cloudflare deploy-команды: каждая сама собирает и публикует только выбранный environment.
- Удалены оставшиеся legacy-отчёты, небезопасные Firebase rules и старый SurveyPro HTML-макет; повторное попадание этих файлов блокирует release-скан.

## Автоматический release gate

На 2026-09-06 проходит:

- `npm run typecheck`;
- `npm run verify:types`;
- `npm run lint`;
- 32 unit tests в 8 файлах;
- 35 Worker/D1 integration tests в 6 файлах;
- `npm run build`;
- `npm audit --audit-level=moderate` — 0 vulnerabilities;
- `npm run verify:release` — tracked-файлы и build проверены на secrets, private keys, локальные артефакты и retired legacy paths;
- все четыре staging/production public/organizer deploy-команды проходят `--dry-run`;
- локальный Worker startup profile: bundle 320.44 KiB / gzip 67.03 KiB, active startup CPU 13.9 ms.

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

## Отложенные внешние действия

По решению владельца от 2026-09-06 эти пункты не блокируют продолжение разработки и оставлены на совместный финальный проход:

1. Brevo sender/API-key, новый deploy Organizer staging и OTP UAT по `docs/ORGANIZER_AUTH_RUNBOOK.md`.
2. Production Turnstile hostnames и secrets, переключение Organizer на проверенный email provider.
3. Реальный Core Web Vitals trace: Chrome DevTools MCP в текущей среде отсутствует, поэтому метрики не вымышлялись.
4. Production deploy/smoke и проверка rollback после успешного auth UAT.
5. Review и merge PR #1 только по решению владельца.

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
- [ ] Phase 11 — автономная часть закрыта; внешний OTP/performance UAT и production secrets/deploy отложены владельцем
- [x] Phase 12 — repository finalized; release-скан встроен в CI, branch/PR/profile README подготовлены

Профильный репозиторий `SameQushori/SameQushori` обновлён: Vecta добавлена первой в Featured Projects, commit `9442d3f` отправлен в `main`.

Основной репозиторий: PR <https://github.com/SameQushori/survey-platform/pull/1> открыт из `feat/vecta-rebuild` в `main`. PR не merge-ился; актуальный commit и CI фиксируются после каждого release-изменения.

## Правила продолжения

- Не добавлять новые MVP-фичи без решения владельца.
- Не ослаблять Turnstile/auth ради deploy.
- Не сохранять email владельца, secrets, `.env*`, `.dev.vars*`, D1 dumps, `.wrangler`, coverage или AI/Codex artifacts.
- После каждого release-действия обновлять этот файл фактическими URL/version IDs и результатами проверок.
