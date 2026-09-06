# Vecta Deployment and Rollback Runbook

Обновлено: 2026-09-06

## Контуры

| Контур | Public Worker | Organizer Worker | D1 |
| --- | --- | --- | --- |
| Staging | `vecta-staging-public` | `vecta-staging-organizer` | `vecta-staging` |
| Production | `vecta-public` | `vecta-organizer` | `vecta-production` |

Staging и production не разделяют D1. Все environment bindings хранятся в `wrangler.jsonc`; secrets — только в Cloudflare.

## Обязательные предпроверки

```powershell
npm.cmd ci
npm.cmd run quality
npm.cmd exec wrangler -- whoami
```

Проверить, что `git status --ignored --short` не показывает secrets, дампы, `.wrangler`, `dist`, coverage или AI artifacts как tracked/staged.

## D1

Production D1 уже создана и прописана в конфигурации. Для новой среды:

```powershell
npm.cmd exec wrangler -- d1 migrations apply vecta-production --remote --config wrangler.jsonc --env production-organizer
npm.cmd exec wrangler -- d1 migrations list vecta-production --remote --config wrangler.jsonc --env production-organizer
```

Первый owner создаётся `scripts/seed-production-owner.sql`, где email намеренно `NULL`. Реальный email задаётся отдельной remote SQL-командой и никогда не записывается в Git.

Перед потенциально destructive изменением:

```powershell
npm.cmd exec wrangler -- d1 export vecta-production --remote --config wrangler.jsonc --env production-organizer --output .\vecta-production-backup.sql
```

Backup хранить за пределами репозитория и удалить локальную копию после переноса в защищённое хранилище.

## Turnstile и email

Turnstile widget должен разрешать точные production hostnames:

- `vecta-public.alimbekov1234567890.workers.dev`
- `vecta-organizer.alimbekov1234567890.workers.dev`

Secrets вводятся интерактивно отдельно для каждого Worker. Не передавать значения аргументом команды и не вставлять в файлы:

```powershell
npm.cmd exec wrangler -- secret put TURNSTILE_SECRET --config wrangler.jsonc --env production-public
npm.cmd exec wrangler -- secret put ATTEMPT_TOKEN_SECRET --config wrangler.jsonc --env production-public

npm.cmd exec wrangler -- secret put TURNSTILE_SECRET --config wrangler.jsonc --env production-organizer
npm.cmd exec wrangler -- secret put ATTEMPT_TOKEN_SECRET --config wrangler.jsonc --env production-organizer
npm.cmd exec wrangler -- secret put AUTH_TOKEN_SECRET --config wrangler.jsonc --env production-organizer
npm.cmd exec wrangler -- secret put AUTH_EMAIL_FROM --config wrangler.jsonc --env production-organizer
npm.cmd exec wrangler -- secret put BREVO_API_KEY --config wrangler.jsonc --env production-organizer
```

`ATTEMPT_TOKEN_SECRET` и `AUTH_TOKEN_SECRET` — независимые случайные значения минимум 32 bytes. Staging использует Brevo и подтверждённый Gmail sender без собственного домена. После успешного staging UAT переключить `production-organizer` в `wrangler.jsonc` на `AUTH_EMAIL_PROVIDER=brevo`, указать тот же подтверждённый sender, выполнить `npm.cmd run cf:typegen` и только затем задавать production `BREVO_API_KEY`/деплоить. Resend остаётся rollback-адаптером, но `onboarding@resend.dev` не подходит для открытой регистрации.

## Сборка и deploy

Cloudflare Vite plugin flatten-ит выбранный environment в `dist/vecta/wrangler.json`. Поэтому environment выбирается на build, а deploy запускается **без** `--env`.

Public:

```powershell
npm.cmd run build:production:public
npm.cmd exec wrangler -- deploy --dry-run
npm.cmd exec wrangler -- deploy
```

Organizer:

```powershell
npm.cmd run build:production:organizer
npm.cmd exec wrangler -- deploy --dry-run
npm.cmd exec wrangler -- deploy
```

Не собирать оба environment до первого deploy: второй build заменяет flattened output первого.

## Smoke после deploy

1. Оба `/api/health` возвращают `200` и request ID.
2. Public `/login` переводит на Organizer hostname.
3. Anonymous Organizer `/api/v1/session` возвращает `401`.
4. Новый email проходит Turnstile, получает OTP, автоматически создаёт личное пространство и входит в `/app`; повторное использование OTP отклоняется.
5. Создать черновик, проверить autosave/reload, publish и одноразовую выдачу code/QR.
6. Участник проходит open attempt, ответы восстанавливаются после reload, submit идемпотентен.
7. Organizer видит результат и скачивает безопасный CSV.
8. Logout отзывает только organizer session; participant exit завершает только attempt.
9. Проверить desktop 1440×1024 и mobile 390×844, клавиатуру и отсутствие console errors.

## Rollback

Перед deploy записать текущий version ID из Cloudflare. При ошибке выполнить rollback через Workers dashboard → Deployments → нужная предыдущая версия → Rollback, затем повторить health/auth smoke.

D1 migrations являются forward-only. Текущие migrations additive/compatible; откат Worker не требует удаления таблиц. Никогда не выполнять destructive rollback D1 без проверенного backup и отдельного migration plan.

## Observability

- Workers Observability включён с sampling rate `1`.
- Логи auth не должны содержать email, OTP, raw tokens или provider body.
- Проверять `organizer_login_email_failed`, его поле `provider`, HTTP 5xx/429 и D1 errors по request ID. Email, OTP и provider response body в логах быть не должно.
- После стабилизации снизить sampling только отдельным осознанным решением.
