import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, FormEvent, SetStateAction } from 'react';
import { supabase } from '../lib/supabase';
import { setCoaching, isDemo } from '../lib/api';
import { HqShell } from '../components/hqShell';
import { Avatar, Icon, Ring } from '../components/hqUi';
import { useReveal, useCountUp } from '../hqHooks';
import {
  loadRoster, teamMix, loadProfile, loadGoalBundle, loadCheckins,
  saveCheckin, saveGoalFields, setQuarter, toggleCommitment, addCommitment,
  updateCommitment, deleteCommitment, goalFunnel, QUARTERS,
  readCoachCache, writeCoachCache, firstName, confidence,
  loadFullRoster, loadTeamLinks,
  type RosterAgent, type Profile, type Goal, type Commitment, type Checkin, type TeamSeg,
  type TeamLink,
} from '../lib/coachData';
import '../truHqDark.css';

/* Full-Pulse-roster row (Task 4's loadFullRoster shape) — used by the "Add
   agents to Coach" picker and to derive the "Not yet assessed" lane. */
type FullRosterRow = { id: string; name: string; coaching_enabled: boolean; hasAssessment: boolean };

/* ============================================================
   COACH (native) — the standalone Coaching app, reskinned into the
   TRU HQ dark language and wired to REAL coaching data from the
   shared Supabase (loadRoster / teamMix / loadProfile / goals /
   check-ins). No mock numbers: the clock ring, hero, leaderboard,
   "needs you", and the drill-in all read the ported loaders.
   READ-ONLY — nothing here writes coaching data.
   ============================================================ */

/* ---- Coaching HEALTH (0–100) for the ring: blends how fresh the last
   check-in is (pace), how recently they were assessed (cadence), and how
   settled their profile is (assessment count → confidence). One coachable
   number that stands in for the mockup's fake "hustle score". ---- */
function healthOf(a: RosterAgent): number {
  // check-in freshness: 0d → 100, 14d+ → ~0
  const checkin = a.lastDays >= 99 ? 20 : Math.max(0, 100 - (a.lastDays / 14) * 100);
  // assessment cadence: fresh (0d) → 100, due at 90d → ~40
  const cadence = Math.max(35, 100 - (a.days / 90) * 60);
  // profile confidence from number of takes
  const conf = confidence(a.takes).pct;
  return Math.round(0.5 * checkin + 0.2 * cadence + 0.3 * conf);
}
const firstNm = (n: string) => firstName(n);

/* ---- Big team-health gauge — focal, ambient glow ---- */
function HealthGauge({ score }: { score: number }) {
  const size = 208;
  const stroke = 16;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c - (score / 100) * c;
  return (
    <div className="hustle-ring" style={{ width: size, height: size }}>
      <div className="hustle-ring-glow" />
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="coachGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#c9962f" />
            <stop offset="1" stopColor="#a9791f" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r + 9} fill="none" stroke="var(--track-outer)" strokeWidth="1" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track-fill-2)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="url(#coachGrad)" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={off}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 1.3s var(--ease)' }}
        />
        <circle cx={size / 2} cy={size / 2} r={r - stroke} fill="none" stroke="var(--track-hairline)" strokeWidth="1" />
      </svg>
      <div className="hustle-center">
        <div className="hustle-num">{score}</div>
        <div className="hustle-cap">Team Health</div>
      </div>
    </div>
  );
}

function MetricTile({ value, label, prefix = '', icon, className = '' }: { value: number; label: string; prefix?: string; icon: string; className?: string }) {
  const { ref, val } = useCountUp(value);
  return (
    <article className={`card coach-metric ${className}`}>
      <span className="coach-metric-mark"><Icon name={icon} size={16} /></span>
      <div className="coach-metric-num">{prefix}<span ref={ref}>{val}</span></div>
      <div className="coach-metric-label">{label}</div>
    </article>
  );
}

