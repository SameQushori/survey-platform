# Vecta — HTTP API Contract

Статус: Phase 8 implemented contract

Base path: `/api/v1`
Формат: JSON, UTF-8

## Общие правила

- Все ответы содержат `X-Request-Id`; входящий валидный request ID может быть принят, иначе Worker создаёт новый.
- Ошибки используют `application/problem+json` и тип `ApiProblem` из `shared/contracts.ts`.
- Неизвестные поля mutation payload отклоняются runtime-схемой.
- Все timestamps — Unix milliseconds UTC.
- Все идентификаторы opaque; клиент не извлекает из них смысл.
- Organizer endpoints требуют подтверждённую managed identity и server-side membership check.
- Production identity берётся только из server-side organizer session; клиентские поля роли/организации игнорируются.
- Participant endpoints принимают `Authorization: Bearer <attempt-token>`; токен короткоживущий, подписанный и привязан к `attemptId`/`tokenVersion`.
- `answer key`, `isCorrect`, внутренние points и tenant metadata отсутствуют во всех participant DTO.
- Коды и invitation tokens перед сравнением превращаются в digest; исходные значения не записываются в БД или logs.

## Idempotency

Заголовок `Idempotency-Key` обязателен для publish, создания invitation batch и submit. Ключ имеет 8–200 символов и используется вместе с authenticated scope.

- Повтор с тем же ключом и тем же request hash возвращает сохранённый status/body.
- Повтор с другим request hash возвращает `409 idempotency_conflict`.
- Submit дополнительно защищён неизменяемым состоянием Attempt.
- Turnstile Siteverify retry использует отдельный UUID `idempotency_key`.

## Public endpoints

| Method | Route | Назначение | Ограничения |
|---|---|---|---|
| `POST` | `/publications/resolve` | Проверить открытый код и вернуть безопасные метаданные | rate limit; без вопросов и answer key |
| `POST` | `/attempts` | Проверить access credential + Turnstile и создать/восстановить Attempt | rate limit; ровно `code` или `invitationToken` |
| `GET` | `/attempts/:attemptId` | Получить assessment snapshot и сохранённые ответы | attempt bearer token |
| `PUT` | `/attempts/:attemptId/answers/:questionId` | Валидировать и сохранить один ответ | attempt bearer token; только active |
| `POST` | `/attempts/:attemptId/submit` | Финализировать и посчитать результат | attempt bearer token + idempotency key |
| `POST` | `/attempts/:attemptId/abandon` | Безвозвратно завершить активную попытку без отправки | attempt bearer token; только active |

### `POST /publications/resolve`

Request:

```json
{ "code": "VECTA1" }
```

Response не содержит вопросов:

```json
{
  "title": "Основы безопасности",
  "description": "Краткий тест",
  "durationSeconds": 900,
  "accessMode": "open",
  "requiresDisplayName": true
}
```

### `POST /attempts`

Request соответствует `CreateAttemptRequest`. Для controlled link токен передаётся из URL fragment в JSON body, чтобы не попадать в HTTP URL logs.

Response соответствует `CreateAttemptResponse`. `assessment.questions[].options` содержит только `id`, `text`, `position`.

### `PUT /attempts/:attemptId/answers/:questionId`

- Single choice: option ID string.
- Multiple choice: непустой массив уникальных option IDs.
- Rating: целое число внутри snapshot range.
- Очистка необязательного ответа: `null`.
- Worker проверяет, что вопрос и options принадлежат snapshot попытки.

### `POST /attempts/:attemptId/submit`

- Обязательные вопросы должны иметь валидный сохранённый ответ.
- При истёкшем deadline Worker сначала переводит Attempt в `expired` и финализирует сохранённые ответы согласно Product Spec.
- Response показывает score только при `showParticipantResult=true`.

## Session и регистрация

| Method | Route | Доступ | Назначение |
|---|---|---|---|
| `POST` | `/auth/request-code` | Public + Turnstile + rate limits | Принять любой валидный email, создать provisional user при необходимости и вернуть `202` только после принятия OTP почтовым provider |
| `POST` | `/auth/verify-code` | Public + rate limit | Однократно проверить OTP; при первом входе создать личную организацию/membership и выдать HttpOnly session cookie |
| `POST` | `/auth/logout` | Session + same-origin marker | Отозвать текущую server-side session и очистить cookie |
| `GET` | `/session` | Organizer session | Текущая identity и memberships |
| `GET` | `/organizations/:organizationId/workspace` | Organizer member | Проверенный tenant context для shell |

Целевой вход: открытая регистрация по email, бесплатный Turnstile, одноразовый шестизначный код на 10 минут и лимиты запросов по IP/email. Worker синхронно ждёт принятия письма provider API: отказ/timeout возвращает `502 email_delivery_failed` и очищает challenge/provisional user. D1 хранит только HMAC digest OTP и session token. После успеха Worker выдаёт 12-часовую `__Host-vecta_session` cookie (`Secure`, `HttpOnly`, `SameSite=Lax`), а права повторно проверяются по D1 membership. Платформенной Super Admin-роли и соответствующих endpoints нет.

