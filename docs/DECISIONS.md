# Vecta — Decision Log

## 2026-09-05 — Production provisioning и честный deploy gate

- Decision: production D1, migrations, owner bootstrap и Worker environments создаются отдельно от staging; staging data не переиспользуются.
- Safety: production Workers не деплоятся с отсутствующими Turnstile/Resend secrets и не получают тестовый Turnstile secret или local auth fallback.
- Email constraint: без собственного домена Resend sandbox отправляет только на email владельца аккаунта; это допустимо для owner UAT, но не объявляется публичной production-доставкой.
- Delivery: code/docs/CI/Git PR могут быть завершены как release candidate, а production deploy остаётся внешним gate до интерактивной установки secrets и успешного UAT.
- Affected phases: 11–12.

## 2026-08-29 — Brand

- Decision: использовать бренд **Vecta**.
- Reason: выбран владельцем продукта.
- Affected phases: все.
- Plan change required: нет, решение внесено в строгий план.

## 2026-08-29 — Backend platform

- Decision: перенести backend с Firebase на Cloudflare.
- Target: Workers + D1; R2, Turnstile и Rate Limiting добавляются по строгому плану.
- Reason: проекту нужен доверенный серверный слой, реляционная модель, строгая авторизация и контролируемая отправка попыток.
- Affected phases: 2, 4–12.
- Plan change required: нет, решение внесено в строгий план.

## 2026-08-29 — Delivery

- Decision: после полного завершения разместить Vecta на Cloudflare, очистить репозиторий и передать изменения одним большим Pull Request.
- Constraint: merge выполняется только после review владельца продукта.
- Affected phases: 11–12.
- Plan change required: нет.

## 2026-08-29 — Legacy data

- Decision: начать Vecta с чистой Cloudflare D1; существующие Firebase-опросы, ответы и аккаунты не мигрировать.
- Constraint: при необходимости перед удалением Firebase допускается read-only архив вне Git.
- Affected phases: 2, 4, 10, 12.
- Plan change required: да, Phase 10 заменена с миграции на retirement.

## 2026-08-29 — Participant modes

- Decision: поддержать открытый и контролируемый режимы участия.
- Open mode: общая ссылка/код, отображаемое имя, повторные попытки определяются настройкой теста.
- Controlled mode: персональная одноразовая ссылка/токен и одна завершённая попытка на приглашение.
- Affected phases: 0, 2, 3, 6–9.
- Plan change required: да, правила добавлены в MVP Scope.

## 2026-08-29 — Participant result visibility

- Decision: результат участника скрыт по умолчанию.
- When enabled by organizer: показывать набранный и максимальный баллы после успешной отправки.
- Constraint: правильные ответы и answer key участнику в MVP не показывать.
- Affected phases: 0, 2, 3, 6–9.
- Plan change required: да.

## 2026-08-29 — Text questions

- Decision: текстовые ответы записать в post-MVP backlog и не реализовывать сейчас.
- Reason: правило ручной/автоматической проверки будет принято позже.
- Affected phases: 0, 2, 3, 6–9.
- Plan change required: да, MVP теперь содержит три типа вопросов.

## 2026-08-29 — Scoring MVP

- Decision: single choice оценивается по точному совпадению, multiple choice — по полному совпадению множества без частичных баллов, rating scale не участвует в score.
- Points: положительный целочисленный вес, по умолчанию `1`; пропуск даёт `0`.
- Constraint: pass/fail threshold и сертификаты не входят в MVP.
- Affected phases: 0, 2, 3, 6–9.
- Plan change required: Product Spec фиксирует правило; общий scope не расширен.

## 2026-08-29 — Git repository

- Decision: использовать `https://github.com/SameQushori/survey-platform`, base branch `main`.
- Delivery branch: отдельная ветка полного ревампа; прямой push в `main` запрещён.
- Affected phases: 1, 12.
- Plan change required: да.

## 2026-08-29 — Phase 2 validation stack

- Decision: использовать TypeScript strict для domain/contracts, Zod для runtime validation, Vitest для unit tests и Wrangler только как dev tool для локальной D1-проверки.
- Reason: один типизированный контракт должен проверяться до UI и Worker implementation; migration обязана реально применяться к D1-compatible local runtime.
- Constraint: Cloudflare Vitest plugin и Worker runtime setup остаются в Phase 4.
- Affected phases: 2, 4–9.
- Plan change required: нет.

## 2026-08-29 — D1 domain schema

