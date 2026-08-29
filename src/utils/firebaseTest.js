import { db } from '../firebase';
import { collection, addDoc, getDocs } from 'firebase/firestore';
import firebaseSurveyManager from './firebaseSurveyManager';

// Тест подключения к Firebase
export const testFirebaseConnection = async () => {
  try {
    console.log('🔍 Тестирование подключения к Firebase...');
    
    // Пробуем получить документы из коллекции surveys
    const surveysCol = collection(db, 'surveys');
    const snapshot = await getDocs(surveysCol);
    console.log('✅ Подключение к Firebase успешно!');
    console.log(`📊 Найдено опросов: ${snapshot.size}`);
    
    return { success: true, surveysCount: snapshot.size };
  } catch (error) {
    console.error('❌ Ошибка подключения к Firebase:', error.message);
    
    if (error.message.includes('Missing or insufficient permissions')) {
      console.error('🔧 Решение: Настройте правила безопасности в Firebase Console');
      console.error('📖 Инструкция: См. файл FIREBASE_SETUP.md');
    }
    
    return { success: false, error: error.message };
  }
};

// Создание тестового опроса
export const createTestSurvey = async () => {
  try {
    const testSurveyData = {
      title: 'Тестовый опрос',
      description: 'Это тестовый опрос для проверки работы Firebase',
      timeLimit: 0,
      isPublic: false,
      questions: [
        {
          id: 'q1',
          text: 'Какой ваш любимый цвет?',
          type: 'single_choice',
          required: true,
          hasCorrectAnswer: false,
          correctAnswer: null,
          points: 1,
          options: [
            { id: 'opt1', text: 'Красный' },
            { id: 'opt2', text: 'Синий' },
            { id: 'opt3', text: 'Зеленый' }
          ]
        }
      ]
    };

    const result = await firebaseSurveyManager.createSurvey(testSurveyData, 'test-admin');
    console.log('✅ Тестовый опрос создан:', result.survey);
    return { success: true, survey: result.survey };
  } catch (error) {
    console.error('❌ Ошибка создания тестового опроса:', error.message);
    return { success: false, error: error.message };
  }
};

// Тест получения опросов пользователя
export const testGetUserSurveys = async (userId) => {
  try {
    const surveys = await firebaseSurveyManager.getUserSurveys(userId);
    console.log(`✅ Получено опросов для пользователя ${userId}:`, surveys.length);
    return { success: true, surveys: surveys };
  } catch (error) {
    console.error('❌ Ошибка получения опросов пользователя:', error.message);
    return { success: false, error: error.message };
  }
};

// Тест отправки ответа
export const testSubmitResponse = async (surveyId) => {
  try {
    const testResponse = {
      q1: 'opt1' // Ответ на первый вопрос
    };

    const result = await firebaseSurveyManager.submitResponse(
      surveyId, 
      'Тестовый участник', 
      testResponse
    );
    console.log('✅ Тестовый ответ отправлен:', result.response);
    return { success: true, response: result.response };
  } catch (error) {
    console.error('❌ Ошибка отправки ответа:', error.message);
    return { success: false, error: error.message };
  }
};

// Проверка всех коллекций
export const checkAllCollections = async () => {
  try {
    const collections = ['surveys', 'responses', 'admins'];
    const results = {};

    for (const collectionName of collections) {
      const col = collection(db, collectionName);
      const snapshot = await getDocs(col);
      results[collectionName] = snapshot.size;
    }

    console.log('📊 Статистика коллекций:', results);
    return { success: true, collections: results };
  } catch (error) {
    console.error('❌ Ошибка проверки коллекций:', error.message);
    return { success: false, error: error.message };
  }
};

// Полный тест системы опросов
export const runFullSurveyTest = async () => {
  console.log('🧪 Запуск полного теста системы опросов...');
  
  try {
    // 1. Тест подключения
    const connectionTest = await testFirebaseConnection();
    if (!connectionTest.success) {
      console.log('❌ Тест подключения провален');
      return connectionTest;
    }

    // 2. Создание тестового опроса
    const createTest = await createTestSurvey();
    if (!createTest.success) {
      console.log('❌ Создание тестового опроса провалено');
      return createTest;
    }

    // 3. Получение опросов пользователя
    const getUserSurveysTest = await testGetUserSurveys('test-admin');
    if (!getUserSurveysTest.success) {
      console.log('❌ Получение опросов пользователя провалено');
      return getUserSurveysTest;
    }

    // 4. Отправка тестового ответа
    const submitResponseTest = await testSubmitResponse(createTest.survey.id);
    if (!submitResponseTest.success) {
      console.log('❌ Отправка ответа провалена');
      return submitResponseTest;
    }

    // 5. Проверка статистики
    const stats = await firebaseSurveyManager.getSurveyStats(createTest.survey.id);
    console.log('📊 Статистика тестового опроса:', stats);

    console.log('🎉 Все тесты пройдены успешно!');
    return { 
      success: true, 
      survey: createTest.survey,
      response: submitResponseTest.response,
      stats: stats
    };

  } catch (error) {
    console.error('❌ Ошибка в полном тесте:', error.message);
    return { success: false, error: error.message };
  }
};

// Проверка статуса Firebase
export const getFirebaseStatus = () => {
  return {
    projectId: 'oprosnik-app',
    status: 'configured',
    message: 'Firebase настроен. Проверьте правила безопасности в консоли.'
  };
}; 