import { useEffect, useRef, useState } from 'react';
import { onAuthChange, onPasswordRecovery, exchangeLink, type AuthState } from './lib/auth';
import { myOrg, isDemo, adminLeaders, claimAgent, myAgent, type AdminLeader, type AgentIdentity } from './lib/api';
import { userIdOf, identityChanged } from './lib/authIdentity';
import { isCoachRoute, parseCoachAgentId, coachRoute } from './lib/coachRoute';
import Login from './pages/Login';
import Onboarding from './pages/Onboarding';
import Home from './pages/Home';
import AdminTeams from './pages/AdminTeams';
import TeamAdmin from './pages/TeamAdmin';
import RosterDeck from './pages/RosterDeck';
import Dashboard from './pages/Dashboard';
import Coach from './pages/Coach';
import Rep from './pages/Rep';
import AgentHq from './pages/AgentHq';
import DeckPreview from './pages/DeckPreview';
import SetPassword from './pages/SetPassword';
import Assess from './pages/Assess';
import { parseDeckRoute } from './lib/deckRoute';

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

  // Land at the top of every page.
  //
  // Without this the browser keeps whatever scroll position you had, so
  // switching from a short page to a long one drops you into the middle of it.
  // It also made the fixed backdrop look like it MOVED between tabs — the
  // room never shifted, the content had slid up underneath it. Measured:
  // Pulse landed at 37px, Coach at 122px, Rep at 600px.
  useEffect(() => { window.scrollTo(0, 0); }, [route]);

  return route;
}

