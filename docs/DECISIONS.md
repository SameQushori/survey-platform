# Vecta — Decision Log

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

## 2026-08-29 — Git repository

- Decision: использовать `https://github.com/SameQushori/survey-platform`, base branch `main`.
- Delivery branch: отдельная ветка полного ревампа; прямой push в `main` запрещён.
- Affected phases: 1, 12.
- Plan change required: да.

## Open decision

- Production-вход организаторов: Cloudflare Access с IdP, email one-time code или другой managed auth.
- Decision deadline: до начала Phase 5. До этого допустима только локальная тестовая identity-заглушка, не попадающая в production.
