import React, { useState } from 'react';
import { runFullSurveyTest, testFirebaseConnection, checkAllCollections } from '../../utils/firebaseTest';
import firebaseSurveyManager from '../../utils/firebaseSurveyManager';
import './TestPage.css';

const TestPage = () => {
  const [testResults, setTestResults] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState(null);
  const [collectionsInfo, setCollectionsInfo] = useState(null);

  const runConnectionTest = async () => {
    setIsLoading(true);
    try {
      const result = await testFirebaseConnection();
      setConnectionStatus(result);
    } catch (error) {
      setConnectionStatus({ success: false, error: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  const runCollectionsTest = async () => {
    setIsLoading(true);
    try {
      const result = await checkAllCollections();
      setCollectionsInfo(result);
    } catch (error) {
      setCollectionsInfo({ success: false, error: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  const runFullTest = async () => {
    setIsLoading(true);
    try {
      const result = await runFullSurveyTest();
      setTestResults(result);
    } catch (error) {
      setTestResults({ success: false, error: error.message });
    } finally {
      setIsLoading(false);
    }
  };

  const checkFirebaseStatus = () => {
    const status = firebaseSurveyManager.firebaseAvailable ? '✅ Доступен' : '❌ Недоступен';
    return status;
  };

  return (
    <div className="test-page">
      <div className="test-container">
        <h1>🧪 Тестирование Firebase</h1>
        
        <div className="status-section">
          <h2>Статус Firebase</h2>
          <p>Статус: {checkFirebaseStatus()}</p>
        </div>

        <div className="test-buttons">
          <button 
            onClick={runConnectionTest} 
            disabled={isLoading}
            className="test-btn"
          >
            🔗 Тест подключения
          </button>

          <button 
            onClick={runCollectionsTest} 
            disabled={isLoading}
            className="test-btn"
          >
            📊 Проверить коллекции
          </button>

          <button 
            onClick={runFullTest} 
            disabled={isLoading}
            className="test-btn primary"
          >
            🧪 Полный тест системы
          </button>
        </div>

        {isLoading && (
          <div className="loading">
            <div className="spinner"></div>
            <p>Выполняется тест...</p>
          </div>
        )}

        {connectionStatus && (
          <div className={`test-result ${connectionStatus.success ? 'success' : 'error'}`}>
            <h3>Результат теста подключения:</h3>
            {connectionStatus.success ? (
              <div>
                <p>✅ Подключение успешно!</p>
                <p>📊 Найдено опросов: {connectionStatus.surveysCount}</p>
              </div>
            ) : (
              <div>
                <p>❌ Ошибка подключения: {connectionStatus.error}</p>
                {connectionStatus.error.includes('permissions') && (
                  <div className="error-help">
                    <p>🔧 Решение: Настройте правила безопасности в Firebase Console</p>
                    <p>📖 См. файл FIREBASE_SETUP.md для инструкций</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {collectionsInfo && (
          <div className={`test-result ${collectionsInfo.success ? 'success' : 'error'}`}>
            <h3>Информация о коллекциях:</h3>
            {collectionsInfo.success ? (
              <div className="collections-info">
                <p>📋 surveys: {collectionsInfo.collections.surveys} документов</p>
                <p>📝 responses: {collectionsInfo.collections.responses} документов</p>
                <p>👥 admins: {collectionsInfo.collections.admins} документов</p>
              </div>
            ) : (
              <p>❌ Ошибка: {collectionsInfo.error}</p>
            )}
          </div>
        )}

        {testResults && (
          <div className={`test-result ${testResults.success ? 'success' : 'error'}`}>
            <h3>Результат полного теста:</h3>
            {testResults.success ? (
              <div className="full-test-results">
                <p>🎉 Все тесты пройдены успешно!</p>
                <div className="test-details">
                  <h4>Созданный опрос:</h4>
                  <p>📝 Название: {testResults.survey.title}</p>
                  <p>🔢 Код: {testResults.survey.code}</p>
                  <p>👤 Создатель: {testResults.survey.createdBy}</p>
                  
                  <h4>Отправленный ответ:</h4>
                  <p>👤 Участник: {testResults.response.participantName}</p>
                  <p>📅 Дата: {new Date(testResults.response.submittedAt).toLocaleString()}</p>
                  
                  <h4>Статистика:</h4>
                  <p>👥 Участников: {testResults.stats.totalParticipants}</p>
                  <p>📊 Средний балл: {testResults.stats.averageScore}</p>
                </div>
              </div>
            ) : (
              <div>
                <p>❌ Ошибка в тесте: {testResults.error}</p>
                <div className="error-help">
                  <p>🔧 Возможные решения:</p>
                  <ul>
                    <li>Проверьте подключение к интернету</li>
                    <li>Убедитесь, что Firebase настроен правильно</li>
                    <li>Проверьте правила безопасности в Firebase Console</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="help-section">
          <h3>💡 Справка</h3>
          <p>Эта страница помогает проверить работу Firebase и системы опросов.</p>
          <p>Если тесты не проходят, проверьте:</p>
          <ul>
            <li>Подключение к интернету</li>
            <li>Настройки Firebase в файле <code>src/firebase.js</code></li>
            <li>Правила безопасности в Firebase Console</li>
            <li>Файл <code>FIREBASE_SETUP.md</code> для инструкций</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default TestPage; 