# Organizer Authentication Runbook

Обновлено: 2026-09-07
Статус: Clerk Development подключён; код готов к staging deploy и UAT. Production Clerk требует собственного домена.

## Архитектура

- Clerk обслуживает регистрацию, Google OAuth, email-коды, bot protection и organizer sessions.
- Регистрация открыта: allow-list и Super Admin отсутствуют.
- После первого валидного Clerk session Worker атомарно создаёт в D1 пользователя, личную организацию, membership `organizer` и audit event.
- Последующие запросы сопоставляются по неизменяемому `clerk:<user_id>` в `users.auth_subject`.
- D1 остаётся источником истины для tenant boundary: валидная Clerk-сессия не даёт доступа к чужой организации.
- Cloudflare Turnstile удалён из organizer login и остаётся только в participant flow.
- Старые D1-таблицы OTP/session сохранены миграционной историей, но runtime-маршруты Brevo/Resend удалены.

## Конфигурация

Client build:

```text
VITE_CLERK_PUBLISHABLE_KEY
```

Organizer Worker:

```text
AUTH_MODE=clerk
CLERK_AUTHORIZED_PARTIES=https://<точный-organizer-host>
CLERK_SECRET_KEY
CLERK_PUBLISHABLE_KEY
```

`CLERK_AUTHORIZED_PARTIES` хранится в `wrangler.jsonc`; ключи задаются как Worker secrets. Значения ключей запрещено помещать в Git, документацию, shell history или логи.

Локальная привязка приложения:

```powershell
clerk login
clerk link --app <application-id>
clerk env pull --app <application-id> --instance dev
```

Установка staging secrets выполняется интерактивно:

```powershell
npm.cmd exec wrangler -- secret put CLERK_SECRET_KEY --config wrangler.jsonc --env staging-organizer
npm.cmd exec wrangler -- secret put CLERK_PUBLISHABLE_KEY --config wrangler.jsonc --env staging-organizer
```

Перед сборкой staging в локальном `.env.local` должен находиться development `VITE_CLERK_PUBLISHABLE_KEY`. Production собирается только с ключом Clerk Production instance.

## Staging UAT

1. Открыть Organizer `/login` в обычном Chrome или Edge.
2. Проверить вход существующего пользователя через шестизначный email-код, включая вставку полного кода и папку «Спам».
3. Выйти через меню профиля; обновление `/app` должно вернуть на `/login`.
4. Войти через Google. Embedded browser может блокировать OAuth — это не считается результатом UAT.
5. Зарегистрировать новый email и убедиться, что автоматически создано одно пустое личное пространство.
6. Создать тест, обновить страницу и проверить сохранение.
7. Зарегистрировать второй аккаунт и убедиться, что он не видит данные первого.
8. Вызвать organizer API без токена и с токеном другого Clerk application: оба запроса должны получить `401`.
9. Проверить, что Worker logs не содержат JWT, email-коды или Clerk secret keys.

## Отзыв и аварийные действия

- Для немедленного завершения сессий пользователя отозвать его sessions в Clerk Dashboard.
- Для блокировки на уровне Vecta перевести D1 user в `disabled`; Worker должен отвечать `403` даже при валидной Clerk session.
- При компрометации `CLERK_SECRET_KEY` ротировать ключ в Clerk, затем интерактивно обновить Worker secret и выполнить deploy.
- Rollback выполняется возвратом предыдущей Worker version. D1 migrations forward-only; auth-таблицы нельзя удалять в аварийном rollback.

## Production gate

Clerk Production instance требует домен, которым владеет проект, и DNS-настройку. Пока домена нет, разрешён только staging на Clerk Development instance. Публиковать production Worker с development keys запрещено.