- Decision: immutable assessment versions, отдельная publication policy, одноразовые controlled invitations, attempt/result separation и digest-only access credentials.
- Constraint: один draft и один live publication на assessment; один Attempt на invitation; open uniqueness является только best-effort.
- Affected phases: 2, 4, 6–9.
- Plan change required: нет.

## 2026-09-01 — Production identity организаторов (заменяет решение 2026-08-30)

- Decision: Cloudflare Access/Zero Trust не используется, потому что onboarding требует платёжный профиль, а владелец прямо отказался продолжать checkout.
- Authentication: Vecta выдаёт одноразовый шестизначный email-код и 12-часовую server-side session; браузер получает только `Secure; HttpOnly; SameSite=Lax` cookie с префиксом `__Host-`.
- Storage: D1 хранит только HMAC digest кода и session token, срок действия, число неудачных попыток и revocation state. Raw-коды и токены не сохраняются.
- Authorization: `platform_role` и membership по-прежнему разрешаются только Worker-ом из D1; знание email само по себе не создаёт пользователя.
- Abuse/CSRF: request-code и verify ограничены отдельным rate-limit binding; request-code требует Turnstile action `organizer_login`; cookie-auth mutations требуют same-origin marker и отклоняют cross-site Fetch Metadata/Origin.
- Email delivery: Worker использует provider adapter. Staging настроен на Resend API; API key является Worker secret. `resend.dev` допустим только для UAT на email владельца Resend-аккаунта, production требует подтверждённый sending domain.
- Local development: фиксированные fake identities разрешены только при `APP_ENV=local` на localhost/`.test`; они не являются production fallback.
- Affected phases: 5, 9, 11–12.
- Plan change required: Phase 11 Access gate заменён email-provider/OTP UAT gate.

## 2026-09-02 — Временный staging access code (заменяет email OTP до production gate)

- Decision: интеграция Resend и email OTP временно вырезаны по прямому решению владельца; публичной регистрации нет.
- Authentication: Organizer staging принимает высокоэнтропийный Worker secret `ORGANIZER_ACCESS_CODE` только вместе с Turnstile и выдаёт прежнюю 12-часовую server-side HttpOnly session.
- Identity: access code привязан к единственному `user_staging_owner` без email; роль Super Admin и Organizer membership разрешаются только через D1.
- Abuse/CSRF: код проверяется HMAC/Web Crypto, login ограничен 5 попытками на IP в минуту, Turnstile проверяет action/hostname, cookie mutations остаются same-origin only.
- UI: email login и email-invite block скрыты; Organizer modal содержит одно поле access code.
- Constraint: общий код допустим только для staging owner UAT и не может быть production authentication. До production требуется отдельное утверждение и реализация индивидуальной identity-схемы.
- Affected phases: 5, 9, 11–12.
- Plan change required: Phase 11 email-delivery UAT заменён access-code UAT; production identity перенесена в обязательный gate Phase 11/12.

## 2026-09-02 — Production email OTP (заменяет временный staging access code)

- Decision: по прямому решению владельца Vecta возвращается к индивидуальному входу по одноразовому коду на заранее добавленный email; публичной регистрации нет.
- Authentication: 6 цифр, TTL 10 минут, максимум 5 ошибок, одноразовое атомарное consume, Turnstile и отдельный rate limit; после успеха выдаётся 12-часовая revocable HttpOnly session.
- Privacy: запрос кода всегда возвращает одинаковый `202` и opaque challenge для известного/неизвестного email; отправка выполняется через `waitUntil`, ошибки логируются без PII.
- Delivery: Resend используется поверх Cloudflare Worker, поскольку native Cloudflare Email Sending произвольным адресатам требует Workers Paid. API key — только Worker secret.
- Staging: `onboarding@resend.dev` допустим только для email владельца Resend account. Production требует verified sending domain и совпадающий `AUTH_EMAIL_FROM`.
- Administration: Super Admin снова может добавить organizer по имени/email; этот email становится allow-list для получения OTP.
- Rollout: удалять remote `ORGANIZER_ACCESS_CODE` только после успешного email OTP deploy/smoke, чтобы не потерять доступ к staging при ошибке настройки провайдера.

## 2026-08-29 — Vecta UI implementation dependencies

