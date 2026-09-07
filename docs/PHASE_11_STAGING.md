# Phase 11 — Cloudflare Staging

Обновлено: 2026-09-07
Статус: Clerk-код, staging deploy и CSP/responsive smoke завершены; ручной auth UAT ещё не зафиксирован.

## Ресурсы

| Ресурс | Значение |
| --- | --- |
| D1 | `vecta-staging`, `fcbe1d68-f3ec-4d9b-966e-202a288fe8fc` |
| Public Worker | `vecta-staging-public` |
| Organizer Worker | `vecta-staging-organizer` |
| Organizer identity | Clerk Development application `Vecta` |
| Participant protection | Cloudflare Turnstile + Rate Limiting |

## Изменение auth-решения

Cloudflare Access и собственная email-доставка больше не используются. Clerk обслуживает Google, email-code и organizer sessions. Каждый подтверждённый пользователь становится организатором собственного workspace; Clerk Organizations и Super Admin отсутствуют. D1 membership остаётся обязательной authorization boundary.

Удалены runtime handlers Brevo/Resend, organizer OTP/session cookie и organizer Turnstile/rate-limit binding. Миграции `0005`–`0006` не удаляются: D1 schema forward-only и их наличие не активирует старый runtime.

## Локальные доказательства

- TypeScript и ESLint проходят.
- 39 unit tests проходят, включая запрет смешивания Clerk Development/Production keys и Clerk transfer/callback routing.
- 28 Worker/D1 integration tests проходят.
- Production build проходит.
- Визуально проверен `/login`: фирменная модалка, Google, email, открытая регистрация и центрирование.
- Provisioning test подтверждает отсутствие дубликата workspace при повторном вызове.
- Cloudflare build декодирует точный Clerk Frontend API origin из publishable key и генерирует Static Assets CSP; production build с `pk_test_*` завершается ошибкой до сборки.

## Опубликованные версии и smoke

- Public: `fc9382b5-0436-4c79-a903-2684d8cf533c`.
- Organizer: `e645a8e5-a7d4-43b3-9dc8-e031154cc12a`.
- `CLERK_SECRET_KEY` и `CLERK_PUBLISHABLE_KEY` установлены как staging Organizer secrets без вывода значений.
- Оба health endpoint возвращают `200` и request ID.
- Organizer `/sso-callback` возвращает SPA `200`; anonymous `/api/v1/session` возвращает `401`.
- Remote UI содержит Google, email и открытую регистрацию.
- Оба hostname отдают CSP с точным Clerk Development FAPI, `*.protect.clerk.com` и без `unsafe-inline` в `script-src`.
- До исправления CSP браузер воспроизводимо блокировал `clerk-js`; после deploy новая загрузка завершилась ожидаемым Development-key warning без новой `failed_to_load_clerk_js` ошибки.
- На 390×844 и 1280×720 нет горизонтального overflow; auth dialog остаётся в viewport, интерактивные элементы имеют accessible names.
- После staging UAT обнаружены и исправлены два Clerk flow-дефекта: `sign_up_if_missing_transfer` теперь завершает регистрацию нового email, а Google SSO финализируется через отдельный `/sso-callback` вместо возврата в незавершённое окно входа.

## Незавершённые внешние действия

1. Пройти email/Google/logout/cross-account UAT из `docs/ORGANIZER_AUTH_RUNBOOK.md`.
2. Снять Core Web Vitals после подключения Chrome DevTools MCP; без trace численные LCP/CLS не фиксируются.

Production не входит в этот проход: без собственного домена Clerk Production instance не готов. Development keys запрещено переносить в production.

## Rollback

До подтверждения Clerk UAT предыдущая Organizer Worker version остаётся rollback-кандидатом. Rollback не должен удалять D1-таблицы и не возвращает Brevo/Resend secrets автоматически; после него требуется отдельный auth smoke.
