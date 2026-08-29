import React, { useState } from 'react';
import { truncateSurveyDescription } from '../../utils/textUtils';
import TruncatedText from '../TruncatedText/TruncatedText';
import './Dashboard.css';

const Dashboard = ({ surveys, onDeleteSurvey, onEditSurvey, onCreateSurvey, onShowQRCode, onShowResults, onExportCSV }) => {
  const [editingSurvey, setEditingSurvey] = useState(null);
  const [editData, setEditData] = useState({});

  const handleEdit = (survey) => {
    setEditingSurvey(survey);
    setEditData({
      title: survey.title,
      description: survey.description,
      questions: [...survey.questions]
    });
  };

  const handleSaveEdit = () => {
    onEditSurvey(editingSurvey.id, editData);
    setEditingSurvey(null);
    setEditData({});
  };

  const handleCancelEdit = () => {
    setEditingSurvey(null);
    setEditData({});
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('ru-RU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Личный кабинет организатора</h1>
        <button className="btn btn-primary" onClick={onCreateSurvey}>
          + Создать новый опрос
        </button>
      </div>

      <div className="dashboard-stats">
        <div className="stat-card">
          <div className="stat-number">{surveys.length}</div>
          <div className="stat-label">Всего опросов</div>
        </div>
        <div className="stat-card">
          <div className="stat-number">
            {surveys.reduce((total, survey) => total + (survey.participants || 0), 0)}
          </div>
          <div className="stat-label">Участников</div>
        </div>
        <div className="stat-card">
          <div className="stat-number">
            {surveys.filter(survey => survey.isActive).length}
          </div>
          <div className="stat-label">Активных опросов</div>
        </div>
      </div>

      <div className="surveys-section">
        <h2>Мои опросы</h2>
        {surveys.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📊</div>
            <h3>У вас пока нет опросов</h3>
            <p>Создайте свой первый опрос, чтобы начать собирать данные</p>
            <button className="btn btn-primary" onClick={onCreateSurvey}>
              Создать опрос
            </button>
          </div>
        ) : (
          <div className="surveys-grid">
            {surveys.map((survey) => (
              <div key={survey.id} className="survey-card">
                {editingSurvey?.id === survey.id ? (
                  <div className="edit-form">
                    <input
                      type="text"
                      value={editData.title}
                      onChange={(e) => setEditData({...editData, title: e.target.value})}
                      className="edit-title"
                    />
                    <textarea
                      value={editData.description}
                      onChange={(e) => setEditData({...editData, description: e.target.value})}
                      className="edit-description"
                      rows="2"
                    />
                    <div className="edit-actions">
                      <button className="btn btn-primary" onClick={handleSaveEdit}>
                        Сохранить
                      </button>
                      <button className="btn btn-outline" onClick={handleCancelEdit}>
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="survey-header">
                      <h3><TruncatedText text={survey.title} maxLength={40} /></h3>
                      <div className="survey-status">
                        {survey.isActive ? (
                          <span className="status active">Активен</span>
                        ) : (
                          <span className="status inactive">Неактивен</span>
                        )}
                      </div>
                    </div>
                    
                    <p className="survey-description">{truncateSurveyDescription(survey.description)}</p>
                    
                    <div className="survey-info">
                      <div className="info-item">
                        <span className="label">Создан:</span>
                        <span className="value">{formatDate(survey.createdAt)}</span>
                      </div>
                      <div className="info-item">
                        <span className="label">Участников:</span>
                        <span className="value">{survey.participants || 0}</span>
                      </div>
                      <div className="info-item">
                        <span className="label">Вопросов:</span>
                        <span className="value">{survey.questions.length}</span>
                      </div>
                    </div>

                    <div className="survey-actions">
                      <button 
                        className="btn btn-outline" 
                        onClick={() => onExportCSV(survey)}
                      >
                        🗎 Экспорт в CSV
                      </button>
                      <button 
                        className="btn btn-outline" 
                        onClick={() => onShowResults(survey)}
                      >
                        📊 Результаты
                      </button>
                      <button 
                        className="btn btn-outline" 
                        onClick={() => handleEdit(survey)}
                      >
                        ✏️ Редактировать
                      </button>
                      <button 
                        className="btn btn-outline danger" 
                        onClick={() => onDeleteSurvey(survey.id)}
                      >
                        🗑️ Удалить
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard; 