- Decision: использовать Manrope через `@fontsource/manrope`, Phosphor Icons, dnd-kit и Recharts для утверждённого интерфейса.
- Reason: локальная типографика без внешнего CDN, единая доступная icon-система, keyboard/touch-compatible drag-and-drop и графики без самодельных CSS/SVG-рисунков.
- Constraint: зависимости применяются только в новом `src/vecta/`; legacy Firebase UI остаётся изолированным до Phase 10.
- Affected phases: 3–9.
- Plan change required: нет.

## 2026-08-29 — Выход из активной попытки

- Decision: после старта вопросной части явный выход завершает текущую попытку как использованную.
- UX constraint: перед выходом обязательно показывается предупреждение; отмена возвращает в тест без потери локальных ответов.
- Security constraint: в production итоговый статус и запрет повторного входа определяет Worker, а не клиентский `sessionStorage`.
- Affected phases: 3, 7, 9.
- Plan change required: нет; правило уточняет обработку незавершённой попытки.

## 2026-08-30 — Меню профиля Organizer

- Decision: в MVP меню профиля содержит данные текущего пользователя/организации и только действие «Выйти».
- Constraint: отдельный экран профиля и переключение организации не входят в текущий MVP.
- Affected phases: 3, 5.
- Plan change required: нет; provisional-пункты удалены.

## 2026-08-30 — Канал поддержки

- Decision: основной канал поддержки MVP — email.
- UI candidate: `support@vecta.team`; адрес обязан быть подтверждён на реальном домене до staging/production.
- Constraint: встроенная support-форма и ticketing integration не входят в текущий MVP.
- Affected phases: 3, 11.
- Plan change required: нет.

## 2026-08-30 — Cloudflare foundation

- Decision: React SPA и Worker API разрабатываются и собираются единым официальным Cloudflare Vite plugin runtime; `/api/*` выполняется Worker, остальные маршруты обслуживаются Static Assets с SPA fallback.
- D1: binding `DB` и migration directory задаются в `wrangler.jsonc`; runtime-типы генерируются командой `wrangler types`, ручной `Env` запрещён.
- API baseline: каждый ответ содержит request ID и security headers; ошибки используют утверждённый `application/problem+json`; health endpoint выполняет безопасную `SELECT 1` и не раскрывает bindings/configuration.
- Testing: domain/UI тесты исполняются обычным Vitest, Worker/D1 integration tests — отдельной конфигурацией актуального `@cloudflare/vitest-plugin`.
- Constraint: Phase 4 использует только локальную D1; production Worker/D1 IDs, secrets, deploy и Cloudflare resources остаются запрещены до Phase 11.
- Affected phases: 4–12.
- Plan change required: нет.

## 2026-08-30 — Dependency security baseline

- Decision: React Router обновлён до 7.18.3 для устранения двух moderate advisories; устаревшие v6 future flags удалены. В Phase 5 HashRouter заменён на BrowserRouter, потому что URL fragment не передаётся серверу и не может быть границей Cloudflare Access policy.
- Verification: typecheck, lint, unit/Worker tests, production build и browser smoke test проходят; `npm audit --omit=dev` — 0 vulnerabilities.
- Constraint: дальнейшие breaking dependency upgrades выполняются только с тем же полным quality gate.
- Affected phases: 4, 9, 11–12.
- Plan change required: нет.

## 2026-08-30 — Phase 6 authoring and publication boundary

- Decision: incomplete authoring state хранится как bounded `draft_json` с optimistic `revision`; строгая domain validation является обязательной границей publish.
- Publication: Worker одним D1 `batch()` создаёт immutable normalized snapshot, publication policy, audit event и idempotency response; опубликованный snapshot не редактируется при close/archive.
- Access code: шесть символов генерируются Web Crypto; D1 хранит только digest и двухсимвольную hint. Plaintext возвращается только один раз после publish или явной rotation, а UI очищает transient navigation state до reload.
- Controlled mode: UI не создаёт mock invitation tokens. Реальные одноразовые invitations реализуются в Phase 7 вместе с Attempt backend.
- Verification: 19 unit tests, 16 Worker/D1 integration tests и browser E2E draft → autosave/reload → publish → code/QR → rotate → close.
- Affected phases: 6–9.
- Plan change required: нет; Phase 6 acceptance criteria закрыты без перехода к participant backend.

## 2026-08-31 — Phase 7 participant attempt security boundary

