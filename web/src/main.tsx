import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Register the service worker so Android offers a real "Install app" prompt
// (standalone window, own icon, own entry in the app switcher) rather than a
// home-screen bookmark. PROD only — in dev it would sit in front of Vite's HMR.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Installability is a nice-to-have; the app must work regardless.
    });
  });
}
