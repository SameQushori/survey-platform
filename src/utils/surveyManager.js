// Система управления опросами
class SurveyManager {
  constructor() {
    this.surveys = this.loadSurveys();
    this.responses = this.loadResponses();
  }

  // Загрузка опросов из localStorage
  loadSurveys() {
    const stored = localStorage.getItem('survey_surveys');
    return stored ? JSON.parse(stored) : [];
  }

  // Загрузка ответов из localStorage
  loadResponses() {
    const stored = localStorage.getItem('survey_responses');
    return stored ? JSON.parse(stored) : [];
  }

  // Сохранение опросов в localStorage
  saveSurveys() {
    localStorage.setItem('survey_surveys', JSON.stringify(this.surveys));
  }

  // Сохранение ответов в localStorage
  saveResponses() {
    localStorage.setItem('survey_responses', JSON.stringify(this.responses));
  }

  // Создание нового опроса
  createSurvey(surveyData, createdBy) {
    const newSurvey = {
      id: this.generateSurveyId(),
      code: this.generateSurveyCode(),
      title: surveyData.title,
      description: surveyData.description,
      timeLimit: surveyData.timeLimit || 0,
      questions: surveyData.questions,
      isActive: true,
      isPublic: surveyData.isPublic || false,
      createdBy: createdBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      participants: 0,
      responses: []
    };

    this.surveys.push(newSurvey);
    this.saveSurveys();
    
    return {
      success: true,
      survey: newSurvey
    };
  }

  // Получение опроса по ID
  getSurveyById(surveyId) {
    return this.surveys.find(survey => survey.id === surveyId);
  }

  // Получение опроса по коду
  getSurveyByCode(code) {
    return this.surveys.find(survey => survey.code === code && survey.isActive);
  }

  // Получение всех опросов пользователя
  getUserSurveys(userId) {
    return this.surveys.filter(survey => survey.createdBy === userId);
  }

  // Обновление опроса
  updateSurvey(surveyId, updateData) {
    const surveyIndex = this.surveys.findIndex(survey => survey.id === surveyId);
    if (surveyIndex === -1) {
      throw new Error('Опрос не найден');
    }

    this.surveys[surveyIndex] = {
      ...this.surveys[surveyIndex],
      ...updateData,
      updatedAt: new Date().toISOString()
    };

    this.saveSurveys();
    return this.surveys[surveyIndex];
  }

  // Удаление опроса
  deleteSurvey(surveyId) {
    this.surveys = this.surveys.filter(survey => survey.id !== surveyId);
    // Также удаляем все ответы на этот опрос
    this.responses = this.responses.filter(response => response.surveyId !== surveyId);
    this.saveSurveys();
    this.saveResponses();
  }

  // Отправка ответа на опрос
  submitResponse(surveyId, participantName, answers, startedAt = null) {
    const survey = this.getSurveyById(surveyId);
    if (!survey) {
      throw new Error('Опрос не найден');
    }

    if (!survey.isActive) {
      throw new Error('Опрос неактивен');
    }

    // Проверяем, что все обязательные вопросы заполнены
    const requiredQuestions = survey.questions.filter(q => q.required);
    const answeredQuestions = Object.keys(answers);
    
    for (const question of requiredQuestions) {
      if (!answeredQuestions.includes(question.id) || 
          (Array.isArray(answers[question.id]) && answers[question.id].length === 0) ||
          (!Array.isArray(answers[question.id]) && !answers[question.id])) {
        throw new Error(`Вопрос "${question.text}" обязателен для заполнения`);
      }
    }

    const response = {
      id: this.generateResponseId(),
      surveyId: surveyId,
      participantName: participantName,
      answers: answers,
      submittedAt: new Date().toISOString(),
      score: this.calculateScore(survey, answers),
      startedAt: startedAt || null
    };

    this.responses.push(response);
    this.saveResponses();

    // Обновляем статистику опроса
    survey.participants += 1;
    survey.responses.push(response.id);
    this.saveSurveys();

    return {
      success: true,
      response: response
    };
  }

  // Получение ответов на опрос
  getSurveyResponses(surveyId) {
    return this.responses.filter(response => response.surveyId === surveyId);
  }

