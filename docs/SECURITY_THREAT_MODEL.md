# Vecta — Security Threat Model

Последнее обновление: 2026-09-06
Область: React SPA, Cloudflare Worker API, D1, organizer email OTP/session flow, Turnstile и публичный participant flow.

## Активы и границы доверия

- D1 хранит организации, memberships, immutable версии тестов, попытки, ответы, агрегаты и audit log.
- Worker является единственной доверенной границей для авторизации, tenant isolation, scoring, deadline и выдачи результата.
- Organizer identity поступает только из проверенной server-side session cookie; роль и организация повторно разрешаются через D1.
- Participant browser недоверенный. Client-side таймер, route parameters, identity и ответы не считаются авторитетными.
- Static Assets публичны и не должны содержать secrets, answer key или runtime-конфигурацию с чувствительными значениями.

## Основные угрозы и меры

| Угроза | Возможный ущерб | Реализованная защита | Остаточный риск / Phase 11 |
| --- | --- | --- | --- |
| Подмена Organizer identity или роли | Доступ к чужой организации | Высокоэнтропийный session token хранится только в `Secure; HttpOnly; SameSite=Lax` cookie, D1 содержит HMAC digest; права разрешаются из D1 | Проверить expiry и logout/revocation на staging |
| Перебор organizer OTP | Захват индивидуальной identity | OTP 6 цифр / 10 минут / один вход, максимум 5 неудачных проверок, rate limit по IP, Turnstile action/hostname; D1 хранит HMAC digest | Проверить реальные лимиты и доставку на staging |
| Массовая регистрация / email bombing | Расход квоты и нежелательные письма | Turnstile Free, раздельные rate limits по IP и HMAC-digest email, одно активное challenge на user; логи не содержат email | Подтвердить Brevo sender и проверить реальные лимиты на staging |
| IDOR / tenant escape | Чтение или изменение чужих тестов и результатов | Organization ID не принимается как источник полномочий; ownership выводится server-side, каждый route проходит membership check | Повторить cross-tenant UAT на staging |
| Утечка answer key | Компрометация теста | Публичный resolve не отдаёт вопросы; participant DTO не содержит answer key, `isCorrect` или внутренних points | Контролировать новые DTO при будущих изменениях |
| Кража кода или invitation token из БД | Несанкционированная попытка | В D1 сохраняются только HMAC digests; plaintext возвращается один раз; controlled invitation одноразовый | Защитить Worker secrets и журналы Cloudflare |
| Подделка или повтор attempt token | Доступ к чужой попытке | Короткоживущий подписанный token привязан к `attemptId` и `tokenVersion`; abandon инвалидирует версию | Ротация секрета требует runbook в Phase 11 |
| Обход дедлайна или повторный submit | Изменение результата | Deadline и status проверяет Worker; ответы валидируются server-side; submit идемпотентен | Наблюдать аномальные повторные запросы |
| Боты и перебор кодов | Нагрузка и подбор доступа | Turnstile Siteverify, строгие hostname/action, token limit, retry только один раз; rate limit публичного resolve | Создать production widget/rules и проверить реальные лимиты |
| CSV formula injection | Выполнение формул у организатора | Все значения с `=`, `+`, `-`, `@`, включая leading whitespace, нейтрализуются; export требует membership | Не ослаблять sanitizer при новых колонках |
| Stored/DOM XSS | Кража сессии, изменение UI | React escaping, отсутствие `dangerouslySetInnerHTML`, строгий CSP без `unsafe-inline`/`unsafe-eval`; Turnstile разрешён только с официального origin | Проверить CSP reports и сторонние интеграции перед добавлением |
| CSRF / cross-origin API abuse | Изменение данных от имени пользователя | Organizer mutations требуют `X-Requested-With`, same-origin Fetch Metadata/Origin и SameSite cookie; participant mutations требуют bearer attempt token; security headers запрещают embedding | Повторить cross-site negative UAT на staging |
| Утечка secrets через Git/build/logs | Компрометация runtime | `.env*`, `.dev.vars*`, keys и service accounts исключены; build очищается и сканируется; structured error log не содержит PII, ответов или токенов | Настроить Cloudflare/CI secrets и log retention в Phase 11 |
| Supply-chain уязвимость | Выполнение вредоносного кода | Lockfile, dependency audit и полный quality gate; Firebase/Recharts/legacy зависимости удалены | Включить CI audit/dependency review в Phase 12 |

## Проверенные инварианты

- Local identity работает только при `APP_ENV=local`, `AUTH_MODE=local` и локальном hostname; production fail-closed покрыт тестом.
- Turnstile отклоняет неверные action/hostname и ограничивает token 2048 символами; transient Siteverify повторяется не более одного раза с тем же idempotency key.
- Rate-limit integration test подтверждает отклонение 21-го resolve-запроса после 20 разрешённых запросов.
- Organizer session принимает только непросроченный и неотозванный token digest; raw session token отсутствует в D1.
- Открытая регистрация не принимает роль/organization ID с клиента; личное пространство создаётся сервером после подтверждения OTP, а disabled user не реактивируется самостоятельно.
- Participant payload и результат не раскрывают правильные ответы.
- CSV tenant boundary и formula neutralization покрыты Worker/D1 integration tests.

## Не считается закрытым до Phase 11

- Organizer Turnstile hostname настроен; Brevo sender нужно подтвердить, `BREVO_API_KEY` установить интерактивно и развернуть новую staging version.
- Staging UAT должен проверить email OTP, cookies, redirects, hostname binding, rate-limit поведение, anti-enumeration, observability и rollback.
- Production заблокирован до успешного email OTP UAT и подтверждённого sender; собственный sending domain остаётся желательным deliverability-gate перед публичным трафиком.
- Метрики Core Web Vitals снимаются на staging с production-like network/cache; локальный bundle gate не заменяет этот замер.
