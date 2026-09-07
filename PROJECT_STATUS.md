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
- Unit tests — 39/39 проходят, включая Clerk environment/build guard и auth transfer/callback routing.
- Worker/D1 integration tests — 28/28 проходят, включая idempotent Clerk workspace provisioning.
- `npm run build` — проходит.
- Полный `npm run quality` — проходит; release scan проверил 97 repository и 73 build-файла, `npm audit` нашёл 0 уязвимостей.

## Cloudflare inventory

### Staging

- D1: `vecta-staging`, ID `fcbe1d68-f3ec-4d9b-966e-202a288fe8fc`, migrations `0001`–`0006`.
- Public: <https://vecta-staging-public.alimbekov1234567890.workers.dev>.
- Organizer: <https://vecta-staging-organizer.alimbekov1234567890.workers.dev>.
- Public version: `fc9382b5-0436-4c79-a903-2684d8cf533c`.
- Organizer Clerk version: `e645a8e5-a7d4-43b3-9dc8-e031154cc12a`.
- Remote smoke: оба health `200` с request ID, Organizer `/sso-callback` `200`, anonymous `/api/v1/session` получает `401`.
- Исправлен блокирующий Clerk CSP: оба Worker отдают точный Frontend API origin, Clerk protection origins и не разрешают `unsafe-inline` scripts; после deploy `clerk-js` загрузился без новой ошибки.
- Исправлен открытый signup: email-код переводит отсутствующего пользователя из sign-in в sign-up и завершает сессию; Google OAuth возвращается на отдельный Clerk callback, который финализирует сессию перед `/app`.
- Responsive/accessibility smoke `/login`: 390×844 и 1280×720 без горизонтального overflow, диалог остаётся в viewport, у полей и кнопок есть accessible names.

### Production

- D1: `vecta-production`, ID `44ad08b1-d7e0-49d7-ad25-9594f50a1227`.
- Конфигурация Workers подготовлена, но production deploy намеренно не выполняется.
- Блокер: нет собственного домена для Clerk Production instance и production OAuth/DNS setup.

## Строгий оставшийся маршрут

1. Выполнить Clerk staging UAT по `docs/ORGANIZER_AUTH_RUNBOOK.md`: email, Google, logout, новый аккаунт и cross-account isolation.
2. Исправить только подтверждённые UAT-дефекты; новые фичи не добавлять.
3. Снять Core Web Vitals через Chrome DevTools MCP; responsive/accessibility smoke уже пройден.
4. Отдельно подключить домен, Clerk Production instance и production keys.
5. После успешного production dry-run/deploy выполнить smoke и rollback readiness check.
6. Merge PR — только после явного решения владельца.

## Что проверить вручную после staging deploy

1. `/login`: новый email автоматически регистрируется после OTP; Google проходит через краткий экран «Завершаем вход» и открывает `/app`; также проверить вставку кода, resend и подсказку про «Спам».
2. Новый аккаунт: после входа открывается пустой `/app`; reload сохраняет вход.
3. Создать черновик → добавить вопросы → дождаться «Сохранено» → reload → опубликовать.
4. Переместить тест вперёд и назад по разрешённым этапам.
5. Пройти тест как участник, проверить выход с расходом попытки и условный показ результата.
6. Вернуться организатором: результаты и CSV принадлежат только его workspace.
7. Выйти через профиль: `/app` снова требует вход, participant state не затрагивается.
8. Повторить основные экраны на 390×844 и проверить клавиатурный focus.

## Фазы

- [x] Phase 0–10 — product rules, repository, domain/API/D1, design, Cloudflare foundation, authorization, authoring, participant, results, hardening и Firebase retirement.
- [ ] Phase 11 — Clerk staging deployed, CSP исправлен и responsive/accessibility smoke пройден; ручной auth UAT и Core Web Vitals остаются.
- [x] Phase 12 — release handoff, PR и профильный README готовы; Vecta стоит первой в Featured Projects. Новые исправления отправляются в тот же PR.

## Правила продолжения

- Не добавлять новые MVP-фичи без решения владельца.
- Не использовать Clerk Development keys в production.
- Не сохранять email владельца, secrets, `.env*`, `.dev.vars*`, D1 dumps, `.wrangler`, coverage или AI/Codex artifacts в Git.
- После каждого deploy обновлять этот файл фактическими version IDs и результатами проверок.
