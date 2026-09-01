import { useEffect, useRef, useState } from 'react';
import { onAuthChange, onPasswordRecovery, exchangeLink, signOut, type AuthState } from './lib/auth';
import { redeemLink } from './lib/redeemLink';
import { myOrg, isDemo, adminLeaders, claimAgent, myAgent, type AdminLeader, type AgentIdentity } from './lib/api';
import { userIdOf, identityChanged } from './lib/authIdentity';
import { isCoachRoute, parseCoachAgentId, parseCoachView, coachRoute, coachProfileRoute } from './lib/coachRoute';
import Login from './pages/Login';
import Onboarding from './pages/Onboarding';
import Home from './pages/Home';
import AdminTeams from './pages/AdminTeams';
import AdminAutomations from './pages/AdminAutomations';
import AdminTargets from './pages/AdminTargets';
import AdminRevenue from './pages/AdminRevenue';
import AdminContracts from './pages/AdminContracts';
import TeamAdmin from './pages/TeamAdmin';
import PulseLab from './pages/PulseLab';
import Lab from './pages/Lab';
import RosterDeck from './pages/RosterDeck';
import Dashboard from './pages/Dashboard';
import Coach from './pages/Coach';
import Rep from './pages/Rep';
import AgentHq from './pages/AgentHq';
import DeckPreview from './pages/DeckPreview';
import SetPassword from './pages/SetPassword';
import Assess from './pages/Assess';
import ConfirmClosings from './pages/ConfirmClosings';
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
  // True from the moment we spot an invite token until the exchange settles.
  //
  // Without this the set-password screen renders against whatever session the
  // browser already had, and someone who was signed in as their team leader sees
  // THAT person's address locked into their own signup form. It corrects itself a
  // moment later, but "a moment later" is after they have read it and decided the
  // invite is broken — and long enough to submit the form believing they are
  // changing somebody else's password.
  const [exchanging, setExchanging] = useState(false);
  // Set when an invite or reset link could not be redeemed. Shown on the login
  // screen, because silently landing on a sign-in form reads as "the link did
  // nothing" and people click it again until it truly expires.
  const [linkFailed, setLinkFailed] = useState(false);
  // The address the redeemed link belongs to, straight from the server. The
  // set-password screen names the account from THIS, not from "who am I?" —
  // those are different questions and the answers can disagree.
  const [linkEmail, setLinkEmail] = useState<string | null>(null);

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
      setExchanging(true);
      // END ANY EXISTING SESSION FIRST. This is the important line.
      //
      // Clicking an invite or reset link is a claim about who you are, and it can
      // land in a browser already signed in as somebody else — an agent opening
      // their invite on a laptop where their team leader is logged in, which is
      // an ordinary Tuesday in a real estate office.
      //
      // Without this, the exchange could verify the token (recording a sign-in
      // for the invited person) and still fail to establish their session, and
      // the failure was swallowed by the catch below. The set-password screen
      // then rendered against the LEADER's session and set the password on the
      // leader's account. That happened, on the first real invite: the token was
      // verified at 01:13:02, no password ever reached the invited account, and
      // the person setting it landed in the other account's view afterwards.
      //
      // Signing out first removes the whole class of bug. The worst case becomes
      // "the link failed and you are signed out", which is recoverable and
      // obvious, instead of "you silently changed someone else's password".
      void redeemLink(signOut, async () => { setLinkEmail(await exchangeLink(tokenHash, type)); })
        .then((ok) => {
          if (ok) return;
          // An expired or already-used link. They are now signed out, which is
          // the correct place to be — not inside whoever was here before.
          setRecovery(false);
          setLinkFailed(true);
        })
        .finally(() => setExchanging(false));
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
    // The owner's own screens come FIRST in this chain and are gated on
    // adminLeaders being non-null — which only happens when the Worker answered
    // /admin/leaders with 200. A team lead who types #/admin/agents falls
    // straight through to their roster, because for them this is undefined.
    adminLeaders && route === '/admin/agents'
      ? <AdminAutomations
          onOpenPulse={() => go('/pulse')}
          onOpenCoach={() => go('/coach')}
          onOpenRep={() => go('/rep')}
        />
    : adminLeaders && route === '/admin/targets'
      ? <AdminTargets
          onOpenPulse={() => go('/pulse')}
          onOpenCoach={() => go('/coach')}
          onOpenRep={() => go('/rep')}
        />
    : adminLeaders && route === '/admin/revenue'
      ? <AdminRevenue
          onOpenPulse={() => go('/pulse')}
          onOpenCoach={() => go('/coach')}
          onOpenRep={() => go('/rep')}
        />
    : adminLeaders && route === '/admin/contracts'
      ? <AdminContracts
          onOpenPulse={() => go('/pulse')}
          onOpenCoach={() => go('/coach')}
          onOpenRep={() => go('/rep')}
        />
    : adminLeaders && (route === '/' || route === '/pulse' || route === '/admin')
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
            openView={parseCoachView(route)}
            onOpenAgent={(id) => go(coachRoute(id))}
            onOpenProfile={(id) => go(coachProfileRoute(id))}
          />
        )
      : route === '/rep'
        ? <Rep org={o} onHome={() => go('/')} />
      // Who is on the platform at all. One screen, so "invite" stops being a
      // control scattered through Coach, Rep and the agent drill-down.
      : route === '/team'
        ? <TeamAdmin org={o} onHome={() => go('/')} />
      // A mock of a different Pulse. Deliberately NOT in the sidebar — it is
      // reachable only by typing the route, so production Pulse is untouched
      // while this is being judged.
      : route === '/pulse/lab'
        ? <PulseLab org={o} onHome={() => go('/')} />
      // Design concepts, on live data. Not linked from anywhere.
      : route === '/lab'
        ? <Lab org={o} onHome={() => go('/')} />
        : <RosterDeck orgName={o.name} onOpenPulse={() => go('/pulse')} onOpenCoach={() => go('/coach')} onOpenRep={() => go('/rep')} />;

  // Public broker closing-confirmation link (#/confirm?t=<round_token>) — no
  // auth, no org. Mounted before every auth check, same as /assess below: the
  // token in the link IS the credential, and the person holding it has no
  // account here by design.
  if (route.startsWith('/confirm')) {
    const q = new URLSearchParams(window.location.hash.split('?')[1] || '');
    return <ConfirmClosings token={q.get('t') ?? ''} />;
  }

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
  if (recovery && exchanging) {
    // Hold the door until we know whose session this is. See `exchanging` above.
    return <div className="center-wrap"><div className="spinner" /></div>;
  }
  if (recovery) {
    return (
      <SetPassword
        linkEmail={linkEmail}
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
    return <Login linkFailed={linkFailed} />;
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
