# Vecta — D1 Data Model

Источник schema: последовательные migrations `migrations/0001_initial.sql`–`0005_organizer_email_auth.sql`.

## Принципы

- Идентификаторы создаёт Worker и передаёт как opaque TEXT UUID.
- Время хранится как Unix milliseconds UTC.
- Foreign keys включены и используются с `RESTRICT` для данных, которые нельзя тихо удалить.
- Hard delete assessments в MVP отсутствует; lifecycle задаётся status.
- Published content хранится snapshot-версиями и после публикации не изменяется.
- Редактируемый документ хранится только у draft-версии в `assessment_versions.draft_json`; optimistic concurrency использует монотонный `revision`.
- Исходные public codes, invitation tokens и idempotency keys в D1 не сохраняются — только digests.
- Correctness хранится только в private `question_options.is_correct` и никогда не проецируется в participant DTO.

## Связи

```text
organizations ──< memberships >── users
      │                         │
      └──< assessments ──< assessment_versions ──< questions ──< question_options
                                  │                      │
                                  └── publications       └── answers ──< answer_options
                                          │                    │
                                          ├──< invitations     │
                                          └──< attempts ───────┘
                                                  │
                                                  └── results

users ──< organizer_auth_challenges
  └────< organizer_auth_sessions

organizations/users ──< audit_log
idempotency_keys — scoped технический ledger
```

## Инварианты

- Один draft на assessment обеспечивается partial unique index.
- Один live publication на assessment обеспечивается partial unique index.
- Один Attempt на controlled invitation обеспечивается unique FK.
- Для open best-effort-once Worker записывает participant identity digest; partial unique index блокирует дубль.
- Для open unlimited digest остаётся `NULL`, поэтому индекс не ограничивает повторы.
- Rating всегда unscored с `points=0`.
- Submitted Attempt обязательно имеет `submitted_at`; active/expired — не имеет.
- Result существует только для финализированной попытки; это дополнительно проверяет application transaction.

## D1-specific решения

- Миграции — последовательные `.sql` файлы; уже применённые файлы не редактируются.
- Индексы соответствуют tenant/status/time predicates и join columns.
- D1 foreign keys считаются включёнными; для будущих schema rebuild migrations используется `PRAGMA defer_foreign_keys`, а не попытка отключить enforcement.
- Read replication не требуется для MVP. Если будет включена позже, read-after-write flows используют D1 Sessions API/bookmarks.
- Workers Rate Limiting является permissive abuse-control, но не источником строгого лимита попыток; строгие правила сохраняются в D1.

## Validation boundary

Zod проверяет payload до SQL. SQL использует только prepared statements с bindings. Database CHECK/UNIQUE/FK constraints являются вторым слоем и не заменяют продуктовую validation.

## Проверка Phase 2

- Wrangler `4.127.1` применил `0001_initial.sql` к пустой локальной D1.
- Выполнено 32 SQL-команды; создано 17 прикладных таблиц.
- `PRAGMA foreign_key_check` не вернул ошибок.
- Повторный `d1 migrations apply` сообщил, что неприменённых migrations нет.

## Дополнение Phase 6

- `0003_authoring_revisions.sql` добавляет `revision`, `draft_json` и индекс draft-revision без изменения уже опубликованных снимков.
- Draft допускает временно незаполненные поля в пределах bounded runtime-схемы; publish повторно валидирует документ строгой схемой.
- Публикация одним D1 `batch()` создаёт immutable version, нормализованные `questions`/`question_options`, publication policy, audit event и idempotency response.
- Open access code генерируется Web Crypto. D1 хранит только SHA-256 digest и двухсимвольную подсказку; исходный код возвращается один раз либо при явной ротации.
- Закрытие публикации и архивирование assessment не удаляют snapshot и не меняют опубликованный контент.

## Дополнение Phase 11

- `0005_organizer_email_auth.sql` добавляет одноразовые organizer challenges и revocable server-side sessions.
- Challenge хранит только HMAC digest кода, expiry, state и bounded failed-attempt counter.
- Session хранит только HMAC digest высокоэнтропийного cookie token, expiry и revocation timestamp.
- Raw OTP и session token не записываются в D1; ротация `AUTH_TOKEN_SECRET` инвалидирует оба класса credentials.

## Platform references

- [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Cloudflare D1 foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)
- [Cloudflare D1 indexes](https://developers.cloudflare.com/d1/best-practices/use-indexes/)
