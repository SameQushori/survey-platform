import React from 'react';
import { Navigate } from 'react-router-dom';
import firebaseAdminAuth from '../../utils/firebaseAdminAuth';

const ProtectedRoute = ({ children }) => {
  const isAuthenticated = firebaseAdminAuth.isAdminLoggedIn();
  
  if (!isAuthenticated) {
    // Перенаправляем на главную страницу, если пользователь не авторизован
    return <Navigate to="/" replace />;
  }
  
  return children;
};

export default ProtectedRoute; 
 