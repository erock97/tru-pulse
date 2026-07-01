import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { myOrg, isDemo } from './lib/api';
import Login from './pages/Login';
import Onboarding from './pages/Onboarding';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';

type Org = { id: string; name: string; plan?: string };

const go = (path: string) => {
  window.location.hash = path;
};

function useHashRoute(): string {
  const [route, setRoute] = useState(() => window.location.hash.replace(/^#/, '') || '/');
  useEffect(() => {
    const on = () => setRoute(window.location.hash.replace(/^#/, '') || '/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export default function App() {
  const route = useHashRoute();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [org, setOrg] = useState<Org | null | undefined>(undefined);

  useEffect(() => {
    if (isDemo) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (isDemo || session === undefined) return;
    if (!session) {
      setOrg(null);
      return;
    }
    setOrg(undefined);
    myOrg().then((o) => setOrg(o));
  }, [session]);

  // The HQ shell: home (product cards) ↔ a product module (Pulse), by hash route.
  const shell = (o: { id: string; name: string }) =>
    route === '/pulse'
      ? <Dashboard org={o} onHome={() => go('/')} />
      : <Home org={o} onOpenPulse={() => go('/pulse')} />;

  if (isDemo) return shell({ id: 'demo', name: 'Sample Realty' });
  if (session === undefined || (session && org === undefined)) {
    return <div className="center-wrap"><div className="spinner" /></div>;
  }
  if (!session) return <Login />;
  if (!org) return <Onboarding onDone={() => myOrg().then((o) => setOrg(o))} />;
  return shell(org);
}
