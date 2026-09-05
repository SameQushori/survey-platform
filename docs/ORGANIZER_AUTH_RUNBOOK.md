# Organizer Email OTP Runbook

Обновлено: 2026-09-05
Статус: email OTP развёрнут в Organizer staging; staging и production owner records настроены, ожидается ручной UAT получения кода и production secrets.

## Архитектура

- Organizer Worker обслуживает `/login`, `/app`, `/admin` и organizer API.
- Пользователь вводит заранее добавленный рабочий email, проходит Turnstile и получает одноразовый шестизначный код.
- Код действует 10 минут, допускает не более 5 неудачных проверок и после успешного входа становится недействительным.
- D1 хранит только HMAC digest кода и session token; plaintext-коды и токены не сохраняются.
- Браузер получает `__Host-vecta_session` с `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` и сроком 12 часов.
- Публичной регистрации нет. Email даёт доступ только если Super Admin заранее создал активного пользователя и membership.
- Ответ запроса кода одинаков для известного и неизвестного email. Отправка выполняется после ответа через `waitUntil`, чтобы не раскрывать наличие учётной записи по содержимому или задержке почтового провайдера.

## Конфигурация

Нечувствительные vars Organizer Worker:

```text
APP_ENV=staging|production
AUTH_MODE=session
AUTH_EMAIL_PROVIDER=resend
AUTH_EMAIL_FROM=Vecta <login@verified-domain.example>
TURNSTILE_HOSTNAMES=<exact organizer hostname>
```

Secrets, вводимые только интерактивно через Wrangler:

```text
TURNSTILE_SECRET
ATTEMPT_TOKEN_SECRET
AUTH_TOKEN_SECRET
RESEND_API_KEY
```

`AUTH_TOKEN_SECRET` должен быть случайным и не короче 32 байт. Его ротация немедленно завершает все активные organizer sessions и делает незавершённые OTP недействительными.

Для staging допустим `Vecta <onboarding@resend.dev>`, но он отправляет письма только на email владельца Resend-аккаунта. Для production обязателен подтверждённый собственный домен и sender на этом домене.

Secrets запрещено помещать в `wrangler.jsonc`, `.env`, Git, shell history, документацию или логи. Использовать интерактивную команду:

```powershell
npx.cmd wrangler secret put RESEND_API_KEY --config wrangler.jsonc --env staging-organizer
```

Cloudflare Vite Plugin выбирает environment во время сборки, а не во время `wrangler deploy`. Поэтому каждый Organizer environment всегда собирать и проверять двумя отдельными командами:

```powershell
npm.cmd run build:staging:organizer
npm.cmd exec wrangler -- deploy --dry-run
```

Для production использовать `npm.cmd run build:production:organizer`; deploy-команда так же запускается без `--env`.

После успешного dry-run второй вызов меняется на `npm.cmd exec wrangler -- deploy`. Не добавлять `--env` на стадии deploy: output-конфиг уже должен быть flattened для выбранного environment.

## Bootstrap первого владельца

До первого входа в D1 должен существовать активный Super Admin с подтверждённым email:

```sql
UPDATE users
SET email = '<normalized-owner-email>',
    auth_subject = 'pending:<normalized-owner-email>',
    updated_at = unixepoch() * 1000
WHERE id IN ('user_staging_owner', 'user_production_owner');
```

Не сохранять реальный email в seed-файле репозитория. Выполнять параметризованный или вручную проверенный SQL только после подтверждения адреса владельцем.

## Staging UAT

1. Открыть Organizer `/login` и ввести заранее добавленный email.
2. Пройти Turnstile; интерфейс должен всегда перейти на шаг ввода кода, в том числе для неизвестного адреса.
3. Проверить письмо Vecta, ввести код и попасть в `/app` или `/admin` согласно роли.
4. Повторно использовать тот же код — получить отказ.
5. Запросить новый код — предыдущий должен перестать работать.
6. Пять раз ввести неверный код — challenge должен стать недействительным.
7. Выйти через меню профиля, обновить защищённую страницу — должен открыться `/login`.
8. Добавить организатора в Super Admin, затем войти его email и проверить границу организации.
9. Для неизвестного email убедиться, что UI не сообщает, существует ли аккаунт.

## Отзыв доступа и аварийные действия

- Обычный отзыв: перевести membership или user в `disabled`, затем выставить `revoked_at` активным sessions этого пользователя.
- Компрометация session secret: ротировать `AUTH_TOKEN_SECRET`; это завершит все organizer sessions.
- Компрометация Resend key: отозвать ключ у провайдера, создать новый и обновить Worker secret.
- Ошибка доставки: challenge удаляется, наружу остаётся generic response, а structured log содержит event `organizer_login_email_failed` без email, кода и токена.
- Rollback: вернуть предыдущую Worker version. После успешного OTP UAT удалить старый `ORGANIZER_ACCESS_CODE` secret; в production его не создавать.