function DividerWave() {
  return (
    <div className="coach-divider" aria-hidden>
      <svg viewBox="0 0 1200 60" preserveAspectRatio="none">
        <path d="M0 40 C 200 10, 420 55, 640 30 S 1050 5, 1200 34 L1200 60 L0 60 Z" fill="var(--accent-soft)" />
        <path d="M0 40 C 200 10, 420 55, 640 30 S 1050 5, 1200 34" fill="none" stroke="var(--accent-line)" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

/* ---- Team-mix wiring bar (real teamMix segments) ---- */
function WiringBar({ segs }: { segs: TeamSeg[] }) {
  const total = segs.reduce((a, s) => a + s.count, 0) || 1;
  return (
    <div className="coach-wire">
      <div className="coach-wire-bar">
        {segs.map((s) => (
          <div
            key={s.label}
            className="coach-wire-seg"
            title={`${s.label} · ${s.count} (${s.pct}%)`}
            style={{ flexGrow: s.count, background: s.color }}
          />
        ))}
      </div>
      <div className="coach-wire-legend">
        {segs.map((s) => (
          <span key={s.label} className="coach-wire-leg">
            <i style={{ background: s.color }} /> {s.label} <b>{Math.round((s.count / total) * 100)}%</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   COACH DASHBOARD
   ============================================================ */
export default function Coach({ org, onHome }: { org: { id: string; name: string }; onHome?: () => void }) {
  const [roster, setRoster] = useState<RosterAgent[] | null>(() => readCoachCache(org.id));
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  // Cohort management (Task 8): the full Pulse roster (for the picker + the
  // "not yet assessed" lane) and each team's public assessment join link.
  // Both are best-effort — if they fail to load, the main coaching dashboard
  // (loadRoster, above) still works on its own.
  const [fullRoster, setFullRoster] = useState<FullRosterRow[]>([]);
  const [teamLinks, setTeamLinks] = useState<TeamLink[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerErr, setPickerErr] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [copiedTeam, setCopiedTeam] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await loadRoster();
        if (!live) return;
        writeCoachCache(org.id, r);
        setRoster(r);
        setErr(null);
      } catch (e) {
        if (!live) return;
        setErr(e instanceof Error ? e.message : 'Could not load your roster.');
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.id]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [fr, tl] = await Promise.all([loadFullRoster(), loadTeamLinks()]);
        if (!live) return;
        setFullRoster(fr);
        setTeamLinks(tl);
      } catch {
        // Best-effort: header actions + the "not yet assessed" lane just stay
        // empty/hidden if this fails; the coaching dashboard above is unaffected.
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.id]);

  useReveal([roster, openId], canvasRef.current);

  // Cohort members added to Coach who haven't taken the assessment yet — a
  // distinct lane, never fabricated archetype data.
  const pending = useMemo(
    () => fullRoster.filter((a) => a.coaching_enabled && !a.hasAssessment),
    [fullRoster],
  );

  async function copyTeamLink(t: TeamLink) {
    const url = `${window.location.origin}/#/assess?t=${t.joinToken}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedTeam(t.teamId);
      window.setTimeout(() => setCopiedTeam((cur) => (cur === t.teamId ? null : cur)), 1800);
    } catch {
      // Clipboard permission denied — no confirmation, but nothing throws.
    }
  }

  async function onTogglePicker(agent: FullRosterRow, on: boolean) {
    setTogglingId(agent.id);
    setPickerErr(null);
    setFullRoster((prev) => prev.map((a) => (a.id === agent.id ? { ...a, coaching_enabled: on } : a)));
    try {
      await setCoaching(agent.id, on);
      const [r, fr] = await Promise.all([loadRoster(), loadFullRoster()]);
      writeCoachCache(org.id, r);
      setRoster(r);
      setFullRoster(fr);
    } catch (e) {
      setFullRoster((prev) => prev.map((a) => (a.id === agent.id ? { ...a, coaching_enabled: !on } : a)));
      setPickerErr(e instanceof Error ? e.message : 'Could not update this agent’s coaching status.');
    } finally {
      setTogglingId(null);
    }
  }

  const mix = useMemo(() => (roster ? teamMix(roster) : null), [roster]);

  // Derived, real coaching aggregates.
  const derived = useMemo(() => {
    if (!roster || roster.length === 0) return null;
    const withHealth = roster.map((a) => ({ a, health: healthOf(a) }));
    const teamHealth = Math.round(withHealth.reduce((s, x) => s + x.health, 0) / withHealth.length);
    const onTrack = roster.filter((a) => a.pace === 'On track').length;
    const needsYou = withHealth
      .filter(({ a }) => a.pace === 'Stalled' || a.pace === 'No check-ins' || a.pace === 'Slipping' || a.due)
      .sort((x, y) => x.health - y.health);
    const leaderboard = [...withHealth].sort((x, y) => y.health - x.health).slice(0, 4);
    const dueCount = roster.filter((a) => a.due).length;
    const assessed = roster.reduce((s, a) => s + a.takes, 0);
    return { withHealth, teamHealth, onTrack, needsYou, leaderboard, dueCount, assessed };
  }, [roster]);

  // Header actions only make sense on the roster dashboard, not the agent drill-in.
  const context = !openId ? (
    <div className="coach-header-actions" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
      {teamLinks.map((t) => (
        <button
          key={t.teamId}
          type="button"
          className="hqbtn hqbtn-ghost hqbtn-sm"
          onClick={() => copyTeamLink(t)}
        >
          {copiedTeam === t.teamId ? 'Copied!' : teamLinks.length > 1 ? `Copy link · ${t.name}` : 'Copy team assessment link'}
        </button>
      ))}
      <button
        type="button"
        className="hqbtn hqbtn-primary hqbtn-sm"
        onClick={() => setPickerOpen(true)}
        disabled={isDemo}
        title={isDemo ? 'Not available in the demo preview' : undefined}
      >
        <Icon name="coach" size={15} /> Add agents to Coach
      </button>
    </div>
  ) : null;

  if (!roster) {
    return (
      <div className="tru-dark">
        <HqShell
          orgName={org.name} eyebrow={`Coaching · ${org.name}`} title="Coach — your team, at a glance."
          onSignOut={() => supabase.auth.signOut()}
          nav={coachNav(onHome)}
        >
          <div className="center-wrap" style={{ minHeight: '50vh', display: 'grid', placeItems: 'center' }}>
            {err ? <div className="card" style={{ padding: 28, maxWidth: 460 }}><h3>Couldn’t load coaching data</h3><p style={{ color: 'var(--text-60)', marginTop: 8 }}>{err}</p></div> : <div className="spinner" />}
          </div>
        </HqShell>
      </div>
    );
  }

  const openAgent = roster.find((a) => a.id === openId) || null;

  return (
    <div className="tru-dark">
      <HqShell
        orgName={org.name}
        eyebrow={openAgent ? `Coaching · ${org.name}` : 'Monday, coaching brief'}
        title={openAgent ? `Coach — ${openAgent.name}` : 'Coach — your team, at a glance.'}
        context={context}
        onSignOut={() => supabase.auth.signOut()}
        nav={coachNav(onHome)}
      >
        <div className="coach-canvas" ref={canvasRef}>
          <div className="coach-ambient" aria-hidden />

          {openAgent ? (
            <AgentDrill agent={openAgent} onBack={() => setOpenId(null)} />
          ) : (
            <>
              {roster.length === 0 || !derived || !mix ? (
                <div className="card ps-emptyview reveal" style={{ padding: 40 }}>
                  <h3>No profiled agents yet</h3>
                  <p style={{ color: 'var(--text-60)', marginTop: 8 }}>
                    {pending.length > 0
                      ? 'Your cohort is added — once they complete the TRU assessment, each one appears here with their archetype, pace, and coaching health.'
                      : 'Coach shows only the agents you’ve curated. Use “Add agents to Coach” above to build your cohort, then have them take the TRU assessment.'}
                  </p>
                </div>
              ) : (
                <>
              {/* ============ HERO BENTO ============ */}
              <section className="coach-bento">
                <article className="card hustle-card reveal">
                  <div className="hustle-card-glow" />
                  <HealthGauge score={derived.teamHealth} />
                  <div className="hustle-copy">
                    <span className="eyebrow"><span className="dot" /> Team pulse</span>
                    <h3>How your team is wired.</h3>
                    <p>{mix.note}</p>
                    <div style={{ marginTop: 16 }}><WiringBar segs={mix.segs} /></div>
                  </div>
                </article>

                <MetricTile className="coach-metric-a reveal" value={roster.length} label="Agents on roster" icon="coach" />
                <MetricTile className="coach-metric-b reveal" value={derived.onTrack} label="On track this week" icon="pulse" />
                <MetricTile className="coach-metric-c reveal" value={derived.dueCount} label="Due for a re-assessment" icon="clock" />
              </section>

              <DividerWave />

              {/* ============ AGENTS + LEADERBOARD ============ */}
              <section className="grid-row">
                <div className="agents-panel">
                  <div className="panel-head reveal">
                    <h3>Agents</h3>
                    <span className="panel-sub">Coaching health ring · archetype · pace</span>
                  </div>
                  <div className="agents-grid">
                    {derived.withHealth.map(({ a, health }, i) => (
                      <article
                        key={a.id}
                        className="card card-hover agent agent-clickable reveal"
                        data-delay={i * 70}
                        role="link" tabIndex={0}
                        onClick={() => setOpenId(a.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(a.id); } }}
                      >
                        <div className="agent-glow" />
                        <div className="agent-top">
                          <Avatar name={a.name} size={46} tone={i % 5} />
                          <Ring pct={health} size={56} label={`${health}`} color={a.paceColor} />
                        </div>
                        <div className="agent-body">
                          <div className="agent-name">{a.name}</div>
                          <div className="agent-meta">
                            <span className="agent-type">{a.archName}</span>
                            <span className="agent-level">{a.quad}</span>
                            <span className="agent-trend" style={{ color: a.paceColor, marginLeft: 'auto' }}>{a.pace}</span>
                          </div>
                        </div>
                        <button
                          className="btn btn-ghost btn-block btn-sm"
                          onClick={(e) => { e.stopPropagation(); setOpenId(a.id); }}
                        >
                          <Icon name="coach" size={17} /> Prep 1:1
                        </button>
                      </article>
                    ))}
                  </div>
                </div>

                <aside className="cohort-panel">
                  <div className="card cohort reveal">
                    <div className="panel-head">
                      <h3>Leaderboard</h3>
                      <span className="panel-sub">By coaching health</span>
                    </div>
                    <ol className="cohort-list">
                      {derived.leaderboard.map(({ a, health }, i) => (
                        <li key={a.id} className={`cohort-row rank-${i + 1}`} role="link" tabIndex={0} style={{ cursor: 'pointer' }}
                          onClick={() => setOpenId(a.id)}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(a.id); } }}
                        >
                          <span className={`cohort-medal rank-${i + 1}`} aria-hidden>
                            <svg viewBox="0 0 24 24" width="30" height="30">
                              <path d="M12 2l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 15.9 6.8 18.2l1-5.8L3.5 8.2l5.9-.9z" className="cohort-medal-star" />
                            </svg>
                            <span className="cohort-medal-rank">{i + 1}</span>
                          </span>
                          <Avatar name={a.name} size={38} tone={i % 5} />
                          <div className="cohort-info">
                            <div className="cohort-name">{a.name}</div>
                            <div className="cohort-sub">{a.quad} · {a.pace}</div>
                          </div>
                          <span className="cohort-metric">{health}</span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  {derived.needsYou.length > 0 && (
                    <div className="card cohort-cta reveal" data-delay="100">
                      <div className="cohort-cta-glow" />
                      <span className="method-badge cohort-cta-badge"><Icon name="target" size={18} /></span>
                      <h4>{derived.needsYou[0].a.name} needs you</h4>
                      <p>
                        {needsReason(derived.needsYou[0].a)} {derived.needsYou.length > 1 ? `${derived.needsYou.length - 1} more ${derived.needsYou.length - 1 === 1 ? 'agent is' : 'agents are'} slipping too.` : ''}
                      </p>
                      <button className="btn btn-primary btn-block btn-sm" onClick={() => setOpenId(derived.needsYou[0].a.id)}>
                        Open {firstNm(derived.needsYou[0].a.name)}’s brief
                      </button>
                    </div>
                  )}
                </aside>
              </section>
                </>
              )}

              {pending.length > 0 && (
                <>
                  <DividerWave />
                  <section className="agents-panel reveal">
                    <div className="panel-head">
                      <h3>Not yet assessed</h3>
                      <span className="panel-sub">In your cohort, waiting on their first TRU assessment</span>
                    </div>
                    <div className="agents-grid">
                      {pending.map((a) => (
                        <article key={a.id} className="card agent" style={{ opacity: 0.78 }}>
                          <div className="agent-top">
                            <Avatar name={a.name} size={46} tone={2} />
                            <span
                              style={{
                                fontSize: 12, fontWeight: 700, color: 'var(--accent-hi)',
                                border: '1px solid var(--accent-line)', background: 'var(--accent-soft)',
                                borderRadius: 999, padding: '5px 12px', whiteSpace: 'nowrap',
                              }}
                            >
                              Invited
                            </span>
                          </div>
                          <div className="agent-body">
                            <div className="agent-name">{a.name}</div>
                            <div className="agent-meta"><span className="agent-type">Awaiting assessment result</span></div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                </>
              )}
            </>
          )}
        </div>
      </HqShell>

      {pickerOpen && (
        <AddAgentsModal
          roster={fullRoster}
          onClose={() => setPickerOpen(false)}
          onToggle={onTogglePicker}
          togglingId={togglingId}
          err={pickerErr}
        />
      )}
    </div>
  );
}

/* ============================================================
   ADD AGENTS TO COACH — a picker modal listing the FULL Pulse
   roster (may be dozens; scrollable, never list-limited). Each row
   toggles agents.coaching_enabled via setCoaching(id, on); the
   parent refreshes the roster + full roster + pending lane on success.
   ============================================================ */
function AddAgentsModal({
  roster, onClose, onToggle, togglingId, err,
}: {
  roster: FullRosterRow[];
  onClose: () => void;
  onToggle: (agent: FullRosterRow, on: boolean) => void;
  togglingId: string | null;
  err: string | null;
}) {
  const [q, setQ] = useState('');
  const filtered = q.trim()
    ? roster.filter((a) => a.name.toLowerCase().includes(q.trim().toLowerCase()))
    : roster;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add agents to Coach"
      style={{
        position: 'fixed', inset: 0, zIndex: 200, display: 'grid', placeItems: 'center',
        background: 'rgba(6,8,14,0.66)', padding: 24,
      }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: 'min(560px, 100%)', maxHeight: '82vh', display: 'flex', flexDirection: 'column', padding: 28 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <h3 style={{ margin: 0 }}>Add agents to Coach</h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>
        <p style={{ color: 'var(--text-60)', fontSize: 14, marginTop: 0, marginBottom: 16 }}>
          Toggle on the agents you want to coach — Coach only ever shows the agents you’ve added here.
        </p>
        <input
          type="text"
          className="ad-input"
          placeholder="Search agents…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ marginBottom: 14 }}
        />
        {err && <div className="ad-inline-err" style={{ marginBottom: 12 }}>{err}</div>}
        <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {roster.length === 0 ? (
            <p style={{ color: 'var(--text-60)', fontSize: 14 }}>No agents found on this team yet.</p>
          ) : filtered.length === 0 ? (
            <p style={{ color: 'var(--text-60)', fontSize: 14 }}>No agents match “{q}”.</p>
          ) : (
            filtered.map((a) => (
              <div
                key={a.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 4px', borderBottom: '1px solid var(--border-soft)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Avatar name={a.name} size={32} tone={0} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14.5 }}>{a.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-60)' }}>{a.hasAssessment ? 'Assessed' : 'Not yet assessed'}</div>
                  </div>
                </div>
                <label className="ad-toggle" style={{ marginBottom: 0 }}>
                  <input
                    type="checkbox"
                    checked={a.coaching_enabled}
                    disabled={togglingId === a.id}
                    onChange={(e) => onToggle(a, e.target.checked)}
                  />
                  <span className="ad-toggle-track"><span className="ad-toggle-dot" /></span>
                </label>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function coachNav(onHome?: () => void) {
  return {
    onHome: () => onHome?.(),
    onOpenPulse: () => { window.location.hash = '/pulse'; },
    onOpenCoach: () => { window.location.hash = '/coach'; },
    onOpenRep: () => { window.location.hash = '/rep'; },
  };
}

function needsReason(a: RosterAgent): string {
  if (a.pace === 'No check-ins') return `${firstName(a.name)} has never had a logged check-in.`;
  if (a.pace === 'Stalled') return `${firstName(a.name)}’s last check-in was ${a.lastLabel} — the conversation has stalled.`;
  if (a.pace === 'Slipping') return `${firstName(a.name)} last checked in ${a.lastLabel} and is starting to slip.`;
  if (a.due) return `${firstName(a.name)} is due for a re-assessment (${a.days}d since the last one).`;
  return `${firstName(a.name)} could use a touch this week.`;
}

/* ============================================================
   AGENT DRILL-IN — real profile (archetype + confidence dims from
   deriveProfile) + goals + check-in history.
   ============================================================ */
function Stat({ value, label, prefix = '', suffix = '' }: { value: number; label: string; prefix?: string; suffix?: string }) {
  const { ref, val } = useCountUp(value);
  return (
    <div className="ad-stat">
      <div className="ad-stat-num">{prefix}<span ref={ref}>{val}</span>{suffix}</div>
      <div className="ad-stat-label">{label}</div>
    </div>
  );
}

/* ---- Deterministic 1:1 talking points, FeedForward-style. Built from the
   archetype's signal/unlock (already derived) + pace + recent focus. No AI, no
   network — pure function of what we already know about the agent. ---- */
function talkingPoints(agent: RosterAgent, profile: Profile | null, lastFocus: string): string[] {
  const first = firstName(agent.name);
  const pts: string[] = [];
  // 1) Open on the relationship / where they stand — paced by heartbeat.
  if (agent.pace === 'No check-ins') {
    pts.push(`Open by genuinely catching up — this is ${first}’s first logged 1:1, so earn the room before any ask.`);
  } else if (agent.pace === 'Stalled' || agent.pace === 'Slipping') {
    pts.push(`Name that it’s been ${agent.lastLabel} since you last connected, own the gap, and ask what’s changed for ${first} since.`);
  } else {
    pts.push(`Lead with a win — ${first} is on track, so reinforce the behavior that’s working before you stretch them.`);
  }
  // 2) FeedForward from the archetype's next unlock (future-focused, not a critique).
  if (profile?.unlock) {
    pts.push(`FeedForward: “Here’s one move for the quarter ahead — ${profile.unlock.charAt(0).toLowerCase()}${profile.unlock.slice(1)}”`);
  }
  // 3) Watch-for from the early-warning signal (so the leader listens for it live).
  if (profile?.signal) {
    pts.push(`Listen for the early-warning signal: ${profile.signal.charAt(0).toLowerCase()}${profile.signal.slice(1)}`);
  }
  // 4) Tie back to their own last stated focus, if any.
  if (lastFocus) {
    pts.push(`Close the loop on their last focus — “${lastFocus}” — before you set the next one.`);
  }
  return pts.slice(0, 4);
}

const todayISODate = () => new Date().toISOString().slice(0, 10);

/* ---- Saved-badge helper: a subtle, self-clearing "Saved"/"Logged" pill. ---- */
function useSavedFlag(): [string | null, (label?: string) => void] {
  const [flag, setFlag] = useState<string | null>(null);
  const t = useRef<number | null>(null);
  const flash = (label = 'Saved') => {
    setFlag(label);
    if (t.current) window.clearTimeout(t.current);
    t.current = window.setTimeout(() => setFlag(null), 1800);
  };
  useEffect(() => () => { if (t.current) window.clearTimeout(t.current); }, []);
  return [flag, flash];
}

function AgentDrill({ agent, onBack }: { agent: RosterAgent; onBack: () => void }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [writeErr, setWriteErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        // loadGoalBundle now CREATES + SEEDS on first open (write path). Run the
        // reads first so a denied goal-write can't blank the profile/history.
        const [p, ci] = await Promise.all([
          loadProfile(agent.id),
          loadCheckins(agent.id),
        ]);
        if (!live) return;
        setProfile(p);
        setCheckins(ci);
        try {
          const gb = await loadGoalBundle(agent.id, agent.teamId, agent.code);
          if (!live) return;
          setGoal(gb.goal);
          setCommitments(gb.commitments);
        } catch (e) {
          if (!live) return;
          // Goal seed denied (RLS) — the sheet still renders read-only + inline error.
          setWriteErr(e instanceof Error ? e.message : 'Couldn’t create this agent’s goal (write denied).');
        }
      } catch {
        // Degrade gracefully — profile from the roster code still renders below.
      }
    })();
    return () => { live = false; };
  }, [agent.id, agent.teamId, agent.code]);

  const first = firstName(agent.name);
  const health = healthOf(agent);
  const fnl = goal ? goalFunnel(goal) : null;
  const doneCount = commitments.filter((c) => c.done).length;
  const points = talkingPoints(agent, profile, checkins[0]?.focus || agent.lastFocus || '');

  return (
    <>
      <button className="ad-back reveal" onClick={onBack}>
        <Icon name="coach" size={18} /> Back to team
      </button>

      {/* 1. HEADER BAND (kept) */}
      <header className="ad-header reveal" data-delay="40">
        <div className="ad-header-glow" />
        <div className="ad-avatar-xl"><Avatar name={agent.name} size={92} tone={0} /></div>
        <div className="ad-header-info">
          <h1 className="ad-name">{agent.name}</h1>
          <div className="ad-badges">
            <span className="agent-type">{agent.archName}</span>
            <span className="ad-level-badge">{agent.quad}</span>
            <span className="ad-trend" style={{ color: agent.paceColor }}>{agent.pace}</span>
          </div>
          <p className="ad-status">{profile ? profile.tagline : `${agent.emoji} ${agent.archName}`}</p>
        </div>
      </header>

      {/* HERO CLOCK (kept) */}
      <section className="ad-hero reveal" data-delay="90">
        <div className="ad-hero-glow" />
        <AdClock pct={health} />
        <div className="ad-hero-stats">
          <div className="ad-hero-lead">
            <span className="eyebrow"><span className="dot" /> Stepping into {first}’s coaching</span>
            <h3>Where they stand.</h3>
            <p>{first}’s coaching health blends check-in freshness, assessment recency, and how settled their profile is.</p>
          </div>
          <div className="ad-hero-metrics">
            <Stat value={agent.lastDays >= 99 ? 0 : agent.lastDays} suffix={agent.lastDays >= 99 ? '' : 'd'} label={agent.lastDays >= 99 ? 'No check-ins yet' : 'Since last check-in'} />
            <Stat value={agent.takes} label="Assessments taken" />
            <Stat value={agent.days} suffix="d" label="Since last assessment" />
          </div>
        </div>
      </section>

      {writeErr && (
        <div className="ad-writebar reveal" role="alert">
          <Icon name="target" size={15} /> {writeErr} — coaching data may be read-only on this login.
        </div>
      )}

      <div className="coach-divider ad-divider" aria-hidden>
        <svg viewBox="0 0 1200 60" preserveAspectRatio="none">
          <path d="M0 40 C 200 10, 420 55, 640 30 S 1050 5, 1200 34 L1200 60 L0 60 Z" fill="var(--accent-soft)" />
          <path d="M0 40 C 200 10, 420 55, 640 30 S 1050 5, 1200 34" fill="none" stroke="var(--accent-line)" strokeWidth="1.5" />
        </svg>
      </div>

      {/* PROFILE + HOW-TO-COACH (kept) */}
      <div className="ad-grid">
        <section className="card ad-panel reveal" data-delay="60">
          <div className="ad-panel-head">
            <h3>Their profile</h3>
            <span className="panel-sub">{profile ? `${profile.confLabel} · ${profile.confPct}% confidence` : agent.archName}</span>
          </div>
          {profile ? (
            <>
              <p style={{ color: 'var(--text-60)', fontSize: 15, marginBottom: 18 }}>{profile.tagline}</p>
              <div className="ad-dims">
                {profile.dimStatus.map((d) => (
                  <div key={d.label} className="ad-dim">
                    <span className="ad-dim-mark" style={{ color: d.color }}>{d.mark}</span>
                    <span className="ad-dim-label">{d.label}</span>
                    <span className="ad-dim-status" style={{ color: d.color }}>{d.statusLabel}</span>
                  </div>
                ))}
              </div>
              {profile.shift && (
                <div className="ad-shift">
                  <b>{profile.shift.dim}</b> shifted {profile.shift.from} → {profile.shift.to} ({profile.shift.when})
                </div>
              )}
            </>
          ) : (
            <p style={{ color: 'var(--text-60)', fontSize: 15 }}>Loading profile…</p>
          )}
        </section>

        <section className="card ad-panel reveal" data-delay="120">
          <div className="ad-panel-head">
            <h3>How to coach them</h3>
            <span className="panel-sub">{profile ? `${profile.quad} · ${profile.law}` : agent.quad}</span>
          </div>
          {profile ? (
            <ul className="ad-wired">
              <li>
                <span className="ad-wired-tag blind">Early-warning signal</span>
                <p>{profile.signal}</p>
              </li>
              <li>
                <span className="ad-wired-tag drive">Next unlock</span>
                <p>{profile.unlock}</p>
              </li>
            </ul>
          ) : (
            <p style={{ color: 'var(--text-60)', fontSize: 15 }}>Loading…</p>
          )}
        </section>
      </div>

      {/* 2. 1:1 PREP SHEET (writes: checkins) */}
      <OneOnOneSheet
        agent={agent}
        points={points}
        checkins={checkins}
        onLogged={(row) => setCheckins((prev) => [row, ...prev])}
      />

      {/* 3. GOAL & COMMITMENT SHEET (writes: goals + commitments) */}
      <GoalSheet
        agent={agent}
        goal={goal}
        setGoal={setGoal}
        fnl={fnl}
        commitments={commitments}
        setCommitments={setCommitments}
        doneCount={doneCount}
      />
    </>
  );
}

/* ============================================================
   1:1 PREP SHEET — deterministic move (talking points) + recent
   context + an inline "Log this 1:1" form → saveCheckin(checkins).
   ============================================================ */
function OneOnOneSheet({
  agent, points, checkins, onLogged,
}: {
  agent: RosterAgent;
  points: string[];
  checkins: Checkin[];
  onLogged: (row: Checkin) => void;
}) {
  const first = firstName(agent.name);
  const [met, setMet] = useState(true);
  const [win, setWin] = useState('');
  const [focus, setFocus] = useState('');
  const [date, setDate] = useState(todayISODate());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [flag, flash] = useSavedFlag();

  const lastFocus = checkins[0]?.focus || '';
  const daysSinceLast = agent.lastDays >= 99 ? null : agent.lastDays;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setErr(null);
    try {
      const row = await saveCheckin({
        agentId: agent.id,
        teamId: agent.teamId,
        met,
        win: win.trim() || null,
        focus: focus.trim() || null,
        // Local date at noon so it lands on the intended calendar day in any TZ.
        createdAt: new Date(`${date}T12:00:00`).toISOString(),
      });
      if (row) {
        onLogged(row);
        setWin('');
        setFocus('');
        setDate(todayISODate());
        flash('Logged');
      }
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Could not log this 1:1 (write denied).');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card ad-panel ad-sheet reveal" data-delay="60">
      <div className="ad-panel-head">
        <h3>1:1 Prep</h3>
        <span className="panel-sub">
          {daysSinceLast == null ? 'No prior check-in' : `Last check-in ${daysSinceLast === 0 ? 'today' : `${daysSinceLast}d ago`}`}
          {lastFocus ? ` · focus: ${lastFocus}` : ''}
        </span>
      </div>

      <div className="ad-sheet-cols">
        {/* The coaching move — deterministic talking points */}
        <div className="ad-sheet-block">
          <div className="ad-sub-label"><span className="ad-wired-tag drive">The move</span></div>
          {points.length > 0 ? (
            <ol className="ad-points">
              {points.map((p, i) => (
                <li key={i} className="ad-point"><span className="ad-point-n">{i + 1}</span><span>{p}</span></li>
              ))}
            </ol>
          ) : (
            <p style={{ color: 'var(--text-60)', fontSize: 15 }}>Loading {first}’s coaching move…</p>
          )}
        </div>

        {/* Log this 1:1 — inline write form */}
        <form className="ad-sheet-block ad-logform" onSubmit={submit}>
          <div className="ad-sub-label">
            <span className="ad-wired-tag blind">Log this 1:1</span>
            {flag && <span className="ad-saved">{flag}</span>}
          </div>

          <label className="ad-toggle">
            <input type="checkbox" checked={met} onChange={(e) => setMet(e.target.checked)} />
            <span className="ad-toggle-track"><span className="ad-toggle-dot" /></span>
            <span className="ad-toggle-label">We met</span>
          </label>

          <label className="ad-field">
            <span>A win to note (optional)</span>
            <input
              type="text" value={win} onChange={(e) => setWin(e.target.value)}
              placeholder={`Something ${first} did well`} className="ad-input"
            />
          </label>

          <label className="ad-field">
            <span>Next focus</span>
            <input
              type="text" value={focus} onChange={(e) => setFocus(e.target.value)}
              placeholder="What they’ll work on next" className="ad-input"
            />
          </label>

          <label className="ad-field ad-field-date">
            <span>Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="ad-input" max={todayISODate()} />
          </label>

          {err && <div className="ad-inline-err">{err}</div>}

          <button type="submit" className="btn btn-primary btn-sm ad-log-btn" disabled={saving}>
            <Icon name="coach" size={16} /> {saving ? 'Logging…' : 'Log this 1:1'}
          </button>
        </form>
      </div>
    </section>
  );
}

/* ============================================================
   GOAL & COMMITMENT SHEET — editable quarterly goal (debounced
   saveGoalFields), live funnel, and a grouped Company/Sphere
   commitments checklist (toggle/add/update/delete). All persist.
   ============================================================ */
const GOAL_FIELDS: Array<{ key: keyof Goal; label: string; step: number; suffix?: string }> = [
  { key: 'q_goal', label: 'Quarter goal (transactions)', step: 1 },
  { key: 'alloc_company', label: 'From company leads', step: 1 },
  { key: 'cvr_company', label: 'Company conversion %', step: 0.5, suffix: '%' },
  { key: 'cvr_sphere', label: 'Sphere conversion %', step: 0.5, suffix: '%' },
];

function GoalSheet({
  agent, goal, setGoal, fnl, commitments, setCommitments, doneCount,
}: {
  agent: RosterAgent;
  goal: Goal | null;
  setGoal: Dispatch<SetStateAction<Goal | null>>;
  fnl: ReturnType<typeof goalFunnel> | null;
  commitments: Commitment[];
  setCommitments: Dispatch<SetStateAction<Commitment[]>>;
  doneCount: number;
}) {
  const first = firstName(agent.name);
  const [flag, flash] = useSavedFlag();
  const [err, setErr] = useState<string | null>(null);
  const debounce = useRef<number | null>(null);
  useEffect(() => () => { if (debounce.current) window.clearTimeout(debounce.current); }, []);

  // Optimistic goal-field edit → debounced persist.
  function editGoal(field: Partial<Goal>) {
    setGoal((g) => (g ? { ...g, ...field } : g));
    if (debounce.current) window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(async () => {
      try {
        await saveGoalFields(agent.id, field);
        setErr(null);
        flash();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Could not save the goal (write denied).');
      }
    }, 550);
  }

  async function changeQuarter(quarter: string) {
    setGoal((g) => (g ? { ...g, quarter } : g));
    try { await setQuarter(agent.id, quarter); setErr(null); flash(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not save the quarter.'); }
  }

  async function onToggle(c: Commitment) {
    const next = !c.done;
    setCommitments((prev) => prev.map((x) => (x.id === c.id ? { ...x, done: next } : x)));
    try { await toggleCommitment(c.id, next); setErr(null); }
    catch (e) {
      setCommitments((prev) => prev.map((x) => (x.id === c.id ? { ...x, done: !next } : x)));
      setErr(e instanceof Error ? e.message : 'Could not save that check.');
    }
  }

  async function onEditText(c: Commitment, text: string) {
    const trimmed = text.trim();
    if (!trimmed || trimmed === c.text) return;
    setCommitments((prev) => prev.map((x) => (x.id === c.id ? { ...x, text: trimmed, is_custom: true } : x)));
    try { await updateCommitment(c.id, { text: trimmed }); setErr(null); flash(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Could not update that commitment.'); }
  }

  async function onDelete(c: Commitment) {
    const prev = commitments;
    setCommitments((p) => p.filter((x) => x.id !== c.id));
    try { await deleteCommitment(c.id); setErr(null); }
    catch (e) { setCommitments(prev); setErr(e instanceof Error ? e.message : 'Could not delete that commitment.'); }
  }

  async function onAdd(source: string, text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      const row = await addCommitment(agent.id, agent.teamId, source, trimmed);
      if (row) { setCommitments((prev) => [...prev, row]); setErr(null); flash('Added'); }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add that commitment.');
    }
  }

  const company = commitments.filter((c) => c.source === 'company');
  const sphere = commitments.filter((c) => c.source === 'sphere');

  return (
    <section className="card ad-panel ad-sheet reveal" data-delay="120">
      <div className="ad-panel-head">
        <h3>Goal &amp; Commitments</h3>
        <span className="panel-sub">
          {goal ? `${goal.quarter}` : 'No goal yet'}
          {commitments.length > 0 ? ` · ${doneCount}/${commitments.length} done` : ''}
          {flag && <span className="ad-saved" style={{ marginLeft: 8 }}>{flag}</span>}
        </span>
      </div>

      {err && <div className="ad-inline-err" style={{ marginBottom: 16 }}>{err}</div>}

      {!goal ? (
        <div className="ad-move-lead">
          <span className="method-badge"><Icon name="target" size={18} /></span>
          <p>Setting up {first}’s quarterly goal…</p>
        </div>
      ) : (
        <>
          {/* Goal editor */}
          <div className="ad-goal-editor">
            <label className="ad-field">
              <span>Quarter</span>
              <select className="ad-input" value={goal.quarter} onChange={(e) => changeQuarter(e.target.value)}>
                {QUARTERS.map((q) => <option key={q} value={q}>{q}</option>)}
              </select>
            </label>
            {GOAL_FIELDS.map((f) => (
              <label key={String(f.key)} className="ad-field">
                <span>{f.label}</span>
                <input
                  type="number" className="ad-input" step={f.step} min={0}
                  value={Number(goal[f.key] ?? 0)}
                  onChange={(e) => editGoal({ [f.key]: Number(e.target.value) } as Partial<Goal>)}
                />
              </label>
            ))}
          </div>

          {/* Live funnel */}
          {fnl && (
            <div className="ad-funnel">
              <div className="ad-funnel-cell">
                <span className="ad-funnel-cap">Company leads</span>
                <span className="ad-funnel-big">{fnl.comp.perQuarter}</span>
                <span className="ad-funnel-sub">{fnl.comp.perMonth}/mo · {fnl.comp.perWeek}/wk · {fnl.pctC}% of goal</span>
              </div>
              <div className="ad-funnel-cell">
                <span className="ad-funnel-cap">Sphere conversations</span>
                <span className="ad-funnel-big">{fnl.sph.perWeek}<small>/wk</small></span>
                <span className="ad-funnel-sub">{fnl.sph.perMonth}/mo · {fnl.sph.perQuarter}/qtr · {fnl.pctS}% of goal</span>
              </div>
            </div>
          )}

          {/* Commitments — grouped Company / Sphere */}
          <div className="ad-commit-groups">
            <CommitGroup
              title="Company" source="company" rows={company}
              onToggle={onToggle} onEditText={onEditText} onDelete={onDelete} onAdd={onAdd}
            />
            <CommitGroup
              title="Sphere" source="sphere" rows={sphere}
              onToggle={onToggle} onEditText={onEditText} onDelete={onDelete} onAdd={onAdd}
            />
          </div>
        </>
      )}
    </section>
  );
}

function CommitGroup({
  title, source, rows, onToggle, onEditText, onDelete, onAdd,
}: {
  title: string;
  source: string;
  rows: Commitment[];
  onToggle: (c: Commitment) => void;
  onEditText: (c: Commitment, text: string) => void;
  onDelete: (c: Commitment) => void;
  onAdd: (source: string, text: string) => void;
}) {
  const [draft, setDraft] = useState('');
  return (
    <div className="ad-commit-group">
      <div className="ad-commit-title"><span className="ad-check-src">{title}</span></div>
      <div className="ad-checklist">
        {rows.map((c) => (
          <div key={c.id} className={`ad-check ad-check-edit ${c.done ? 'done' : ''}`}>
            <button
              type="button" className="ad-check-box ad-check-toggle"
              aria-label={c.done ? 'Mark not done' : 'Mark done'}
              onClick={() => onToggle(c)}
            >
              {c.done && <Icon name="coach" size={13} />}
            </button>
            <input
              className="ad-check-input"
              defaultValue={c.text}
              onBlur={(e) => onEditText(c, e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
            />
            <button type="button" className="ad-check-del" aria-label="Delete commitment" onClick={() => onDelete(c)}>×</button>
          </div>
        ))}
        {rows.length === 0 && <p className="ad-commit-empty">No {title.toLowerCase()} commitments yet.</p>}
      </div>
      <form
        className="ad-commit-add"
        onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { onAdd(source, draft); setDraft(''); } }}
      >
        <input
          className="ad-input" value={draft} onChange={(e) => setDraft(e.target.value)}
          placeholder={`Add a ${title.toLowerCase()} commitment…`}
        />
        <button type="submit" className="btn btn-ghost btn-sm" disabled={!draft.trim()}>Add</button>
      </form>
    </div>
  );
}

function AdClock({ pct }: { pct: number }) {
  const size = 260;
  const stroke = 20;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c - (pct / 100) * c;
  return (
    <div className="ad-clock" style={{ width: size, height: size }}>
      <div className="ad-clock-glow" />
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="adGradC" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#c9962f" />
            <stop offset="1" stopColor="#a9791f" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r + 12} fill="none" stroke="var(--track-outer)" strokeWidth="1" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track-fill-2)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="url(#adGradC)" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={off}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 1.4s var(--ease)' }}
        />
        <circle cx={size / 2} cy={size / 2} r={r - 22} fill="none" stroke="var(--track-hairline)" strokeWidth="1" />
      </svg>
      <div className="ad-clock-center">
        <div className="ad-clock-num">{pct}</div>
        <div className="ad-clock-cap">Coaching Health</div>
      </div>
    </div>
  );
}
