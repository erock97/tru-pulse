import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { setCoaching, isDemo, signOutClean } from '../lib/api';
import { HqShell } from '../components/hqShell';
import { Avatar, Icon, Ring } from '../components/hqUi';
import { useReveal, useCountUp } from '../hqHooks';
import {
  loadRoster, teamMix, loadProfile, loadGoalBundle,
  loadCheckinBundle, loadOpenCommitments, saveStructuredCheckin,
  saveGoalFields, setQuarter, toggleCommitment, addCommitment,
  updateCommitment, deleteCommitment, goalFunnel, QUARTERS,
  readCoachCache, writeCoachCache, firstName, confidence,
  loadFullRoster, loadTeamLinks,
  ONE_ON_ONE_CHECKLIST, ONE_ON_ONE_CHECKLIST_VERSION, ARCHETYPE_CUES, MET_LABELS, COMMITMENT_STATUS_LABELS,
  type RosterAgent, type Profile, type Goal, type Commitment, type TeamSeg,
  type TeamLink, type CheckinBundle, type CheckinItem, type CheckinItemKind,
  type CommitmentReview, type CommitmentStatus, type MetStatus,
} from '../lib/coachData';
import { CG } from '../lib/assessmentData';
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
          onSignOut={() => signOutClean()}
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
        onSignOut={() => signOutClean()}
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

/* ---- Display titles for the 4 divergence axes (energy/approach/deal/decision). ---- */
const AXIS_TITLE: Record<string, string> = {
  energy: 'Energy', approach: 'Approach', deal: 'Deal Style', decision: 'Decisions',
};

// NOTE: the old deterministic "talking points" list (FeedForward-style, built
// from archetype signal/unlock + pace + last focus) that used to render
// beside the old yes/no OneOnOneSheet is retired by Block 4b's design
// (COACH_1ON1_STRUCTURED_DESIGN.md §4): "left = the guided checklist
// (replacing 'The move' talking points — the archetype-specific pointers
// migrate into checklist cues + the untouched Playbook card above)". The
// archetype-specific coaching content still renders, unchanged, in the
// "How to run their 1:1" Playbook card and the checklist's own cues.

const todayISODate = () => new Date().toISOString().slice(0, 10);

/* ============================================================
   1:1 IN-PROGRESS DRAFT — localStorage, keyed per agent, so
   leaving the drill (back to team, another agent, or a tab/hash
   switch) never loses what a leader has already typed. Mirrors
   the "optimistic + debounced" persistence style used by
   GoalSheet's editGoal (see saveGoalFields below). Best-effort:
   any storage failure is swallowed so the form never breaks.

   v2 (Block 4b, COACH_1ON1_STRUCTURED_DESIGN.md §5) — the richer
   structured form's shape: multi-item wins + a single next-commitments
   list, per-item commitment-review statuses, checklist ticks, met
   tri-state, and the private note. Same storage key as v1 so nobody
   loses an in-flight draft on deploy day — loadOneOnOneDraft migrates an
   old v1 draft ({met:boolean, win, focus, date}) into v2 on read. (An
   in-flight v2 draft that still carries a legacy `focuses` array folds
   those into `commitments` on read — see loadOneOnOneDraft.)
   ============================================================ */
interface OneOnOneDraftV2 {
  v: 2;
  met: MetStatus;
  date: string;
  wins: string[];
  commitments: string[];
  reviews: Record<string, CommitmentStatus>;
  checklist: Record<string, boolean>;
  privateNote: string;
}

const oneOnOneDraftKey = (agentId: string) => `pulse:1on1draft:${agentId}`;

function emptyOneOnOneDraft(): OneOnOneDraftV2 {
  return {
    v: 2, met: 'yes', date: todayISODate(),
    wins: [], commitments: [], reviews: {}, checklist: {}, privateNote: '',
  };
}

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((v) => typeof v === 'string');
}

