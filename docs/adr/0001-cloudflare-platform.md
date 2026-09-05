# ADR-0001: Cloudflare как целевая платформа

- Статус: принято
- Дата: 2026-08-29

## Контекст

Legacy React-клиент напрямую работает с Firebase и не имеет доверенного server-side слоя для ролей, scoring, version snapshots, deadline и idempotency.

## Решение

Использовать Cloudflare Workers со Static Assets, D1 как основную БД, Turnstile и Workers Rate Limiting. R2 подключать только при подтверждённой необходимости тяжёлого или асинхронного экспорта. React обращается только к `/api/*`; bindings недоступны клиенту.

## Последствия

- Authorization и tenant isolation реализуются в Worker.
- Нужны D1 migrations, staging/production environments и Worker integration tests.
- Firebase runtime полностью удаляется после готовности Cloudflare vertical slices.
