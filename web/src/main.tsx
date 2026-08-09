import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import PublicSite from './site/PublicSite';
import { matchPublicRoute } from './lib/routes';
import './styles.css';

// The marketing site owns six real paths (/services, /work, /apply, and the
// three policies). They are resolved HERE, before App mounts, so those pages
// render instantly with no Supabase session lookup and no auth flash — and so
// App's hooks are never conditionally skipped.
//
// "/" is deliberately NOT matched: the product lives at "/" plus a hash route.
// Claiming root here would show every logged-in customer the marketing page
// instead of their dashboard. App renders the marketing home itself, inside its
// existing signed-out branch.
const publicRoute = matchPublicRoute(window.location.pathname, window.location.hash);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {publicRoute ? <PublicSite route={publicRoute} /> : <App />}
  </React.StrictMode>,
);
