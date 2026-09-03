import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { signOutClean, loadTeamRoster, type TeamMember } from '../lib/api';
import { HqShell } from '../components/hqShell';
import { ScaleMarks } from '../components/scaleMarks';
import { Icon } from '../components/hqUi';
import { useReveal } from '../hqHooks';
import {
  loadRoster, teamMix, loadProfile, loadGoalBundle, createGoal, GOAL_DEFAULTS,
  loadCheckinBundle, loadOpenCommitments, saveStructuredCheckin,
  loadMeetingPrep, setMeetingPrepStatus,
  saveGoalFields, setQuarter, toggleCommitment, addCommitment,
  updateCommitment, deleteCommitment, goalFunnel, QUARTERS,
  readCoachCache, writeCoachCache, firstName, confidence,
  loadTeamLinks,
  ONE_ON_ONE_CHECKLIST, ONE_ON_ONE_CHECKLIST_VERSION, ARCHETYPE_CUES, MET_LABELS, COMMITMENT_STATUS_LABELS,
  type RosterAgent, type Profile, type Goal, type Commitment, type TeamSeg,
  type TeamLink, type CheckinBundle, type CheckinItem, type CheckinItemKind,
  type CommitmentReview, type CommitmentStatus, type MetStatus, type MeetingPrep,
} from '../lib/coachData';
import { scrollKey, saveScroll, readScroll } from '../lib/scrollMemory';
import { Strip } from '../components/rosterViz';
import {
  DeckFocusProvider, useDeckFocus, useDeckKeys,
} from '../components/deckFocus';
import { Odometer } from '../components/odometer';
import { AgentBriefPanel, TeamBriefSection } from '../components/CoachBrief';
import AgentProfile from './AgentProfile';
import { useFlip } from '../lib/deckMotion';
import { CADENCE_DAYS, cadenceEdge, cadenceMark, pastCadence } from '../lib/deckMarks';
import '../truHqDark.css';


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

/* ---- Big team-health gauge — focal, ambient glow ---- */



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
export default function Coach(props: {
  org: { id: string; name: string };
  onHome?: () => void;
  openAgentId?: string | null;
  /** 'sheet' (default) = the 1:1 prep sheet; 'profile' = the full personality profile. */
  openView?: 'sheet' | 'profile';
  onOpenAgent?: (id: string | null) => void;
  onOpenProfile?: (id: string) => void;
}) {
  // One focus scope around the whole page, so the marks in the lead tile, the
  // bars in the small tiles and the rows in the cohort table are three faces
  // of one instrument rather than three separate pictures of one team.
  return (
    <DeckFocusProvider>
      <CoachDeck {...props} />
    </DeckFocusProvider>
  );
}

