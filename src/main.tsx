import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/react';

import VectaApp from './vecta/VectaApp';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element was not found');
}

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!clerkPublishableKey) {
  throw new Error('VITE_CLERK_PUBLISHABLE_KEY is not configured');
}

createRoot(rootElement).render(
  <StrictMode>
    <ClerkProvider publishableKey={clerkPublishableKey}>
      <VectaApp />
    </ClerkProvider>
  </StrictMode>,
);
