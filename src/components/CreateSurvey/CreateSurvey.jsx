import React, { useState } from 'react';
import firebaseSurveyManager from '../../utils/firebaseSurveyManager';
import firebaseAdminAuth from '../../utils/firebaseAdminAuth';
import './CreateSurvey.css';

const CreateSurvey = ({ isOpen, onClose, onSurveyCreated }) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState([]);
  const [surveyData, setSurveyData] = useState({
    title: '',
    description: '',
    timeLimit: 0,
    questions: []
  });

  const questionTypes = [
    { id: 'single_choice', name: 'Один ответ', icon: '🔘', description: 'Выберите один вариант ответа' },
    { id: 'multiple_choice', name: 'Несколько ответов', icon: '☑️', description: 'Выберите несколько вариантов ответа' },
    { id: 'text', name: 'Текстовый ответ', icon: '📝', description: 'Введите текстовый ответ' },
    { id: 'rating', name: 'Оценка', icon: '⭐', description: 'Оцените по шкале от 1 до 10' }
  ];

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setSurveyData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSurveyDataChange = (field, value) => {
    setSurveyData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const addQuestion = () => {
    const newQuestion = {
      id: `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      text: '',
      type: 'single_choice',
      required: true,
      hasCorrectAnswer: true,
      correctAnswer: null,
      points: 1,
      options: [
        { id: `opt_${Date.now()}_1`, text: '' },
        { id: `opt_${Date.now()}_2`, text: '' }
      ]
    };

    setSurveyData(prev => ({
      ...prev,
      questions: [...prev.questions, newQuestion]
    }));
  };

  const updateQuestion = (questionId, updates) => {
    setSurveyData(prev => ({
      ...prev,
      questions: prev.questions.map(q => 
        q.id === questionId ? { ...q, ...updates } : q
      )
    }));
  };

  const removeQuestion = (questionId) => {
    setSurveyData(prev => ({
      ...prev,
      questions: prev.questions.filter(q => q.id !== questionId)
    }));
  };

  const addOption = (questionId) => {
    setSurveyData(prev => ({
      ...prev,
      questions: prev.questions.map(q => {
        if (q.id === questionId) {
          const newOption = {
            id: `opt_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            text: ''
          };
          return {
            ...q,
            options: [...q.options, newOption]
          };
        }
        return q;
      })
    }));
  };

  const updateOption = (questionId, optionId, text) => {
    setSurveyData(prev => ({
      ...prev,
      questions: prev.questions.map(q => {
        if (q.id === questionId) {
          return {
            ...q,
            options: q.options.map(opt => 
              opt.id === optionId ? { ...opt, text } : opt
            )
          };
        }
        return q;
      })
    }));
  };

  const removeOption = (questionId, optionId) => {
    setSurveyData(prev => ({
      ...prev,
      questions: prev.questions.map(q => {
        if (q.id === questionId) {
          return {
            ...q,
            options: q.options.filter(opt => opt.id !== optionId)
          };
        }
        return q;
      })
    }));
  };

  const handleCorrectAnswerChange = (questionId, optionId, isChecked) => {
    setSurveyData(prev => ({
      ...prev,
      questions: prev.questions.map(q => {
        if (q.id === questionId) {
          let newCorrectAnswer;
          
          if (q.type === 'single_choice') {
            // Для одного ответа - просто заменяем
            newCorrectAnswer = isChecked ? optionId : null;
          } else {
            // Для нескольких ответов - добавляем/удаляем из массива
            const currentAnswers = Array.isArray(q.correctAnswer) ? q.correctAnswer : [];
            if (isChecked) {
              newCorrectAnswer = [...currentAnswers, optionId];
            } else {
              newCorrectAnswer = currentAnswers.filter(id => id !== optionId);
            }
          }
          
          return {
            ...q,
            correctAnswer: newCorrectAnswer
          };
        }
        return q;
      })
    }));
  };

  const validateStep = (step) => {
    const newErrors = [];

    if (step === 1) {
      if (!surveyData.title.trim()) {
        newErrors.push('Введите название опроса');
      }
      if (!surveyData.description.trim()) {
        newErrors.push('Введите описание опроса');
      }
    } else if (step === 2) {
      if (surveyData.questions.length === 0) {
        newErrors.push('Добавьте хотя бы один вопрос');
      } else {
        surveyData.questions.forEach((question, index) => {
          if (!question.text.trim()) {
            newErrors.push(`Вопрос ${index + 1}: введите текст вопроса`);
          }
          if (question.type === 'single_choice' || question.type === 'multiple_choice') {
            if (question.options.length < 2) {
              newErrors.push(`Вопрос ${index + 1}: добавьте минимум 2 варианта ответа`);
            }
            question.options.forEach((option, optIndex) => {
              if (!option.text.trim()) {
                newErrors.push(`Вопрос ${index + 1}, вариант ${optIndex + 1}: введите текст варианта`);
              }
            });
          }
        });
      }
    }

    setErrors(newErrors);
    return newErrors.length === 0;
  };

  const nextStep = () => {
    if (validateStep(currentStep)) {
      setCurrentStep(prev => prev + 1);
      setErrors([]);
    }
  };

  const prevStep = () => {
    setCurrentStep(prev => prev - 1);
    setErrors([]);
  };

  const handleSubmit = async () => {
    if (!validateStep(currentStep)) {
      return;
    }

    // Защита от повторного вызова
    if (isLoading) {
      return;
    }

    setIsLoading(true);
    setErrors([]);

    try {
      const currentAdmin = firebaseAdminAuth.getCurrentAdmin();
      if (!currentAdmin) {
        throw new Error('Необходимо войти в систему');
      }

      console.log('Создаем опрос...', surveyData);
      const result = await firebaseSurveyManager.createSurvey(surveyData, currentAdmin.id);
      
      console.log('Опрос создан успешно:', result);
      
      if (onSurveyCreated) {
        onSurveyCreated(result.survey);
      }
    } catch (error) {
      console.error('Ошибка создания опроса:', error);
      setErrors([error.message]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (!isLoading) {
      setCurrentStep(1);
      setSurveyData({
        title: '',
        description: '',
        timeLimit: 0,
        questions: []
      });
      setErrors([]);
      onClose();
    }
  };

  const renderQuestion = (question, index) => (
    <div key={question.id} className="question-card">
      <div className="question-header">
        <span className="question-number">Вопрос {index + 1}</span>
        <button 
          className="remove-question-btn"
          onClick={() => removeQuestion(question.id)}
          type="button"
          title="Удалить вопрос"
        >
          ×
        </button>
      </div>

      <div className="question-content">
        <div className="question-text-section">
          <input
            type="text"
            className="question-text-input"
            placeholder="Введите текст вопроса"
            value={question.text}
            onChange={(e) => updateQuestion(question.id, { text: e.target.value })}
          />
        </div>

        <div className="question-settings">
          <div className="setting-group">
            <label className="setting-label">
              Баллы за правильный ответ:
              <input
                type="number"
                min="1"
                max="10"
                value={question.points}
                onChange={(e) => updateQuestion(question.id, { points: parseInt(e.target.value) || 1 })}
                className="points-input"
              />
            </label>
          </div>
        </div>

        <div className="question-type-selector">
          <label>Тип вопроса:</label>
          <div className="type-options">
            {questionTypes.map(type => (
              <button
                key={type.id}
                type="button"
                className={`type-option ${question.type === type.id ? 'active' : ''}`}
                onClick={() => updateQuestion(question.id, { 
                  type: type.id,
                  correctAnswer: null,
                  hasCorrectAnswer: true,
                  required: true,
                  options: type.id === 'text' || type.id === 'rating' ? [] : question.options
                })}
              >
                <span className="type-icon">{type.icon}</span>
                <span className="type-name">{type.name}</span>
              </button>
            ))}
          </div>
        </div>

        {(question.type === 'single_choice' || question.type === 'multiple_choice') && (
          <div className="options-section">
            <div className="options-header">
              <label>Варианты ответов:</label>
              <button 
                type="button"
                className="add-option-btn"
                onClick={() => addOption(question.id)}
              >
                + Добавить вариант
              </button>
            </div>

            <div className="options-list">
              {question.options.map((option, optionIndex) => {
                const isCorrect = question.type === 'single_choice' 
                  ? question.correctAnswer === option.id
                  : Array.isArray(question.correctAnswer) && question.correctAnswer.includes(option.id);
                
                return (
                  <div key={option.id} className="option-item">
                    <div className="option-main">
                      <div className="option-checkbox-wrapper">
                        <input
                          type={question.type === 'multiple_choice' ? 'checkbox' : 'radio'}
                          name={`correct_${question.id}`}
                          id={`correct_${question.id}_${option.id}`}
                          checked={isCorrect}
                          onChange={(e) => handleCorrectAnswerChange(question.id, option.id, e.target.checked)}
                          className="correct-answer-checkbox"
                        />
                        <label 
                          htmlFor={`correct_${question.id}_${option.id}`}
                          className="checkbox-label-text"
                        >
                          Правильный
                        </label>
                      </div>
                      
                      <input
                        type="text"
                        className="option-input"
                        placeholder={`Вариант ${optionIndex + 1}`}
                        value={option.text}
                        onChange={(e) => updateOption(question.id, option.id, e.target.value)}
                      />
                    </div>
                    
                    <button
                      type="button"
                      className="remove-option-btn"
                      onClick={() => removeOption(question.id, option.id)}
                      disabled={question.options.length <= 2}
                      title="Удалить вариант"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {question.type === 'rating' && (
          <div className="rating-settings">
            <label>Максимальная оценка:</label>
            <input
              type="number"
              min="3"
              max="10"
              value={question.maxRating || 5}
              onChange={(e) => updateQuestion(question.id, { maxRating: parseInt(e.target.value) || 5 })}
              className="rating-input"
            />
          </div>
        )}
      </div>
    </div>
  );

  if (!isOpen) return null;

  return (
    <div className="create-survey-overlay">
      <div className="create-survey-modal">
        <button className="create-survey-close" onClick={handleClose}>
          ×
        </button>

        <div className="create-survey-content">
          <div className="survey-header">
            <h2>Создание опроса</h2>
            <div className="step-indicator">
              <span className={`step ${currentStep >= 1 ? 'active' : ''}`}>1. Основная информация</span>
              <span className={`step ${currentStep >= 2 ? 'active' : ''}`}>2. Вопросы</span>
              <span className={`step ${currentStep >= 3 ? 'active' : ''}`}>3. Завершение</span>
            </div>
          </div>

          {errors.length > 0 && (
            <div className="error-messages">
              {errors.map((error, index) => (
                <div key={index} className="error-message">{error}</div>
              ))}
            </div>
          )}

          {currentStep === 1 && (
            <div className="step-content">
              <div className="form-group">
                <label htmlFor="title">Название опроса *</label>
                <input
                  type="text"
                  id="title"
                  name="title"
                  className="form-input"
                  placeholder="Введите название опроса"
                  value={surveyData.title}
                  onChange={handleInputChange}
                  maxLength="100"
                />
                <small className="form-hint">
                  Максимум 100 символов
                </small>
              </div>

              <div className="form-group">
                <label htmlFor="description">Описание опроса:</label>
                <textarea
                  id="description"
                  className="form-textarea"
                  value={surveyData.description}
                  onChange={(e) => handleSurveyDataChange('description', e.target.value)}
                  placeholder="Введите описание опроса..."
                  rows="3"
                  maxLength="200"
                />
                <small className="form-hint">
                  Максимум 200 символов
                </small>
              </div>

              <div className="form-group">
                <label htmlFor="timeLimit">Ограничение времени (в минутах):</label>
                <div className="time-limit-container">
                  <input
                    type="number"
                    id="timeLimit"
                    className="form-input"
                    value={surveyData.timeLimit}
                    onChange={(e) => handleSurveyDataChange('timeLimit', parseInt(e.target.value) || 0)}
                    placeholder="0 = без ограничения"
                    min="0"
                    max="1440"
                  />
                  <span className="time-limit-hint">
                    {surveyData.timeLimit > 0 
                      ? (surveyData.timeLimit >= 60
                        ? `(${Math.floor(surveyData.timeLimit / 60)}ч ${surveyData.timeLimit % 60}мин)`
                        : `(${surveyData.timeLimit} мин)`
                      )
                      : 'Без ограничения времени'
                    }
                  </span>
                </div>
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="step-content">
              <div className="questions-header">
                <h3>Вопросы опроса</h3>
                <button 
                  type="button"
                  className="add-question-btn"
                  onClick={addQuestion}
                >
                  + Добавить вопрос
                </button>
              </div>

              <div className="questions-list">
                {surveyData.questions.length === 0 ? (
                  <div className="empty-questions">
                    <p>Вопросы не добавлены</p>
                    <p>Нажмите "Добавить вопрос" для создания первого вопроса</p>
                  </div>
                ) : (
                  surveyData.questions.map((question, index) => renderQuestion(question, index))
                )}
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div className="step-content">
              <div className="survey-preview">
                <h3>Предварительный просмотр</h3>
                <div className="preview-survey">
                  <h4>{surveyData.title}</h4>
                  {surveyData.description && <p>{surveyData.description}</p>}
                  
                  <div className="preview-questions">
                    {surveyData.questions.map((question, index) => (
                      <div key={question.id} className="preview-question">
                        <p><strong>{index + 1}. {question.text}</strong> {question.required && <span className="required">*</span>}</p>
                        {question.type === 'single_choice' && (
                          <div className="preview-options">
                            {question.options.map(option => (
                              <div key={option.id} className="preview-option">
                                <input type="radio" disabled />
                                <span>{option.text}</span>
                                {question.hasCorrectAnswer && question.correctAnswer === option.id && (
                                  <span className="correct-indicator">✓</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {question.type === 'multiple_choice' && (
                          <div className="preview-options">
                            {question.options.map(option => (
                              <div key={option.id} className="preview-option">
                                <input type="checkbox" disabled />
                                <span>{option.text}</span>
                                {question.hasCorrectAnswer && Array.isArray(question.correctAnswer) && question.correctAnswer.includes(option.id) && (
                                  <span className="correct-indicator">✓</span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {question.type === 'text' && (
                          <div className="preview-text-input">
                            <input type="text" placeholder="Текстовый ответ" disabled />
                          </div>
                        )}
                        {question.type === 'rating' && (
                          <div className="preview-rating">
                            {[...Array(question.maxRating || 5)].map((_, i) => (
                              <span key={i} className="star">⭐</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="step-actions">
            {currentStep > 1 && (
              <button 
                type="button"
                className="btn btn-secondary"
                onClick={prevStep}
                disabled={isLoading}
              >
                Назад
              </button>
            )}
            
            {currentStep < 3 ? (
              <button 
                type="button"
                className="btn btn-primary"
                onClick={nextStep}
                disabled={isLoading}
              >
                Далее
              </button>
            ) : (
              <button 
                type="button"
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={isLoading}
              >
                {isLoading ? 'Создание...' : 'Создать опрос'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreateSurvey; 