- Decision: public resolve не возвращает вопросы; полный immutable snapshot выдаётся только после успешной проверки access credential и Turnstile при создании или восстановлении попытки.
- Attempt token: короткоживущий JOSE-токен подписан HMAC-секретом Worker и привязан к `attemptId`/`tokenVersion`; в браузере хранится только в `sessionStorage`.
- Access credentials: открытые коды нормализуются, invitation tokens остаются case-sensitive; в D1 сохраняются только HMAC digests. Plaintext invitation возвращается организатору ровно один раз.
- Attempt policy: open mode использует best-effort browser identity; controlled invitation строго одноразовый. Выход переводит активную попытку в `abandoned`, повторное использование не разрешается.
- Server authority: Worker валидирует типы/option IDs, контролирует deadline, сериализует сохранение ответов и идемпотентно финализирует submit. Клиентский таймер не является источником истины.
- Result privacy: participant DTO не содержит answer key; `score/maxScore` возвращаются только при `showParticipantResult=true`.
- Turnstile: production всегда выполняет Siteverify и строго проверяет ожидаемые hostname/action. Локальная разработка использует только официальные dummy sitekey/secret Cloudflare; ослабление metadata-check разрешено исключительно при одновременных `APP_ENV=local`, `AUTH_MODE=local` и точном dummy sitekey.
- Verification: automated quality gate и ручная приёмка фиксируются в `PROJECT_STATUS.md`; production widget, hostname и secrets настраиваются только в Phase 11.
- Affected phases: 7, 9, 11–12.
- Plan change required: нет; Phase 8 запрещено начинать до ручной приёмки Phase 7 владельцем.

## 2026-09-01 — Phase 9 hardening и lightweight results chart

- Decision: Recharts удалён и заменён доступным native SVG-графиком. Это решение заменяет часть записи «Vecta UI implementation dependencies» от 2026-08-29; Manrope, Phosphor Icons и dnd-kit сохраняются.
- Performance: preview хранится как WebP, Manrope импортирует только используемые Cyrillic/Latin subsets и weights; тяжёлый chart chunk отсутствует.
- Accessibility: reusable dialogs/drawer обязаны управлять focus trap, Escape, scroll lock и restoration; results tabs используют WAI-ARIA tab semantics, attempts — native table.
- Security: organizer session token и OTP хешируются HMAC; cookie недоступна JavaScript; Turnstile разрешён CSP только с официального origin, ограничивает token и повторяет transient Siteverify один раз с idempotency key.
- Verification: доказательства и перенесённый на staging Core Web Vitals trace зафиксированы в `docs/PHASE_9_QUALITY_GATE.md` и `docs/SECURITY_THREAT_MODEL.md`.
- Affected phases: 9, 11–12.
- Plan change required: нет.

## 2026-09-01 — Phase 10 Firebase retirement без архива

- Decision: удалить legacy Firebase runtime, конфигурацию, документацию и зависимости; существующие опросы, ответы и организаторы не мигрировать.
- Archive: read-only архив не создаётся, потому что владелец продукта прямо подтвердил отсутствие необходимости в старых данных.
- Runtime: единственный entry point — TypeScript Vecta SPA; единственный backend/data path — Cloudflare Worker + D1.
- Dependency cleanup: вместе с Firebase удалены использовавшиеся только legacy UI пакеты `file-saver` и `gh-pages`.
- Rollback boundary: новый runtime не поддерживает возврат legacy-данных; исходный baseline остаётся в Git tag `local-baseline-before-origin`.
- Verification: retirement inventory и breaking-change note зафиксированы в `docs/PHASE_10_FIREBASE_RETIREMENT.md`.
- Affected phases: 10–12.
- Plan change required: нет.

## 2026-09-04 — Reversible assessment workflow

- Decision: Kanban поддерживает обратные переходы без изменения immutable publication snapshot.
- Reopen: `closed/archived -> published` разрешён только для последней публикации; ответы сохраняются, прошедший `closesAt` очищается, действие пишется в audit log.
- Revise: `published/closed/archived -> draft` создаёт следующую version из нормализованного snapshot с новыми question/option IDs. Live publication сначала закрывается для новых попыток; существующие attempts/results остаются привязаны к старой версии.
- Results history: assessment list возвращает все publication summaries; UI показывает номер версии, когда публикаций больше одной.
- Verification: domain transition tests и Worker/D1 lifecycle tests покрывают reopen, revise, republish v2 и неизменность старого snapshot.
- Affected phases: 6, 8, 11–12.
- Plan change required: нет; это расширение согласованной board-модели без изменения MVP ролей и типов вопросов.
