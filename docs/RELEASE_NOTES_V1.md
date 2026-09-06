# Vecta 1.0 — Release Notes

Дата release candidate: 2026-09-06

## Что изменилось

Vecta 1.0 полностью заменяет прежнюю Survey Platform. Новый продукт построен вокруг корпоративной оценки знаний и единого lifecycle: создать → опубликовать → провести → проанализировать → переоткрыть или выпустить новую версию.

Основные изменения:

- новый responsive интерфейс Vecta без legacy UI;
- drag-and-drop board и безопасные обратные переходы;
- полноценный редактор, immutable publication versions и publish checklist;
- открытый/контролируемый participant access, server-authoritative attempts и autosave;
- results dashboard, question analytics, attempt details и защищённый CSV;
- открытая регистрация организаторов по email OTP, автоматическое личное пространство и revocable sessions;
- Cloudflare Worker + Static Assets + D1 вместо Firebase;
- Turnstile, rate limiting, tenant authorization, security headers и audit log;
- 67 автоматических тестов и GitHub Actions quality gate;
- атомарные environment-specific Cloudflare deploy-команды и release-скан на secrets/local/legacy artifacts.

## Breaking changes

- Firebase runtime, configuration и зависимости удалены.
- Legacy Firebase данные и аккаунты не мигрируются по решению владельца.
- Legacy URLs/components не являются публичным API и не поддерживаются.
- Organizer authentication больше не использует общий пароль или клиентскую Firebase Auth.
- Published versions immutable; изменение действующего теста создаёт следующую версию.

## Известные release-gates

Код и отдельная production D1 готовы. До production Worker deploy обязательны:

- ручной staging OTP UAT владельца;
- production Turnstile hostnames и secrets;
- подтверждённый Brevo sender, API key и успешный staging OTP UAT;
- реальный Core Web Vitals trace;
- production smoke и подтверждение merge владельцем.

Эти пункты не заменяются mock credentials и не обходятся ослаблением authentication.
