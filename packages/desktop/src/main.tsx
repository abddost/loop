// Must be imported first to ensure Tailwind layers and style foundations are defined
import './index.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppsSDKUIProvider } from '@openai/apps-sdk-ui/components/AppsSDKUIProvider';
import { initializeTheme } from './lib/theme';
import App from './App';

// Apply persisted theme before first render to avoid flash
initializeTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppsSDKUIProvider>
      <App />
    </AppsSDKUIProvider>
  </StrictMode>,
);
