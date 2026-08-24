import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { adminActAs, isDemo, signOutClean, type AdminLeader } from '../lib/api';
import { FubConnect } from '../components/FubConnect';
import { AdminConnections } from '../components/AdminConnections';
import { AdminIntake } from '../components/AdminIntake';
import { HqShell } from '../components/hqShell';
import { Icon, Ring } from '../components/hqUi';
import { useReveal, useCountUp } from '../hqHooks';
import '../truHqDark.css';

/* ============================================================
   HOME — dark asymmetric BENTO command center.
   Reskin of the TRU HQ home to match the finished mockup, wired
   to the REAL data + callbacks (org.name, product-open routing,
   openCoach SSO bridge, FubConnect, AdminConnections, act-as).
   PRESENTATION ONLY — no auth/data logic changed.
   ============================================================ */

/* ---- mini gold sparkline that bleeds off the Pulse tile ---- */
function GciSpark() {
  const pts = [18, 22, 20, 27, 25, 33, 31, 40, 48];
  const w = 300;
  const h = 90;
  const max = 52;
  const x = (i: number) => (i * w) / (pts.length - 1);
  const y = (v: number) => h - (v / max) * h;
  const line = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(v)}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  return (
    <svg className="hh-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="hhSparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--accent-soft)" />
          <stop offset="1" stopColor="transparent" />
        </linearGradient>
        <linearGradient id="hhSparkLine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent-hi)" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#hhSparkFill)" />
      <path d={line} fill="none" stroke="url(#hhSparkLine)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])} r="4" fill="var(--accent-hi)" />
    </svg>
  );
}

/* ---- tiny upward arc corner accent ---- */
function TinyArc() {
  return (
    <svg className="hh-arc" viewBox="0 0 120 40" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="hhArc" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent-hi)" />
        </linearGradient>
      </defs>
      <path d="M2 34 Q40 30 60 20 T118 4" fill="none" stroke="url(#hhArc)" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="118" cy="4" r="3.5" fill="var(--accent-hi)" />
    </svg>
  );
}

/* ---- slim progress arc/bar accent (Rep certification) ---- */
function ProgressArc({ pct }: { pct: number }) {
  return (
    <div className="hh-progress" aria-hidden>
      <div className="hh-progress-track">
        <span className="hh-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="hh-progress-cap">{pct}% certified</span>
    </div>
  );
}

/* ---- count-up mini stat used inside the Pulse tile ---- */
function GciCount() {
  const { ref, val } = useCountUp(392);
  return (
    <span className="hh-feat-stat-num">
      $<span ref={ref}>{val}</span>k
    </span>
  );
}

/* ---- curved SVG divider ---- */
function DividerWave() {
  return (
    <div className="ps-divider hh-divider" aria-hidden>
      <svg viewBox="0 0 1200 60" preserveAspectRatio="none">
        <path d="M0 40 C 200 10, 420 55, 640 30 S 1050 5, 1200 34 L1200 60 L0 60 Z" fill="none" />
        <path d="M0 40 C 200 10, 420 55, 640 30 S 1050 5, 1200 34" fill="none" stroke="var(--border-soft)" strokeWidth="1" />
      </svg>
    </div>
  );
}

/** Keyboard-focusable, clickable tile wrapper. */
function tileProps(onOpen?: () => void) {
  return {
    role: 'link' as const,
    tabIndex: 0,
    onClick: () => onOpen?.(),
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onOpen?.();
      }
    },
  };
}

