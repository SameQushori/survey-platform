import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import firebaseAdminAuth from '../../utils/firebaseAdminAuth';
import AdminRegistration from '../AdminRegistration/AdminRegistration';
import './AdminManagement.css';

const AdminManagement = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const [organizers, setOrganizers] = useState([]);
  const [isRegistrationOpen, setIsRegistrationOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [visiblePasswords, setVisiblePasswords] = useState({});

  useEffect(() => {
    if (isOpen) {
      loadOrganizers();
    }
  }, [isOpen]);

  const loadOrganizers = async () => {
    try {
      setIsLoading(true);
      setError('');
      const organizersList = await firebaseAdminAuth.getOrganizersWithPasswords();
      setOrganizers(organizersList);
    } catch (error) {
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenRegistration = () => {
    setIsRegistrationOpen(true);
  };

  const handleCloseRegistration = () => {
    setIsRegistrationOpen(false);
  };

  const handleRegistrationSuccess = (newOrganizer) => {
    // Обновляем список организаторов
    loadOrganizers();
    setIsRegistrationOpen(false);
  };

  const handleDeleteOrganizer = async (organizerId) => {
    if (window.confirm('Вы уверены, что хотите удалить этого организатора?')) {
      try {
        await firebaseAdminAuth.deleteAdmin(organizerId);
        await loadOrganizers();
      } catch (error) {
        setError(error.message);
      }
    }
  };

  const handleGoHome = () => {
    navigate('/');
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString('ru-RU');
  };

  const togglePasswordVisibility = (organizerId) => {
    setVisiblePasswords(prev => ({
      ...prev,
      [organizerId]: !prev[organizerId]
    }));
  };

  const handleClose = () => {
    setOrganizers([]);
    setError('');
    setVisiblePasswords({});
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="admin-management-overlay">
        <div className="admin-management-modal" onClick={e => e.stopPropagation()}>
          <button className="admin-management-close" onClick={handleClose}>
            ×
          </button>

          <div className="admin-management-content">
            <div className="admin-management-header-actions">
              <h2>Управление организаторами</h2>
              <button className="btn btn-outline" onClick={handleGoHome}>
                ← Вернуться на главную
              </button>
            </div>
            <p className="admin-management-subtitle">
              Просмотр и управление организаторами системы
            </p>

            {error && (
              <div className="error-message">
                {error}
              </div>
            )}

            {!error && (
              <div className="admin-management-header">
                <button 
                  className="btn btn-primary"
                  onClick={handleOpenRegistration}
                >
                  + Добавить организатора
                </button>
              </div>
            )}

            {isLoading ? (
              <div className="loading-message">
                Загрузка списка организаторов...
              </div>
            ) : (
              <div className="admins-list">
                {organizers.length === 0 ? (
                  <div className="empty-state">
                    <p>Организаторы не найдены</p>
                    <p>Добавьте первого организатора для начала работы</p>
                  </div>
                ) : (
                  organizers.map(organizer => (
                    <div key={organizer.id} className="admin-card">
                      <div className="admin-info">
                        <div className="admin-main-info">
                          <h3>{organizer.name}</h3>
                          <p className="admin-email">Логин: {organizer.login}</p>
                          <div className="admin-password">
                            <span className="password-label">Пароль: </span>
                            <button 
                              className="password-toggle-btn"
                              onClick={() => togglePasswordVisibility(organizer.id)}
                              type="button"
                            >
                              {visiblePasswords[organizer.id] ? '👁️' : '🙈'}
                            </button>
                            <span className={`password-value ${visiblePasswords[organizer.id] ? 'visible' : 'hidden'}`}>
                              {visiblePasswords[organizer.id] ? organizer.password : '••••••••'}
                            </span>
                          </div>
                        </div>
                        <div className="admin-meta">
                          <span className="admin-status">
                            {organizer.isActive ? 'Активен' : 'Неактивен'}
                          </span>
                          <span className="admin-date">
                            Создан: {formatDate(organizer.createdAt)}
                          </span>
                        </div>
                      </div>
                      <div className="admin-actions">
                        <button
                          className="btn btn-danger"
                          onClick={() => handleDeleteOrganizer(organizer.id)}
                        >
                          Удалить
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <AdminRegistration
        isOpen={isRegistrationOpen}
        onClose={handleCloseRegistration}
        onSuccess={handleRegistrationSuccess}
      />
    </>
  );
};

export default AdminManagement; 
 