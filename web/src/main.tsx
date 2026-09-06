import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import PublicSite from './site/PublicSite';
import { resolveView } from './lib/routes';
import { clearLegacyTokens } from './lib/clearLegacyTokens';
import './styles.css';
import './premiumInterior.css';

// Before anything renders, and on every load rather than only on sign-out — a user who
// never signs out is exactly the one still carrying a pre-cutover token.
clearLegacyTokens();

// Marketing paths resolve before App mounts so they never flash a login screen.
// "/" is the product on app.truhq.co and the marketing home on truhq.co, which
// is what `resolveView` decides from the host: App's signed-out face is the
// login door, correct for the app and catastrophic for the marketing site.
// Unknown paths come back as 'not-found' (truthy) so PublicSite renders a real
// 404 rather than dropping into App, which would show the homepage.
const publicRoute = resolveView(
  window.location.pathname,
  window.location.hash,
  window.location.host,
  window.location.search,
);
document.documentElement.classList.toggle('tru-premium', !publicRoute);

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