export default function Home({
  org,
  onOpenPulse,
  onOpenRep,
  adminLeaders,
}: {
  org: { id: string; name: string };
  onOpenPulse: () => void;
  onOpenRep?: () => void;
  adminLeaders?: AdminLeader[];
}) {
  // Platform-owner tile: pick a team, become its leader, land back here as them.
  const [pick, setPick] = useState('');
  const [acting, setActing] = useState(false);
  const [actErr, setActErr] = useState('');

  // One picker row per COMPANY, not per login. A team can have several leaders
  // (Synergy has two) and every leader of a team sees the same HQ, so listing
  // each login read as separate businesses. Acting as the first leader is
  // acting as the team; the other names still show so it's clear who's inside.
  const actAsTeams = useMemo(() => {
    const byTeam = new Map<string, { team: string; email: string; names: string[] }>();
    for (const l of adminLeaders ?? []) {
      const g = byTeam.get(l.team_name);
      if (g) g.names.push(l.name);
      else byTeam.set(l.team_name, { team: l.team_name, email: l.email, names: [l.name] });
    }
    return [...byTeam.values()];
  }, [adminLeaders]);
  async function actAs() {
    if (!pick || acting) return;
    setActing(true);
    setActErr('');
    try {
      await adminActAs(pick);
      window.location.hash = '/'; // land on their HQ home
    } catch (e) {
      setActErr(e instanceof Error ? e.message : 'Could not start the session.');
      setActing(false);
    }
  }

  // Coach is a NATIVE in-app tab — a hash navigation on the session the user already
  // has. There is no second login and no handoff to another site.
  //
  // This used to sit beside an SSO bridge that shipped the user's access token to
  // trucoaching.co to mint a session there. That bridge was already unwired from every
  // button, and it could not work once the browser stopped holding a token at all.
  const openCoachInApp = () => { window.location.hash = '/coach'; };

  const canvasRef = useRef<HTMLDivElement | null>(null);
  useReveal([!!adminLeaders], canvasRef.current);

  // The full-screen "OPENING COACH" splash that used to sit here covered a page load
  // to another site. Coach is a tab now, so there is nothing to cover.

  return (
    <div className="tru-dark">
      <HqShell
        orgName={org.name}
        eyebrow="Your TRU HQ"
        title={`Welcome back, ${org.name}.`}
        onSignOut={() => signOutClean()}
        nav={{
          onHome: () => {
            window.location.hash = '/';
          },
          onOpenPulse,
          onOpenCoach: openCoachInApp,
          onOpenRep,
        }}
      >
        <div className="hh-canvas" ref={canvasRef}>
          <div className="hh-ambient" aria-hidden />

          {/* ============ BENTO ============ */}
          <section className="hh-bento">
            {/* HERO ANCHOR */}
            <article className="hh-hero reveal">
              <div className="hh-hero-glow" />
              <div className="hh-hero-inner">
                <span className="hq-eyebrow">
                  <span className="dot" /> One command center
                </span>
                <h2 className="hh-hero-title">Your TRU HQ</h2>
                <p className="hh-hero-sub">
                  Accountability, coaching, certification, and outbound — one roof, one login.
                </p>
                <div className="hh-hero-cta">
                  <button className="hqbtn hqbtn-primary" onClick={onOpenPulse}>
                    <Icon name="pulse" size={18} /> Open Pulse
                  </button>
                  <button className="hqbtn hqbtn-ghost" onClick={openCoachInApp}>
                    <Icon name="coach" size={18} /> Coach your team
                  </button>
                </div>
              </div>
            </article>

            {/* PULSE */}
            <article className="hqcard hqcard-hover hh-tile hh-pulse reveal" data-delay="80" {...tileProps(onOpenPulse)}>
              <div className="hh-tile-glow" />
              <div className="hh-tile-top">
                <span className="hh-tile-icon">
                  <Icon name="pulse" size={22} />
                </span>
                <h4 className="hh-tile-name">Pulse</h4>
              </div>
              <p className="hh-tile-pitch">Lead accountability — who's working what, and what's slipping.</p>
              <div className="hh-feat-stat">
                <GciCount />
                <span className="hh-feat-stat-cap">GCI in play</span>
                <TinyArc />
              </div>
              <GciSpark />
            </article>

            {/* COACH */}
            <article className="hqcard hqcard-hover hh-tile hh-coach reveal" data-delay="140" {...tileProps(openCoachInApp)}>
              <div className="hh-tile-glow" />
              <div className="hh-tile-top">
                <span className="hh-tile-icon">
                  <Icon name="coach" size={22} />
                </span>
                <h4 className="hh-tile-name">Coach</h4>
              </div>
              <p className="hh-tile-pitch">Walk into every agent's business and prep a 1:1 that lands.</p>
              <div className="hh-coach-body">
                <Ring pct={78} size={116} stroke={9} label="78" color="var(--accent-hi)" />
                <div className="hh-tile-stat">
                  <span className="hh-prod-dot" />6 agents · avg hustle
                </div>
              </div>
            </article>

            {/* REP */}
            <article className="hqcard hqcard-hover hh-tile hh-small hh-rep reveal" data-delay="200" {...tileProps(onOpenRep)}>
              <div className="hh-tile-top">
                <span className="hh-tile-icon">
                  <Icon name="rep" size={20} />
                </span>
                <h4 className="hh-tile-name">Rep</h4>
              </div>
              <p className="hh-tile-pitch">Onboard and certify every agent on the program.</p>
              {/* Demo (?demo=1): match the Rep tab's seeded roster (1 of 3 certified = 33%)
                  so the home tile doesn't contradict it. Real orgs keep the 0 placeholder. */}
              <ProgressArc pct={isDemo ? 33 : 0} />
            </article>
          </section>

          {/* curved divider */}
          <DividerWave />

          {/* ============ PLATFORM OWNER: Act as a team ============ */}
          {adminLeaders && (
            <section className="hqcard hh-panel reveal" data-delay="60" style={{ marginBottom: 18 }}>
              <div className="hh-panel-tag">Platform owner</div>
              <h3>Act as a team</h3>
              <p className="hh-panel-sub">
                Open any team's HQ exactly as their leader sees it — Pulse, Coach, all of it. Sign out to come back to yourself.
              </p>
              <div className="hh-actas-row">
                <select value={pick} onChange={(e) => setPick(e.target.value)}>
                  <option value="">Select a team…</option>
                  {actAsTeams.map((t) => (
                    <option key={t.team} value={t.email}>
                      {t.team} · {t.names.join(' & ')}
                    </option>
                  ))}
                </select>
                <button className="btn" onClick={actAs} disabled={!pick || acting}>
                  {acting ? 'Switching…' : 'Enter their HQ →'}
                </button>
              </div>
              {actErr && (
                <div className="err" style={{ marginTop: 10 }}>
                  {actErr}
                </div>
              )}
            </section>
          )}

          {/* ============ PLATFORM OWNER: Add a team ============ */}
          {adminLeaders && (
            <section className="hqcard hh-panel reveal" data-delay="70" style={{ marginBottom: 18 }}>
              <div className="hh-panel-tag">Platform owner</div>
              <h3>Add a team</h3>
              <p className="hh-panel-sub">
                Set a brokerage up from their Follow Up Boss key. Each team leader gets their own
                login and an email to set their password — nothing for them to configure.
              </p>
              <AdminIntake />
            </section>
          )}

          {/* ============ FOLLOW UP BOSS ============ */}
          {!adminLeaders && (
            <section className="hqcard hh-panel reveal" data-delay="80">
              <div className="hh-panel-tag">Data connection</div>
              <h3>Follow Up Boss</h3>
              <p className="hh-panel-sub">
                One API key powers every TRU product for your team — Pulse, Coach, and the rest. Connect it once; paste a new one anytime a key is
                rotated or stops working.
              </p>
              <FubConnect />
            </section>
          )}
          {adminLeaders && (
            <section className="hqcard hh-panel reveal" data-delay="80">
              <div className="hh-panel-tag">Follow Up Boss</div>
              <h3>Team connections</h3>
              <p className="hh-panel-sub">
                Every team's Follow Up Boss status at a glance — and paste a key to connect or re-key any team yourself, no impersonation needed. One
                key per team powers Pulse, Coach, and the rest.
              </p>
              <AdminConnections />
            </section>
          )}
        </div>
      </HqShell>
    </div>
  );
}