function loadOneOnOneDraft(agentId: string): OneOnOneDraftV2 | null {
  try {
    const raw = window.localStorage.getItem(oneOnOneDraftKey(agentId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    if (parsed.v === 2) {
      const met: MetStatus = parsed.met === 'yes' || parsed.met === 'partial' || parsed.met === 'no' ? parsed.met : 'yes';
      // A pre-merge v2 draft may still carry a separate `focuses` array; fold it
      // ahead of any commitments so an in-flight draft survives the merge.
      const legacyFocuses = isStringArray(parsed.focuses) ? parsed.focuses : [];
      const commitments = isStringArray(parsed.commitments) ? parsed.commitments : [];
      return {
        v: 2,
        met,
        date: typeof parsed.date === 'string' ? parsed.date : todayISODate(),
        wins: isStringArray(parsed.wins) ? parsed.wins : [],
        commitments: [...legacyFocuses, ...commitments],
        reviews: parsed.reviews && typeof parsed.reviews === 'object' ? parsed.reviews : {},
        checklist: parsed.checklist && typeof parsed.checklist === 'object' ? parsed.checklist : {},
        privateNote: typeof parsed.privateNote === 'string' ? parsed.privateNote : '',
      };
    }

    // v1 migration — { met: boolean, win: string, focus: string, date: string }.
    // Fold the single win into wins, and the single next-focus into the merged
    // commitments list, so an in-flight v1 draft survives instead of vanishing.
    if ('met' in parsed || 'win' in parsed || 'focus' in parsed || 'date' in parsed) {
      const win = typeof parsed.win === 'string' ? parsed.win.trim() : '';
      const focus = typeof parsed.focus === 'string' ? parsed.focus.trim() : '';
      return {
        v: 2,
        met: parsed.met === false ? 'no' : 'yes',
        date: typeof parsed.date === 'string' ? parsed.date : todayISODate(),
        wins: win ? [win] : [],
        commitments: focus ? [focus] : [], reviews: {}, checklist: {}, privateNote: '',
      };
    }
    return null;
  } catch {
    return null;
  }
}

function saveOneOnOneDraft(agentId: string, draft: OneOnOneDraftV2): void {
  try {
    window.localStorage.setItem(oneOnOneDraftKey(agentId), JSON.stringify(draft));
  } catch {
    /* best-effort — a storage failure should never break the form */
  }
}

function clearOneOnOneDraft(agentId: string): void {
  try {
    window.localStorage.removeItem(oneOnOneDraftKey(agentId));
  } catch {
    /* best-effort */
  }
}

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
  const [checkins, setCheckins] = useState<CheckinBundle[]>([]);
  const [openCommitments, setOpenCommitments] = useState<CheckinItem[]>([]);
  const [writeErr, setWriteErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        // loadGoalBundle now CREATES + SEEDS on first open (write path). Run the
        // reads first so a denied goal-write can't blank the profile/history.
        // loadCheckinBundle (Block 4a/4b) enriches each checkins row with its
        // structured children (checkin_items + checkin_leader) so Past 1:1s can
        // render the richer detail without a second round-trip per row.
        const [p, ci, oc] = await Promise.all([
          loadProfile(agent.id),
          loadCheckinBundle(agent.id),
          loadOpenCommitments(agent.id),
        ]);
        if (!live) return;
        setProfile(p);
        setCheckins(ci);
        setOpenCommitments(oc);
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

      {/* PERSONAL PROFILE + DIVERGENCE — only for agents with a personal_code
          (Task 7's baseline assessment). Old-site, business-only agents simply
          don't render these two cards — no crash, no empty headings. */}
      {(profile?.personalType || (profile && profile.divergences.length > 0)) && (
        <div className="ad-grid" style={{ marginTop: 22 }}>
          {profile?.personalType && (
            <section className="card ad-panel">
              <div className="ad-panel-head">
                <h3>Who they are</h3>
                <span className="panel-sub">{profile.personalCode}</span>
              </div>
              <p style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-strong)', marginBottom: 8 }}>
                {profile.personalType.name}
              </p>
              <p style={{ color: 'var(--text-60)', fontSize: 15, marginBottom: 16 }}>{profile.personalType.desc}</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                {profile.personalType.strengths.map((s) => (
                  <span key={s} className="chip">{s}</span>
                ))}
              </div>
              <div className="ad-shift">{profile.personalType.watch}</div>
            </section>
          )}

          {profile && profile.divergences.length > 0 && (
            <section className="card ad-panel">
              <div className="ad-panel-head">
                <h3>Where they diverge</h3>
                <span className="panel-sub">{profile.divergences.length} of 4 axes</span>
              </div>
              <ul className="ad-wired">
                {profile.divergences.map((d) => (
                  <li key={d.axis}>
                    <span className="ad-wired-tag blind">{AXIS_TITLE[d.axis]}</span>
                    <p>In life they’re {d.personalLabel.toLowerCase()}, but at work they show up {d.workLabel.toLowerCase()}.</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {/* THE 1:1 PLAYBOOK — always present for an assessed agent (business code). */}
      {profile && CG[profile.code] && (
        <section className="card ad-panel" style={{ marginTop: 22 }}>
          <div className="ad-panel-head">
            <h3>How to run their 1:1</h3>
            <span className="panel-sub">{agent.archName}</span>
          </div>
          <ul className="ad-wired">
            <li><span className="ad-wired-tag drive">Communicate</span><p>{CG[profile.code].communicate}</p></li>
            <li><span className="ad-wired-tag drive">Motivate</span><p>{CG[profile.code].motivate}</p></li>
            <li><span className="ad-wired-tag blind">Hold accountable</span><p>{CG[profile.code].accountable}</p></li>
            <li><span className="ad-wired-tag blind">In conflict</span><p>{CG[profile.code].conflict}</p></li>
            <li><span className="ad-wired-tag drive">FeedForward ask</span><p>{CG[profile.code].feedforward}</p></li>
          </ul>
        </section>
      )}

      {/* 2. RUN THIS 1:1 — structured leadership form (Block 4b), replacing the
          old yes/no OneOnOneSheet. Writes: checkins + checkin_items + checkin_leader
          via the one-RPC saveStructuredCheckin (COACH_1ON1_STRUCTURED_DESIGN.md §1d). */}
      <RunOneOnOneSheet
        agent={agent}
        checkins={checkins}
        openCommitments={openCommitments}
        onLogged={(bundle, reviews) => {
          setCheckins((prev) => [bundle, ...applyReviewsToCheckins(prev, reviews, bundle.id)]);
          setOpenCommitments((prev) => {
            const reviewedIds = new Set(reviews.map((r) => r.itemId));
            const stillOpen = prev.filter((i) => !reviewedIds.has(i.id));
            const newOpen = bundle.items.filter((i) => i.kind === 'commitment' && i.status === null);
            return [...stillOpen, ...newOpen];
          });
        }}
      />

      {/* 2b. PAST 1:1s — read-back of everything logged above, so a leader can
          reopen any prior conversation before running the next one. */}
      <PastOneOnOnes agent={agent} checkins={checkins} />

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
   RUN THIS 1:1 — the structured leadership form (Block 4b), built to
   COACH_1ON1_STRUCTURED_DESIGN.md §4. Replaces the old yes/no
   OneOnOneSheet. Left column = a compact five-step "tuck-away guide"
   (collapsed by default, tap a step for its cue + archetype cue; ⚡ steps
   auto-tick) plus the leader-only private note; right column = the capture
   groups in meeting order (review last commitments → wins → next
   commitments) + the met tri-state/date/save footer. Nothing persists
   until "Log this 1:1" — saveStructuredCheckin (one RPC) writes
   checkins + checkin_items + checkin_leader together.
   ============================================================ */

// Applies review outcomes recorded in THIS session back onto the items
// they belong to in prior sessions' bundles, so reopening an older 1:1
// in Past 1:1s shows the outcome the leader just set (not "still open").
function applyReviewsToCheckins(
  prev: CheckinBundle[], reviews: CommitmentReview[], newCheckinId: string,
): CheckinBundle[] {
  if (reviews.length === 0) return prev;
  const byId = new Map(reviews.map((r) => [r.itemId, r.status]));
  return prev.map((b) => ({
    ...b,
    items: b.items.map((it) => (byId.has(it.id) ? { ...it, status: byId.get(it.id)!, reviewedIn: newCheckinId } : it)),
  }));
}

const REVIEW_PILL_CLASS: Record<CommitmentStatus, string> = { done: 'yes', partial: 'partial', missed: 'no' };
const MET_PILL_CLASS: Record<MetStatus, string> = { yes: 'yes', partial: 'partial', no: 'no' };

// One multi-add capture group (Wins / Next commitments) — same add-row
// idiom as CommitGroup (Goal & Commitments), just
// without the done-toggle/edit-in-place (these are per-session text items,
// not standing checklist rows).
function MultiAddGroup({
  title, items, placeholder, helper, emptyText, tone = 'accent', onAdd, onRemove,
}: {
  title: string;
  items: string[];
  placeholder: string;
  helper?: string;
  emptyText?: string;
  tone?: 'accent' | 'sea';
  onAdd: (text: string) => void;
  onRemove: (index: number) => void;
}) {
  const [draft, setDraft] = useState('');
  return (
    <div className={`ro-group ro-group-${tone}`}>
      <div className="ro-group-head">
        <span className="ro-group-title">{title}</span>
        {items.length > 0 && <span className="ro-group-count">{items.length}</span>}
      </div>
      {helper && <p className="ro-group-helper">{helper}</p>}
      <div className="ro-rows">
        {items.map((text, i) => (
          <div key={i} className="ro-row">
            <span className="ro-row-dot" aria-hidden />
            <span className="ro-row-text">{text}</span>
            <button type="button" className="ro-row-del" aria-label={`Remove ${title.toLowerCase()} item`} onClick={() => onRemove(i)}>×</button>
          </div>
        ))}
        {items.length === 0 && <p className="ro-empty">{emptyText || 'Nothing added yet.'}</p>}
      </div>
      <form
        className="ro-add"
        onSubmit={(e) => { e.preventDefault(); if (draft.trim()) { onAdd(draft); setDraft(''); } }}
      >
        <input className="ad-input ro-add-input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} />
        <button type="submit" className="btn btn-ghost btn-sm ro-add-btn" disabled={!draft.trim()}>Add</button>
      </form>
    </div>
  );
}

function RunOneOnOneSheet({
  agent, checkins, openCommitments, onLogged,
}: {
  agent: RosterAgent;
  checkins: CheckinBundle[];
  openCommitments: CheckinItem[];
  onLogged: (bundle: CheckinBundle, reviews: CommitmentReview[]) => void;
}) {
  const first = firstName(agent.name);
  const [draft, setDraftState] = useState<OneOnOneDraftV2>(() => loadOneOnOneDraft(agent.id) ?? emptyOneOnOneDraft());
  const [draftRestored, setDraftRestored] = useState(() => !!loadOneOnOneDraft(agent.id));
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [flag, flash] = useSavedFlag();
  const debounce = useRef<number | null>(null);
  const touchedSteps = useRef<Set<string>>(new Set());
  useEffect(() => () => { if (debounce.current) window.clearTimeout(debounce.current); }, []);

  const lastFocus = checkins[0]?.focus || '';
  const daysSinceLast = agent.lastDays >= 99 ? null : agent.lastDays;

  function queueDraftSave(next: OneOnOneDraftV2) {
    if (debounce.current) window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => saveOneOnOneDraft(agent.id, next), 550);
  }
  // Optimistic field edit → debounced draft persist (mirrors GoalSheet's editGoal).
  function update(patch: Partial<OneOnOneDraftV2>) {
    setDraftState((d) => {
      const next = { ...d, ...patch };
      queueDraftSave(next);
      return next;
    });
  }

  // ⚡ auto-tick: review/win/next reflect what the capture groups actually
  // hold, at zero extra clicks — but once a leader manually toggles a given
  // step, that step stops auto-updating (their choice wins from then on).
  useEffect(() => {
    const reviewedAll = openCommitments.length === 0 || openCommitments.every((c) => !!draft.reviews[c.id]);
    const autoVals: Record<string, boolean> = {
      review: reviewedAll,
      win: draft.wins.some((w) => w.trim().length > 0),
      next: draft.commitments.some((c) => c.trim().length > 0),
    };
    setDraftState((d) => {
      let changed = false;
      const nextChecklist = { ...d.checklist };
      Object.entries(autoVals).forEach(([id, val]) => {
        if (touchedSteps.current.has(id)) return;
        if (!!nextChecklist[id] !== val) { nextChecklist[id] = val; changed = true; }
      });
      if (!changed) return d;
      const next = { ...d, checklist: nextChecklist };
      queueDraftSave(next);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.wins, draft.commitments, draft.reviews, openCommitments]);

  function toggleChecklistStep(id: string) {
    touchedSteps.current.add(id);
    update({ checklist: { ...draft.checklist, [id]: !draft.checklist[id] } });
  }
  function setReview(itemId: string, status: CommitmentStatus) {
    update({ reviews: { ...draft.reviews, [itemId]: status } });
  }
  function addWin(t: string) { const s = t.trim(); if (s) update({ wins: [...draft.wins, s] }); }
  function removeWin(i: number) { update({ wins: draft.wins.filter((_, idx) => idx !== i) }); }
  function addCommit(t: string) { const s = t.trim(); if (s) update({ commitments: [...draft.commitments, s] }); }
  function removeCommit(i: number) { update({ commitments: draft.commitments.filter((_, idx) => idx !== i) }); }

  // Not a <form onSubmit> — this column can't be a <form> itself, since each
  // MultiAddGroup below renders its OWN add-row <form> (mirroring CommitGroup's
  // add idiom) and nested <form> elements are invalid HTML: the browser closes
  // the outer form early and an Enter-to-add in a nested form falls through to
  // a real, unhandled page submit (full reload, ?demo=1 lost). "Log this 1:1"
  // is a plain button with an onClick instead.
  async function submit() {
    if (saving) return;
    setSaving(true);
    setErr(null);
    try {
      const reviews: CommitmentReview[] = openCommitments
        .filter((c) => !!draft.reviews[c.id])
        .map((c) => ({ itemId: c.id, status: draft.reviews[c.id] }));
      const wins = draft.wins.map((w) => w.trim()).filter(Boolean);
      const commitmentTexts = draft.commitments.map((c) => c.trim()).filter(Boolean);
      // Local date at noon so it lands on the intended calendar day in any TZ.
      const createdAt = new Date(`${draft.date}T12:00:00`).toISOString();

      const res = await saveStructuredCheckin({
        agentId: agent.id, teamId: agent.teamId, met: draft.met, createdAt,
        wins, commitments: commitmentTexts, reviews,
        checklist: draft.checklist, privateNote: draft.privateNote.trim() || null,
      });
      const checkinId = res?.checkinId ?? `local-${Date.now()}`;
      const now = new Date().toISOString();
      let seq = 0;
      const mkItem = (kind: CheckinItemKind, body: string): CheckinItem => ({
        id: `${checkinId}-item-${seq++}`, agentId: agent.id, checkinId, kind, body,
        position: seq, status: null, reviewedIn: null, createdAt: now,
      });
      const bundle: CheckinBundle = {
        id: checkinId, agent_id: agent.id, created_at: createdAt, met: draft.met,
        // checkins.focus is back-filled from the FIRST next-commitment (mirrors
        // the RPC) so the hero "last / next focus" line, roster pace, and Past
        // 1:1s previews keep working now that "next focuses" is gone.
        leads: null, convos: null, win: wins[0] ?? null, focus: commitmentTexts[0] ?? null,
        items: [
          ...wins.map((w) => mkItem('win', w)),
          ...commitmentTexts.map((c) => mkItem('commitment', c)),
        ],
        leader: {
          checkinId, agentId: agent.id, checklistVersion: ONE_ON_ONE_CHECKLIST_VERSION,
          checklist: draft.checklist, privateNote: draft.privateNote.trim() || null,
          createdAt: now, updatedAt: now,
        },
      };
      onLogged(bundle, reviews);
      if (debounce.current) { window.clearTimeout(debounce.current); debounce.current = null; }
      clearOneOnOneDraft(agent.id);
      setDraftRestored(false);
      touchedSteps.current = new Set();
      setDraftState(emptyOneOnOneDraft());
      flash('Logged');
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Could not log this 1:1 (write denied).');
    } finally {
      setSaving(false);
    }
  }

  const totalSteps = ONE_ON_ONE_CHECKLIST.length;
  const doneStepCount = ONE_ON_ONE_CHECKLIST.filter((s) => !!draft.checklist[s.id]).length;
  const progressPct = Math.round((doneStepCount / totalSteps) * 100);
  const arch = ARCHETYPE_CUES[agent.quad];
  const archLabel = `For ${/^[AEIOU]/i.test(agent.quad) ? 'an' : 'a'} ${agent.quad}`;
  const reviewedCount = openCommitments.filter((c) => !!draft.reviews[c.id]).length;

  return (
    <section className="card ad-panel ad-sheet ro-sheet reveal" data-delay="60">
      <div className="ad-panel-head">
        <h3>Run this 1:1</h3>
        <span className="panel-sub">
          {daysSinceLast == null ? 'No prior check-in' : `Last check-in ${daysSinceLast === 0 ? 'today' : `${daysSinceLast}d ago`}`}
          {lastFocus ? ` · focus: ${lastFocus}` : ''}
        </span>
      </div>

      <div className="ad-sheet-cols ro-cols">
        {/* LEFT — the guided meeting (leader-only, never shown to the agent).
            A compact "tuck-away guide": the five moves render as a lean number
            + short-name strip with the progress meter; a step's full guidance
            and its archetype cue only appear when the leader taps it (accordion,
            one open at a time). Click a number to tick manually; ⚡ steps
            tick themselves. The leader-only private note sits below. */}
        <div className="ad-sheet-block ro-guide">
          <div className="ro-guide-head">
            <div className="ro-guide-heading">
              <span className="ro-eyebrow">The meeting</span>
              <span className="ro-private"><Icon name="target" size={12} /> only you see this</span>
            </div>
            <div className="ro-progress" role="img" aria-label={`${doneStepCount} of ${totalSteps} steps done`}>
              <span className="ro-progress-count">{doneStepCount}<span className="ro-progress-total">/{totalSteps}</span></span>
              <span className="ro-progress-track"><span className="ro-progress-fill" style={{ width: `${progressPct}%` }} /></span>
            </div>
          </div>
          <div className="ro-strip">
            {ONE_ON_ONE_CHECKLIST.map((step, i) => {
              const done = !!draft.checklist[step.id];
              const open = openStep === step.id;
              return (
                <div key={step.id} className={`ro-chip ${done ? 'done' : ''} ${open ? 'open' : ''}`}>
                  <button
                    type="button" className="ro-chip-mark"
                    aria-pressed={done}
                    aria-label={done ? `Mark ${step.short} not done` : `Mark ${step.short} done`}
                    onClick={() => toggleChecklistStep(step.id)}
                  >
                    {done ? <Icon name="coach" size={12} /> : <span className="ro-chip-num">{i + 1}</span>}
                  </button>
                  <button
                    type="button" className="ro-chip-name"
                    aria-expanded={open}
                    onClick={() => setOpenStep(open ? null : step.id)}
                  >
                    {step.short}
                    {step.auto && <span className="ro-chip-auto" title="Ticks itself when its section is filled in">⚡</span>}
                  </button>
                </div>
              );
            })}
          </div>
          {openStep && (() => {
            const step = ONE_ON_ONE_CHECKLIST.find((s) => s.id === openStep)!;
            const archCue = step.id === 'win' ? arch?.praise : step.id === 'coach' ? arch?.coach : null;
            return (
              <div className="ro-cue-panel">
                <div className="ro-cue-panel-head">
                  <span className="ro-cue-panel-title">{step.title}</span>
                  <button type="button" className="ro-cue-panel-close" aria-label="Hide guidance" onClick={() => setOpenStep(null)}>×</button>
                </div>
                <p className="ro-cue-panel-body">{step.cue}</p>
                {archCue && (
                  <div className="ro-arch-cue">
                    <span className="ro-arch-tag">{archLabel}</span>
                    <p>{archCue}</p>
                  </div>
                )}
              </div>
            );
          })()}

          <div className="ro-note">
            <div className="ro-note-head">
              <Icon name="target" size={13} />
              <span>Private note</span>
              <span className="ro-note-hint">never shown to {first}</span>
            </div>
            <textarea
              className="ad-input ad-textarea ro-note-input" rows={3} value={draft.privateNote}
              onChange={(e) => update({ privateNote: e.target.value })}
              placeholder="Coaching context to remember before next time — for your eyes only."
            />
          </div>
        </div>

        {/* RIGHT — the capture form, in meeting order. A <div>, not a <form> —
            see the note on submit() above: the MultiAddGroups below each own a
            real add-row <form>, and forms cannot nest. */}
        <div className="ad-sheet-block ad-logform ro-capture">
          <div className="ro-guide-head ro-capture-head">
            <span className="ro-eyebrow">Capture</span>
            <div className="ro-flags">
              {draftRestored && <span className="ad-draft-note">Draft restored</span>}
              {flag && <span className="ad-saved">{flag}</span>}
            </div>
          </div>

          <div className="ro-group ro-group-review">
            <div className="ro-group-head">
              <span className="ro-group-title">From last time</span>
              {openCommitments.length > 0 && (
                <span className="ro-group-count">{reviewedCount}/{openCommitments.length}</span>
              )}
            </div>
            <p className="ro-group-helper">Mark how each commitment landed before setting new ones.</p>
            <div className="ro-rows">
              {openCommitments.map((item) => (
                <div key={item.id} className="ro-review-row">
                  <span className="ro-review-text">{item.body}</span>
                  <div className="ro-review-pills">
                    {(['done', 'partial', 'missed'] as CommitmentStatus[]).map((s) => (
                      <button
                        key={s} type="button"
                        className={`ad-met-pill ad-met-pill-btn ${REVIEW_PILL_CLASS[s]} ${draft.reviews[item.id] === s ? 'active' : ''}`}
                        onClick={() => setReview(item.id, s)}
                      >
                        {COMMITMENT_STATUS_LABELS[s]}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {openCommitments.length === 0 && (
                <p className="ro-empty">No open commitments from a prior 1:1 — set the first ones below.</p>
              )}
            </div>
          </div>

          <MultiAddGroup
            title="Wins" tone="sea" items={draft.wins}
            helper="Celebrate first — name the exact behavior."
            placeholder={`Something ${first} did well…`}
            emptyText="No wins noted yet."
            onAdd={addWin} onRemove={removeWin}
          />
          <MultiAddGroup
            title="Next commitments" items={draft.commitments}
            helper="Specific and countable — you’ll review these next 1:1."
            placeholder="e.g. “20 sphere conversations by Fri”…"
            emptyText="No commitments set yet."
            onAdd={addCommit} onRemove={removeCommit}
          />

          {err && <div className="ad-inline-err">{err}</div>}

          <div className="ro-footer">
            <div className="ro-footer-field">
              <span className="ro-footer-label">Did you meet?</span>
              <div className="ad-met-row">
                {(['yes', 'partial', 'no'] as MetStatus[]).map((m) => (
                  <button
                    key={m} type="button"
                    className={`ad-met-pill ad-met-pill-btn ${MET_PILL_CLASS[m]} ${draft.met === m ? 'active' : ''}`}
                    onClick={() => update({ met: m })}
                  >
                    {MET_LABELS[m]}
                  </button>
                ))}
              </div>
            </div>
            <div className="ro-footer-field ro-footer-date">
              <span className="ro-footer-label">Date</span>
              <input
                type="date" value={draft.date} max={todayISODate()}
                onChange={(e) => update({ date: e.target.value })} className="ad-input"
              />
            </div>
            <button type="button" className="btn btn-primary btn-sm ro-log-btn" disabled={saving} onClick={() => { void submit(); }}>
              <Icon name="coach" size={16} /> {saving ? 'Logging…' : 'Log this 1:1'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================
   PAST 1:1s — read-back history for the drill-in. Every check-in
   logged above (or, in ?demo=1, seeded) is already loaded onto
   AgentDrill's `checkins` state; this just gives it somewhere to
   be seen. Newest first, collapsed to a one-line summary, click to
   expand the full notes — same click-to-open/caret language as
   Rep's roster rows (rp-agent / rp-caret).
   ============================================================ */
function checkinDateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const MET_STATUS: Record<string, { cls: string; label: string }> = {
  yes: { cls: 'yes', label: 'Met' },
  true: { cls: 'yes', label: 'Met' },
  partial: { cls: 'partial', label: 'Partial' },
  no: { cls: 'no', label: 'Missed' },
  false: { cls: 'no', label: 'Missed' },
};
function metStatus(met: unknown): { cls: string; label: string } {
  return MET_STATUS[String(met)] || { cls: 'unknown', label: '—' };
}

function PastOneOnOnes({ agent, checkins }: { agent: RosterAgent; checkins: CheckinBundle[] }) {
  const first = firstName(agent.name);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <section className="card ad-panel ad-sheet reveal" data-delay="80">
      <div className="ad-panel-head">
        <h3>Past 1:1s</h3>
        <span className="panel-sub">
          {checkins.length > 0 ? `${checkins.length} logged` : 'No history yet'}
        </span>
      </div>

      {checkins.length === 0 ? (
        <div className="ad-move-lead">
          <span className="method-badge"><Icon name="coach" size={18} /></span>
          <p>No logged 1:1s yet — once you log one above, it’ll show up here so you can reopen it before {first}’s next check-in.</p>
        </div>
      ) : (
        <div className="ad-checkins">
          {checkins.map((c) => {
            const isOpen = openId === c.id;
            const status = metStatus(c.met);
            const preview = c.win && c.focus
              ? `${c.win} · Next: ${c.focus}`
              : c.win || (c.focus ? `Next: ${c.focus}` : 'No notes logged');
            // A structured session (Block 4b) has checkin_items and/or a
            // checkin_leader row; legacy quick check-ins have neither and
            // fall back to the original win/focus-only detail below.
            const wins = c.items.filter((i) => i.kind === 'win');
            const commitmentItems = c.items.filter((i) => i.kind === 'commitment');
            const isStructured = c.items.length > 0 || !!c.leader;
            const checklistDone = c.leader ? ONE_ON_ONE_CHECKLIST.filter((s) => c.leader!.checklist[s.id]).length : 0;
            return (
              <div key={c.id} className={`ad-checkin ${isOpen ? 'open' : ''}`}>
                <button
                  type="button"
                  className="ad-checkin-row"
                  aria-expanded={isOpen}
                  onClick={() => setOpenId(isOpen ? null : c.id)}
                >
                  <span className="ad-checkin-date">{checkinDateLabel(c.created_at)}</span>
                  <span className={`ad-met-pill ${status.cls}`}>{status.label}</span>
                  <span className="ad-checkin-focus">{preview}</span>
                  <span className="ad-checkin-caret">{isOpen ? '▾' : '▸'}</span>
                </button>
                {isOpen && (
                  <div className="ad-checkin-detail ro-past">
                    {isStructured ? (
                      <>
                        <div className="ad-checkin-detail-row">
                          <span className="ad-checkin-detail-label ro-past-label ro-past-win">Wins</span>
                          {wins.length > 0 ? (
                            <ul className="ad-detail-list">
                              {wins.map((w) => <li key={w.id}>{w.body}</li>)}
                            </ul>
                          ) : <p className="ad-checkin-detail-text muted">Nothing noted.</p>}
                        </div>
                        <div className="ad-checkin-detail-row">
                          <span className="ad-checkin-detail-label ro-past-label">Next commitments</span>
                          {commitmentItems.length > 0 ? (
                            <ul className="ad-detail-list ad-detail-list-commit">
                              {commitmentItems.map((ci) => (
                                <li key={ci.id}>
                                  <span>{ci.body}</span>
                                  {ci.status ? (
                                    <span className={`ad-met-pill ${REVIEW_PILL_CLASS[ci.status]}`}>{COMMITMENT_STATUS_LABELS[ci.status]}</span>
                                  ) : (
                                    <span className="ad-met-pill unknown">Open</span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          ) : <p className="ad-checkin-detail-text muted">None set.</p>}
                        </div>
                        {c.leader && (
                          <div className="ro-leader-block">
                            <div className="ro-leader-head">
                              <Icon name="target" size={12} />
                              <span>Leader-only</span>
                              <span className="ro-leader-count">{checklistDone}/{ONE_ON_ONE_CHECKLIST.length} steps</span>
                            </div>
                            <p className="ro-leader-note">{c.leader.privateNote || 'No private note.'}</p>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="ad-checkin-detail-row">
                          <span className="ad-checkin-detail-label ro-past-label ro-past-win">Win</span>
                          <p className="ad-checkin-detail-text">{c.win || 'Nothing noted.'}</p>
                        </div>
                        <div className="ad-checkin-detail-row">
                          <span className="ad-checkin-detail-label ro-past-label">Next focus</span>
                          <p className="ad-checkin-detail-text">{c.focus || 'Nothing noted.'}</p>
                        </div>
                      </>
                    )}

                    {(c.leads != null || c.convos != null) && (
                      <div className="ad-checkin-detail-row">
                        <span className="ad-checkin-detail-label ro-past-label">Activity</span>
                        <span className="ad-checkin-nums">
                          {c.leads != null ? `${c.leads} leads` : ''}
                          {c.leads != null && c.convos != null ? ' · ' : ''}
                          {c.convos != null ? `${c.convos} convos` : ''}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
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
