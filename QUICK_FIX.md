# 🔧 Быстрое решение проблемы Firebase

## Проблема
```
Missing or insufficient permissions
```

## Решение (5 минут)

### 1. Откройте Firebase Console
https://console.firebase.google.com/project/oprosnik-app

### 2. Перейдите в Firestore Database
- В левом меню выберите **Firestore Database**
- Если база не создана, нажмите **Create database** → **Start in test mode**

### 3. Настройте правила безопасности
- Перейдите на вкладку **Rules**
- Замените все на:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

### 4. Нажмите **Publish**

### 5. Перезапустите приложение
```bash
npm run dev
```

## Проверка
- Откройте консоль браузера (F12)
- Должно появиться: `🎉 Firebase подключен успешно!`
- Попробуйте войти: admin / admin123

## Если не помогло
См. подробную инструкцию в `FIREBASE_SETUP.md` 