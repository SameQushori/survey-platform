# Vecta — Permission Matrix

Все разрешения проверяются Worker. Скрытие кнопки в React не считается контролем доступа. Платформенной Super Admin-роли нет.

| Capability | Anonymous | Participant token | Organizer member |
|---|---:|---:|---:|
| Просмотреть landing | Allow | Allow | Allow |
| Зарегистрироваться/войти по email OTP | Allow, Turnstile + rate limits | Allow как anonymous flow | Allow |
| Resolve открытый код | Allow, rate limited | Allow, rate limited | Allow |
| Создать Attempt | Allow, Turnstile + rate limit | Deny | Allow как participant flow |
| Читать/сохранять свою active Attempt | Deny | Allow только token-bound attempt | Deny через organizer route |
| Submit своей Attempt | Deny | Allow один раз | Deny через organizer route |
| Читать participant result | Deny | Только собственный и только по publication policy | Через private results API |
| Список тестов организации | Deny | Deny | Allow только active membership |
| Создать/редактировать draft | Deny | Deny | Allow в своей организации |
| Publish/close/archive | Deny | Deny | Allow в своей организации |
| Создать/revoke invitations | Deny | Deny | Allow в своей организации |
| Results/attempt detail/export | Deny | Deny | Allow в своей организации |
| Управлять всеми organizations/memberships | Deny | Deny | Deny |
| Читать audit log | Deny | Deny | Post-MVP/deny |

## Обязательные server-side predicates

- При первом подтверждённом email Worker создаёт пользователя, личную организацию и membership `organizer`; клиент не выбирает роль или organization ID.
- Organizer resource query всегда содержит `organization_id` из подтверждённого membership context.
- `404`, а не `403`, используется для чужого tenant resource, чтобы не подтверждать его существование.
- Attempt token содержит минимальные claims и сверяется с `attempts.token_version`, status и deadline.
- Controlled invitation проверяется по digest, status, expiry и уникальному `attempts.invitation_id`.
- Open best-effort-once использует privacy-preserving participant identity digest; режим явно не считается строгой идентификацией человека.
- Publish, close, archive, registration и invitation revoke пишутся в `audit_log`.
