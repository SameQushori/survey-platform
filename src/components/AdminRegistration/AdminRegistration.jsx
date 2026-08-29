import React, { useState } from 'react';
import firebaseAdminAuth from '../../utils/firebaseAdminAuth';
import './AdminRegistration.css';

const AdminRegistration = ({ isOpen, onClose, onSuccess }) => {
  const [formData, setFormData] = useState({
    login: '',
    password: '',
    confirmPassword: '',
    name: ''
  });
  const [errors, setErrors] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    // Очищаем ошибки при вводе
    if (errors.length > 0) {
      setErrors([]);
    }
  };

  const validateForm = () => {
    const newErrors = [];

    if (!formData.login.trim()) {
      newErrors.push('Введите логин');
    } else if (formData.login.trim().length < 3) {
      newErrors.push('Логин должен содержать минимум 3 символа');
    } else if (!/^[a-zA-Z0-9_]+$/.test(formData.login)) {
      newErrors.push('Логин может содержать только буквы, цифры и знак подчеркивания');
    }

    if (!formData.password) {
      newErrors.push('Введите пароль');
    } else if (formData.password.length < 6) {
      newErrors.push('Пароль должен содержать минимум 6 символов');
    }

    if (formData.password !== formData.confirmPassword) {
      newErrors.push('Пароли не совпадают');
    }

    if (!formData.name.trim()) {
      newErrors.push('Введите имя организатора');
    } else if (formData.name.trim().length < 2) {
      newErrors.push('Имя должно содержать минимум 2 символа');
    }

    setErrors(newErrors);
    return newErrors.length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setIsLoading(true);
    setErrors([]);

    try {
      const currentAdmin = firebaseAdminAuth.getCurrentAdmin();
      if (!currentAdmin) {
        throw new Error('Необходимо войти в систему');
      }

      const result = await firebaseAdminAuth.registerOrganizer(
        formData.login,
        formData.password,
        formData.name,
        currentAdmin.id
      );

      setSuccessMessage('Организатор успешно создан!');
      
      // Очищаем форму
      setFormData({
        login: '',
        password: '',
        confirmPassword: '',
        name: ''
      });

      // Вызываем callback успеха
      if (onSuccess) {
        onSuccess(result.admin);
      }

      // Закрываем модальное окно через 2 секунды
      setTimeout(() => {
        onClose();
        setSuccessMessage('');
      }, 2000);

    } catch (error) {
      setErrors([error.message]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (!isLoading) {
      setFormData({
        login: '',
        password: '',
        confirmPassword: '',
        name: ''
      });
      setErrors([]);
      setSuccessMessage('');
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="admin-registration-overlay">
      <div className="admin-registration-modal">
        <button className="admin-registration-close" onClick={handleClose}>
          ×
        </button>

        <div className="admin-registration-content">
          <h2>Создание организатора</h2>
          <p className="admin-registration-subtitle">
            Создайте нового организатора для управления опросами
          </p>

          {successMessage && (
            <div className="success-message">
              {successMessage}
            </div>
          )}

          {errors.length > 0 && (
            <div className="error-message">
              {errors.map((error, index) => (
                <p key={index}>{error}</p>
              ))}
            </div>
          )}

          <form onSubmit={handleSubmit} className="admin-registration-form">
            <div className="form-group">
              <label htmlFor="name">Имя организатора *</label>
              <input
                type="text"
                id="name"
                name="name"
                className={`form-input ${errors.includes('Введите имя организатора') ? 'error' : ''}`}
                placeholder="Введите имя организатора"
                value={formData.name}
                onChange={handleInputChange}
                disabled={isLoading}
              />
              {errors.includes('Введите имя организатора') && <span className="error-text">{'Введите имя организатора'}</span>}
            </div>

            <div className="form-group">
              <label htmlFor="login">Логин *</label>
              <input
                type="text"
                id="login"
                name="login"
                className={`form-input ${errors.includes('Введите логин') ? 'error' : ''}`}
                placeholder="Введите логин (минимум 3 символа)"
                value={formData.login}
                onChange={handleInputChange}
                disabled={isLoading}
              />
              {errors.includes('Введите логин') && <span className="error-text">{'Введите логин'}</span>}
            </div>

            <div className="form-group">
              <label htmlFor="password">Пароль *</label>
              <input
                type="password"
                id="password"
                name="password"
                className={`form-input ${errors.includes('Введите пароль') ? 'error' : ''}`}
                placeholder="Минимум 6 символов"
                value={formData.password}
                onChange={handleInputChange}
                disabled={isLoading}
              />
              {errors.includes('Введите пароль') && <span className="error-text">{'Введите пароль'}</span>}
            </div>

            <div className="form-group">
              <label htmlFor="confirmPassword">Подтвердите пароль *</label>
              <input
                type="password"
                id="confirmPassword"
                name="confirmPassword"
                className={`form-input ${errors.includes('Пароли не совпадают') ? 'error' : ''}`}
                placeholder="Повторите пароль"
                value={formData.confirmPassword}
                onChange={handleInputChange}
                disabled={isLoading}
              />
              {errors.includes('Пароли не совпадают') && <span className="error-text">{'Пароли не совпадают'}</span>}
            </div>

            <div className="form-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleClose}
                disabled={isLoading}
              >
                Отмена
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isLoading}
              >
                {isLoading ? 'Создание...' : 'Создать организатора'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AdminRegistration; 