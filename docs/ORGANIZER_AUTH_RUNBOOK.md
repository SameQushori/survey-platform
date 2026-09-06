# Organizer Email OTP Runbook

Обновлено: 2026-09-06
Статус: открытая регистрация и Brevo adapter реализованы; staging ждёт подтверждения sender, установки `BREVO_API_KEY`, deploy и ручного UAT.

## Архитектура

- Organizer Worker обслуживает `/login`, `/app` и organizer API; `/admin/*` перенаправляется в `/app`.
- Любой пользователь вводит email, проходит Turnstile и получает одноразовый шестизначный код.
- При первом успешном подтверждении Worker атомарно создаёт личную организацию, membership `organizer`, audit event и 12-часовую session.
- Код действует 10 минут, допускает не более 5 неудачных проверок и после успешного входа становится недействительным.
- D1 хранит только HMAC digest кода и session token; plaintext-коды и токены не сохраняются.
- Браузер получает `__Host-vecta_session` с `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` и сроком 12 часов.
- Запрос считается успешным только после принятия письма провайдером. При отказе API возвращает `502 email_delivery_failed`, а challenge и неподтверждённый provisional user удаляются.
- Общей Super Admin-роли и allow-list нет. Доступ к данным определяется только активным membership конкретной организации.

## Защита от злоупотреблений

- Cloudflare Turnstile Free остаётся включённым на запросе OTP.
- Отдельные rate-limit keys ограничивают запросы по IP и нормализованному email; проверка OTP также ограничена по IP.
- Disabled user не реактивируется сам через открытую регистрацию.
- Логи доставки содержат request/challenge identifiers и provider status, но не email, OTP, raw token или provider body.

## Конфигурация

Нечувствительные vars Organizer Worker:

```text
APP_ENV=staging|production
AUTH_MODE=session
AUTH_EMAIL_PROVIDER=brevo|resend
AUTH_EMAIL_FROM=Vecta <verified-sender@example.com>
TURNSTILE_HOSTNAMES=<exact organizer hostname>
```

Secrets вводятся только интерактивно через Wrangler:

```text
TURNSTILE_SECRET
ATTEMPT_TOKEN_SECRET
AUTH_TOKEN_SECRET
BREVO_API_KEY или RESEND_API_KEY — строго в соответствии с выбранным provider
```

`AUTH_TOKEN_SECRET` должен быть случайным и не короче 32 байт. Его ротация завершает активные organizer sessions и инвалидирует незавершённые OTP.

Staging переключён на Brevo. Выбранный Gmail-адрес сначала нужно зарегистрировать и подтвердить в Brevo, а полное значение `Vecta <адрес>` сохранить как Cloudflare secret `AUTH_EMAIL_FROM`. Собственный домен для такого переходного sender не обязателен, но Brevo может заменить Gmail/Yahoo sender техническим доменом; перед production следует оценить доставляемость и позднее подключить собственный домен.

Resend adapter оставлен для обратного переключения. Его sandbox sender `onboarding@resend.dev` отправляет письма только на email владельца Resend-аккаунта и не подходит для открытой регистрации.

Secrets запрещено помещать в `wrangler.jsonc`, `.env`, Git, shell history, документацию или логи. Пример интерактивной команды:

```powershell
npm.cmd exec wrangler -- secret put BREVO_API_KEY --config wrangler.jsonc --env staging-organizer
npm.cmd exec wrangler -- secret put AUTH_EMAIL_FROM --config wrangler.jsonc --env staging-organizer
```

Cloudflare Vite Plugin выбирает environment во время сборки. Сборка и deploy Organizer staging:

```powershell
npm.cmd run build:staging:organizer
npm.cmd exec wrangler -- deploy --dry-run --config dist/vecta/wrangler.json
npm.cmd exec wrangler -- deploy --config dist/vecta/wrangler.json
```

## Staging UAT

1. Открыть Organizer `/login`, ввести новый email и пройти Turnstile.
2. Проверить входящие и «Спам», ввести код из письма и попасть в `/app`.
3. Убедиться, что доска пуста и создано одно личное пространство; обновление страницы сохраняет session.
4. Повторно использовать тот же код — получить отказ.
5. Запросить новый код — предыдущий должен перестать работать.
6. Пять раз ввести неверный код — challenge должен стать недействительным.
7. Выйти через меню профиля, обновить `/app` — должен открыться экран входа.
8. Зарегистрировать второй email и убедиться, что он не видит тесты первого пользователя.
9. Временно задать неверный sender в отдельном тестовом контуре: UI должен показать ошибку отправки, provisional user/challenge не должны остаться, email не должен попасть в Worker logs.

## Отзыв доступа и аварийные действия

- Для блокировки вручную перевести user в `disabled` и выставить `revoked_at` активным sessions; self-service вход не должен реактивировать его.
- При компрометации session secret ротировать `AUTH_TOKEN_SECRET`.
- При компрометации Brevo/Resend key отозвать ключ у выбранного провайдера, создать новый и обновить соответствующий Worker secret.
- Rollback: вернуть предыдущую Worker version. D1 migrations остаются forward-only.
