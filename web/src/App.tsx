import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { myOrg, isDemo, adminLeaders, claimAgent, myAgent, type AdminLeader, type AgentIdentity } from './lib/api';
import Login from './pages/Login';
import Onboarding from './pages/Onboarding';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import Coach from './pages/Coach';
import Rep from './pages/Rep';
import AgentCourse from './pages/AgentCourse';
import SetPassword from './pages/SetPassword';

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
  // Invite / password-reset links land with a recovery|invite token in the URL hash.
  const [recovery, setRecovery] = useState<boolean>(
    () => typeof window !== 'undefined' && /type=(recovery|invite)/.test(window.location.hash),
  );

  useEffect(() => {
    if (isDemo) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
    });
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

  // Signed in but org-less → platform owner? (The worker verifies against the
  // admins table server-side; everyone else gets null → onboarding as before.)
  const [admin, setAdmin] = useState<AdminLeader[] | null | undefined>(undefined);
  useEffect(() => {
    if (isDemo || !session || org !== null) return;
    setAdmin(undefined);
    adminLeaders().then(setAdmin);
  }, [session, org]);

  // Not an org leader and not an admin? They may be an AGENT. Link this login to
  // their agent row (by verified email) and resolve it → the take-the-course view.
  const [agent, setAgent] = useState<AgentIdentity | null | undefined>(undefined);
  useEffect(() => {
    if (isDemo || !session || org !== null || admin !== null) return;
    setAgent(undefined);
    (async () => {
      await claimAgent();
      setAgent(await myAgent());
    })();
  }, [session, org, admin]);

  // The HQ shell: home (product cards) ↔ a product module (Pulse), by hash route.
  const shell = (o: { id: string; name: string }, adminLeaders?: AdminLeader[]) =>
    route === '/pulse'
      ? <Dashboard org={o} onHome={() => go('/')} />
      : route === '/coach'
        ? <Coach org={o} onHome={() => go('/')} />
      : route === '/rep'
        ? <Rep org={o} onHome={() => go('/')} />
        : <Home org={o} onOpenPulse={() => go('/pulse')} onOpenRep={() => go('/rep')} adminLeaders={adminLeaders} />;

  if (isDemo && route === '/learn') {
    return <AgentCourse agent={{ id: 'demo-agent', org_id: 'demo', name: 'Jordan Rivera', team_id: 'demo' }} />;
  }
  if (isDemo) return shell({ id: 'demo', name: 'Sample Realty' });
  if (recovery) {
    return (
      <SetPassword
        onDone={() => {
          setRecovery(false);
          if (typeof window !== 'undefined') history.replaceState(null, '', window.location.pathname);
        }}
      />
    );
  }
  if (session === undefined || (session && org === undefined)) {
    return <div className="center-wrap"><div className="spinner" /></div>;
  }
  if (!session) return <Login />;
  if (!org) {
    if (admin === undefined) return <div className="center-wrap"><div className="spinner" /></div>;
    if (admin) return shell({ id: 'hq', name: 'TRU HQ' }, admin);
    if (agent === undefined) return <div className="center-wrap"><div className="spinner" /></div>;
    if (agent) return <AgentCourse agent={agent} />;
    return <Onboarding onDone={() => myOrg().then((o) => setOrg(o))} />;
  }
  // Impersonated session → the shell's sidebar carries the "Exit — switch teams"
  // control (adminReturn drops the owner back to their HQ act-as picker).
  return shell(org);
}
