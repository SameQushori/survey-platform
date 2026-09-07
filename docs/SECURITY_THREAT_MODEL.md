# Vecta — Security Threat Model

Последнее обновление: 2026-09-07
Область: React SPA, Clerk organizer identity, Cloudflare Worker API, D1, Turnstile и публичный participant flow.

## Активы и границы доверия

- Clerk является доверенной границей organizer identity, регистрации, OAuth, email-кодов и session lifecycle.
- Worker проверяет Clerk token server-side и принимает только токены с точным `authorizedParty` Organizer host.
- D1 является единственным источником полномочий: организация и роль выводятся из active membership, а не из request body или Clerk metadata.
- Participant browser недоверенный. Таймер, route parameters, identity и ответы на клиенте не считаются авторитетными.
- Static Assets публичны и не должны содержать secret keys, answer key или чувствительную runtime-конфигурацию.

## Основные угрозы и меры

| Угроза | Возможный ущерб | Реализованная защита | Остаточный риск |
| --- | --- | --- | --- |
| Подмена organizer identity | Захват рабочего пространства | `@clerk/backend` проверяет session token; `authorizedParties` ограничивает точный origin; local mode fail-closed вне localhost | Провести negative-token UAT на staging |
| IDOR / tenant escape | Чтение или изменение чужих тестов | Каждый organizer route повторно разрешает active D1 membership; organization ID не является полномочием | Повторить cross-account UAT |
| Массовая регистрация / email bombing | Расход квоты и нежелательные письма | Clerk bot protection, provider limits и abuse controls; собственный organizer email endpoint удалён | Настроить Clerk production protections перед публичным трафиком |
| Утечка Clerk secret | Подделка backend-запросов | Secret существует только в Clerk/Cloudflare secrets; `.env*` игнорируются и release-сканируются | Ротация по auth runbook, ограничение dashboard access |
| Disabled user повторно регистрируется | Обход блокировки | Существующий D1 user со статусом `disabled` получает `403` и не provision-ится повторно | Добавить административный self-service только отдельным решением |
| Утечка answer key | Компрометация теста | Public resolve не отдаёт вопросы; participant DTO не содержит answer key, `isCorrect` или внутренних points | Контролировать новые DTO |
| Кража access/invitation token из D1 | Несанкционированная попытка | В D1 только HMAC digests; invitation одноразовый; plaintext возвращается один раз | Защитить Worker secrets и логи |
| Подделка attempt token | Доступ к чужой попытке | Короткоживущий JOSE token привязан к attempt/version; abandon инвалидирует версию | Ротация секрета завершает активные попытки |
| Обход дедлайна / повтор submit | Изменение результата | Deadline и status проверяет Worker; ответы валидируются server-side; submit идемпотентен | Наблюдать аномальные повторы |
| Боты и подбор participant code | Нагрузка и подбор доступа | Turnstile Siteverify с hostname/action, rate limit публичного resolve, bounded payload | Проверить production widget/rules |
| CSV formula injection | Выполнение формул у организатора | Опасные префиксы нейтрализуются; export требует membership; лимит 10 000 строк | Не ослаблять sanitizer |
| Stored/DOM XSS | Кража сессии, изменение UI | React escaping, отсутствие `dangerouslySetInnerHTML`, API CSP `default-src 'none'`, запрет embedding; Static Assets CSP генерируется с точным Clerk FAPI из publishable key | Проверить сгенерированный CSP повторно для production key/domain |
| CSRF / cross-origin mutations | Изменение данных | Bearer Clerk token, `X-Requested-With`, Fetch Metadata/Origin checks; participant mutations требуют отдельный bearer token | Проверить staging cross-site negative cases |
| Supply chain | Выполнение вредоносного кода | Lockfile, audit, typecheck, tests, build и release scan в CI | Контролировать обновления Clerk/Workers SDK |

## Проверенные инварианты

- Local identity работает только при `APP_ENV=local`, `AUTH_MODE=local` и локальном hostname.
- Первый Clerk user provision создаёт user + organization + organizer membership + audit event одним D1 batch; повторный вызов не создаёт дубликат.
- Disabled D1 user не получает новую identity и не реактивируется автоматически.
- Participant Turnstile отклоняет неверные action/hostname и ограничивает размер token.
- Participant payload и результат не раскрывают правильные ответы.
- CSV tenant boundary и formula neutralization покрыты Worker/D1 integration tests.

## Открытые production gates

- Выполнить Clerk staging UAT: email, Google, logout, cross-account isolation, invalid token и observability.
- Подключить собственный домен, создать Clerk Production instance и настроить production OAuth credentials/DNS.
- Проверить автоматически сгенерированный Static Assets CSP с финальным Clerk Production key/domain.
- Снять Core Web Vitals на staging с production-like network/cache.
