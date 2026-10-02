// The dashboard. Settings sync first (@shared/settings.js, which the pixel office
// uses too), then the look you saved, then the app.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { startSettingsSync } from '@shared/settings.js';
import './styles/app.css';
import { queryClient } from './data/queries';
import { applyAppearance } from './lib/appearance';
import { App, startApp } from './app/App';

startSettingsSync();
applyAppearance();
startApp();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
