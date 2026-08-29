import React, { useEffect } from 'react';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage/HomePage';
import DashboardPage from './pages/DashboardPage/DashboardPage';
import ParticipantPage from './pages/ParticipantPage/ParticipantPage';
import TestPage from './pages/TestPage/TestPage';
import ProtectedRoute from './components/ProtectedRoute/ProtectedRoute';
import ProtectedParticipantRoute from './components/ProtectedParticipantRoute/ProtectedParticipantRoute';
import { testFirebaseConnection } from './utils/firebaseTest';
import './App.css';

function App() {
  useEffect(() => {
    // Тестируем подключение к Firebase при запуске
    const testConnection = async () => {
      const result = await testFirebaseConnection();
      if (result.success) {
        console.log('🎉 Firebase подключен успешно!');
      } else {
        console.error('🔥 Ошибка подключения к Firebase:', result.error);
      }
    };
    
    testConnection();
  }, []);

  return (
    <Router>
      <div className="App">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route 
            path="/dashboard" 
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/participant" 
            element={
              <ProtectedParticipantRoute>
                <ParticipantPage />
              </ProtectedParticipantRoute>
            } 
          />
          <Route path="/test" element={<TestPage />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
