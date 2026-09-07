# Vecta Deployment and Rollback Runbook

Обновлено: 2026-09-07

## Контуры

| Контур | Public Worker | Organizer Worker | D1 | Organizer identity |
| --- | --- | --- | --- | --- |
| Staging | `vecta-staging-public` | `vecta-staging-organizer` | `vecta-staging` | Clerk Development |
| Production | `vecta-public` | `vecta-organizer` | `vecta-production` | Clerk Production после подключения домена |

Staging и production используют разные D1. Bindings хранятся в `wrangler.jsonc`, secrets — только в Cloudflare.

## Предпроверки

```powershell
npm.cmd ci
npm.cmd run quality
npm.cmd exec wrangler -- whoami
```

Проверить `git status --ignored --short`: secrets, `.env*`, `.dev.vars*`, дампы D1, `.wrangler`, `dist`, coverage и AI/Codex artifacts не должны быть tracked или staged.

## D1

```powershell
npm.cmd exec wrangler -- d1 migrations apply vecta-staging --remote --config wrangler.jsonc --env staging-organizer
npm.cmd exec wrangler -- d1 migrations list vecta-staging --remote --config wrangler.jsonc --env staging-organizer
```

Для production заменить имя базы и environment на `vecta-production` / `production-organizer`. Перед потенциально destructive migration сделать remote export в путь вне репозитория. Миграции forward-only.

## Secrets

Participant secrets задаются отдельно для Public и Organizer Worker:

```powershell
npm.cmd exec wrangler -- secret put TURNSTILE_SECRET --config wrangler.jsonc --env staging-public
npm.cmd exec wrangler -- secret put ATTEMPT_TOKEN_SECRET --config wrangler.jsonc --env staging-public
npm.cmd exec wrangler -- secret put TURNSTILE_SECRET --config wrangler.jsonc --env staging-organizer
npm.cmd exec wrangler -- secret put ATTEMPT_TOKEN_SECRET --config wrangler.jsonc --env staging-organizer
```

Clerk нужен только Organizer Worker:

```powershell
npm.cmd exec wrangler -- secret put CLERK_SECRET_KEY --config wrangler.jsonc --env staging-organizer
npm.cmd exec wrangler -- secret put CLERK_PUBLISHABLE_KEY --config wrangler.jsonc --env staging-organizer
```

Secrets вводятся интерактивно; значения нельзя передавать аргументами команды. Client bundle получает соответствующий `VITE_CLERK_PUBLISHABLE_KEY` из локального игнорируемого environment или CI secret.

## Сборка и deploy

Cloudflare Vite plugin flatten-ит выбранный environment в `dist/vecta/wrangler.json`; deploy запускается без дополнительного `--env`.

```powershell
npm.cmd run deploy:staging:public -- --dry-run
npm.cmd run deploy:staging:organizer -- --dry-run
npm.cmd run deploy:staging:public
npm.cmd run deploy:staging:organizer
```

Каждая команда сначала собирает конкретный environment. Build guard принимает `pk_test_*` только для staging и `pk_live_*` только для production, поэтому development publishable key не может случайно попасть в production bundle. Скрипт декодирует Frontend API origin из publishable key и генерирует для него точный Static Assets CSP из `scripts/cloudflare-headers.template`; ручной deploy результата обычного `vite build` запрещён. Production-команды разрешены только после создания Clerk Production instance, настройки собственного домена и установки production keys.

## Smoke после deploy

1. Оба `/api/health` возвращают `200` и `X-Request-Id`.
2. Public `/login` переводит на Organizer hostname.
3. Anonymous Organizer `/api/v1/session` возвращает `401`.
4. Email-код и Google создают Clerk session и приводят в `/app`.
5. Первый вход нового аккаунта создаёт одно пустое личное пространство; второй вход не создаёт дубликат.
6. Два разных аккаунта не видят данные друг друга.
7. Черновик сохраняется после reload, публикация выдаёт code/QR, participant attempt завершается, результат и CSV доступны организатору.
8. Logout завершает Clerk session; participant exit завершает только попытку.
9. Проверить desktop 1440×1024 и mobile 390×844, клавиатуру и отсутствие console errors.

## Rollback

Перед deploy записать текущий Worker version ID. При ошибке вернуть предыдущую версию через Workers Dashboard → Deployments → Rollback и повторить health/auth smoke. Не удалять D1-таблицы auth во время rollback.

## Observability

- Workers Observability включён с sampling rate `1`.
- Логи не должны содержать Clerk JWT, secret keys, email-коды, invitation tokens или participant attempt tokens.
- Проверять HTTP 401/403/5xx, ошибки Clerk verification/profile lookup, D1 provisioning и request ID.
