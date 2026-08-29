import React, { useState, useEffect } from 'react';
import './AuthWindow.css';
import logo from '../../assets/img/logo.png';
import firebaseAdminAuth from '../../utils/firebaseAdminAuth';

const AuthWindow = ({ isOpen, onClose, onLogin }) => {
  const [currentRole, setCurrentRole] = useState(null);
  const [showAuthForm, setShowAuthForm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [formData, setFormData] = useState({
    login: '',
    password: '',
    name: ''
  });

  // Сброс состояния при закрытии модального окна
  useEffect(() => {
    if (!isOpen) {
      setCurrentRole(null);
      setShowAuthForm(false);
      setFormData({ login: '', password: '', name: '' });
      setAuthError('');
    }
  }, [isOpen]);

  const selectRole = (role) => {
    setCurrentRole(role);
    setShowAuthForm(true);
    setAuthError('');
  };

  const goBack = () => {
    setShowAuthForm(false);
    setCurrentRole(null);
    setFormData({ login: '', password: '', name: '' });
    setAuthError('');
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    
    // Очищаем ошибку при вводе
    if (authError) {
      setAuthError('');
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setAuthError('');

    try {
      if (currentRole === 'organizer') {
        const { login, password } = formData;
        
        // Валидация полей
        if (!login.trim() || !password.trim()) {
          throw new Error('Пожалуйста, заполните все поля');
        }

        // Проверяем авторизацию через систему администраторов
        const result = firebaseAdminAuth.loginAdmin(login, password);
        
        console.log('Organizer login successful:', result.admin);
        
        if (onLogin) {
          onLogin({ 
            role: 'organizer', 
            login, 
            admin: result.admin,
            session: result.session 
          });
        }
      } else {
        const { name } = formData;
        
        // Валидация имени участника
        if (!name.trim()) {
          throw new Error('Пожалуйста, введите ваше имя');
        }
        
        if (name.trim().length < 2) {
          throw new Error('Имя должно содержать минимум 2 символа');
        }

        console.log('Participant login:', { name });
        
        if (onLogin) {
          onLogin({ role: 'participant', name: name.trim() });
        }
      }

      // Закрываем модальное окно после успешной авторизации
      onClose();
    } catch (error) {
      console.error('Login error:', error);
      setAuthError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && isOpen) {
        if (currentRole) {
          goBack();
        } else {
          onClose();
        }
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      // Блокируем прокрутку body при открытом модальном окне
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, currentRole]);

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      // Закрываем окно только если мы на экране выбора роли
      if (!showAuthForm) {
        onClose();
      }
    }
  };

  const renderRoleInfo = () => {
    if (currentRole === 'organizer') {
      return (
        <div className="role-info">
          <strong>Организатор:</strong> Войдите с помощью логина и пароля для доступа к административной панели
        </div>
      );
    } else {
      return (
        <div className="role-info">
          <strong>Участник:</strong> Введите ваше имя для быстрого входа в систему
        </div>
      );
    }
  };

  const renderFormFields = () => {
    if (currentRole === 'organizer') {
      return (
        <>
          <div className="form-group">
            <label htmlFor="login">Логин</label>
            <input
              type="text"
              id="login"
              name="login"
              className="form-input"
              placeholder="Введите ваш логин"
              value={formData.login}
              onChange={handleInputChange}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">Пароль</label>
            <input
              type="password"
              id="password"
              name="password"
              className="form-input"
              placeholder="Введите пароль"
              value={formData.password}
              onChange={handleInputChange}
              required
            />
          </div>
        </>
      );
    } else {
      return (
        <div className="form-group">
          <label htmlFor="name">Имя</label>
          <input
            type="text"
            id="name"
            name="name"
            className="form-input"
            placeholder="Введите ваше имя"
            value={formData.name}
            onChange={handleInputChange}
            required
          />
        </div>
      );
    }
  };

  if (!isOpen) return null;

  return (
    <div className="auth-modal-overlay" onClick={handleOverlayClick}>
      <div className="auth-container">
        <button className="auth-close-btn" onClick={onClose}>
          ×
        </button>
        
        <div className="logo-img-wrapper">
          <img src={logo} alt="Logo" className="logo-img" />
        </div>
        
        {!showAuthForm ? (
          <div className="welcome-screen fade-in">
            <h1 className="title">Добро пожаловать!</h1>
            <p className="subtitle">Выберите свою роль для входа в систему</p>
            
            <div className="role-selection">
              <div className="role-buttons">
                <button 
                  className="role-btn" 
                  onClick={() => selectRole('organizer')}
                >
                  Организатор
                </button>
                <button 
                  className="role-btn" 
                  onClick={() => selectRole('participant')}
                >
                  Участник
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="form-container fade-in">
            {renderRoleInfo()}
            
            {authError && (
              <div className="auth-error-message">
                {authError}
              </div>
            )}
            
            <form onSubmit={handleLogin}>
              {renderFormFields()}
              <button 
                type="submit" 
                className="login-btn" 
                disabled={isLoading}
              >
                {isLoading ? 'Вход...' : `Войти как ${currentRole === 'organizer' ? 'организатор' : 'участник'}`}
              </button>
            </form>
            
            <button 
              onClick={goBack}
              className="back-btn"
            >
              ← Вернуться к выбору роли
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuthWindow; 