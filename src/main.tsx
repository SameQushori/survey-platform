import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import VectaApp from './vecta/VectaApp';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element was not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <VectaApp />
  </StrictMode>,
);
