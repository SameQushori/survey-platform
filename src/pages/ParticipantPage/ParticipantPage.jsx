import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import firebaseSurveyManager from '../../utils/firebaseSurveyManager';
import { truncateSurveyDescription } from '../../utils/textUtils';
import TruncatedText from '../../components/TruncatedText/TruncatedText';
import SurveyForm from '../../components/SurveyForm/SurveyForm';
import './ParticipantPage.css';

const ParticipantPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [participantName, setParticipantName] = useState('');
  const [currentSurvey, setCurrentSurvey] = useState(null);
  const [showSurveyForm, setShowSurveyForm] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [surveyResponse, setSurveyResponse] = useState(null);
  const [errors, setErrors] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // Получаем код из URL параметров
  const surveyCode = searchParams.get('code');

  useEffect(() => {
    // Если есть код в URL, загружаем опрос
    if (surveyCode) {
      loadSurvey();
    }
  }, [surveyCode]);

  const loadSurvey = async () => {
    try {
      const survey = await firebaseSurveyManager.getSurveyByCode(surveyCode.toUpperCase());
      if (survey && survey.isActive) {
        setCurrentSurvey(survey);
      }
    } catch (error) {
      console.error('Error loading survey:', error);
    }
  };

  const handleNameSubmit = async (e) => {
    e.preventDefault();
    
    if (!participantName.trim()) {
      setErrors(['Введите ваше имя']);
      return;
    }

    if (participantName.trim().length < 2) {
      setErrors(['Имя должно содержать минимум 2 символа']);
      return;
    }

    setIsLoading(true);
    setErrors([]);

    try {
      // Проверяем еще раз, что опрос существует и активен
      const survey = await firebaseSurveyManager.getSurveyByCode(surveyCode.toUpperCase());
      
      if (!survey) {
        setErrors(['Опрос с таким кодом не найден']);
        return;
      }

      if (!survey.isActive) {
        setErrors(['Этот опрос неактивен']);
        return;
      }

      setCurrentSurvey(survey);
      setShowSurveyForm(true);
    } catch (error) {
      setErrors([error.message]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSurveySubmit = (response) => {
    setSurveyResponse(response);
    setShowSurveyForm(false);
    setShowResults(true);
  };

  const handleCloseSurvey = () => {
    setShowSurveyForm(false);
    setCurrentSurvey(null);
  };

  const handleCloseResults = () => {
    setShowResults(false);
    setSurveyResponse(null);
    setCurrentSurvey(null);
    setParticipantName('');
  };

  const handleStartOver = () => {
    setShowResults(false);
    setSurveyResponse(null);
    setCurrentSurvey(null);
    setParticipantName('');
    setErrors([]);
  };

  const handleGoHome = () => {
    navigate('/');
  };

  if (showSurveyForm && currentSurvey) {
    return (
      <SurveyForm
        survey={currentSurvey}
        participantName={participantName}
        onSubmit={handleSurveySubmit}
        onClose={handleCloseSurvey}
      />
    );
  }

  if (showResults && surveyResponse) {
    return (
      <div className="participant-results-overlay">
        <div className="participant-results-modal">
          <button className="results-close" onClick={handleCloseResults}>
            ×
          </button>
          
          <div className="results-content">
            <div className="results-header">
              <h2>Опрос завершен!</h2>
              <p>Спасибо за участие в опросе "<TruncatedText text={currentSurvey.title} maxLength={50} />"</p>
            </div>

            <div className="results-info">
              <div className="result-item">
                <span className="result-label">Участник:</span>
                <span className="result-value">{participantName}</span>
              </div>
              
              <div className="result-item">
                <span className="result-label">Дата завершения:</span>
                <span className="result-value">
                  {new Date(surveyResponse.submittedAt).toLocaleString('ru-RU')}
                </span>
              </div>

              {surveyResponse.score !== null && (
                <div className="result-item">
                  <span className="result-label">Ваш результат:</span>
                  <span className="result-value score">
                    {surveyResponse.score} баллов
                  </span>
                </div>
              )}
            </div>

            <div className="results-actions">
              <button 
                className="btn btn-outline"
                onClick={handleGoHome}
              >
                Вернуться на главную
              </button>
              <button 
                className="btn btn-primary"
                onClick={handleStartOver}
              >
                Пройти другой опрос
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="participant-page">
      <div className="participant-container">
        <div className="participant-header">
          <button className="btn btn-outline back-button" onClick={handleGoHome}>
            Вернуться на главную
          </button>
          <div className="participant-header-top">
            <h1>Участие в опросе</h1>
          </div>
          <p>Введите ваше имя для начала участия в опросе</p>
          {currentSurvey && (
            <div className="survey-info-display">
              <h3><TruncatedText text={currentSurvey.title} maxLength={50} /></h3>
              {truncateSurveyDescription(currentSurvey.description) && <p>{truncateSurveyDescription(currentSurvey.description)}</p>}
              <div className="survey-details">
                <span>Код: {surveyCode}</span>
                <span>Вопросов: {currentSurvey.questions.length}</span>
                {currentSurvey.timeLimit > 0 && (
                  <span>Время: {currentSurvey.timeLimit} мин</span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="participant-form-container">
          <form className="participant-form" onSubmit={handleNameSubmit}>
            {errors.length > 0 && (
              <div className="error-messages">
                {errors.map((error, index) => (
                  <div key={index} className="error-message">{error}</div>
                ))}
              </div>
            )}

            <div className="form-group">
              <label htmlFor="participantName">Ваше имя *</label>
              <input
                type="text"
                id="participantName"
                value={participantName}
                onChange={(e) => setParticipantName(e.target.value)}
                placeholder="Введите ваше имя"
                className="form-input"
                maxLength="50"
                autoFocus
              />
              <small className="form-hint">
                Имя будет отображаться в результатах опроса (максимум 50 символов)
              </small>
            </div>

            <button 
              type="submit" 
              className="btn btn-primary submit-btn"
              disabled={isLoading}
            >
              {isLoading ? 'Загрузка...' : 'Начать опрос'}
            </button>
          </form>
        </div>

        <div className="participant-info-section">
          <div className="info-card">
            <div className="info-icon">📋</div>
            <h3>Как участвовать</h3>
            <p>Введите ваше имя и нажмите "Начать опрос" для участия</p>
          </div>

          <div className="info-card">
            <div className="info-icon">✅</div>
            <h3>Результаты</h3>
            <p>После завершения вы увидите результаты и сможете пройти другие опросы</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ParticipantPage; 