export default function App() {
  const route = useHashRoute();
  const [session, setSession] = useState<AuthState | null | undefined>(undefined);
  const [org, setOrg] = useState<Org | null | undefined>(undefined);
  // Invite / password-reset links land with a recovery|invite token in the URL hash.
  const [recovery, setRecovery] = useState<boolean>(
    () => typeof window !== 'undefined' && /type=(recovery|invite)/.test(window.location.hash),
  );

  // The signed-in user id we have already reacted to. A ref, not state, so a
  // token refresh cannot schedule a render on its own.
  const seenUserId = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (isDemo) return;
    // An invite or reset link lands with a one-time token in the URL. We redeem it
    // explicitly against the Worker, which swallows it and turns it into a server-side
    // session — so the token never becomes something this page holds.
    //
    // Supabase puts these in the query string on some link types and in the hash on
    // others, so read both rather than betting on one and silently dropping invites.
    const hash = new URLSearchParams(window.location.hash.replace(/^#\/?/, ''));
    const query = new URLSearchParams(window.location.search);
    const tokenHash = query.get('token_hash') ?? hash.get('token_hash');
    const type = query.get('type') ?? hash.get('type');
    if (tokenHash && type) {
      // Strip it from the address bar first: a one-time token sitting in history
      // (or in a shared screenshot) outlives the moment it was meant for.
      history.replaceState(null, '', window.location.pathname);
      setRecovery(type === 'recovery' || type === 'invite');
      exchangeLink(tokenHash, type)
        .catch(() => { /* an expired link just leaves them on the login screen */ });
    }
    const unsubscribe = onAuthChange((s) => {
      // Only publish the session when the PERSON changed. Tab-focus token
      // refreshes land here constantly with a new object for the same user;
      // publishing those unmounts whatever the leader is in the middle of.
      if (identityChanged(seenUserId.current, userIdOf(s))) setSession(s);
    });
    const stopRecovery = onPasswordRecovery(() => setRecovery(true));
    return () => { unsubscribe(); stopRecovery(); };
  }, []);

  useEffect(() => {
    if (isDemo || session === undefined) return;
    const nextUserId = userIdOf(session);
    if (!identityChanged(seenUserId.current, nextUserId)) return;
    seenUserId.current = nextUserId;
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

  // The HQ shell, by hash route. Landing on the roster rather than a page of
  // product cards: Home showed the same nine people a second time and cost a
  // click before anything real. `/home` still resolves so the platform-owner
  // "act as team" tile is not lost, and `/pulse/detail` keeps the old
  // lead-by-lead view reachable while the roster proves itself.
  const shell = (o: { id: string; name: string }, adminLeaders?: AdminLeader[]) =>
    // A platform owner has no org of their own, so there is no roster to put
    // in front of them. They get the Admin tab — their own screen, in the same
    // shell as everything else, rather than the retired Home page.
    adminLeaders && (route === '/' || route === '/pulse' || route === '/admin')
      ? <AdminTeams
          leaders={adminLeaders}
          onOpenPulse={() => go('/pulse')}
          onOpenCoach={() => go('/coach')}
          onOpenRep={() => go('/rep')}
        />
    : route === '/pulse/detail'
      ? <Dashboard org={o} onHome={() => go('/')} />
      : route === '/home'
      ? <Home org={o} onOpenPulse={() => go('/pulse')} onOpenRep={() => go('/rep')} adminLeaders={adminLeaders} />
      // `/deck` is NOT listed here on purpose — it belongs to the Zillow slide
      // preview (parseDeckRoute), which is matched earlier.
      : route === '/pulse' || route === '/'
      ? <RosterDeck orgName={o.name} onOpenPulse={() => go('/pulse')} onOpenCoach={() => go('/coach')} onOpenRep={() => go('/rep')} />
      : isCoachRoute(route)
        ? (
          <Coach
            org={o}
            onHome={() => go('/')}
            openAgentId={parseCoachAgentId(route)}
            onOpenAgent={(id) => go(coachRoute(id))}
          />
        )
      : route === '/rep'
        ? <Rep org={o} onHome={() => go('/')} />
      // Who is on the platform at all. One screen, so "invite" stops being a
      // control scattered through Coach, Rep and the agent drill-down.
      : route === '/team'
        ? <TeamAdmin org={o} onHome={() => go('/')} />
        : <RosterDeck orgName={o.name} onOpenPulse={() => go('/pulse')} onOpenCoach={() => go('/coach')} onOpenRep={() => go('/rep')} />;

  // Public assessment link (#/assess?t=<join_token>) — no auth, no org.
  const assessToken = (() => {
    if (!route.startsWith('/assess')) return null;
    const q = new URLSearchParams(window.location.hash.split('?')[1] || '');
    return q.get('t');
  })();
  if (route.startsWith('/assess')) {
    return <Assess token={assessToken ?? ''} />;
  }

  // Public native-slide look: ?demo=1#/deck/zillow-day2/1 (no auth).
  const deck = parseDeckRoute(route);
  if (deck) {
    return <DeckPreview deck={deck.deck} n={deck.n} />;
  }

  if (isDemo && (route === '/learn' || route.startsWith('/learn/'))) {
    return <AgentHq agent={{ id: 'demo-agent', org_id: 'demo', name: 'Jordan Rivera', team_id: 'demo' }} />;
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
  if (!session) {
    // Signed out on the APP host means one thing: you came here to sign in.
    //
    // This used to render the marketing home instead, which was a trap. The
    // marketing site's "Client log in" points at this host's bare root, so the
    // moment a session expired that button could only reload a marketing page
    // — solid black for the first seconds while a 3MB hero video loads — with
    // no route to the form from it. Marketing lives at truhq.co; this host is
    // the product, and its signed-out face is the door.
    return <Login />;
  }
  if (!org) {
    if (admin === undefined) return <div className="center-wrap"><div className="spinner" /></div>;
    if (admin) return shell({ id: 'hq', name: 'TRU HQ' }, admin);
    if (agent === undefined) return <div className="center-wrap"><div className="spinner" /></div>;
    if (agent) return <AgentHq agent={agent} />;
    return <Onboarding onDone={() => myOrg().then((o) => setOrg(o))} />;
  }
  // Impersonated session → the shell's sidebar carries the "Exit — switch teams"
  // control (adminReturn drops the owner back to their HQ act-as picker).
  return shell(org);
}
