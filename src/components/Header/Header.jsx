import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import firebaseAdminAuth from '../../utils/firebaseAdminAuth';
import './Header.css';

const Header = ({ onOpenModal }) => {
  const navigate = useNavigate();
  const [currentAdmin, setCurrentAdmin] = useState(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Функция для проверки состояния авторизации
  const checkAuthStatus = () => {
    const admin = firebaseAdminAuth.getCurrentAdmin();
    const loggedIn = firebaseAdminAuth.isAdminLoggedIn();
    
    setCurrentAdmin(admin);
    setIsLoggedIn(loggedIn);
    
    console.log('Header: Проверка авторизации', { admin, loggedIn });
  };

  useEffect(() => {
    // Проверяем состояние авторизации при загрузке
    checkAuthStatus();

    // Слушаем изменения в localStorage
    const handleStorageChange = (e) => {
      if (e.key === 'current_admin' || e.key === null) {
        checkAuthStatus();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    
    // Также проверяем при фокусе на окне (если пользователь переключился между вкладками)
    window.addEventListener('focus', checkAuthStatus);

    // Проверяем каждую секунду для быстрого обновления
    const interval = setInterval(checkAuthStatus, 1000);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('focus', checkAuthStatus);
      clearInterval(interval);
    };
  }, []);

  const handleLogout = () => {
    firebaseAdminAuth.logout();
    setIsLoggedIn(false);
    setCurrentAdmin(null);
    navigate('/');
  };

  const handleDashboardClick = () => {
    navigate('/dashboard');
  };

  const handleCreateSurvey = () => {
    // Проверяем, авторизован ли пользователь
    const currentAdmin = firebaseAdminAuth.getCurrentAdmin();
    
    if (currentAdmin && firebaseAdminAuth.isAdminLoggedIn()) {
      // Если пользователь уже авторизован, перенаправляем на дашборд
      navigate('/dashboard');
    } else {
      // Если не авторизован, открываем окно авторизации
      onOpenModal();
    }
  };

  return (
    <header className="header">
      <div className="header-content">
        <a href="/" className="logo">
          <div className="logo-icon-wrapper">
            <img src="src\assets\img\logo.png" alt="#" className="logo-icon" />
          </div>
          Oprosnik
        </a>
        <div className="nav-buttons">
          {isLoggedIn ? (
            <>
              <button className="btn btn-outline" onClick={handleDashboardClick}>
                Личный кабинет
              </button>
              <button className="btn btn-primary" onClick={handleLogout}>
                Выйти
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-outline" onClick={onOpenModal}>
                Войти
              </button>
              <button className="btn btn-primary" onClick={handleCreateSurvey}>
                Начать
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header; 