## Assessment authoring

| Method | Route | Доступ | Назначение |
|---|---|---|---|
| `GET` | `/organizations/:organizationId/assessments` | Organizer member | Список с pagination/filter |
| `POST` | `/organizations/:organizationId/assessments` | Organizer member | Assessment + первый draft |
| `GET` | `/assessments/:assessmentId/draft` | Organizer member | Полный private draft DTO |
| `PUT` | `/assessments/:assessmentId/draft` | Organizer member | Атомарно заменить draft content |
| `POST` | `/assessments/:assessmentId/publish` | Organizer member | Валидировать, snapshot и publication |
| `POST` | `/assessments/:assessmentId/revise` | Organizer member | Закрыть live-доступ и создать новый draft из последнего immutable snapshot |
| `POST` | `/publications/:publicationId/close` | Organizer member | Запретить новые попытки |
| `POST` | `/publications/:publicationId/reopen` | Organizer member | Повторно открыть последнюю closed/archived publication |
| `POST` | `/assessments/:assessmentId/archive` | Organizer member | Архивировать закрытый тест |
| `GET` | `/publications/:publicationId/distribution` | Organizer member | Policy, status и безопасная code hint |
| `POST` | `/publications/:publicationId/code/rotate` | Organizer member | Инвалидировать старый и один раз вернуть новый код |

`PUT /draft` принимает полный документ и использует optimistic concurrency через `If-Match: <draft-revision>`. Успешный ответ и `GET /draft` содержат актуальный `ETag`; несовпадение возвращает `409 conflict`.

Publish выполняет в одной логической операции:

1. Проверяет draft и права.
2. Создаёт immutable published version и content hash.
3. Создаёт publication policy и access digest.
4. Переводит assessment в `published`.
5. Записывает audit event и idempotency response.

Операция реализована D1 `batch()` с conditional statements: частично опубликованный тест не становится видимым. Повтор с тем же `Idempotency-Key` и тем же request hash возвращает сохранённый результат.

Для open publication исходный код присутствует только в ответе publish/rotate. `GET /distribution` никогда не возвращает plaintext; Organizer UI сразу очищает transient navigation state, поэтому reload требует явной ротации. QR строится из production-independent BrowserRouter route `/join?code=...`.

Обратные переходы не меняют опубликованный snapshot. `reopen` сохраняет publication/version/results и очищает прошедший `closesAt`, иначе тест остался бы недоступен. `revise` атомарно закрывает live publication, создаёт draft со следующим номером версии и новыми question/option IDs, чтобы старые ответы продолжали ссылаться на исходную версию. Список assessments возвращает историю публикаций для выбора прежних результатов.

## Controlled invitations

| Method | Route | Доступ | Назначение |
|---|---|---|---|
| `POST` | `/publications/:publicationId/invitations/batch` | Organizer member | Создать персональные ссылки |
| `GET` | `/publications/:publicationId/invitations` | Organizer member | Список без исходных токенов |
| `POST` | `/invitations/:invitationId/revoke` | Organizer member | Отозвать неиспользованное приглашение |

Исходный invitation token возвращается только один раз в ответе batch-create. В БД хранится digest.

## Results

| Method | Route | Доступ | Назначение |
|---|---|---|---|
| `GET` | `/publications/:publicationId/results/overview` | Organizer member | Агрегаты |
| `GET` | `/publications/:publicationId/results/questions` | Organizer member | Анализ вопросов |
| `GET` | `/publications/:publicationId/attempts` | Organizer member | Paginated attempts |
| `GET` | `/attempts/:attemptId/detail` | Organizer member | Private attempt detail |
| `GET` | `/publications/:publicationId/export.csv` | Organizer member | Защищённый CSV export |

Pagination использует opaque cursor, а не page offset. Export проверяет membership до выполнения query и нейтрализует spreadsheet formulas.

Overview возвращает реальные attempt counts, средний процент только по результатам с `maxScore > 0`, четыре фиксированных диапазона, controlled participation и UTC trend завершений. Question analysis считает exact-match correctness только по финализированным попыткам; для шкалы возвращается среднее значение. Синхронный CSV ограничен 10 000 строками, выдаётся с `Cache-Control: private, no-store` и не использует R2.

## Error mapping

| HTTP | Code | Пример |
|---|---|---|
| `400` | `bad_request`, `validation_failed` | неверный JSON/поле |
| `401` | `unauthorized` | отсутствует/невалиден auth token |
| `403` | `forbidden` | нет membership или неверная роль |
| `404` | `not_found` | ресурс не существует или скрыт tenant boundary |
| `409` | `conflict`, `idempotency_conflict`, `attempt_already_used` | revision/state conflict |
| `410` | `assessment_closed`, `access_expired`, `attempt_expired` | публичный доступ больше невозможен |
| `429` | `rate_limited` | содержит `Retry-After` |
| `502` | `turnstile_failed` | Siteverify недоступен после допустимого retry |
| `500` | `internal_error` | detail не раскрывает внутренности |

## Platform references

- [Turnstile server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Workers Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Workers testing](https://developers.cloudflare.com/workers/testing/)
