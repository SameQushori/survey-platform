import React, { useState, useEffect } from 'react';
import firebaseSurveyManager from '../../utils/firebaseSurveyManager';
import { truncateSurveyTitle } from '../../utils/textUtils';
import TruncatedText from '../TruncatedText/TruncatedText';
import './SurveyResults.css';
import { saveAs } from 'file-saver';

const SurveyResults = ({ survey, onClose }) => {
  const [activeTab, setActiveTab] = useState('overview');
  const [responses, setResponses] = useState([]);
  const [stats, setStats] = useState(null);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadSurveyData();
  }, [survey]);

  const loadSurveyData = async () => {
    try {
      setIsLoading(true);
      const [responsesData, statsData] = await Promise.all([
        firebaseSurveyManager.getSurveyResponses(survey.id),
        firebaseSurveyManager.getSurveyStats(survey.id)
      ]);
      setResponses(responsesData);
      setStats(statsData);
    } catch (error) {
      console.error('Ошибка загрузки данных опроса:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString('ru-RU');
  };

  const getQuestionText = (questionId) => {
    const question = survey.questions.find(q => q.id === questionId);
    return question ? question.text : 'Неизвестный вопрос';
  };

  const getOptionText = (questionId, optionId) => {
    const question = survey.questions.find(q => q.id === questionId);
    if (!question || !question.options) return 'Неизвестный вариант';
    const option = question.options.find(opt => opt.id === optionId);
    return option ? option.text : 'Неизвестный вариант';
  };

  const handleShowQRCode = () => {
    setQrModalOpen(true);
  };

  const handleCloseQRCode = () => {
    setQrModalOpen(false);
  };

  // Функция для расчета расширенной аналитики
  const calculateAdvancedAnalytics = () => {
    if (!responses.length || !stats) return null;

    const analytics = {
      questionDifficulty: {},
      errorAnalysis: {},
      timeAnalysis: {},
      recommendations: []
    };

    // Анализ сложности вопросов
    survey.questions.forEach((question, index) => {
      const questionStats = stats.questionStats[question.id];
      if (!questionStats) return;

      let correctAnswers = 0;
      let totalAnswers = questionStats.totalResponses;

      if (question.hasCorrectAnswer) {
        if (question.type === 'single_choice') {
          correctAnswers = questionStats.optionCounts[question.correctAnswer] || 0;
        } else if (question.type === 'multiple_choice' && Array.isArray(question.correctAnswer)) {
          // Для множественного выбора считаем полностью правильные ответы
          correctAnswers = responses.filter(response => {
            const answer = response.answers[question.id];
            if (!Array.isArray(answer)) return false;
            
            const correctSet = new Set(question.correctAnswer);
            const answerSet = new Set(answer);
            
            return correctSet.size === answerSet.size && 
                   [...correctSet].every(id => answerSet.has(id));
          }).length;
        }
      }

      const difficultyScore = totalAnswers > 0 ? (correctAnswers / totalAnswers) * 100 : 0;
      
      analytics.questionDifficulty[question.id] = {
        questionIndex: index + 1,
        questionText: question.text,
        difficultyScore: Math.round(difficultyScore * 100) / 100,
        correctAnswers,
        totalAnswers,
        type: question.type,
        hasCorrectAnswer: question.hasCorrectAnswer
      };
    });

    // Анализ ошибок
    survey.questions.forEach(question => {
      const questionStats = stats.questionStats[question.id];
      if (!questionStats || !question.hasCorrectAnswer) return;

      const errorAnalysis = {
        mostCommonErrors: [],
        errorRate: 0,
        confusionMatrix: {}
      };

      if (question.type === 'single_choice') {
        const correctOption = question.correctAnswer;
        const correctCount = questionStats.optionCounts[correctOption] || 0;
        const totalCount = questionStats.totalResponses;
        errorAnalysis.errorRate = totalCount > 0 ? ((totalCount - correctCount) / totalCount) * 100 : 0;

        // Находим самые частые ошибки
        const errors = Object.entries(questionStats.optionCounts)
          .filter(([optionId]) => optionId !== correctOption)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 3);

        errorAnalysis.mostCommonErrors = errors.map(([optionId, count]) => ({
          optionText: getOptionText(question.id, optionId),
          count,
          percentage: Math.round((count / totalCount) * 100)
        }));
      }

      analytics.errorAnalysis[question.id] = errorAnalysis;
    });

    // Временной анализ (если есть данные о времени)
    const responseTimes = responses
      .filter(r => r.submittedAt && r.startedAt)
      .map(r => {
        const start = new Date(r.startedAt);
        const end = new Date(r.submittedAt);
        return (end - start) / 1000; // в секундах
      });

    if (responseTimes.length > 0) {
      analytics.timeAnalysis = {
        averageTime: Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length),
        minTime: Math.round(Math.min(...responseTimes)),
        maxTime: Math.round(Math.max(...responseTimes)),
        totalResponses: responseTimes.length
      };
    }

    // Генерация рекомендаций
    const recommendations = [];

    // Анализ сложных вопросов
    const difficultQuestions = Object.values(analytics.questionDifficulty)
      .filter(q => q.hasCorrectAnswer && q.difficultyScore < 50)
      .sort((a, b) => a.difficultyScore - b.difficultyScore);

    if (difficultQuestions.length > 0) {
      recommendations.push({
        type: 'difficulty',
        title: 'Сложные вопросы',
        description: `Найдено ${difficultQuestions.length} вопросов с низким процентом правильных ответов`,
        questions: difficultQuestions.slice(0, 3),
        priority: 'high'
      });
    }

    // Анализ вопросов с высоким процентом ошибок
    const highErrorQuestions = Object.entries(analytics.errorAnalysis)
      .filter(([, analysis]) => analysis.errorRate > 60)
      .map(([questionId, analysis]) => ({
        questionId,
        questionText: getQuestionText(questionId),
        errorRate: analysis.errorRate,
        mostCommonErrors: analysis.mostCommonErrors
      }))
      .sort((a, b) => b.errorRate - a.errorRate);

    if (highErrorQuestions.length > 0) {
      recommendations.push({
        type: 'errors',
        title: 'Вопросы с высоким процентом ошибок',
        description: `Найдено ${highErrorQuestions.length} вопросов с процентом ошибок более 60%`,
        questions: highErrorQuestions.slice(0, 3),
        priority: 'high'
      });
    }

    // Общие рекомендации
    if (analytics.timeAnalysis && analytics.timeAnalysis.averageTime > 300) {
      recommendations.push({
        type: 'time',
        title: 'Долгое время прохождения',
        description: `Среднее время прохождения опроса составляет ${Math.round(analytics.timeAnalysis.averageTime / 60)} минут`,
        priority: 'medium'
      });
    }

    analytics.recommendations = recommendations;
    return analytics;
  };

  // Получаем максимальный балл из stats
  const maxScore = stats?.maxScore || (survey.questions?.reduce((sum, q) => q.hasCorrectAnswer && q.correctAnswer ? sum + (q.points || 1) : sum, 0));

  const renderOverview = () => (
    <div className="results-overview">
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">👥</div>
          <div className="stat-content">
            <h3>Участников</h3>
            <p className="stat-value">{stats?.totalParticipants}</p>
          </div>
        </div>
        
        {stats?.averageScore !== undefined && (
          <div className="stat-card">
            <div className="stat-icon">📊</div>
            <div className="stat-content">
              <h3>Средний балл</h3>
              <p className="stat-value">{stats?.averageScore} / {maxScore}</p>
            </div>
          </div>
        )}

        <div className="stat-card">
          <div className="stat-icon">❓</div>
          <div className="stat-content">
            <h3>Вопросов</h3>
            <p className="stat-value">{survey.questions.length}</p>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">⏱️</div>
          <div className="stat-content">
            <h3>Время</h3>
            <p className="stat-value">
              {survey.timeLimit > 0 
                ? `${Math.floor(survey.timeLimit / 60)}ч ${survey.timeLimit % 60}мин`
                : 'Без ограничения'
              }
            </p>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon">📅</div>
          <div className="stat-content">
            <h3>Создан</h3>
            <p className="stat-value">{formatDate(survey.createdAt).split(',')[0]}</p>
          </div>
        </div>
      </div>

      {responses.length > 0 && (
        <div className="recent-responses-section">
          <h3>Последние ответы</h3>
          <div className="recent-responses-list">
            {responses.slice(-5).reverse().map(response => (
              <div key={response.id} className="response-card">
                <div className="response-header">
                  <span className="participant-name">
                    <TruncatedText text={response.participantName} maxLength={25} />
                  </span>
                  <span className="response-date">{formatDate(response.submittedAt)}</span>
                </div>
                {response.score !== null && (
                  <div className="response-score">
                    Результат: {response.score} баллов
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderQuestions = () => (
    <div className="questions-analysis">
      {survey.questions.map((question, index) => {
        const questionStats = stats?.questionStats[question.id];
        
        return (
          <div key={question.id} className="question-analysis">
            <div className="question-header">
              <h3>Вопрос {index + 1}: <TruncatedText text={question.text} maxLength={40} /></h3>
              {question.required && <span className="required-badge">Обязательный</span>}
            </div>

            {question.type === 'single_choice' && questionStats && (
              <div className="choice-analysis">
                <div className="options-chart">
                  {question.options.map(option => {
                    const count = questionStats.optionCounts[option.id] || 0;
                    const percentage = questionStats.totalResponses > 0 
                      ? Math.round((count / questionStats.totalResponses) * 100) 
                      : 0;
                    
                    return (
                      <div key={option.id} className="option-bar">
                        <div className="option-info">
                          <span className="option-text">{option.text}</span>
                          <span className="option-count">{count} ({percentage}%)</span>
                        </div>
                        <div className="progress-bar">
                          <div 
                            className="progress-fill" 
                            style={{ width: `${percentage}%` }}
                          ></div>
                        </div>
                        {question.hasCorrectAnswer && question.correctAnswer === option.id && (
                          <span className="correct-indicator">✓ Правильный ответ</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {question.type === 'multiple_choice' && questionStats && (
              <div className="choice-analysis">
                <div className="options-chart">
                  {question.options.map(option => {
                    const count = questionStats.optionCounts[option.id] || 0;
                    const percentage = questionStats.totalResponses > 0 
                      ? Math.round((count / questionStats.totalResponses) * 100) 
                      : 0;
                    
                    return (
                      <div key={option.id} className="option-bar">
                        <div className="option-info">
                          <span className="option-text">{option.text}</span>
                          <span className="option-count">{count} ({percentage}%)</span>
                        </div>
                        <div className="progress-bar">
                          <div 
                            className="progress-fill" 
                            style={{ width: `${percentage}%` }}
                          ></div>
                        </div>
                        {question.hasCorrectAnswer && Array.isArray(question.correctAnswer) && question.correctAnswer.includes(option.id) && (
                          <span className="correct-indicator">✓ Правильный ответ</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {question.type === 'text' && (
              <div className="text-responses">
                <h4>Текстовые ответы ({responses.length})</h4>
                <div className="text-responses-list">
                  {responses.map(response => {
                    const answer = response.answers[question.id];
                    if (!answer) return null;
                    
                    return (
                      <div key={response.id} className="text-response">
                        <div className="text-response-header">
                          <span className="participant-name">
                            <TruncatedText text={response.participantName} maxLength={25} />
                          </span>
                          <span className="response-date">{formatDate(response.submittedAt)}</span>
                        </div>
                        <p className="text-answer">{answer}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {question.type === 'rating' && (
              <div className="rating-analysis">
                <h4>Распределение оценок</h4>
                <div className="rating-chart">
                  {[...Array(question.maxRating || 5)].map((_, i) => {
                    const rating = i + 1;
                    const count = responses.filter(response => 
                      response.answers[question.id] === rating
                    ).length;
                    const percentage = responses.length > 0 
                      ? Math.round((count / responses.length) * 100) 
                      : 0;
                    
                    return (
                      <div key={rating} className="rating-bar">
                        <div className="rating-label">
                          <span className="stars">{'⭐'.repeat(rating)}</span>
                          <span className="rating-count">{count}</span>
                        </div>
                        <div className="progress-bar">
                          <div 
                            className="progress-fill" 
                            style={{ width: `${percentage}%` }}
                          ></div>
                        </div>
                        <span className="rating-percentage">{percentage}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  const renderAdvancedAnalytics = () => {
    const analytics = calculateAdvancedAnalytics();
    if (!analytics) return <div className="no-data">Нет данных для анализа</div>;

    return (
      <div className="advanced-analytics">
        {/* Рекомендации */}
        <div className="recommendations-section">
          <h3>🔍 Рекомендации по улучшению</h3>
          <div className="recommendations-grid">
            {analytics.recommendations.map((rec, index) => (
              <div key={index} className={`recommendation-card ${rec.priority}`}>
                <div className="recommendation-header">
                  <h4>{rec.title}</h4>
                  <span className={`priority-badge ${rec.priority}`}>
                    {rec.priority === 'high' ? '🔴 Высокий' : rec.priority === 'medium' ? '🟡 Средний' : '🟢 Низкий'}
                  </span>
                </div>
                <p className="recommendation-description">{rec.description}</p>
                {rec.questions && (
                  <div className="recommendation-questions">
                    {rec.questions.map((q, qIndex) => (
                      <div key={qIndex} className="recommendation-question">
                        <strong>Вопрос {q.questionIndex || qIndex + 1}:</strong> {q.questionText || q.questionId}
                        {q.difficultyScore !== undefined && (
                          <span className="difficulty-score">
                            Сложность: {q.difficultyScore}%
                          </span>
                        )}
                        {q.errorRate !== undefined && (
                          <span className="error-rate">
                            Ошибок: {Math.round(q.errorRate)}%
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Анализ сложности вопросов */}
        <div className="difficulty-analysis">
          <h3>📊 Анализ сложности вопросов</h3>
          <div className="difficulty-chart">
            {Object.values(analytics.questionDifficulty)
              .filter(q => q.hasCorrectAnswer)
              .sort((a, b) => a.difficultyScore - b.difficultyScore)
              .map((question, index) => (
                <div key={question.questionIndex} className="difficulty-item">
                  <div className="difficulty-header">
                    <span className="question-number">Вопрос {question.questionIndex}</span>
                    <span className={`difficulty-badge ${question.difficultyScore < 30 ? 'very-hard' : question.difficultyScore < 50 ? 'hard' : question.difficultyScore < 70 ? 'medium' : 'easy'}`}>
                      {question.difficultyScore < 30 ? '🔴 Очень сложный' : 
                       question.difficultyScore < 50 ? '🟠 Сложный' : 
                       question.difficultyScore < 70 ? '🟡 Средний' : '🟢 Легкий'}
                    </span>
                  </div>
                  <div className="difficulty-progress">
                    <div className="progress-bar">
                      <div 
                        className={`progress-fill ${question.difficultyScore < 30 ? 'very-hard' : question.difficultyScore < 50 ? 'hard' : question.difficultyScore < 70 ? 'medium' : 'easy'}`}
                        style={{ width: `${question.difficultyScore}%` }}
                      ></div>
                    </div>
                    <span className="difficulty-percentage">{question.difficultyScore}%</span>
                  </div>
                  <p className="question-text">{question.questionText}</p>
                  <div className="difficulty-stats">
                    <span>Правильных: {question.correctAnswers}/{question.totalAnswers}</span>
                  </div>
                </div>
              ))}
          </div>
        </div>

        {/* Анализ ошибок */}
        <div className="error-analysis">
          <h3>❌ Анализ ошибок</h3>
          <div className="error-chart">
            {Object.entries(analytics.errorAnalysis)
              .filter(([, analysis]) => analysis.errorRate > 0)
              .sort(([,a], [,b]) => b.errorRate - a.errorRate)
              .map(([questionId, analysis]) => (
                <div key={questionId} className="error-item">
                  <div className="error-header">
                    <h4>{getQuestionText(questionId)}</h4>
                    <span className="error-rate-badge">
                      {Math.round(analysis.errorRate)}% ошибок
                    </span>
                  </div>
                  {analysis.mostCommonErrors.length > 0 && (
                    <div className="common-errors">
                      <h5>Самые частые ошибки:</h5>
                      {analysis.mostCommonErrors.map((error, index) => (
                        <div key={index} className="common-error">
                          <span className="error-option">{error.optionText}</span>
                          <span className="error-count">{error.count} ({error.percentage}%)</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>

        {/* Временной анализ */}
        {analytics.timeAnalysis && (
          <div className="time-analysis">
            <h3>⏱️ Временной анализ</h3>
            <div className="time-stats">
              <div className="time-stat">
                <span className="time-label">Среднее время:</span>
                <span className="time-value">{analytics.timeAnalysis.averageTime} сек</span>
              </div>
              <div className="time-stat">
                <span className="time-label">Минимальное время:</span>
                <span className="time-value">{analytics.timeAnalysis.minTime} сек</span>
              </div>
              <div className="time-stat">
                <span className="time-label">Максимальное время:</span>
                <span className="time-value">{analytics.timeAnalysis.maxTime} сек</span>
              </div>
            </div>
          </div>
        )}

        {/* Общие выводы */}
        <div className="conclusions">
          <h3>📋 Общие выводы</h3>
          <div className="conclusions-content">
            <div className="conclusion-item">
              <strong>Самый сложный вопрос:</strong>
              {(() => {
                const hardest = Object.values(analytics.questionDifficulty)
                  .filter(q => q.hasCorrectAnswer)
                  .sort((a, b) => a.difficultyScore - b.difficultyScore)[0];
                return hardest ? ` Вопрос ${hardest.questionIndex} (${hardest.difficultyScore}% правильных ответов)` : ' Нет данных';
              })()}
            </div>
            <div className="conclusion-item">
              <strong>Самый легкий вопрос:</strong>
              {(() => {
                const easiest = Object.values(analytics.questionDifficulty)
                  .filter(q => q.hasCorrectAnswer)
                  .sort((a, b) => b.difficultyScore - a.difficultyScore)[0];
                return easiest ? ` Вопрос ${easiest.questionIndex} (${easiest.difficultyScore}% правильных ответов)` : ' Нет данных';
              })()}
            </div>
            <div className="conclusion-item">
              <strong>Вопросы требующие внимания:</strong>
              {(() => {
                const problematic = Object.values(analytics.questionDifficulty)
                  .filter(q => q.hasCorrectAnswer && q.difficultyScore < 50).length;
                return ` ${problematic} вопросов с процентом правильных ответов менее 50%`;
              })()}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // --- Экспорт в CSV ---
  const handleExportCSV = () => {
    if (!responses.length) return;
    const header = ['Имя участника', ...survey.questions.map((q, i) => `${i + 1}. ${q.text}`), 'Баллы', 'Время (сек)', 'Дата'];
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
      // Время прохождения
      let timeSec = '';
      if (response.startedAt && response.submittedAt) {
        const start = new Date(response.startedAt);
        const end = new Date(response.submittedAt);
        timeSec = Math.round((end - start) / 1000);
      }
      return [
        response.participantName,
        ...answerCells,
        `${response.score} / ${maxScore}`,
        timeSec,
        formatDate(response.submittedAt)
      ];
    });
    const csv = [header, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, `survey_results_${survey.id}.csv`);
  };

  // --- renderResponses с пометками правильности и временем ---
  const renderResponses = () => (
    <div className="all-responses">
      <div className="responses-header">
        <h3>Все ответы ({responses.length})</h3>
      </div>
      <div className="responses-list">
        {responses.map(response => {
          let timeSec = '';
          if (response.startedAt && response.submittedAt) {
            const start = new Date(response.startedAt);
            const end = new Date(response.submittedAt);
            timeSec = Math.round((end - start) / 1000);
          }
          return (
            <div key={response.id} className="response-detail">
              <div className="response-detail-header">
                <span className="participant-name">
                  <TruncatedText text={response.participantName} maxLength={25} />
                </span>
                <span className="response-date">{formatDate(response.submittedAt)}</span>
                {response.score !== null && (
                  <span className="response-score">{response.score} / {maxScore} баллов</span>
                )}
                {timeSec !== '' && (
                  <span className="response-score" style={{color:'#007bff'}}>⏱️ {timeSec} сек</span>
                )}
              </div>
              <div className="response-answers">
                {survey.questions.map((question, index) => {
                  const answer = response.answers[question.id];
                  if (!answer) return null;
                  let isCorrect = null;
                  if (question.hasCorrectAnswer && question.correctAnswer) {
                    if (question.type === 'single_choice') {
                      isCorrect = answer === question.correctAnswer;
                    } else if (question.type === 'multiple_choice') {
                      const userAnswers = Array.isArray(answer) ? answer : [answer];
                      const correctAnswers = Array.isArray(question.correctAnswer) ? question.correctAnswer : [question.correctAnswer];
                      isCorrect = userAnswers.length === correctAnswers.length && userAnswers.every(a => correctAnswers.includes(a));
                    } else if (question.type === 'text') {
                      isCorrect = answer.toLowerCase().trim() === question.correctAnswer.toLowerCase().trim();
                    }
                  }
                  return (
                    <div key={question.id} className={`answer-item${isCorrect === true ? ' correct' : isCorrect === false ? ' incorrect' : ''}`}>
                      <div className="answer-question">
                        <strong>{index + 1}. {question.text}</strong>
                        {isCorrect === true && <span style={{color: '#28a745', marginLeft: 8}}>✔</span>}
                        {isCorrect === false && <span style={{color: '#dc3545', marginLeft: 8}}>✘</span>}
                      </div>
                      <div className="answer-content">
                        {question.type === 'single_choice' && (
                          <span>{getOptionText(question.id, answer)}</span>
                        )}
                        {question.type === 'multiple_choice' && (
                          <span>{Array.isArray(answer) ? answer.map(id => getOptionText(question.id, id)).join(', ') : answer}</span>
                        )}
                        {question.type === 'text' && (
                          <span>{answer}</span>
                        )}
                        {question.type === 'rating' && (
                          <span>{'⭐'.repeat(answer)} ({answer} из {question.maxRating || 5})</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  if (!survey) return null;

  return (
    <div className="survey-results-overlay">
      <div className="survey-results-modal">
        <button className="results-close" onClick={onClose} title="Закрыть">
          ×
        </button>

        <div className="results-header">
          <div className="results-header-content">
            <div>
              <h2>Результаты опроса</h2>
              <p><TruncatedText text={survey.title} maxLength={40} /></p>
            </div>
            <button 
              className="btn btn-outline"
              onClick={handleExportCSV}
              title="Экспорт в CSV"
            >
              🗎 Экспорт в CSV
            </button>
          </div>
        </div>

        <div className="results-tabs">
          <button 
            className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            📊 Обзор
          </button>
          <button 
            className={`tab-btn ${activeTab === 'questions' ? 'active' : ''}`}
            onClick={() => setActiveTab('questions')}
          >
            ❓ Анализ вопросов
          </button>
          <button 
            className={`tab-btn ${activeTab === 'analytics' ? 'active' : ''}`}
            onClick={() => setActiveTab('analytics')}
          >
            🔍 Расширенная аналитика
          </button>
          <button 
            className={`tab-btn ${activeTab === 'responses' ? 'active' : ''}`}
            onClick={() => setActiveTab('responses')}
          >
            👥 Все ответы
          </button>
        </div>

        <div className="results-content">
          {activeTab === 'overview' && renderOverview()}
          {activeTab === 'questions' && renderQuestions()}
          {activeTab === 'analytics' && renderAdvancedAnalytics()}
          {activeTab === 'responses' && renderResponses()}
        </div>
      </div>
    </div>
  );
};

export default SurveyResults; 