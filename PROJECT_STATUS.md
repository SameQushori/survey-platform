# Vecta — Project Status

Последнее обновление: 2026-09-07
Ветка: `feat/vecta-rebuild`
Pull request: <https://github.com/SameQushori/survey-platform/pull/1>

## Текущее состояние

Vecta 1.0 реализована как breaking-change ревамп Survey Platform. Firebase и legacy UI удалены, старые данные не мигрируются. Runtime: React 19 + TypeScript + Cloudflare Workers/Static Assets + D1.

Organizer authentication переводится на Clerk:

- открытая регистрация без Super Admin и allow-list;
- Google или шестизначный email-код в кастомном UI Vecta;
- автоматическое создание личного D1 workspace и membership `organizer` при первом входе;
- Clerk проверяет identity/session, D1 проверяет tenant membership;
- Cloudflare Turnstile удалён из organizer login и сохранён для participant flow;
- собственные OTP, Brevo/Resend adapters и organizer session routes удалены из runtime.

Локальный Clerk application `Vecta` привязан через CLI, `.env.local` получен и игнорируется Git. Clerk Development подходит для staging. Production заблокирован до подключения собственного домена и создания Clerk Production instance.

## Реализованный продукт

- Responsive onboarding и единый вход/регистрация.
- Drag-and-drop доска «Черновики → Запущены → Завершены» с согласованными обратными переходами.
- Редактор трёх типов вопросов, последовательный autosave и optimistic revision.
- Immutable publication versions, общий code/QR и контролируемые invitations.
- Восстанавливаемые participant attempts, server deadline, autosave ответов, abandon и idempotent submit.
- Results overview, question analytics, attempt details, history и безопасный CSV.
- Tenant authorization, audit log, rate limits, participant Turnstile и HMAC/JOSE credentials.
- Firebase/legacy retirement, CI quality gate, release scan и Cloudflare deployment scripts.

## Последняя автоматическая проверка

- `npm run typecheck` — проходит.
- `npm run lint` — проходит.
- Unit tests — 32/32 проходят.
- Worker/D1 integration tests — 27/27 проходят, включая idempotent Clerk workspace provisioning.
- `npm run build` — проходит.
- Полный `npm run quality` нужно повторить после финального обновления документов и deployment.

## Cloudflare inventory

### Staging

- D1: `vecta-staging`, ID `fcbe1d68-f3ec-4d9b-966e-202a288fe8fc`, migrations `0001`–`0006`.
- Public: <https://vecta-staging-public.alimbekov1234567890.workers.dev>.
- Organizer: <https://vecta-staging-organizer.alimbekov1234567890.workers.dev>.
- Public version: `4c7cf89f-4a53-4236-a250-6a9d01dd64d7`.
- Organizer Clerk version: `cc9a1b6e-749b-4c81-b9d2-b92c87e4410d`.
- Remote smoke: оба health `200` с request ID, Organizer `/login` `200`, anonymous `/api/v1/session` `401`, опубликованная auth-модалка содержит Google и email flow.

### Production

- D1: `vecta-production`, ID `44ad08b1-d7e0-49d7-ad25-9594f50a1227`.
- Конфигурация Workers подготовлена, но production deploy намеренно не выполняется.
- Блокер: нет собственного домена для Clerk Production instance и production OAuth/DNS setup.

## Строгий оставшийся маршрут

1. Выполнить Clerk staging UAT по `docs/ORGANIZER_AUTH_RUNBOOK.md`: email, Google, logout, новый аккаунт и cross-account isolation.
2. Исправить только подтверждённые UAT-дефекты; новые фичи не добавлять.
3. Снять responsive/accessibility/performance smoke.
4. Закоммитить, отправить ветку, дождаться CI и обновить PR.
5. Отдельно подключить домен, Clerk Production instance и production keys.
6. После успешного production dry-run/deploy выполнить smoke и rollback readiness check.
7. Merge PR — только после явного решения владельца.

## Что проверить вручную после staging deploy

1. `/login`: Google, email, шесть OTP-ячеек, вставка кода, resend и подсказка про «Спам».
2. Новый аккаунт: после входа открывается пустой `/app`; reload сохраняет вход.
3. Создать черновик → добавить вопросы → дождаться «Сохранено» → reload → опубликовать.
4. Переместить тест вперёд и назад по разрешённым этапам.
5. Пройти тест как участник, проверить выход с расходом попытки и условный показ результата.
6. Вернуться организатором: результаты и CSV принадлежат только его workspace.
7. Выйти через профиль: `/app` снова требует вход, participant state не затрагивается.
8. Повторить основные экраны на 390×844 и проверить клавиатурный focus.

## Фазы

- [x] Phase 0–10 — product rules, repository, domain/API/D1, design, Cloudflare foundation, authorization, authoring, participant, results, hardening и Firebase retirement.
- [ ] Phase 11 — Clerk staging deployed; ручной auth UAT и performance smoke остаются.
- [ ] Phase 12 — финальный commit/push/CI и release handoff; профильный README уже обновлён, Vecta стоит первой в Featured Projects.

## Правила продолжения

- Не добавлять новые MVP-фичи без решения владельца.
- Не использовать Clerk Development keys в production.
- Не сохранять email владельца, secrets, `.env*`, `.dev.vars*`, D1 dumps, `.wrangler`, coverage или AI/Codex artifacts в Git.
- После каждого deploy обновлять этот файл фактическими version IDs и результатами проверок.
