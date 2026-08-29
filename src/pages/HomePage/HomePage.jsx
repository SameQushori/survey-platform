import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Header from '../../components/Header/Header';
import Hero from '../../components/Hero/Hero';
import Features from '../../components/Features/Features';
import HowItWorks from '../../components/HowItWorks/HowItWorks';
import Footer from '../../components/Footer/Footer';
import AuthWindow from '../../components/AuthWindow/AuthWindow';
import firebaseAdminAuth from '../../utils/firebaseAdminAuth';
import firebaseSurveyManager from '../../utils/firebaseSurveyManager';
import './HomePage.css';

const HomePage = () => {
  const navigate = useNavigate();
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isCodeModalOpen, setIsCodeModalOpen] = useState(false);
  const [inputCode, setInputCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [isCodeLoading, setIsCodeLoading] = useState(false);

  const handleOpenAuth = () => {
    setIsAuthOpen(true);
  };

  const handleCloseAuth = () => {
    setIsAuthOpen(false);
  };

  const handleCreateSurvey = () => {
    // Проверяем, авторизован ли пользователь
    const currentAdmin = firebaseAdminAuth.getCurrentAdmin();
    
    if (currentAdmin && firebaseAdminAuth.isAdminLoggedIn()) {
      // Если пользователь уже авторизован, перенаправляем на дашборд
      navigate('/dashboard');
    } else {
      // Если не авторизован, открываем окно авторизации
      setIsAuthOpen(true);
    }
  };

  const handleLogin = (loginData) => {
    if (loginData.role === 'organizer') {
      // Перенаправляем на дашборд
      navigate('/dashboard');
    } else {
      // Для участников показываем модальное окно для ввода кода
      setIsCodeModalOpen(true);
    }
  };

  const handleOpenCodeModal = () => {
    setIsCodeModalOpen(true);
  };

  const handleCloseCodeModal = () => {
    setIsCodeModalOpen(false);
    setInputCode('');
    setCodeError('');
  };

  const handleCodeSubmit = async (e) => {
    e.preventDefault();
    
    if (!inputCode.trim()) {
      setCodeError('Введите код опроса');
      return;
    }

    setIsCodeLoading(true);
    setCodeError('');

    try {
      // Проверяем существование опроса
      const survey = await firebaseSurveyManager.getSurveyByCode(inputCode.toUpperCase());
      
      if (!survey) {
        setCodeError('Опрос с таким кодом не найден');
        return;
      }

      if (!survey.isActive) {
        setCodeError('Этот опрос неактивен');
        return;
      }

      // Перенаправляем на страницу участника с кодом
      navigate(`/participant?code=${inputCode.toUpperCase()}`);
    } catch (error) {
      setCodeError('Ошибка при проверке кода: ' + error.message);
    } finally {
      setIsCodeLoading(false);
    }
  };

  return (
    <div className="App">
      <Header onOpenModal={handleOpenAuth} />
      <Hero onOpenModal={handleCreateSurvey} onJoinClick={handleOpenCodeModal} />
      <Features />
      <HowItWorks />
      <Footer />
      
      <AuthWindow 
        isOpen={isAuthOpen}
        onClose={handleCloseAuth}
        onLogin={handleLogin}
      />
      
      {/* Модальное окно для ввода кода */}
      {isCodeModalOpen && (
        <div className="code-modal-overlay">
          <div className="code-modal" onClick={e => e.stopPropagation()}>
            <button className="code-modal-close" onClick={handleCloseCodeModal}>×</button>
            <h2>Ввести код опроса</h2>
            <form onSubmit={handleCodeSubmit}>
              <input
                type="text"
                className="code-input"
                placeholder="Введите код опроса"
                value={inputCode}
                onChange={e => setInputCode(e.target.value)}
                autoFocus
                required
                style={{ textTransform: 'uppercase' }}
              />
              {codeError && (
                <div className="error-message" style={{ color: 'red', marginTop: 8, fontSize: 14 }}>
                  {codeError}
                </div>
              )}
              <button 
                type="submit" 
                className="btn btn-primary" 
                style={{marginTop: 16}}
                disabled={isCodeLoading}
              >
                {isCodeLoading ? 'Проверка...' : 'Присоединиться'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default HomePage; 