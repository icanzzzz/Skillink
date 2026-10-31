import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { I18nProvider } from './i18n.js';
import './styles.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Missing #root element');
}

createRoot(container).render(
  <React.StrictMode>
    <I18nProvider api={window.skillink}>
      <App />
    </I18nProvider>
  </React.StrictMode>,
);
