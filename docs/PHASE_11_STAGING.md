# Phase 11 — Cloudflare Staging

Последнее обновление: 2026-09-05
Статус: **staging развёрнут; production D1/config подготовлены; ожидаются ручной owner UAT, secrets и Core Web Vitals**.

## Развёрнутые ресурсы

| Ресурс | Значение | Состояние |
| --- | --- | --- |
| D1 | `vecta-staging` / EEUR | remote: 6 migrations / 18 application tables; privileged users `0`, foreign keys clean |
| Public Worker | `vecta-staging-public` | deployed, version `fcf05337-9b5c-4410-8d2b-fde5b4261680`, preview URLs disabled |
| Organizer Worker | `vecta-staging-organizer` | открытая email-регистрация + reversible assessment workflow, version `702e7110-7566-4fe2-85fa-1b614b8a6ed2` |
| Turnstile | managed widget `vecta-staging` | public и organizer hostnames разрешены; secret ротирован 2026-09-01 |
| Participant rate limit | namespace `2001`, 20 requests / 60 seconds | привязан к обоим staging Workers |
| Organizer auth rate limit | namespace `2002`, 5 requests / 60 seconds | привязан к Organizer Worker |
| Existing secrets | public: `TURNSTILE_SECRET`, `ATTEMPT_TOKEN_SECRET`; organizer: те же + `AUTH_TOKEN_SECRET`, `RESEND_API_KEY`, старый `ORGANIZER_ACCESS_CODE` | старый access-code secret удалить только после успешного email OTP UAT |
| Owner identity | `user_staging_owner` / `org_vecta` | Обычный Organizer; подтверждённый email привязан только в remote D1, без PII в Git |

Public staging: <https://vecta-staging-public.alimbekov1234567890.workers.dev>

Organizer staging: <https://vecta-staging-organizer.alimbekov1234567890.workers.dev>

## Подготовленный production-контур

| Ресурс | Значение | Состояние |
| --- | --- | --- |
| D1 | `vecta-production` / `44ad08b1-d7e0-49d7-ad25-9594f50a1227` / WEUR | 6 migrations / 18 tables; privileged users `0`, `foreign_key_check` чистый |
| Public Worker config | `vecta-public` | отдельный D1 и rate-limit namespace `3001`; ещё не deployed |
| Organizer Worker config | `vecta-organizer` | session auth, Resend и namespaces `3001`/`3002`; ещё не deployed |
| Owner identity | `user_production_owner` / `org_vecta` | Обычный Organizer; email привязан только в remote D1 |

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
- 32 unit tests и 34 Worker/D1 tests проходят.
- Migration `0005_organizer_email_auth.sql` применяется в isolated D1 test runtime.
- Worker tests подтверждают email request → Resend adapter → одноразовый OTP → provision личного workspace → HttpOnly cookie → authenticated session → logout/revocation, max attempts и безопасную очистку при delivery failure.
- Plaintext OTP не записывается в D1, raw session token заменён HMAC digest; проверка выполняется Web Crypto.
- Cookie-auth mutations отклоняют cross-site request context.
- `build:staging:organizer` формирует `vecta-staging-organizer` с staging D1, session auth, Resend vars и обоими rate-limit bindings; актуальная сборка deployed.
- OTP интерфейс состоит из шести доступных ячеек, принимает вставку полного кода и поддерживает клавиатурную навигацию; подсказка про папку «Спам» показана только после запроса письма.
- После UI deploy remote smoke подтверждает health/login `200` и наличие новой OTP-разметки/CSS в опубликованных assets.
- Платформенные Super Admin endpoints и UI удалены; открытая регистрация создаёт отдельный workspace и organizer membership после первого подтверждённого OTP.
- Remote D1 session audit 2026-09-04: активная owner email-session отсутствует, поэтому старый access-code secret пока не удалён.
- Встроенная панель помощи содержит поиск и три раскрываемые инструкции; фиктивный support email и мёртвые `#privacy`/`#terms`/`#docs` удалены до появления подтверждённых каналов и документов.
- Финальный gate блока: typecheck/lint, 29 unit и 34 Worker/D1 tests; обе среды прошли remote health/shell/asset smoke после раздельных environment-specific сборок.
- Auth handoff regression исправлен 2026-09-05: обе staging-сборки получают явный `VITE_ORGANIZER_ORIGIN`; public CTA и прямой `/login` переходят на Organizer hostname. Открытая регистрация deployed в Public version `fcf05337-9b5c-4410-8d2b-fde5b4261680` и Organizer version `702e7110-7566-4fe2-85fa-1b614b8a6ed2`; remote health smoke, 32 unit и 34 Worker/D1 tests проходят.
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

Migrations `0005`–`0006` совместимы с существующей schema: `0005` добавляет auth tables/indexes, `0006` только обнуляет неиспользуемую platform role. Перед потенциально destructive production migration обязателен `wrangler d1 export` вне Git.
