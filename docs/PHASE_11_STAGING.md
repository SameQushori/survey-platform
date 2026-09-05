# Phase 11 — Cloudflare Staging

Последнее обновление: 2026-09-05
Статус: **staging развёрнут; production D1/config подготовлены; ожидаются ручной owner UAT, secrets и Core Web Vitals**.

## Развёрнутые ресурсы

| Ресурс | Значение | Состояние |
| --- | --- | --- |
| D1 | `vecta-staging` / EEUR | remote: 5 migrations / 18 application tables; pending migrations отсутствуют |
| Public Worker | `vecta-staging-public` | deployed, version `b2fe70e8-ace3-423c-9081-7122d20be2a1`, preview URLs disabled |
| Organizer Worker | `vecta-staging-organizer` | email OTP + reversible assessment workflow deployed, version `edf2a88c-8fd3-404b-8850-73ae3d23f99a`; предыдущая access-code версия сохранена для rollback до UAT |
| Turnstile | managed widget `vecta-staging` | public и organizer hostnames разрешены; secret ротирован 2026-09-01 |
| Participant rate limit | namespace `2001`, 20 requests / 60 seconds | привязан к обоим staging Workers |
| Organizer auth rate limit | namespace `2002`, 5 requests / 60 seconds | привязан к Organizer Worker |
| Existing secrets | public: `TURNSTILE_SECRET`, `ATTEMPT_TOKEN_SECRET`; organizer: те же + `AUTH_TOKEN_SECRET`, `RESEND_API_KEY`, старый `ORGANIZER_ACCESS_CODE` | старый access-code secret удалить только после успешного email OTP UAT |
| Owner identity | `user_staging_owner` / `org_vecta` | Super Admin + Organizer; подтверждённый email привязан только в remote D1, без PII в Git |

Public staging: <https://vecta-staging-public.alimbekov1234567890.workers.dev>

Organizer staging: <https://vecta-staging-organizer.alimbekov1234567890.workers.dev>

## Подготовленный production-контур

| Ресурс | Значение | Состояние |
| --- | --- | --- |
| D1 | `vecta-production` / `44ad08b1-d7e0-49d7-ad25-9594f50a1227` / WEUR | 5 migrations / 18 tables; `foreign_key_check` чистый |
| Public Worker config | `vecta-public` | отдельный D1 и rate-limit namespace `3001`; ещё не deployed |
| Organizer Worker config | `vecta-organizer` | session auth, Resend и namespaces `3001`/`3002`; ещё не deployed |
| Owner identity | `user_production_owner` / `org_vecta` | Super Admin + Organizer; email привязан только в remote D1 |

Production Worker deploy намеренно не выполняется до интерактивной установки secrets и успешного OTP UAT. Полный маршрут: `docs/DEPLOYMENT.md`.

## Изменение auth-решения

Владелец отказался от Cloudflare Zero Trust checkout, требующего платёжный профиль. Никакая покупка или активация плана не выполнена. Cloudflare Access удалён из runtime и документации.

Новая граница:

- Public Worker использует `AUTH_MODE=disabled` и не обслуживает organizer identity.
- Organizer Worker использует `AUTH_MODE=session`.
- Текущий remote вход: email → Turnstile → одноразовый код → server-side D1 session → HttpOnly cookie.
- Logout отзывает только Vecta session и не разлогинивает пользователя из Cloudflare dashboard.
- Email OTP UI/API восстановлены локально как целевая production identity. Resend выбран, потому что Cloudflare Email Sending для произвольных адресатов требует Workers Paid.
- Добавлены environment-specific Vite build scripts. Environment выбирается до сборки; `wrangler deploy --env ...` после обычного build запрещён, потому что redirected output уже flattened.

Подробности: `docs/ORGANIZER_AUTH_RUNBOOK.md`.

## Проверено локально

- TypeScript typecheck проходит.
- 25 unit tests и 33 Worker/D1 tests проходят.
- Migration `0005_organizer_email_auth.sql` применяется в isolated D1 test runtime.
- Worker tests подтверждают email request → Resend adapter → одноразовый OTP → HttpOnly cookie → authenticated session → logout/revocation, max attempts и anti-enumeration.
- Plaintext OTP не записывается в D1, raw session token заменён HMAC digest; проверка выполняется Web Crypto.
- Cookie-auth mutations отклоняют cross-site request context.
- `build:staging:organizer` формирует `vecta-staging-organizer` с staging D1, session auth, Resend vars и обоими rate-limit bindings; `wrangler deploy --dry-run` проходит, upload не выполнялся.
- OTP интерфейс состоит из шести доступных ячеек, принимает вставку полного кода и поддерживает клавиатурную навигацию; подсказка про папку «Спам» показана только после запроса письма.
- После UI deploy remote smoke подтверждает health/login `200` и наличие новой OTP-разметки/CSS в опубликованных assets.
- Super Admin member actions используют реальный PATCH endpoint: disable подтверждается в modal, restore выполняется из того же меню; 34 Worker/D1 tests проверяют status и audit event.
- Remote D1 session audit 2026-09-04: активная owner email-session отсутствует, поэтому старый access-code secret пока не удалён.
- Встроенная панель помощи содержит поиск и три раскрываемые инструкции; фиктивный support email и мёртвые `#privacy`/`#terms`/`#docs` удалены до появления подтверждённых каналов и документов.
- Финальный gate блока: typecheck/lint, 29 unit и 34 Worker/D1 tests; обе среды прошли remote health/shell/asset smoke после раздельных environment-specific сборок.
- Auth handoff regression исправлен 2026-09-05: обе staging-сборки получают явный `VITE_ORGANIZER_ORIGIN`; public CTA и прямой `/login` переходят на Organizer hostname. Public Worker version `b2fe70e8-ace3-423c-9081-7122d20be2a1`; browser QA, remote shell/asset/auth-route smoke, 32 unit и 36 Worker/D1 tests проходят.
- Assessment board поддерживает обратные переходы с серверной state machine: reopen последней публикации и создание новой draft-version из immutable snapshot. История публикаций доступна в «Результатах»; старые attempts/results не перепривязываются.
- Reversible workflow gate: typecheck/lint, 29 unit и 36 Worker/D1 tests, local desktop menu/modal QA без console errors и remote smoke. Незалогиненный вызов `/reopen` возвращает `401`.

## Следующий обязательный gate

1. Выполнить owner UAT входа по письму из `docs/ORGANIZER_AUTH_RUNBOOK.md`.
2. После подтверждённого входа удалить старый `ORGANIZER_ACCESS_CODE` и повторить session/logout smoke.
3. Пройти негативные/позитивные auth-сценарии и проверить roles/tenant boundary.
4. Интерактивно установить production secrets, добавить production hostnames в Turnstile, снять Core Web Vitals и выполнить production deploy/smoke.

## Rollback

Текущие проверенные access-code версии, доступные для rollback до закрытия OTP UAT:

- Public: `562946a9-dc5e-4686-80a7-d6f27bf5fca1`.
- Organizer: `3912ce4a-48a0-4996-bb52-8b2628c6b8f5`.

Migration `0005` только добавляет две таблицы и индексы; она совместима с предыдущим Worker. Перед потенциально destructive production migration обязателен `wrangler d1 export` вне Git.
