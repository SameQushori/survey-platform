import React from 'react';

const ProtectedParticipantRoute = ({ children }) => {
  // For participant routes, we don't need authentication
  // Participants can access surveys directly via code
  return children;
};

export default ProtectedParticipantRoute; 