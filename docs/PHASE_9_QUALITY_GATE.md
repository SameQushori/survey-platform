# Phase 9 — Hardening and Quality Gate

Дата закрытия: 2026-09-01
Результат: passed. Ручная пауза между Phase 9 и Phase 10 отменена прямой командой владельца; автоматические проверки сохранены.

## Security

- Organizer identity fail-closed вне `local`/`session` mode; native session replacement проверен отдельным Phase 11 gate.
- Turnstile CSP разрешает только `https://challenges.cloudflare.com` для script/frame.
- Siteverify ограничивает размер token, строго проверяет action/hostname и повторяет transient failure ровно один раз с тем же idempotency key.
- Реальный rate limiter покрыт abuse-test: 20 запросов разрешены, 21-й получает 429.
- `npm audit --audit-level=high` и `npm audit --omit=dev --audit-level=moderate`: 0 vulnerabilities.
- В active Worker/UI отсутствуют логи с PII, ответами и токенами; build не содержит `.env*` или `.dev.vars*`.

## Accessibility и responsive

- Диалоги и help drawer получили focus trap, Escape, scroll lock, focus restoration, accessible name и `aria-modal`.
- Results tabs используют tablist/tab/tabpanel, `aria-selected`, Home/End и стрелки.
- Attempts list переведён на semantic table; график — на доступный native SVG.
- Цвета текста, status и control border доведены до WCAG 2.2 AA; focus indicator стал непрозрачным и контрастным.
- Browser QA: desktop и 390×844, keyboard navigation, modal/drawer focus, внутренний horizontal scroll таблицы, console errors/warnings = 0.

## Производительность

- Recharts удалён; график реализован без chart runtime.
- Preview заменён с PNG 483 235 bytes на WebP 28 496 bytes.
- Manrope ограничен явными Cyrillic/Latin WOFF2 subsets и четырьмя используемыми weights.
- CSS: 77.04 kB / gzip 14.26 kB вместо 101.63 kB / gzip 29.02 kB.
- Удалён Recharts chunk 359.16 kB / gzip 105.51 kB.

## Автоматический gate

- `npm run typecheck` — passed.
- `npm run lint` — passed, включая `@typescript-eslint/no-floating-promises`.
- `npm test` — 29 passed.
- `npm run test:worker` — 26 passed.
- `npm run build` — passed.
- Chrome DevTools performance trace локально недоступен; Core Web Vitals перенесены в обязательный staging UAT Phase 11.
