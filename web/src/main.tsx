import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import PublicSite from './site/PublicSite';
import { matchPublicRoute } from './lib/routes';
import { clearLegacyTokens } from './lib/clearLegacyTokens';
import './styles.css';

// Before anything renders, and on every load rather than only on sign-out — a user who
// never signs out is exactly the one still carrying a pre-cutover token.
clearLegacyTokens();

// /services and /about are marketing paths. Resolve them before App mounts so
// they never flash a login screen. "/" stays the product for signed-in users
// — matchPublicRoute never claims it. App renders the marketing home itself
// when signed out.
const publicRoute = matchPublicRoute(window.location.pathname, window.location.hash);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {publicRoute ? <PublicSite route={publicRoute} /> : <App />}
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
