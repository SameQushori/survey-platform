import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import firebaseAdminAuth from '../../utils/firebaseAdminAuth';
import firebaseSurveyManager from '../../utils/firebaseSurveyManager';
import { truncateParticipantName, truncateSurveyDescription } from '../../utils/textUtils';
import TruncatedText from '../../components/TruncatedText/TruncatedText';
import CreateSurvey from '../../components/CreateSurvey/CreateSurvey';
import SurveyResults from '../../components/SurveyResults/SurveyResults';
import AdminRegistration from '../../components/AdminRegistration/AdminRegistration';
import QRCodeModal from '../../components/QRCodeModal/QRCodeModal';
import './DashboardPage.css';
import { saveAs } from 'file-saver';

const DashboardPage = () => {
  const navigate = useNavigate();
  const [currentAdmin, setCurrentAdmin] = useState(null);
  const [surveys, setSurveys] = useState([]);
  const [organizers, setOrganizers] = useState([]);
  const [showCreateSurvey, setShowCreateSurvey] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [selectedSurvey, setSelectedSurvey] = useState(null);
  const [activeTab, setActiveTab] = useState('surveys');
  const [isLoading, setIsLoading] = useState(true);
  const [isRegistrationOpen, setIsRegistrationOpen] = useState(false);
  const [adminError, setAdminError] = useState('');
  const [visiblePasswords, setVisiblePasswords] = useState({});
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [selectedSurveyForQR, setSelectedSurveyForQR] = useState(null);
  const [deleteConfirmModal, setDeleteConfirmModal] = useState(false);
  const [surveyToDelete, setSurveyToDelete] = useState(null);
  const [surveyStats, setSurveyStats] = useState({});
  const [statsLoading, setStatsLoading] = useState({});
  const [message, setMessage] = useState(null);

  // Автоматическое скрытие сообщений через 5 секунд
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => {
        setMessage(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  // Функция для загрузки данных администратора
  const loadAdminData = async () => {
    const admin = firebaseAdminAuth.getCurrentAdmin();
    if (admin) {
      setCurrentAdmin(admin);
      await loadSurveys(admin.id);
      if (admin.role === 'super_admin') {
        await loadOrganizers();
      }
      setIsLoading(false);
    } else {
      navigate('/');
    }
  };

  // Инициализация при загрузке компонента
  useEffect(() => {
    loadAdminData();
  }, [navigate]);

  // Слушатель изменений в localStorage для обновления состояния
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === 'current_admin' || e.key === null) {
        loadAdminData();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    
    // Также слушаем изменения в текущем окне
    const checkAdminChange = () => {
      const admin = firebaseAdminAuth.getCurrentAdmin();
      if (admin && (!currentAdmin || admin.id !== currentAdmin.id)) {
        loadAdminData();
      }
    };

    // Проверяем каждые 2 секунды
    const interval = setInterval(checkAdminChange, 2000);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, [currentAdmin, navigate]);

  const loadSurveys = async (adminId) => {
    try {
      console.log('Загрузка опросов для администратора:', adminId);
      const adminSurveys = await firebaseSurveyManager.getUserSurveys(adminId);
      console.log('Загружено опросов:', adminSurveys.length, adminSurveys);
      setSurveys(adminSurveys);
    } catch (error) {
      console.error('Ошибка загрузки опросов:', error);
      setSurveys([]);
    }
  };

  const loadOrganizers = async () => {
    try {
      const organizersList = await firebaseAdminAuth.getOrganizersWithPasswords();
      setOrganizers(organizersList);
    } catch (error) {
      setAdminError(error.message);
    }
  };

  const handleSurveyCreated = async (newSurvey) => {
    console.log('Опрос создан:', newSurvey);
    // Принудительно перезагружаем опросы для обновления списка
    if (currentAdmin) {
      console.log('Перезагружаем опросы после создания...');
      await loadSurveys(currentAdmin.id);
    }
    setShowCreateSurvey(false);
    setMessage({ type: 'success', text: 'Опрос успешно создан' });
  };

  const handleSurveyToggle = async (surveyId, isActive) => {
    try {
      console.log('Переключаем статус опроса:', surveyId, isActive);
      await firebaseSurveyManager.updateSurvey(surveyId, { isActive });
      // Принудительно перезагружаем опросы
      if (currentAdmin) {
        await loadSurveys(currentAdmin.id);
      }
    } catch (error) {
      console.error('Ошибка при обновлении опроса:', error);
      alert('Ошибка обновления опроса: ' + error.message);
    }
  };

  const handleShowResults = (survey) => {
    setSelectedSurvey(survey);
    setShowResults(true);
  };

  const handleCloseResults = () => {
    setShowResults(false);
    setSelectedSurvey(null);
  };

  const handleLogout = () => {
    firebaseAdminAuth.logout();
    setCurrentAdmin(null);
    setSurveys([]);
    setOrganizers([]);
    navigate('/');
  };

  const handleGoHome = () => {
    navigate('/');
  };

  const loadSurveyStats = async (surveyId) => {
    if (statsLoading[surveyId]) return; // Уже загружается
    
    setStatsLoading(prev => ({ ...prev, [surveyId]: true }));
    try {
      const stats = await firebaseSurveyManager.getSurveyStats(surveyId);
      setSurveyStats(prev => ({ ...prev, [surveyId]: stats }));
    } catch (error) {
      console.error('Ошибка загрузки статистики для опроса:', surveyId, error);
      setSurveyStats(prev => ({ ...prev, [surveyId]: null }));
    } finally {
      setStatsLoading(prev => ({ ...prev, [surveyId]: false }));
    }
  };

  // Загружаем статистику для всех опросов
  useEffect(() => {
    if (surveys.length > 0) {
      surveys.forEach(survey => {
        loadSurveyStats(survey.id);
      });
    }
  }, [surveys]);

  const getSurveyStats = async (surveyId) => {
    try {
      return await firebaseSurveyManager.getSurveyStats(surveyId);
    } catch (error) {
      console.error('Ошибка получения статистики:', error);
      return null;
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString('ru-RU');
  };

  const handleOpenRegistration = () => {
    setIsRegistrationOpen(true);
  };

  const handleCloseRegistration = () => {
    setIsRegistrationOpen(false);
  };

  const handleRegistrationSuccess = async (newOrganizer) => {
    await loadOrganizers();
    setIsRegistrationOpen(false);
  };

  const handleDeleteOrganizer = async (organizerId) => {
    if (window.confirm('Вы уверены, что хотите удалить этого организатора?')) {
      try {
        await firebaseAdminAuth.deleteAdmin(organizerId);
        await loadOrganizers();
      } catch (error) {
        setAdminError(error.message);
      }
    }
  };

  const togglePasswordVisibility = (organizerId) => {
    setVisiblePasswords(prev => ({
      ...prev,
      [organizerId]: !prev[organizerId]
    }));
  };

  const handleShowQRCode = (survey) => {
    setSelectedSurveyForQR(survey);
    setQrModalOpen(true);
  };

  const handleCloseQRCode = () => {
    setQrModalOpen(false);
    setSelectedSurveyForQR(null);
  };

  const handleDeleteSurveyClick = (survey) => {
    setSurveyToDelete(survey);
    setDeleteConfirmModal(true);
  };

  const handleConfirmDelete = async () => {
    if (surveyToDelete) {
      try {
        console.log('Принудительно удаляем опрос:', surveyToDelete.id);
        
        // Используем принудительное удаление с очисткой кэша
        await firebaseSurveyManager.forceDeleteSurvey(surveyToDelete.id);
        
        console.log('Опрос принудительно удален, обновляем список...');
        
        // Принудительно перезагружаем данные
        if (currentAdmin) {
          await loadSurveys(currentAdmin.id);
        }
        
        setDeleteConfirmModal(false);
        setSurveyToDelete(null);
        setMessage({ type: 'success', text: 'Опрос успешно удален' });
      } catch (error) {
        console.error('Ошибка при удалении опроса:', error);
        setMessage({ type: 'error', text: 'Ошибка удаления опроса: ' + error.message });
      }
    }
  };

  const handleCancelDelete = () => {
    setDeleteConfirmModal(false);
    setSurveyToDelete(null);
  };

  // Принудительное обновление данных
  const refreshData = async () => {
    if (currentAdmin) {
      setIsLoading(true);
      await loadSurveys(currentAdmin.id);
      if (currentAdmin.role === 'super_admin') {
        await loadOrganizers();
      }
      setIsLoading(false);
    }
  };

  // --- Экспорт в CSV для Dashboard ---
  const handleExportCSV = async (survey) => {
    const responses = await firebaseSurveyManager.getSurveyResponses(survey.id);
    if (!responses.length) return;
    const header = ['Имя участника', ...survey.questions.map((q, i) => `${i + 1}. ${q.text}`), 'Баллы', 'Дата'];
    const getOptionText = (questionId, optionId) => {
      const question = survey.questions.find(q => q.id === questionId);
      if (!question || !question.options) return '';
      const option = question.options.find(opt => opt.id === optionId);
      return option ? option.text : '';
    };
    const rows = responses.map(response => {
      const answerCells = survey.questions.map(question => {
        const answer = response.answers[question.id];
        if (question.type === 'single_choice') {
          return getOptionText(question.id, answer);
        } else if (question.type === 'multiple_choice') {
          return Array.isArray(answer) ? answer.map(id => getOptionText(question.id, id)).join(', ') : '';
        } else if (question.type === 'text') {
          return answer || '';
        } else if (question.type === 'rating') {
          return answer ? `${answer} из ${question.maxRating || 5}` : '';
        }
        return '';
      });
      return [
        response.participantName,
        ...answerCells,
        response.score,
        new Date(response.submittedAt).toLocaleString('ru-RU')
      ];
    });
    const csv = [header, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, `survey_results_${survey.id}.csv`);
  };

  if (isLoading) {
    return (
      <div className="dashboard-loading">
        <div className="loading-spinner"></div>
        <p>Загрузка дашборда...</p>
      </div>
    );
  }

  if (!currentAdmin) {
    return (
      <div className="dashboard-loading">
        <div className="loading-spinner"></div>
        <p>Загрузка данных пользователя...</p>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div className="dashboard-title">
          <h1>Панель управления</h1>
          <p>Добро пожаловать, {currentAdmin.name} ({currentAdmin.role})</p>
        </div>
        <div className="dashboard-actions">
          <button className="btn btn-outline" onClick={refreshData}>
            🔄 Обновить
          </button>
          <button className="btn btn-outline" onClick={handleGoHome}>
            Вернуться на главную
          </button>
          <button className="btn btn-outline" onClick={handleLogout}>
            Выйти
          </button>
        </div>
      </div>

      {message && (
        <div className={`message ${message.type}`}>
          <span className="message-text">{message.text}</span>
          <button 
            className="message-close" 
            onClick={() => setMessage(null)}
          >
            ×
          </button>
        </div>
      )}

      <div className="dashboard-tabs">
        <button 
          className={`tab-btn ${activeTab === 'surveys' ? 'active' : ''}`}
          onClick={() => setActiveTab('surveys')}
        >
          📊 Мои опросы ({surveys.length})
        </button>
        {currentAdmin.role === 'super_admin' && (
          <button 
            className={`tab-btn ${activeTab === 'admins' ? 'active' : ''}`}
            onClick={() => setActiveTab('admins')}
          >
            👥 Управление организаторами
          </button>
        )}
      </div>

      {activeTab === 'surveys' && (
        <div className="dashboard-content">
          <div className="surveys-header">
            <h2>Мои опросы</h2>
          </div>
          <div className="surveys-actions">
            <button 
              className="btn btn-primary"
              onClick={() => setShowCreateSurvey(true)}
            >
              + Создать опрос
            </button>
          </div>

          {surveys.length === 0 ? (
            <div className="empty-surveys">
              <div className="empty-icon">📋</div>
              <h3>У вас пока нет опросов</h3>
              <p>Создайте первый опрос, чтобы начать собирать данные</p>
              <button 
                className="btn btn-primary"
                onClick={() => setShowCreateSurvey(true)}
              >
                Создать первый опрос
              </button>
            </div>
          ) : (
            <div className="surveys-grid">
              {surveys.map(survey => {
                const stats = surveyStats[survey.id];
                const isLoadingStats = statsLoading[survey.id];
                
                return (
                  <div key={survey.id} className="survey-card">
                    <div className="survey-header">
                      <div className="survey-title">
                        <h3><TruncatedText text={survey.title} maxLength={40} /></h3>
                        <span className={`status-badge ${survey.isActive ? 'active' : 'inactive'}`}>
                          {survey.isActive ? 'Активен' : 'Неактивен'}
                        </span>
                      </div>
                      <div className="survey-actions">
                        <button 
                          className="action-btn"
                          onClick={() => handleShowQRCode(survey)}
                          title="Показать QR-код"
                        >
                          📱
                        </button>
                        {stats && stats.totalParticipants > 0 && (
                          <button 
                            className="action-btn"
                            onClick={() => handleShowResults(survey)}
                            title="Просмотреть результаты"
                          >
                            📊
                          </button>
                        )}
                        <button 
                          className="action-btn"
                          onClick={() => handleSurveyToggle(survey.id, !survey.isActive)}
                          title={survey.isActive ? 'Деактивировать' : 'Активировать'}
                        >
                          {survey.isActive ? '⏸️' : '▶️'}
                        </button>
                        <button 
                          className="action-btn delete"
                          onClick={() => handleDeleteSurveyClick(survey)}
                          title="Удалить"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>

                    {survey.description && (
                      <p className="survey-description">{truncateSurveyDescription(survey.description)}</p>
                    )}

                    <div className="survey-info">
                      <div className="info-item">
                        <span className="info-label">Код:</span>
                        <span className="info-value code">{survey.code}</span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">Вопросов:</span>
                        <span className="info-value">{survey.questions.length}</span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">Время:</span>
                        <span className="info-value">
                          {survey.timeLimit > 0 
                            ? `${Math.floor(survey.timeLimit / 60)}ч ${survey.timeLimit % 60}мин`
                            : 'Без ограничения'
                          }
                        </span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">Участников:</span>
                        <span className="info-value">
                          {isLoadingStats ? '⏳' : (stats?.totalParticipants || 0)}
                        </span>
                      </div>
                      {stats?.averageScore !== undefined && (
                        <div className="info-item">
                          <span className="info-label">Средний балл:</span>
                          <span className="info-value">{stats.averageScore}</span>
                        </div>
                      )}
                    </div>

                    <div className="survey-meta">
                      <span className="meta-item">
                        Создан: {formatDate(survey.createdAt)}
                      </span>
                    </div>

                    {stats && stats.totalParticipants > 0 && (
                      <div className="survey-stats">
                        <h4>Последние ответы:</h4>
                        <div className="recent-responses">
                          {stats.recentResponses.slice(0, 3).map(response => (
                            <div key={response.id} className="response-item">
                              <span className="participant-name">{truncateParticipantName(response.participantName)}</span>
                              <span className="response-date">
                                {formatDate(response.submittedAt)}
                              </span>
                              {response.score !== null && (
                                <span className="response-score">{response.score} баллов</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'admins' && currentAdmin.role === 'super_admin' && (
        <div className="dashboard-content">
          <div className="admins-header">
            <h2>Управление организаторами</h2>
          </div>
          <div className="admins-actions">
            <button 
              className="btn btn-primary"
              onClick={handleOpenRegistration}
            >
              + Добавить организатора
            </button>
          </div>

          {adminError && (
            <div className="error-message">
              {adminError}
            </div>
          )}

          <div className="admins-list">
            {organizers.length === 0 ? (
              <div className="empty-admins">
                <div className="empty-icon">👥</div>
                <h3>Организаторы не найдены</h3>
                <p>Добавьте первого организатора для начала работы</p>
              </div>
            ) : (
              organizers.map(organizer => (
                <div key={organizer.id} className="admin-card">
                  <div className="admin-info">
                    <div className="admin-main-info">
                      <h3>{organizer.name}</h3>
                      <p className="admin-login">Логин: {organizer.login}</p>
                      <div className="admin-password">
                        <span className="password-label">Пароль: </span>
                        <button 
                          className="password-toggle-btn"
                          onClick={() => togglePasswordVisibility(organizer.id)}
                          type="button"
                        >
                          {visiblePasswords[organizer.id] ? '👁️' : '🙈'}
                        </button>
                        <span className={`password-value ${visiblePasswords[organizer.id] ? 'visible' : 'hidden'}`}>
                          {visiblePasswords[organizer.id] ? organizer.password : '••••••••'}
                        </span>
                      </div>
                    </div>
                    <div className="admin-meta">
                      <span className="admin-status">
                        {organizer.isActive ? 'Активен' : 'Неактивен'}
                      </span>
                      <span className="admin-date">
                        Создан: {formatDate(organizer.createdAt)}
                      </span>
                    </div>
                  </div>
                  <div className="admin-actions">
                    <button
                      className="btn btn-danger"
                      onClick={() => handleDeleteOrganizer(organizer.id)}
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {showCreateSurvey && (
        <CreateSurvey
          isOpen={showCreateSurvey}
          onClose={() => setShowCreateSurvey(false)}
          onSurveyCreated={handleSurveyCreated}
        />
      )}

      {showResults && selectedSurvey && (
        <SurveyResults
          survey={selectedSurvey}
          onClose={handleCloseResults}
          onExportCSV={handleExportCSV}
        />
      )}

      {isRegistrationOpen && (
        <AdminRegistration
          isOpen={isRegistrationOpen}
          onClose={handleCloseRegistration}
          onSuccess={handleRegistrationSuccess}
        />
      )}

      {qrModalOpen && selectedSurveyForQR && (
        <QRCodeModal
          isOpen={qrModalOpen}
          onClose={handleCloseQRCode}
          surveyCode={selectedSurveyForQR.code}
          surveyTitle={selectedSurveyForQR.title}
        />
      )}

      {deleteConfirmModal && surveyToDelete && (
        <div className="delete-confirm-modal">
          <div className="confirm-message">
            <div className="confirm-text">
              Вы уверены, что хотите удалить опрос "<TruncatedText text={surveyToDelete.title} maxLength={40} />"?
            </div>
            <div className="confirm-actions">
              <button className="btn btn-danger" onClick={handleConfirmDelete}>
                Удалить
              </button>
              <button className="btn btn-secondary" onClick={handleCancelDelete}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardPage; 