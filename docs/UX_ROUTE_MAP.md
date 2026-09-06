# Vecta — UX Route Map

Статус: Phase 3, зафиксированная логика до визуального дизайна
Дата: 2026-08-29

## Принципы маршрутизации

- MVP работает на русском языке.
- Organizer самостоятельно регистрируется по email One-time Code; memberships определяет Worker по D1, платформенной Super Admin-роли нет.
- Participant не создаёт постоянный аккаунт.
- Контролируемая ссылка передаёт одноразовый токен во fragment (`#token=...`), чтобы секрет не попадал в обычные server/access logs. Клиент немедленно обменивает его на attempt session и очищает fragment.
- Опубликованная версия теста неизменяема; открытая попытка всегда привязана к конкретной версии.
- Любой прямой переход на недоступный шаг восстанавливается серверным состоянием попытки или переводит на безопасный error state.

## Публичный контур

| Route | Экран | Основная задача | Ключевые состояния |
|---|---|---|---|
| `/` | Onboarding и вход Vecta | Понять продукт и сразу выбрать Organizer managed auth либо ввести participant code | default, code validating, invalid/expired/closed code, auth unavailable |
| `/login` | Модальный вход поверх onboarding | Пройти managed auth после выбора Organizer на главной; закрытие возвращает на `/` | redirecting, invalid/expired, no access |
| `/access-denied` | Модальное сообщение поверх onboarding | Объяснить недоступность workspace, позволить закрыть окно или повторить вход | default |
| `/join` | Вход участника | Ввести общий код и отображаемое имя | default, validating, invalid, expired, closed, rate-limited, network error |
| `/join#token=…` | Обмен приглашения | Активировать контролируемую одноразовую ссылку | exchanging, invalid, used, expired, closed, network error |
| `/attempt/:attemptId/instructions` | Инструкция | Увидеть правила и осознанно начать | ready, starting, already started, closed before start |
| `/attempt/:attemptId/questions/:position` | Вопрос | Ответить и сохранить прогресс | loading, saved, saving, validation, recoverable network error |
| `/attempt/:attemptId/review` | Проверка ответов | Найти пропуски и подтвердить отправку | complete, unanswered items, submitting, submit conflict |
| `/attempt/:attemptId/complete` | Завершение | Получить подтверждение; при разрешении — балл | confirmation only, score visible, submit processing, recovery error |
| `*` | 404 | Вернуться в безопасную точку | default |

## Контур Organizer

| Route | Экран | Основная задача | Ключевые состояния |
|---|---|---|---|
| `/app` | Обзор | Быстро увидеть активные тесты и создать новый | populated, empty, loading, error |
| `/app/assessments` | Все тесты | Найти и отфильтровать draft/published/closed/archived | populated, empty, filtered empty, loading, error |
| `/app/assessments/new` | Новый draft | Задать название и базовые параметры | pristine, validation, saving, save error |
| `/app/assessments/:assessmentId/edit` | Редактор draft | Создать вопросы, варианты, баллы и настройки | empty draft, editing, autosaving, saved, conflict, error |
| `/app/assessments/:assessmentId/preview` | Preview | Проверить опыт участника без создания результата | desktop/mobile preview, invalid draft |
| `/app/assessments/:assessmentId/publish` | Публикация | Проверить checklist и создать immutable version | ready, blocking errors, publishing, published, error |
| `/app/publications/:publicationId/distribute` | Распространение | Получить ссылку, код, QR или controlled invitations | open mode, controlled mode, generating, error |
| `/app/publications/:publicationId/results` | Обзор результатов | Понять участие и общую результативность | live, closed, no attempts, loading, error |
| `/app/publications/:publicationId/results/questions` | Анализ вопросов | Найти сложные и неоднозначные вопросы | populated, insufficient data, loading, error |
| `/app/publications/:publicationId/attempts` | Попытки | Найти конкретного участника и статус | populated, empty, filtered empty, loading, error |
| `/app/publications/:publicationId/attempts/:attemptId` | Детали попытки | Проверить ответы и начисление баллов | complete, in progress, invalidated, loading, error |

## Навигационные правила

- После регистрации или входа Organizer всегда попадает в `/app`; legacy `/admin/*` безопасно перенаправляется туда же.
- В Organizer-контуре постоянная навигация содержит только: «Обзор», «Тесты», «Результаты». Настройки аккаунта находятся в меню профиля, без отдельного MVP-раздела.
- Редактор использует локальную навигацию: «Содержание», «Настройки», «Preview», затем явное действие «Опубликовать».
- Participant-контур не показывает глобальную навигацию и не предлагает уйти со страницы во время попытки.
- На mobile таблицы превращаются в списки строк, вторичные действия уходят в контекстное меню, но информационная иерархия не меняется.
- Клик по профилю открывает anchored menu без смены route. Минимальный состав: данные аккаунта и «Выйти»; «Профиль» и «Сменить организацию» остаются provisional до отдельного MVP-решения.
- «Помощь и поддержка» открывается как глобальный right drawer без отдельного route: поиск по коротким инструкциям, популярные вопросы и один канал обращения. Конкретный support channel выбирается до реализации.
