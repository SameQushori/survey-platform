import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import firebaseSurveyManager from '../../utils/firebaseSurveyManager';
import { truncateParticipantName } from '../../utils/textUtils';
import TruncatedText from '../TruncatedText/TruncatedText';
import './SurveyForm.css';

const SurveyForm = ({ survey, participantName, onSubmit, onClose }) => {
  const navigate = useNavigate();
  const [answers, setAnswers] = useState({});
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState([]);
  const [timeLeft, setTimeLeft] = useState(survey.timeLimit > 0 ? survey.timeLimit * 60 : 0); // Время в секундах
  const [isTimeUp, setIsTimeUp] = useState(false);
  const [startedAt, setStartedAt] = useState(new Date().toISOString()); // Время начала прохождения

  useEffect(() => {
    // Инициализируем ответы для всех вопросов
    const initialAnswers = {};
    survey.questions.forEach(question => {
      if (question.type === 'multiple_choice') {
        initialAnswers[question.id] = [];
      } else {
        initialAnswers[question.id] = '';
      }
    });
    setAnswers(initialAnswers);
  }, [survey]);

  // Таймер для ограничения времени
  useEffect(() => {
    if (survey.timeLimit === 0) return; // Без ограничения времени
    if (timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          setIsTimeUp(true);
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft, survey.timeLimit]);

  // Автоматическая отправка при истечении времени
  useEffect(() => {
    if (isTimeUp) {
      handleSubmit(true); // true = автоотправка
    }
  }, [isTimeUp]);

  const formatTime = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const handleAnswerChange = (questionId, value) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: value
    }));
    
    // Очищаем ошибки при изменении ответа
    if (errors.length > 0) {
      setErrors([]);
    }
  };

  const handleMultipleChoiceChange = (questionId, optionId, checked) => {
    setAnswers(prev => {
      const currentAnswers = Array.isArray(prev[questionId]) ? prev[questionId] : [];
      const newAnswers = checked
        ? [...currentAnswers, optionId]
        : currentAnswers.filter(id => id !== optionId);
      
      return {
        ...prev,
        [questionId]: newAnswers
      };
    });
    
    if (errors.length > 0) {
      setErrors([]);
    }
  };

  const validateCurrentQuestion = () => {
    const question = survey.questions[currentQuestion];
    // Убираем проверку required, так как все вопросы теперь обязательны, но можно пропустить
    return true;
  };

  const nextQuestion = () => {
    // Убираем валидацию, позволяем пропускать вопросы
    if (currentQuestion < survey.questions.length - 1) {
      setCurrentQuestion(prev => prev + 1);
      setErrors([]);
    }
  };

  const prevQuestion = () => {
    if (currentQuestion > 0) {
      setCurrentQuestion(prev => prev - 1);
      setErrors([]);
    }
  };

  const goToQuestion = (questionIndex) => {
    if (questionIndex >= 0 && questionIndex < survey.questions.length) {
      setCurrentQuestion(questionIndex);
      setErrors([]);
    }
  };

  const handleSubmit = async (auto = false) => {
    if (!auto && !validateCurrentQuestion()) {
      return;
    }

    setIsSubmitting(true);
    setErrors([]);
    try {
      const result = await firebaseSurveyManager.submitResponse(survey.id, participantName, answers, startedAt);
      if (onSubmit) {
        onSubmit(result.response);
      }
    } catch (error) {
      setErrors([error.message]);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoHome = () => {
    navigate('/');
  };

  const renderQuestion = (question, index) => {
    const isCurrentQuestion = index === currentQuestion;
    const answer = answers[question.id] || '';

    if (!isCurrentQuestion) return null;

    return (
      <div key={question.id} className="question-container">
        <div className="question-header">
          <div className="question-number">
            <span className="question-number-text">Вопрос {index + 1}</span>
            <span className="question-total">из {survey.questions.length}</span>
          </div>
        </div>

        <div className="question-content">
          <h3 className="question-text">{question.text}</h3>

          {question.type === 'single_choice' && (
            <div className="options-list">
              {question.options.map(option => (
                <label key={option.id} className="option-item">
                  <div className="option-radio">
                    <input
                      type="radio"
                      name={`question_${question.id}`}
                      value={option.id}
                      checked={answer === option.id}
                      onChange={(e) => handleAnswerChange(question.id, e.target.value)}
                    />
                    <span className="radio-custom"></span>
                  </div>
                  <span className="option-text">{option.text}</span>
                </label>
              ))}
            </div>
          )}

          {question.type === 'multiple_choice' && (
            <div className="options-list">
              {question.options.map(option => (
                <label key={option.id} className="option-item">
                  <div className="option-checkbox">
                    <input
                      type="checkbox"
                      checked={Array.isArray(answer) && answer.includes(option.id)}
                      onChange={(e) => handleMultipleChoiceChange(question.id, option.id, e.target.checked)}
                    />
                    <span className="checkbox-custom"></span>
                  </div>
                  <span className="option-text">{option.text}</span>
                </label>
              ))}
            </div>
          )}

          {question.type === 'text' && (
            <div className="text-input-container">
              <textarea
                value={answer}
                onChange={(e) => handleAnswerChange(question.id, e.target.value)}
                placeholder="Введите ваш ответ..."
                className="text-input"
                rows="4"
              />
            </div>
          )}

          {question.type === 'rating' && (
            <div className="rating-container">
              <div className="rating-stars">
                {[...Array(question.maxRating || 5)].map((_, i) => {
                  const starValue = i + 1;
                  const isSelected = answer >= starValue;
                  
                  return (
                    <button
                      key={i}
                      type="button"
                      className={`star-btn ${isSelected ? 'selected' : ''}`}
                      onClick={() => handleAnswerChange(question.id, starValue)}
                    >
                      ⭐
                    </button>
                  );
                })}
              </div>
              <span className="rating-label">
                {answer ? `Оценка: ${answer} из ${question.maxRating || 5}` : 'Выберите оценку'}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  if (!survey) return null;

  return (
    <div className="survey-form-overlay">
      <div className="survey-form-modal">
        <button className="survey-form-close" onClick={onClose}>
          ×
        </button>

        <div className="survey-form-content">
          <div className="survey-header">
            <div className="survey-header-top">
              <div className="survey-title-section">
                <h2><TruncatedText text={survey.title} maxLength={50} /></h2>
                {survey.description && <p className="survey-description"><TruncatedText text={survey.description} maxLength={100} /></p>}
              </div>
              <button className="btn btn-outline" onClick={handleGoHome}>
                Вернуться на главную
              </button>
            </div>
            
            <div className="survey-info">
              <div className="participant-info">
                <span className="participant-label">Участник:</span>
                <span className="participant-name">{truncateParticipantName(participantName)}</span>
              </div>
              
              {timeLeft > 0 && (
                <div className={`time-info ${timeLeft <= 60 ? 'time-warning' : ''}`}>
                  <span className="time-label">Осталось времени:</span>
                  <span className="time-value">{formatTime(timeLeft)}</span>
                </div>
              )}
            </div>
          </div>

          {errors.length > 0 && (
            <div className="error-messages">
              {errors.map((error, index) => (
                <div key={index} className="error-message">{error}</div>
              ))}
            </div>
          )}

          <div className="progress-section">
            <div className="progress-bar">
              <div 
                className="progress-fill"
                style={{ width: `${((currentQuestion + 1) / survey.questions.length) * 100}%` }}
              ></div>
            </div>
            
            <div className="progress-text">
              {currentQuestion + 1} из {survey.questions.length} вопросов
            </div>
          </div>

          {/* Навигация по вопросам */}
          <div className="questions-navigation">
            <div className="navigation-dots">
              {survey.questions.map((question, index) => {
                const answer = answers[question.id];
                const isAnswered = question.type === 'multiple_choice' 
                  ? Array.isArray(answer) && answer.length > 0
                  : answer && answer.toString().trim() !== '';
                const isCurrent = index === currentQuestion;
                
                return (
                  <button
                    key={index}
                    type="button"
                    className={`nav-dot ${isCurrent ? 'current' : ''} ${isAnswered ? 'answered' : 'unanswered'}`}
                    onClick={() => goToQuestion(index)}
                    title={`Вопрос ${index + 1}: ${isAnswered ? 'Отвечен' : 'Не отвечен'}`}
                  >
                    {index + 1}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="questions-container">
            {survey.questions.map((question, index) => renderQuestion(question, index))}
          </div>

          <div className="form-actions">
            <div className="navigation-buttons">
              {currentQuestion > 0 && (
                <button 
                  type="button"
                  className="btn btn-secondary"
                  onClick={prevQuestion}
                  disabled={isSubmitting}
                >
                  ← Назад
                </button>
              )}
              
              {currentQuestion < survey.questions.length - 1 ? (
                <button 
                  type="button"
                  className="btn btn-primary"
                  onClick={nextQuestion}
                  disabled={isSubmitting}
                >
                  Далее →
                </button>
              ) : (
                <button 
                  type="button"
                  className="btn btn-success"
                  onClick={() => handleSubmit(false)}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Отправка...' : 'Завершить опрос'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SurveyForm; 