function CoachDeck({
  org,
  onHome,
  openAgentId = null,
  openView = 'sheet',
  onOpenAgent,
  onOpenProfile,
}: {
  org: { id: string; name: string };
  onHome?: () => void;
  openAgentId?: string | null;
  openView?: 'sheet' | 'profile';
  onOpenAgent?: (id: string | null) => void;
  onOpenProfile?: (id: string) => void;
}) {
  // The whole Coach cohort, assessed or not. The dashboard maths below runs
  // on `roster` (the assessed subset, archetypes are its whole vocabulary);
  // opening a person uses `cohort`, so a 1:1 can be run and logged with
  // someone who has not taken the assessment yet.
  const [cohort, setCohort] = useState<RosterAgent[] | null>(() => readCoachCache(org.id));
  const roster = useMemo(() => (cohort ? cohort.filter((a) => a.assessed) : null), [cohort]);
  const [err, setErr] = useState<string | null>(null);
  // Which agent's 1:1 is open lives in the ROUTE (see lib/coachRoute), so a
  // refresh or the back button returns to the same sheet. `setOpenId` keeps its
  // name and signature so every existing call site is unchanged; it now
  // navigates instead of setting local state. Falls back to local state only
  // when rendered without a router (the ?demo=1 preview).
  const [localOpenId, setLocalOpenId] = useState<string | null>(null);
  const [localView, setLocalView] = useState<'sheet' | 'profile'>('sheet');
  const [briefAgentName, setBriefAgentName] = useState<string | null>(null);
  // The roster table. On a 40-agent team it is the whole page, and the brief
  // above it -- the reason to open this tab -- scrolls off. Collapsed is a
  // choice the leader makes and keeps; it never collapses itself.
  const openId = onOpenAgent ? openAgentId : localOpenId;
  const setOpenId = onOpenAgent
    ?? ((id: string | null) => { setLocalOpenId(id); setLocalView('sheet'); });
  // Which face of the open agent: their 1:1 prep sheet or the full profile.
  const view = onOpenProfile ? openView : localView;
  const openProfile = onOpenProfile
    ?? ((id: string) => { setLocalOpenId(id); setLocalView('profile'); });
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);
  useDeckFocus();
  /* How often you mean to sit down with each of them. A constant until now.
     Drag the marker on the lead tile and the cohort re-tones against the
     cadence you are asking about — "what would it look like if I saw everyone
     weekly?" Nothing is written; it is a question, not a setting. */
  const [cadence, setCadence] = useState<number>(CADENCE_DAYS);

  // Each team's public assessment join link. Best-effort — if it fails to load,
  // the header action hides and the rest of the page is unaffected.
  const [teamLinks, setTeamLinks] = useState<TeamLink[]>([]);
  const [copiedTeam, setCopiedTeam] = useState<string | null>(null);
  // The team as Follow Up Boss reports it — everyone, invited or not, assessed or
  // not. Coach used to be built only from people who had completed the assessment,
  // which meant a leader with a full FUB roster and live scraped conversations saw
  // an empty page. This is the list the page is built on now.
  const [team, setTeam] = useState<TeamMember[]>([]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = await loadRoster(undefined, { includeUnassessed: true });
        if (!live) return;
        writeCoachCache(org.id, r);
        setCohort(r);
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
        const [tl, team] = await Promise.all([
          loadTeamLinks(),
          loadTeamRoster().catch(() => []),
        ]);
        if (!live) return;
        setTeamLinks(tl);
        setTeam(team);
      } catch {
        // Best-effort: header actions + the "not yet assessed" lane just stay
        // empty/hidden if this fails; the coaching dashboard above is unaffected.
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.id]);

  // `view` is a dep because coming BACK from the profile remounts the sheet's
  // .reveal panels with the same openId — without a re-run, nothing observes
  // them and the whole sheet sits at opacity 0 ("it kind of blanks out").
  useReveal([roster, openId, view], canvasRef.current);

  // Everyone in the cohort appears in Coach whether or not they have taken the
  // assessment. This lane used to render ONLY when the archetype dashboard was
  // completely empty, so on a part-assessed team the unassessed vanished from
  // the tab entirely — the owner had invited them, they were ticked into Coach,
  // and Coach showed no trace of them. It renders in both states now.
  /* EVERYONE on the team, which is the list this page should always have been
     built from. Pond accounts and people a leader has taken off the team are the
     only omissions — the first is not a person and the second is an explicit
     decision made on the Team tab.

     Each row carries whatever is actually known about them, in order: their
     archetype once they have been assessed, otherwise where they are in getting
     a login. Nothing is inferred and nothing is left out. */
  const assessedById = useMemo(
    () => new Map((roster ?? []).map((a) => [a.id, a])), [roster],
  );
  const everyone = useMemo(() => team
    .filter((m) => !m.excluded && m.role !== 'pond')
    .map((m) => ({
      id: m.id,
      name: m.name,
      inCoach: m.coaching,
      invited: !!m.invitedAt,
      signedIn: !!m.signedInAt,
      assessed: assessedById.get(m.id) ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name)),
  [team, assessedById]);

  // The counts a leader needs in week one, over the whole team rather than the
  // handful who happen to have finished an assessment.
  const onboarding = useMemo(() => {
    let accepted = 0, invited = 0, noLogin = 0, assessed = 0;
    for (const p of everyone) {
      if (p.assessed) assessed += 1;
      if (!p.invited) noLogin += 1;
      else if (p.signedIn) accepted += 1;
      else invited += 1;
    }
    return { total: everyone.length, accepted, invited, noLogin, assessed };
  }, [everyone]);

  /* THE ROSTER. Every person on the team, always rendered — this is the part a
     leader opens Coach to see. Someone who has been assessed shows their
     archetype; someone who has not shows where they are in getting a login,
     which is the only other true thing there is to say about them. Both are
     one click into their brief, which is built from the scraped Follow Up Boss
     conversations and exists whether or not they ever take the assessment. */
  const teamLane = everyone.length > 0 ? (
    <div className="dk-sec brief-sec reveal">
      <h2>Your team</h2>
      <p>
        Everyone Follow Up Boss reports on this team
        {' · '}{everyone.length} {everyone.length === 1 ? 'person' : 'people'}
      </p>
      <div className="brief-scan" role="list" aria-label="Team roster">
        {everyone.map((p, i) => (
          <article
            className={[
              'rs-plate', 'brief-agent-card', 'is-link',
              /* A person with no assessment is not a problem, so their card is
                 quiet rather than loud. The loud states on this page mean a
                 leader is needed; "hasn't taken it yet" does not. */
              p.assessed ? '' : 'is-quiet',
            ].filter(Boolean).join(' ')}
            role="listitem"
            key={p.id}
            style={{ animationDelay: `${Math.min(i, 10) * 70}ms` }}
            onClick={() => { setBriefAgentName(p.name); setOpenId(p.id); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { setBriefAgentName(p.name); setOpenId(p.id); } }}
            tabIndex={0}
          >
            <header className="brief-agent-top">
              <h3 className="brief-agent-name">{p.name}</h3>
              <span className="brief-agent-stats">
                {p.assessed ? (
                  <span className="brief-stat">{p.assessed.archName}</span>
                ) : !p.invited ? (
                  <span className="brief-stat">No login sent</span>
                ) : p.signedIn ? (
                  <span className="brief-stat">Accepted</span>
                ) : (
                  <span className="brief-stat is-watch">Invited</span>
                )}
              </span>
            </header>
            {/* No score, on purpose. Coaching health is built from check-ins and
                an assessment; inventing one for somebody who has neither would
                be a number a leader could act on and should not. */}
            <p className="brief-agent-meta is-quiet">
              {p.assessed
                ? `Last 1:1 ${p.assessed.lastLabel} · health ${healthOf(p.assessed)}`
                : p.inCoach
                  ? 'Open to run and log their 1:1. Archetype and coaching health appear once they take the TRU assessment.'
                  : p.signedIn
                    ? 'Signed in. Their archetype and coaching health appear once they take the TRU assessment.'
                    : p.invited
                      ? 'Invite delivered. Nothing to score until they set up their login.'
                      : 'Not invited yet. Send them a login from the Team tab.'}
            </p>
          </article>
        ))}
      </div>
    </div>
  ) : null;

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
    // The table IS the leaderboard now — same ordering, no second list of the
    // same four people sitting above it.
    const ranked = [...withHealth].sort((x, y) => y.health - x.health);
    const leaderboard = ranked.slice(0, 4);
    const dueCount = roster.filter((a) => a.due).length;
    const assessed = roster.reduce((s, a) => s + a.takes, 0);
    return { withHealth, ranked, teamHealth, onTrack, needsYou, leaderboard, dueCount, assessed };
  }, [roster]);

  /* The cohort is ranked by coaching health, so its order changes whenever the
     data does. FLIP moves each person to their new place rather than redrawing
     the table under you. */
  const rankOrder = derived ? derived.ranked.map(({ a }) => a.id).join('|') : '';
  useFlip(tableRef, rankOrder);

  /* Walking the cohort from the keyboard, which also walks the dot along the
     cadence scale in the lead tile. Stood down while a coaching sheet is open
     — the sheet owns Escape there, and arrow keys belong to its own content. */
  useDeckKeys({
    keys: derived ? derived.ranked.map(({ a }) => a.id) : [],
    onOpen: (id) => setOpenId(id),
    enabled: !openId && !!derived,
    canQuiet: !!derived && derived.needsYou.length > 0,
  });

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
      {/* Was "Add agents to Coach", a modal that toggled coaching_enabled on a
          copy of the whole roster. It is the same switch the Team tab's In
          Coach column sets, and having both meant two screens could disagree
          about who is in your cohort. One place decides now. */}
      <button
        type="button"
        className="hqbtn hqbtn-primary hqbtn-sm"
        onClick={() => { window.location.hash = '/team'; }}
      >
        <Icon name="roster" size={15} /> Choose your cohort in Team
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

  const openAgent = (cohort ?? roster).find((a) => a.id === openId) || null;

  // An agent named in the weekly brief is not always in the Coach cohort --
  // the cohort is the lead's hand-picked list, and the brief reviews everyone
  // with conversations. Live on 2026-08-25: 0 of Scott Moore's 8 briefed
  // agents were in the cohort, so every click on that team's brief silently
  // did nothing. When the id has no roster row, this holds the name so a
  // brief-only sheet can open instead of nothing.
  const briefOnly = openId && !openAgent ? briefAgentName : null;

  // The furthest-out point on the cadence scale, so the lead tile can name it.
  // `lastDays` uses 99 for "never", which is worse than any real number.
  const driftPeak = (() => {
    const worst = [...roster].sort((a, b) => b.lastDays - a.lastDays)[0];
    if (!worst) return { name: '—', days: 0, never: false };
    return { name: worst.name, days: worst.lastDays, never: worst.lastDays >= 99 };
  })();

  /* ---- the cadence scale ------------------------------------------------
     Coach's lead tile carried a caption about rings at 7, 14 and 30 days over
     an empty card: the picture it described was written, never rendered, and
     the words outlived it. Rather than a second kind of chart, Coach gets the
     SAME instrument Pulse has, on its own axis. Pulse measures a rate against
     your line; Coach measures elapsed days against your cadence. One reading,
     one gesture, two units. The placement rules live in lib/deckMarks. */
  const cadenceHi = cadenceEdge(roster);
  const cadenceMarks = roster.map((a) => cadenceMark(a, cadenceHi, cadence));
  const overCadence = pastCadence(roster, cadence);

  return (
    <div className="tru-dark">
      {/* One layout, open or not. Opening an agent used to drop `dk-main` and
          bring back the old top bar, which is why the sheet looked like a
          different, older product the moment you clicked a name — different
          width, different header, different language. It is the same page. */}
      <HqShell
        orgName={org.name}
        onSignOut={() => signOutClean()}
        nav={coachNav(onHome)}
        hideTopbar
        // Coach's fire is a conversation owed, not a number missed. The room
        // goes ember once somebody has stalled, amber while a re-assessment is
        // due, and sea when the whole cohort is current.
        mood={
          derived && derived.needsYou.length > 0 ? 'hot'
            : derived && derived.dueCount > 0 ? 'watch'
              : 'calm'
        }
        islandSlot={openAgent || briefOnly ? (
          <button className="dk-back" onClick={() => setOpenId(null)}>
            <span aria-hidden>←</span> Team
          </button>
        ) : undefined}
      >
        <div className="coach-canvas dk-main" ref={canvasRef}>
          <div className="coach-ambient" aria-hidden />

          {briefOnly ? (
            /* Their coaching brief in full, without the cohort tooling. The
               1:1 forms and archetype panels need cohort membership to mean
               anything; the brief only needs the report, which exists. */
            <div className="dk-sec">
              <h2>{briefOnly}</h2>
              <p>
                Reviewed in the weekly brief. Not in your Coach cohort yet —
                use "Add agents to Coach" to run 1:1s and track commitments.
              </p>
              <AgentBriefPanel agentId={openId!} agentName={briefOnly} />
            </div>
          ) : openAgent && view === 'profile' ? (
            <AgentProfile agent={openAgent} onBack={() => setOpenId(openAgent.id)} />
          ) : openAgent ? (
            <AgentDrill
              agent={openAgent}
              cohort={derived ? derived.withHealth.map((x) => ({ id: x.a.id, health: x.health })) : []}
              teamHealth={derived ? derived.teamHealth : null}
              onOpenProfile={() => openProfile(openAgent.id)}
            />
          ) : (
            <>
              {roster.length === 0 || !derived || !mix ? (
                <>
                  {/* A team invited this week has real coaching data before it
                      has a single archetype: the weekly brief reviews everyone
                      with conversations, assessed or not. Hiding both behind the
                      empty card told Scott Moore's leader "we have nothing on
                      your team" in the same week we scraped eight of them.

                      The deck keeps its masthead and a row of real tiles here
                      too. Onboarding IS the state of the team in week one, and
                      showing a lone apologetic card in its place read as the
                      product being broken. Nothing on this path is estimated —
                      every number is a count of rows. */}
                  {onboarding.total > 0 && (
                    <>
                      <header className="dk-mast">
                        <div>
                          <span className={onboarding.invited > 0 ? 'dk-eyebrow hot' : 'dk-eyebrow'}>
                            <i />
                            {onboarding.invited > 0
                              ? `${onboarding.invited} still to accept`
                              : 'Everybody is in'}
                          </span>
                          <h1>
                            <em>{onboarding.accepted}</em> of {onboarding.total} in,
                            and the assessment is what fills this page.
                          </h1>
                          <p className="dk-sub">
                            Archetypes, pace and coaching health appear per person as they
                            finish the TRU assessment. Everything below is live now.
                          </p>
                        </div>
                        <div className="dk-mast-do">{context}</div>
                      </header>
                      <section className="dk-bento">
                        {([
                          ['In your cohort', onboarding.total, 'people you added to Coach'],
                          ['Accepted their invite', onboarding.accepted, 'signed in at least once'],
                          ['Invited, not accepted', onboarding.invited, 'email delivered, never opened'],
                          ['No login sent yet', onboarding.noLogin, 'invite them from the Team tab'],
                          ['Assessed', onboarding.assessed, 'they appear in the dashboard'],
                        ] as [string, number, string][]).map(([k, v, u]) => (
                          <div className="rs-plate dk-tile" key={k}>
                            <span className="k">{k}</span>
                            <span className="v"><Odometer value={v} /></span>
                            <span className="u">{u}</span>
                          </div>
                        ))}
                      </section>
                    </>
                  )}
                  <TeamBriefSection
                    onOpenAgent={(id, name) => { setBriefAgentName(name); setOpenId(id); }}
                  />
                  {teamLane ?? (
                    <div className="card ps-emptyview reveal" style={{ padding: 40 }}>
                      <h3>No team yet</h3>
                      <p style={{ color: 'var(--text-60)', marginTop: 8 }}>
                        Nobody has come through from Follow Up Boss for this team. Connect
                        the account on the Team tab and the roster fills in.
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <>
              {/* ============ MASTHEAD ============ */}
              <header className="dk-mast">
                <div>
                  <span className={derived.needsYou.length > 0 ? 'dk-eyebrow hot' : 'dk-eyebrow'}>
                    <i />
                    {derived.needsYou.length > 0
                      ? `${derived.needsYou.length} need you`
                      : 'Everybody is current'}
                  </span>
                  <h1>
                    {mix.segs[0]
                      ? <>Mostly <em>{mix.segs[0].label.toLowerCase()}s</em>, and {derived.onTrack} of {roster.length} on track.</>
                      : <>Your team, at a glance.</>}
                  </h1>
                  <p className="dk-sub">{mix.note}</p>
                </div>
                {/* These actions used to live in the shell's top bar, which
                    Coach hides on this view — so both of them, the cohort link
                    and the assessment link, have been unreachable here since
                    the deck layout landed. The masthead is where a deck page
                    puts its actions. */}
                <div className="dk-mast-do">{context}</div>
              </header>

              {/* ============ THE CADENCE SCALE + THE NUMBERS ============ */}
              <section className="dk-bento">
                {/* The value is the outermost dot on the scale beside it — the
                    person you have gone longest without sitting down with. Not
                    the health score; that is its own tile and its own thing. */}
                <div className="rs-plate dk-tile dk-tile-lead">
                  <span className="k">Longest without a 1:1</span>
                  <span className="v">{driftPeak.never ? 'never' : `${driftPeak.days}d`}</span>
                  <ScaleMarks
                    lo={0} hi={cadenceHi} line={cadence}
                    lineLabel={cadence === CADENCE_DAYS ? `your cadence · ${cadence}d` : `trying ${cadence}d`}
                    onLineChange={setCadence}
                    lineName={`your cadence, currently every ${cadence} days`}
                    marks={cadenceMarks}
                  />
                  <span className="u">
                    {cadence === CADENCE_DAYS
                      ? <>{driftPeak.name} · drag the cadence to ask what a tighter one would mean</>
                      : <><b>{overCadence}</b> of {roster.length} past a {cadence}-day cadence · <button className="sm-reset" onClick={() => setCadence(CADENCE_DAYS)}>back to {CADENCE_DAYS}d</button></>}
                  </span>
                </div>
                {/* Four of the five carry the distribution the number
                    summarises, in the same order every time, so a bar in one
                    tile lines up with the bar under it in the next. The
                    headcount does not — a strip of one bar per agent all the
                    same height would be decoration, and this deck does not
                    draw decoration. */}
                {([
                  ['Agents on roster', roster.length, 'in your cohort', null, null, null],
                  ['On track this week', derived.onTrack, `of ${roster.length}`,
                    'sea', derived.ranked.map(({ a }) => (a.pace === 'On track' ? 1 : 0)),
                    derived.ranked.map(({ a }) => `${a.name} · ${a.pace}`)],
                  ['Due for a re-assessment', derived.dueCount, 'past 90 days',
                    'amber', derived.ranked.map(({ a }) => Math.min(a.days, 120)),
                    derived.ranked.map(({ a }) => `${a.name} · ${a.days >= 99 ? 'never assessed' : `${a.days}d since assessment`}`)],
                  ['Slipping or stalled', derived.needsYou.length,
                    derived.needsYou.length ? 'need a conversation' : 'nobody drifting',
                    'ember', derived.ranked.map(({ a }) => Math.min(a.lastDays, 60)),
                    derived.ranked.map(({ a }) => `${a.name} · ${a.lastDays >= 99 ? 'never' : `${a.lastDays}d`} since a 1:1`)],
                  ['Team coaching health', derived.teamHealth, 'check-ins, cadence, profile',
                    'sea', derived.ranked.map(({ health }) => health),
                    derived.ranked.map(({ a, health }) => `${a.name} · health ${health}`)],
                ] as const).map(([k, n, u, tone, values, labels]) => (
                  <div className="rs-plate dk-tile" key={k}>
                    <span className="k">{k}</span>
                    <span className="v"><Odometer value={n} /></span>
                    {tone && values && labels && (
                      <Strip
                        values={values}
                        tone={tone}
                        keys={derived.ranked.map(({ a }) => a.id)}
                        labels={labels}
                      />
                    )}
                    <span className="u">{u}</span>
                  </div>
                ))}
              </section>

              {/* The archetype mix. It used to sit inside the masthead, which
                  made Coach's header 44px taller than Pulse's and pushed the
                  whole page down relative to the other tabs. */}
              <div className="dk-wiring"><WiringBar segs={mix.segs} /></div>

              {/* ============ THE WEEKLY BRIEF ============ */}
              {/* The Hermes review of last week's Follow Up Boss activity —
                  who to coach on what, with the evidence one click deep. Rows
                  open the agent's sheet, where their full brief lives. */}
              <TeamBriefSection
                onOpenAgent={(id, name) => { setBriefAgentName(name); setOpenId(id); }}
                cohort={(() => {
                  const m = new Map();
                  if (derived) {
                    const needs = new Set(derived.needsYou.map((x) => x.a.id));
                    for (const { a, health } of derived.withHealth) {
                      const meta = { archName: a.archName, health, lastDays: a.lastDays, needsYou: needs.has(a.id) };
                      m.set(a.id, meta);
                      m.set(a.name.trim().toLowerCase(), meta);
                    }
                  }
                  return m;
                })()}
              />


                  {/* The whole team, under the archetype dashboard. That
                      dashboard describes assessed people by definition; this is
                      everyone, which is what a leader came to see. */}
                  {teamLane}
                </>
              )}
            </>
          )}
        </div>
      </HqShell>

    </div>
  );
}


function coachNav(onHome?: () => void) {
  return {
    onHome: () => onHome?.(),
    onOpenPulse: () => { window.location.hash = '/pulse'; },
    onOpenCoach: () => { window.location.hash = '/coach'; },
    onOpenRep: () => { window.location.hash = '/rep'; },
    onOpenTeam: () => { window.location.hash = '/team'; },
  };
}


/* ============================================================
   AGENT DRILL-IN — real profile (archetype + confidence dims from
   deriveProfile) + goals + check-in history.
   ============================================================ */

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

function AgentDrill({ agent, teamHealth, onOpenProfile }: {
  agent: RosterAgent;
  /** Everyone's coaching health, so this one can be shown in context. */
  cohort: Array<{ id: string; health: number }>;
  teamHealth: number | null;
  onOpenProfile: () => void;
}) {
  // Channel fit is pure derivation from the assessment code — no request, no
  // state. Computed here so both the list and the "against the grain" line
  // come from one ranking.

  const [profile, setProfile] = useState<Profile | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [checkins, setCheckins] = useState<CheckinBundle[]>([]);
  const [openCommitments, setOpenCommitments] = useState<CheckinItem[]>([]);
  const [prep, setPrep] = useState<MeetingPrep | null>(null);
  const [writeErr, setWriteErr] = useState<string | null>(null);

  // Remember where the leader was in THIS agent's sheet. Restoring on mount is
  // what makes returning from another tab land on the same line rather than the
  // top — the route gets them back to the right agent, this gets them back to
  // the right place in it.
  useEffect(() => {
    const store = typeof window === 'undefined' ? null : window.sessionStorage;
    const key = scrollKey(agent.id);

    // Deliberately setTimeout rather than requestAnimationFrame: rAF does not
    // run at all while the tab is hidden, so a refresh that lands in a
    // background tab would silently never restore. Retry a few times because
    // the sheet's cards load async and the page is not tall enough to scroll
    // to the saved offset on the first tick.
    const saved = readScroll(store, key);
    const timers: number[] = [];
    if (saved !== null && saved > 0) {
      [0, 80, 250, 600].forEach((delay) => {
        timers.push(window.setTimeout(() => {
          if (Math.abs(window.scrollY - saved) > 2) window.scrollTo({ top: saved });
        }, delay));
      });
    }

    let debounce = 0;
    const onScroll = () => {
      if (debounce) window.clearTimeout(debounce);
      debounce = window.setTimeout(() => { saveScroll(store, key, window.scrollY); }, 120);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    // A tab switch can arrive before the debounce fires — flush so the offset
    // that gets remembered is where they actually were when they left.
    const onHide = () => { saveScroll(store, key, window.scrollY); };
    window.addEventListener('visibilitychange', onHide);

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('visibilitychange', onHide);
      if (debounce) window.clearTimeout(debounce);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [agent.id]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        // loadGoalBundle is read-only; a goal is created from an explicit
        // action on the sheet. Run the
        // reads first so a denied goal-write can't blank the profile/history.
        // loadCheckinBundle (Block 4a/4b) enriches each checkins row with its
        // structured children (checkin_items + checkin_leader) so Past 1:1s can
        // render the richer detail without a second round-trip per row.
        const [p, ci, oc, mp] = await Promise.all([
          loadProfile(agent.id),
          loadCheckinBundle(agent.id),
          loadOpenCommitments(agent.id),
          loadMeetingPrep(agent.id),
        ]);
        if (!live) return;
        setProfile(p);
        setCheckins(ci);
        setOpenCommitments(oc);
        setPrep(mp);
        try {
          const gb = await loadGoalBundle(agent.id, agent.teamId);
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
      {/* The sheet, in the deck's own language.
          Was: a back button, a glowing header band, a hero with a dial, and a
          drawn divider — the vocabulary of the product this replaced. The way
          back now lives in the island bar with everything else. */}
      <header className="dk-mast">
        <div>
          <span className="dk-eyebrow"><i />{agent.assessed ? `${agent.archName} · ${agent.quad}` : 'Not assessed yet'}</span>
          <h1>{agent.name}</h1>
          <p className="dk-sub">
            {profile
              ? profile.tagline
              : agent.assessed
                ? `Stepping into ${first}'s coaching.`
                : `Run and log ${first}'s 1:1 now. Their archetype and playbook appear once they take the TRU assessment.`}
          </p>
        </div>
        {/* The doorway to who they are, where a reader looks first — Eric's
            call after finding it buried at the bottom of the sheet. There is
            no profile to open until they have been assessed. */}
        {agent.assessed && (
          <div className="dk-mast-do">
            <button className="ad-profile-link" onClick={onOpenProfile}>
              {first}’s full profile →
            </button>
          </div>
        )}
      </header>

      {/* The vitals, one quiet line. This replaces four tiles that spent a
          full screen on numbers that only need a glance — the page belongs to
          this week's brief and the 1:1 (Eric's two priorities for Coach). */}
      <div className="ad-vitals">
        <span className="ad-vital">
          <b>{health}</b> coaching health{teamHealth !== null ? <i> · team {teamHealth}</i> : null}
        </span>
        <span className="ad-vital">
          <b>{agent.lastDays >= 99 ? 'never' : `${agent.lastDays}d`}</b> since last 1:1
        </span>
        <span className="ad-vital"><b style={{ color: agent.paceColor }}>{agent.pace}</b></span>
        <span className="ad-vital">
          <b>{agent.days >= 99 ? 'never' : `${agent.days}d`}</b> since assessed
        </span>
      </div>

      {/* Coaching data is read-only on some logins (RLS). Losing this in the
          reformat would have hidden a real failure behind a sheet that just
          looked empty. */}
      {writeErr && (
        <div className="ad-inline-err" role="alert" style={{ marginBottom: 18 }}>
          {writeErr} — coaching data may be read-only on this login.
        </div>
      )}


      {/* THE WEEKLY BRIEF — the top of the page, in full detail with the
          evidence visible. This is the reason a leader opens this sheet: the
          in-depth read on where this agent is struggling, with the exact call
          or note to point at. Renders nothing when no brief system runs for
          this team; renders "not enough reviewed" when the report simply had
          nothing on them — that distinction is deliberate. */}
      <AgentBriefPanel agentId={agent.id} agentName={agent.name} />

      {/* 2. RUN THIS 1:1 — structured leadership form (Block 4b), replacing the
          old yes/no OneOnOneSheet. Writes: checkins + checkin_items + checkin_leader
          via the one-RPC saveStructuredCheckin (COACH_1ON1_STRUCTURED_DESIGN.md §1d). */}
      <RunOneOnOneSheet
        agent={agent}
        checkins={checkins}
        openCommitments={openCommitments}
        prep={prep}
        onPrepHandled={(id, status) => {
          setPrep(null);
          void setMeetingPrepStatus(id, status);
        }}
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
  agent, checkins, openCommitments, prep, onPrepHandled, onLogged,
}: {
  agent: RosterAgent;
  checkins: CheckinBundle[];
  openCommitments: CheckinItem[];
  /** The Fathom notetaker's distilled notes for the latest recorded meeting
   *  with this agent, if one is waiting — offered as a pre-fill, never saved
   *  on its own. Leader-only data (carries a suggested private note). */
  prep: MeetingPrep | null;
  onPrepHandled: (id: string, status: 'applied' | 'dismissed') => void;
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
  // Merge the notetaker's distilled notes into the in-progress draft. Additive
  // and de-duplicated: anything the leader already typed stays; the private
  // note appends rather than replaces. The 1:1 is still only saved by "Log
  // this 1:1" — Apply touches the draft and nothing else.
  function applyPrep() {
    if (!prep?.distilled) return;
    const d = prep.distilled;
    const haveWins = new Set(draft.wins.map((w) => w.trim().toLowerCase()));
    const haveCommits = new Set(draft.commitments.map((c) => c.trim().toLowerCase()));
    const pn = d.privateNote.trim();
    const meetingDate = prep.meetingStart ? prep.meetingStart.slice(0, 10) : '';
    update({
      wins: [...draft.wins, ...d.wins.filter((w) => !haveWins.has(w.trim().toLowerCase()))],
      commitments: [...draft.commitments, ...d.commitments.filter((c) => !haveCommits.has(c.trim().toLowerCase()))],
      privateNote: pn
        ? (draft.privateNote.trim() ? `${draft.privateNote.trim()}\n${pn}` : pn)
        : draft.privateNote,
      // Date the 1:1 the day the meeting actually happened (never the future).
      ...(meetingDate && meetingDate <= todayISODate() ? { date: meetingDate } : {}),
      met: 'yes',
    });
    onPrepHandled(prep.id, 'applied');
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

          {/* Notes from the recorded meeting (Fathom), offered as a pre-fill.
              Apply merges into the draft below — nothing is logged until the
              leader presses "Log this 1:1", same as always. */}
          {prep && (
            <div className="ro-prep">
              <div className="ro-prep-head">
                <span className="ro-prep-title">
                  Meeting notes ready
                  {prep.meetingStart
                    ? ` · ${new Date(prep.meetingStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                    : ''}
                </span>
                <button
                  type="button" className="btn btn-ghost btn-sm ro-prep-btn"
                  onClick={() => onPrepHandled(prep.id, 'dismissed')}
                >
                  Dismiss
                </button>
                {prep.distilled && (
                  <button type="button" className="btn btn-primary btn-sm ro-prep-btn" onClick={applyPrep}>
                    Fill the form
                  </button>
                )}
              </div>
              {prep.distilled ? (
                <div className="ro-prep-body">
                  {prep.distilled.wins.map((w, i) => (
                    <p key={`w${i}`} className="ro-prep-line"><b>Win</b> {w}</p>
                  ))}
                  {prep.distilled.commitments.map((c, i) => (
                    <p key={`c${i}`} className="ro-prep-line"><b>Commit</b> {c}</p>
                  ))}
                  {prep.distilled.privateNote && (
                    <p className="ro-prep-line ro-prep-private"><b>Private</b> {prep.distilled.privateNote}</p>
                  )}
                  {prep.distilled.wins.length === 0 && prep.distilled.commitments.length === 0 && !prep.distilled.privateNote && (
                    <p className="ro-prep-line">Nothing concrete surfaced in this recording.</p>
                  )}
                </div>
              ) : prep.distillError ? (
                <div className="ro-prep-body">
                  <p className="ro-prep-line">The recording arrived but couldn’t be distilled — the notetaker’s own summary:</p>
                  {prep.summaryMd && <pre className="ro-prep-raw">{prep.summaryMd}</pre>}
                </div>
              ) : (
                <p className="ro-prep-line">Distilling the recording — give it a minute and reopen {first}.</p>
              )}
            </div>
          )}

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
  const [making, setMaking] = useState(false);
  const [makeErr, setMakeErr] = useState<string | null>(null);
  const debounce = useRef<number | null>(null);
  useEffect(() => () => { if (debounce.current) window.clearTimeout(debounce.current); }, []);

  async function makeGoal() {
    setMaking(true);
    setMakeErr(null);
    try {
      const gb = await createGoal(agent.id, agent.teamId, agent.code);
      setGoal(gb.goal);
      setCommitments(gb.commitments);
    } catch (e) {
      setMakeErr(e instanceof Error ? e.message : 'Could not set up this goal.');
    } finally {
      setMaking(false);
    }
  }

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
        /* No goal, and opening this page will not invent one. The starting
           numbers are visible before anything is written, because the two
           conversion rates in them are assumptions, not measurements. */
        <div className="ad-move-lead ad-goal-empty">
          <span className="method-badge"><Icon name="target" size={18} /></span>
          <div>
            <p><b>{first} has no goal set.</b></p>
            <p className="ad-goal-empty-note">
              Starting from {GOAL_DEFAULTS.q_goal} contracts this quarter,
              {' '}{GOAL_DEFAULTS.alloc_company} of them from company leads, at
              {' '}{GOAL_DEFAULTS.cvr_company}% company and {GOAL_DEFAULTS.cvr_sphere}% sphere conversion.
              Those two rates are assumptions — change them once you know {first}’s real ones.
            </p>
            <button className="hqbtn hqbtn-primary" disabled={making} onClick={makeGoal}>
              {making ? 'Setting up…' : `Set ${first}’s goal`}
            </button>
            {makeErr && <div className="ad-inline-err" style={{ marginTop: 12 }}>{makeErr}</div>}
          </div>
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