  // Получение статистики опроса
  getSurveyStats(surveyId) {
    const survey = this.getSurveyById(surveyId);
    const responses = this.getSurveyResponses(surveyId);
    
    if (!survey) return null;

    // Считаем максимальный балл
    let maxScore = 0;
    survey.questions.forEach(q => {
      if (q.hasCorrectAnswer && q.correctAnswer) {
        maxScore += q.points || 1;
      }
    });

    const stats = {
      totalParticipants: responses.length,
      averageScore: 0,
      maxScore,
      questionStats: {},
      recentResponses: responses.slice(-5).reverse()
    };

    if (responses.length > 0) {
      const totalScore = responses.reduce((sum, response) => sum + (response.score || 0), 0);
      stats.averageScore = Math.round((totalScore / responses.length) * 100) / 100;
    }

    // Статистика по вопросам
    survey.questions.forEach(question => {
      if (question.type === 'multiple_choice' || question.type === 'single_choice') {
        const questionResponses = responses.map(r => r.answers[question.id]).filter(Boolean);
        const optionCounts = {};
        
        question.options.forEach(option => {
          optionCounts[option.id] = 0;
        });

        questionResponses.forEach(answer => {
          if (Array.isArray(answer)) {
            answer.forEach(optionId => {
              if (optionCounts[optionId] !== undefined) {
                optionCounts[optionId]++;
              }
            });
          } else if (optionCounts[answer] !== undefined) {
            optionCounts[answer]++;
          }
        });

        stats.questionStats[question.id] = {
          type: question.type,
          text: question.text,
          optionCounts: optionCounts,
          totalResponses: questionResponses.length
        };
      }
    });

    return stats;
  }

  // Генерация уникального ID опроса
  generateSurveyId() {
    return 'survey_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  // Генерация уникального кода опроса
  generateSurveyCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    // Проверяем уникальность
    while (this.surveys.find(survey => survey.code === code)) {
      code = '';
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    }
    
    return code;
  }

  // Генерация уникального ID ответа
  generateResponseId() {
    return 'response_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  // Подсчет баллов за ответы
  calculateScore(survey, answers) {
    let totalScore = 0;

    survey.questions.forEach(question => {
      if (question.hasCorrectAnswer && question.correctAnswer) {
        const userAnswer = answers[question.id];
        if (userAnswer) {
          let isCorrect = false;
          if (question.type === 'single_choice') {
            isCorrect = userAnswer === question.correctAnswer;
          } else if (question.type === 'multiple_choice') {
            const userAnswers = Array.isArray(userAnswer) ? userAnswer : [userAnswer];
            const correctAnswers = Array.isArray(question.correctAnswer) ? question.correctAnswer : [question.correctAnswer];
            isCorrect = userAnswers.length === correctAnswers.length && 
                       userAnswers.every(answer => correctAnswers.includes(answer));
          } else if (question.type === 'text') {
            isCorrect = userAnswer.toLowerCase().trim() === question.correctAnswer.toLowerCase().trim();
          }
          if (isCorrect) {
            totalScore += question.points || 1;
          }
        }
      }
    });
    return totalScore;
  }

  // Валидация данных опроса
  validateSurveyData(surveyData) {
    const errors = [];

    if (!surveyData.title || surveyData.title.trim().length < 3) {
      errors.push('Название опроса должно содержать минимум 3 символа');
    }

    if (!surveyData.questions || surveyData.questions.length === 0) {
      errors.push('Опрос должен содержать хотя бы один вопрос');
    }

    surveyData.questions?.forEach((question, index) => {
      if (!question.text || question.text.trim().length < 3) {
        errors.push(`Вопрос ${index + 1}: текст вопроса должен содержать минимум 3 символа`);
      }

      if (question.type === 'single_choice' || question.type === 'multiple_choice') {
        if (!question.options || question.options.length < 2) {
          errors.push(`Вопрос ${index + 1}: должно быть минимум 2 варианта ответа`);
        }
      }

      if (question.hasCorrectAnswer && question.correctAnswer) {
        if (question.type === 'single_choice') {
          if (!question.options?.find(opt => opt.id === question.correctAnswer)) {
            errors.push(`Вопрос ${index + 1}: правильный ответ должен быть одним из вариантов`);
          }
        } else if (question.type === 'multiple_choice') {
          const correctAnswers = Array.isArray(question.correctAnswer) ? question.correctAnswer : [question.correctAnswer];
          const validOptions = question.options?.map(opt => opt.id) || [];
          if (!correctAnswers.every(answer => validOptions.includes(answer))) {
            errors.push(`Вопрос ${index + 1}: все правильные ответы должны быть среди вариантов`);
          }
        }
      }
    });

    return errors;
  }
}

// Создаем единственный экземпляр
const surveyManager = new SurveyManager();

export default surveyManager; 