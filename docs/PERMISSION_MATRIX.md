# Vecta — Permission Matrix

Все разрешения проверяются Worker. Скрытие кнопки в React не считается контролем доступа.

| Capability | Anonymous | Participant token | Organizer member | Super Admin |
|---|---:|---:|---:|---:|
| Просмотреть landing | Allow | Allow | Allow | Allow |
| Resolve открытый код | Allow, rate limited | Allow, rate limited | Allow | Allow |
| Создать Attempt | Allow, Turnstile + rate limit | Deny | Allow как participant flow | Allow как participant flow |
| Читать/сохранять свою active Attempt | Deny | Allow только token-bound attempt | Deny через organizer route | Deny через organizer route |
| Submit своей Attempt | Deny | Allow один раз | Deny через organizer route | Deny через organizer route |
| Читать participant result | Deny | Только собственный и только по publication policy | Через private results API | Через membership, не глобально |
| Список тестов организации | Deny | Deny | Allow только active membership | Allow только через явный membership или admin endpoint |
| Создать/редактировать draft | Deny | Deny | Allow в своей организации | Deny без membership |
| Publish/close/archive | Deny | Deny | Allow в своей организации | Deny без membership |
| Создать/revoke invitations | Deny | Deny | Allow в своей организации | Deny без membership |
| Results/attempt detail/export | Deny | Deny | Allow в своей организации | Deny без membership |
| Управлять organizations/memberships | Deny | Deny | Deny | Allow |
| Читать audit log | Deny | Deny | Post-MVP/deny | Allow для administrative scope |

## Обязательные server-side predicates

- Organizer resource query всегда содержит `organization_id` из подтверждённого membership context.
- `404`, а не `403`, используется для чужого tenant resource, чтобы не подтверждать его существование.
- Super Admin не получает неограниченный доступ к ответам только благодаря platform role.
- Attempt token содержит минимальные claims и сверяется с `attempts.token_version`, status и deadline.
- Controlled invitation проверяется по digest, status, expiry и уникальному `attempts.invitation_id`.
- Open best-effort-once использует privacy-preserving participant identity digest; режим явно не считается строгой идентификацией человека.
- Publish, close, archive, membership changes и invitation revoke пишутся в `audit_log`.
