# Phase 11 — Cloudflare Staging

Обновлено: 2026-09-07
Статус: Clerk-код и staging deploy завершены; ручной auth UAT ещё не зафиксирован.

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
- 32 unit tests проходят.
- 27 Worker/D1 integration tests проходят.
- Production build проходит.
- Визуально проверен `/login`: фирменная модалка, Google, email, открытая регистрация и центрирование.
- Provisioning test подтверждает отсутствие дубликата workspace при повторном вызове.

## Опубликованные версии и smoke

- Public: `4c7cf89f-4a53-4236-a250-6a9d01dd64d7`.
- Organizer: `cc9a1b6e-749b-4c81-b9d2-b92c87e4410d`.
- `CLERK_SECRET_KEY` и `CLERK_PUBLISHABLE_KEY` установлены как staging Organizer secrets без вывода значений.
- Оба health endpoint возвращают `200` и request ID.
- Organizer `/login` возвращает `200`; anonymous `/api/v1/session` возвращает `401`.
- Remote UI содержит Google, email и открытую регистрацию.

## Незавершённые внешние действия

1. Пройти email/Google/logout/cross-account UAT из `docs/ORGANIZER_AUTH_RUNBOOK.md`.
2. Снять Core Web Vitals.

Production не входит в этот проход: без собственного домена Clerk Production instance не готов. Development keys запрещено переносить в production.

## Rollback

До подтверждения Clerk UAT предыдущая Organizer Worker version остаётся rollback-кандидатом. Rollback не должен удалять D1-таблицы и не возвращает Brevo/Resend secrets автоматически; после него требуется отдельный auth smoke.
