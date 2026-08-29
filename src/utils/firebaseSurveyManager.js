import { db } from '../firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy
} from 'firebase/firestore';

// Коллекции Firestore
const surveysCol = collection(db, 'surveys');
const responsesCol = collection(db, 'responses');
const adminsCol = collection(db, 'admins');

class FirebaseSurveyManager {
  constructor() {
    this.surveys = [];
    this.responses = [];
    this.firebaseAvailable = true;
    this.checkFirebaseConnection();
  }

  // Проверка доступности Firebase
  async checkFirebaseConnection() {
    try {
      await getDocs(surveysCol);
      this.firebaseAvailable = true;
      console.log('✅ Firebase SurveyManager подключен');
      return true;
    } catch (error) {
      console.warn('Firebase недоступен для опросов, используем localStorage:', error.message);
      this.firebaseAvailable = false;
      return false;
    }
  }

  // --- ОПРОСЫ ---
  async getAllSurveys() {
    const snapshot = await getDocs(surveysCol);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  async getSurveyById(surveyId) {
    console.log('🔍 getSurveyById вызван с surveyId:', surveyId);
    
    if (!this.firebaseAvailable) {
      // Fallback на localStorage
      const storedSurveys = localStorage.getItem('survey_surveys');
      const surveys = storedSurveys ? JSON.parse(storedSurveys) : [];
      const survey = surveys.find(survey => survey.id === surveyId) || null;
      console.log('💾 Опрос из localStorage:', survey);
      return survey;
    }

    try {
      console.log('🔥 Запрос к Firebase для surveyId:', surveyId);
      const ref = doc(surveysCol, surveyId);
      const snap = await getDoc(ref);
      const survey = snap.exists() ? { id: snap.id, ...snap.data() } : null;
      console.log('🔥 Опрос из Firebase:', survey);
      return survey;
    } catch (error) {
      console.error('❌ Ошибка получения опроса по ID:', error);
      return null;
    }
  }

  async getSurveyByCode(code) {
    console.log('🔍 getSurveyByCode вызван с code:', code);
    
    if (!this.firebaseAvailable) {
      // Fallback на localStorage
      const storedSurveys = localStorage.getItem('survey_surveys');
      const surveys = storedSurveys ? JSON.parse(storedSurveys) : [];
      const survey = surveys.find(survey => survey.code === code && survey.isActive) || null;
      console.log('💾 Опрос по коду из localStorage:', survey);
      return survey;
    }

    try {
      console.log('🔥 Запрос к Firebase для кода:', code);
      const q = query(surveysCol, where('code', '==', code), where('isActive', '==', true));
      const snapshot = await getDocs(q);
      if (snapshot.empty) {
        console.log('❌ Опрос с кодом не найден в Firebase');
        return null;
      }
      const docSnap = snapshot.docs[0];
      const survey = { id: docSnap.id, ...docSnap.data() };
      console.log('🔥 Опрос по коду из Firebase:', survey);
      return survey;
    } catch (error) {
      console.error('❌ Ошибка получения опроса по коду:', error);
      return null;
    }
  }

  async createSurvey(surveyData, createdBy) {
    try {
      console.log('📝 createSurvey вызван с данными:', { surveyData, createdBy });
      
      const newSurvey = {
        code: this.generateSurveyCode(),
        title: surveyData.title,
        description: surveyData.description,
        timeLimit: surveyData.timeLimit || 0,
        questions: surveyData.questions,
        isActive: true,
        createdBy: createdBy,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        participants: 0,
        responses: []
      };

      console.log('📋 Создаваемый опрос:', newSurvey);

      if (this.firebaseAvailable) {
        // Сохраняем в Firebase
        console.log('🔥 Сохраняем в Firebase...');
        const docRef = await addDoc(surveysCol, newSurvey);
        const createdSurvey = { id: docRef.id, ...newSurvey };
        console.log('✅ Опрос сохранен в Firebase:', createdSurvey);
        return { success: true, survey: createdSurvey };
      } else {
        // Fallback на localStorage
        console.log('💾 Сохраняем в localStorage...');
        const surveyWithId = { id: this.generateSurveyId(), ...newSurvey };
        const storedSurveys = localStorage.getItem('survey_surveys');
        let surveys = storedSurveys ? JSON.parse(storedSurveys) : [];
        surveys.push(surveyWithId);
        localStorage.setItem('survey_surveys', JSON.stringify(surveys));
        console.log('✅ Опрос сохранен в localStorage:', surveyWithId);
        return { success: true, survey: surveyWithId };
      }
    } catch (error) {
      console.error('❌ Ошибка создания опроса:', error);
      throw new Error('Ошибка создания опроса: ' + error.message);
    }
  }

  async updateSurvey(surveyId, updateData) {
    try {
      const updatePayload = {
        ...updateData,
        updatedAt: new Date().toISOString()
      };

      if (this.firebaseAvailable) {
        const ref = doc(surveysCol, surveyId);
        await updateDoc(ref, updatePayload);
        return await this.getSurveyById(surveyId);
      } else {
        // Fallback на localStorage
        const storedSurveys = localStorage.getItem('survey_surveys');
        let surveys = storedSurveys ? JSON.parse(storedSurveys) : [];
        const surveyIndex = surveys.findIndex(s => s.id === surveyId);
        if (surveyIndex !== -1) {
          surveys[surveyIndex] = { ...surveys[surveyIndex], ...updatePayload };
          localStorage.setItem('survey_surveys', JSON.stringify(surveys));
          return surveys[surveyIndex];
        }
        throw new Error('Опрос не найден');
      }
    } catch (error) {
      throw new Error('Ошибка обновления опроса: ' + error.message);
    }
  }

  async deleteSurvey(surveyId) {
    try {
      console.log('🗑️ deleteSurvey вызван с surveyId:', surveyId);
      
      if (this.firebaseAvailable) {
        console.log('🔥 Удаляем опрос из Firebase...');
        
        // Удаляем опрос
        const surveyRef = doc(surveysCol, surveyId);
        await deleteDoc(surveyRef);
        console.log('✅ Опрос удален из Firebase');
        
        // Удаляем все ответы на этот опрос
        console.log('🗑️ Удаляем ответы на опрос...');
        const responsesQuery = query(responsesCol, where('surveyId', '==', surveyId));
        const responsesSnapshot = await getDocs(responsesQuery);
        
        if (!responsesSnapshot.empty) {
          const deletePromises = responsesSnapshot.docs.map(doc => deleteDoc(doc.ref));
          await Promise.all(deletePromises);
          console.log(`✅ Удалено ${responsesSnapshot.size} ответов`);
        } else {
          console.log('ℹ️ Ответов для удаления не найдено');
        }
      } else {
        console.log('💾 Удаляем опрос из localStorage...');
        
        // Fallback на localStorage
        const storedSurveys = localStorage.getItem('survey_surveys');
        let surveys = storedSurveys ? JSON.parse(storedSurveys) : [];
        const initialCount = surveys.length;
        surveys = surveys.filter(survey => survey.id !== surveyId);
        localStorage.setItem('survey_surveys', JSON.stringify(surveys));
        console.log(`✅ Удален опрос из localStorage (было: ${initialCount}, стало: ${surveys.length})`);

        // Удаляем ответы
        const storedResponses = localStorage.getItem('survey_responses');
        let responses = storedResponses ? JSON.parse(storedResponses) : [];
        const initialResponsesCount = responses.length;
        responses = responses.filter(response => response.surveyId !== surveyId);
        localStorage.setItem('survey_responses', JSON.stringify(responses));
        console.log(`✅ Удалены ответы из localStorage (было: ${initialResponsesCount}, стало: ${responses.length})`);
      }
      
      return { success: true };
    } catch (error) {
      console.error('❌ Ошибка удаления опроса:', error);
      throw new Error('Ошибка удаления опроса: ' + error.message);
    }
  }

  // --- ОТВЕТЫ ---
  async getSurveyResponses(surveyId) {
    if (!this.firebaseAvailable) {
      // Fallback на localStorage
      const storedResponses = localStorage.getItem('survey_responses');
      const responses = storedResponses ? JSON.parse(storedResponses) : [];
      return responses
        .filter(response => response.surveyId === surveyId)
        .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    }

    try {
      const q = query(
        responsesCol, 
        where('surveyId', '==', surveyId),
        orderBy('submittedAt', 'desc')
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Ошибка получения ответов:', error);
      return [];
    }
  }

  async submitResponse(surveyId, participantName, answers, startedAt = null) {
    try {
      console.log('📤 submitResponse вызван с данными:', { surveyId, participantName, answers, startedAt });
      
      const survey = await this.getSurveyById(surveyId);
      console.log('🔍 Найденный опрос для ответа:', survey);
      
      if (!survey) {
        console.error('❌ Опрос не найден для ID:', surveyId);
        throw new Error('Опрос не найден');
      }

      if (!survey.isActive) {
        console.error('❌ Опрос неактивен:', survey);
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
        startedAt: startedAt || null,
        score: this.calculateScore(survey, answers)
      };

      console.log('📝 Создаваемый ответ:', response);

      if (this.firebaseAvailable) {
        // Сохраняем ответ в Firebase
        console.log('🔥 Сохраняем ответ в Firebase...');
        const responseRef = await addDoc(responsesCol, response);
        const savedResponse = { id: responseRef.id, ...response };
        console.log('✅ Ответ сохранен в Firebase:', savedResponse);

        // Обновляем статистику опроса
        const newParticipants = survey.participants + 1;
        console.log('📊 Обновляем статистику опроса:', { surveyId, newParticipants });
        await updateDoc(doc(surveysCol, surveyId), {
          participants: newParticipants,
          updatedAt: new Date().toISOString()
        });

        return { success: true, response: savedResponse };
      } else {
        // Fallback на localStorage
        console.log('💾 Сохраняем ответ в localStorage...');
        const storedResponses = localStorage.getItem('survey_responses');
        let responses = storedResponses ? JSON.parse(storedResponses) : [];
        responses.push(response);
        localStorage.setItem('survey_responses', JSON.stringify(responses));

        // Обновляем статистику опроса
        const storedSurveys = localStorage.getItem('survey_surveys');
        let surveys = storedSurveys ? JSON.parse(storedSurveys) : [];
        const surveyIndex = surveys.findIndex(s => s.id === surveyId);
        if (surveyIndex !== -1) {
          surveys[surveyIndex].participants += 1;
          surveys[surveyIndex].updatedAt = new Date().toISOString();
          localStorage.setItem('survey_surveys', JSON.stringify(surveys));
        }

        return { success: true, response: response };
      }
    } catch (error) {
      console.error('❌ Ошибка отправки ответа:', error);
      throw new Error('Ошибка отправки ответа: ' + error.message);
    }
  }

  // --- АДМИНИСТРАТОРЫ ---
  async getAllAdmins() {
    const snapshot = await getDocs(adminsCol);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  async getAdminByLogin(login) {
    const q = query(adminsCol, where('login', '==', login));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;
    const docSnap = snapshot.docs[0];
    return { id: docSnap.id, ...docSnap.data() };
  }

  async createAdmin(adminData) {
    const docRef = await addDoc(adminsCol, adminData);
    return { id: docRef.id, ...adminData };
  }

  async updateAdmin(id, updateData) {
    const ref = doc(adminsCol, id);
    await updateDoc(ref, updateData);
    return this.getAdminById(id);
  }

  async deleteAdmin(id) {
    await deleteDoc(doc(adminsCol, id));
  }

  // --- Вспомогательные методы ---
  generateSurveyId() {
    return 'survey_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  generateSurveyCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  generateResponseId() {
    return 'response_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

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
                       userAnswers.every(ans => correctAnswers.includes(ans));
          }
          if (isCorrect) {
            totalScore += question.points || 1;
          }
        }
      }
    });
    return totalScore;
  }

  validateSurveyData(surveyData) {
    const errors = [];

    if (!surveyData.title || surveyData.title.trim().length < 3) {
      errors.push('Название опроса должно содержать минимум 3 символа');
    }

    if (!surveyData.description || surveyData.description.trim().length < 10) {
      errors.push('Описание опроса должно содержать минимум 10 символов');
    }

    if (!surveyData.questions || surveyData.questions.length === 0) {
      errors.push('Опрос должен содержать хотя бы один вопрос');
    }

    surveyData.questions.forEach((question, index) => {
      if (!question.text || question.text.trim().length < 3) {
        errors.push(`Вопрос ${index + 1}: текст вопроса должен содержать минимум 3 символа`);
      }

      if (question.type === 'single_choice' || question.type === 'multiple_choice') {
        if (!question.options || question.options.length < 2) {
          errors.push(`Вопрос ${index + 1}: должно быть минимум 2 варианта ответа`);
        }

        question.options.forEach((option, optIndex) => {
          if (!option.text || option.text.trim().length === 0) {
            errors.push(`Вопрос ${index + 1}, вариант ${optIndex + 1}: текст варианта не может быть пустым`);
          }
        });
      }
    });

    return errors;
  }

  async getUserSurveys(userId) {
    console.log('🔍 getUserSurveys вызван с userId:', userId);
    console.log('🔍 Firebase доступен:', this.firebaseAvailable);
    
    if (!this.firebaseAvailable) {
      // Fallback на localStorage
      const storedSurveys = localStorage.getItem('survey_surveys');
      const surveys = storedSurveys ? JSON.parse(storedSurveys) : [];
      console.log('📦 Все опросы в localStorage:', surveys);
      
      const userSurveys = surveys
        .filter(survey => survey.createdBy === userId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      
      console.log('👤 Опросы пользователя из localStorage:', userSurveys);
      return userSurveys;
    }

    try {
      console.log('🔥 Запрос к Firebase для пользователя:', userId);
      const q = query(
        surveysCol, 
        where('createdBy', '==', userId),
        orderBy('createdAt', 'desc')
      );
      const snapshot = await getDocs(q);
      const surveys = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      console.log('🔥 Опросы из Firebase:', surveys);
      
      // Проверяем, что все опросы действительно существуют
      console.log('🔍 Проверяем существование опросов...');
      const validSurveys = [];
      
      for (const survey of surveys) {
        try {
          const surveyRef = doc(surveysCol, survey.id);
          const surveyDoc = await getDoc(surveyRef);
          
          if (surveyDoc.exists()) {
            validSurveys.push(survey);
            console.log(`✅ Опрос ${survey.id} существует`);
          } else {
            console.log(`❌ Опрос ${survey.id} не существует, пропускаем`);
          }
        } catch (error) {
          console.log(`❌ Ошибка проверки опроса ${survey.id}:`, error.message);
        }
      }
      
      console.log(`📊 Валидных опросов: ${validSurveys.length} из ${surveys.length}`);
      return validSurveys;
    } catch (error) {
      console.error('❌ Ошибка получения опросов пользователя:', error);
      return [];
    }
  }

  async getSurveyStats(surveyId) {
    try {
      const survey = await this.getSurveyById(surveyId);
      const responses = await this.getSurveyResponses(surveyId);
      
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
        recentResponses: responses.slice(0, 5)
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
    } catch (error) {
      console.error('Ошибка получения статистики:', error);
      return null;
    }
  }

  // Принудительная очистка кэша и перезагрузка данных
  async clearCacheAndReload() {
    console.log('🧹 Очистка кэша и перезагрузка данных...');
    
    if (this.firebaseAvailable) {
      // Принудительно переподключаемся к Firebase
      await this.checkFirebaseConnection();
      console.log('✅ Кэш очищен, Firebase переподключен');
    } else {
      // Очищаем localStorage
      localStorage.removeItem('survey_surveys');
      localStorage.removeItem('survey_responses');
      console.log('✅ localStorage очищен');
    }
  }

  // Принудительное удаление опроса с очисткой кэша
  async forceDeleteSurvey(surveyId) {
    console.log('💥 Принудительное удаление опроса:', surveyId);
    
    try {
      // Сначала удаляем опрос
      await this.deleteSurvey(surveyId);
      
      // Затем очищаем кэш
      await this.clearCacheAndReload();
      
      console.log('✅ Опрос принудительно удален и кэш очищен');
      return { success: true };
    } catch (error) {
      console.error('❌ Ошибка принудительного удаления:', error);
      throw new Error('Ошибка принудительного удаления: ' + error.message);
    }
  }
}

// Создаем единственный экземпляр
const firebaseSurveyManager = new FirebaseSurveyManager();

export default firebaseSurveyManager; 