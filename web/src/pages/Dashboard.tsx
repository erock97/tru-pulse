import { useEffect, useMemo, useRef, useState, type ReactNode, type ChangeEvent } from 'react';
import { loadDashboard, saveSettings, setAgentPause, signOutClean, type DashboardData, type Settings, type LeadRow } from '../lib/api';
import { payModel, PAY_LABEL, isClosing, isOfferPlus, stageClass } from '../../../shared/flags';
import { CountUp, SOURCE_COLORS } from '../components/viz';
import { FubConnect } from '../components/FubConnect';
import { HqShell } from '../components/hqShell';
import { Icon } from '../components/hqUi';
import { useReveal, useCountUp } from '../hqHooks';
import '../truHqDark.css';

/* ============================================================
   PULSE (Dashboard) — dark asymmetric BENTO reskin.
   PRESENTATION ONLY. Every number below flows from the SAME real
   computed values the previous render used — loadDashboard(),
   the per-agent rollup, source mix, person-stage production,
   commission-at-risk, accountability + pause-watch. No mock data.
   ============================================================ */

const money = (n: number) => '$' + Math.round(n).toLocaleString();
const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
// A lead's accountable owner: the agent, else its pond (ponds get their own rows —
// that's where unowned leads hide), else Unassigned.
const ownerOf = (l: LeadRow) => l.assigned_to || (l.pond ? `Pond · ${l.pond}` : 'Unassigned');
const isPerson = (owner: string) => owner !== 'Unassigned' && !owner.startsWith('Pond · ');

type View = 'overview' | 'accountability' | 'sources' | 'settings';
type Win = '7' | '14' | 'mtd' | '90' | '180' | '365';
const WINDOWS: Array<[Win, string]> = [['7', '7d'], ['14', '14d'], ['mtd', 'MTD'], ['90', '90d'], ['180', '6mo'], ['365', '12mo']];

// Pause watch — why an agent is paused from new leads. 'capacity' = hit the
// monthly volume cap; 'no_close' = took N leads since their last under-contract.
interface PauseReason { kind: 'capacity' | 'no_close'; count: number; cap: number }

// Per-agent CURRENT-STAGE, CREATED-DATE-WINDOWED counts (computed straight off
// `leads` — see the baseline block below). Keyed by norm(agent) in Drill.stats,
// same convention as Drill.closings/contacts/paused below. Period-over-period
// ▲/▼ trend arrows are removed for now — they depended on `person_stage_log`
// dated history, which has no reliable backfill (tracking starts going
// forward). They return once that log accrues history; shared/metrics.ts
// (computeAgentTrends) stays in place for that future layer.
interface AgentStat { offersReached: number; closings: number }

interface Drill {
  leads: LeadRow[];
  contacts: Map<string, { email: string | null; phone: string | null }>;
  subs: Map<string, string | null>;
  closings: Map<string, number>;
  paused: Map<string, PauseReason[]>;
  stats: Map<string, AgentStat>;
}

// A per-agent record used by the constellation / triage / roster. `agent` is the
// display owner string; every field is a REAL rollup value (see below).
// status: 'paused' is MANUAL ONLY — set when a leader ticks "Pause this agent" in
// the drill (agents.is_paused). Auto pause-watch rules (capacity / no-close) and the
// strike limit are a SOFT hint (`pauseRecommended`) — they never claim "Paused".
type AgentStatus = 'on_track' | 'at_risk' | 'paused';
interface AgentNode {
  agent: string;
  person: boolean;
  total: number;
  zero: number;
  stuck: number;
  worked: number;
  workedPct: number;
  strikes: number;
  paused: PauseReason[];      // auto pause-watch recommendation reasons (NOT manual)
  pauseRecommended: boolean;  // true when an auto rule tripped (pause-watch or strikes)
  agentId: string | null;     // agents.id — null when unmatched (pond/unassigned/demo)
  pauseReason: string | null; // manual pause reason code, when is_paused
  pauseNote: string | null;   // manual pause free-text note (reason = 'other')
  pausedAt: string | null;    // manual pause timestamp
  source: string;      // the agent's dominant lead source (for the source lens)
  srcs: Map<string, number>;
  status: AgentStatus;
}

const STATUS_META: Record<AgentStatus, { label: string; color: string; soft: string }> = {
  on_track: { label: 'On track', color: 'var(--sea-hi)', soft: 'var(--sea-soft)' },
  at_risk: { label: 'At risk', color: 'var(--accent-hi)', soft: 'var(--accent-soft)' },
  paused: { label: 'Paused', color: 'var(--terracotta)', soft: 'rgba(192,107,79,0.14)' },
};

// Manual pause reasons (agents.pause_reason) — mirrors db/hq_agent_pause.sql.
const PAUSE_REASONS: Array<[string, string]> = [
  ['at_capacity', 'At capacity'],
  ['no_closings', 'No closings'],
  ['on_leave', 'On leave'],
  ['coaching', 'Coaching'],
  ['other', 'Other'],
];
const PAUSE_REASON_LABEL: Record<string, string> = Object.fromEntries(PAUSE_REASONS);
const pauseTitle = (a: { pauseReason: string | null; pauseNote: string | null }) =>
  a.pauseReason ? (PAUSE_REASON_LABEL[a.pauseReason] ?? a.pauseReason) + (a.pauseNote ? `: ${a.pauseNote}` : '') : 'Paused';

// Module-level cache (keyed by org) so returning to Pulse renders INSTANTLY from the
// last load and refreshes in the background — no spinner flash on Home→Pulse. Keyed
// by org.id so an impersonation switch never flashes the previous team's data.
let _dashCache: { orgId: string; data: DashboardData } | null = null;

export default function Dashboard({ org, onHome }: { org: { id: string; name: string }; onHome?: () => void }) {
  const [data, setData] = useState<DashboardData | null>(
    _dashCache && _dashCache.orgId === org.id ? _dashCache.data : null,
  );
  const [view, setView] = useState<View>('overview');
  // Remember the selected window across reloads — Chrome's Memory Saver discards a
  // backgrounded tab, and a leader shouldn't land back on MTD after checking a lead.
  const [win, setWin] = useState<Win>(() => {
    try { return (sessionStorage.getItem('pulse.win') as Win) || 'mtd'; } catch { return 'mtd'; }
  });
  useEffect(() => {
    try { sessionStorage.setItem('pulse.win', win); } catch { /* private mode */ }
  }, [win]);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  async function load() {
    const d = await loadDashboard();
    _dashCache = { orgId: org.id, data: d };
    setData(d);
  }
  useEffect(() => {
    void load();
    // Live-ish: re-pull from Supabase every 60s (the Worker cron + FUB webhook keep
    // it fresh) so the board updates on its own — no manual refresh button.
    const id = setInterval(() => void load(), 60_000);
    return () => clearInterval(id);
  }, []);

  // Reveal the fade-up sections once data has painted (scoped to this subtree).
  useReveal([data, view], canvasRef.current);

  if (!data) {
    return (
      <div className="tru-dark">
        <div className="center-wrap" style={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}>
          <div className="spinner" />
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // REAL DATA PIPELINE — unchanged from the prior render. Every value below is
  // computed exactly as before; only the JSX that consumes it is new.
  // ══════════════════════════════════════════════════════════════════════════

  // Date window — leads without a created date stay visible in every window.
  const today = new Date();
  const cutoff = win === 'mtd'
    ? new Date(today.getFullYear(), today.getMonth(), 1).getTime()
    : Date.now() - Number(win) * 86400_000;
  // Source filter — Settings lets a leader check only the sources they pay for.
  const enabledSources = data.settings?.sources && data.settings.sources.length ? data.settings.sources : null;
  const leads = data.leads.filter((l) =>
    (!l.fub_created || Date.parse(l.fub_created) >= cutoff) &&
    (!enabledSources || enabledSources.includes(l.source_family ?? 'Other')));

  const total = leads.length;
  const zero = leads.filter((l) => l.flag === 'zero_contact').length;
  const stuck = leads.filter((l) => l.flag === 'stuck').length;
  const worked = leads.filter((l) => l.flag === 'worked').length;
  const workedPct = total ? Math.round((worked / total) * 100) : 0;

  const avgGci = Number(data.settings?.avg_gci ?? 4000);
  const closeRate = Number(data.settings?.close_rate ?? 2);
  const capacity = Number(data.settings?.per_agent_capacity ?? 20);
  const strikeLimit = Number(data.settings?.strike_limit ?? 3);
  const winDays = win === 'mtd' ? Math.max(1, today.getDate()) : Number(win);

  // Production — BASELINE (Eric, 2026-07-07): CURRENT STAGE, CREATED-DATE-WINDOWED,
  // computed directly off `leads` (the same created-date + source windowed set as
  // `total` above). This SUPERSEDES the prior person_stage_log / achievement-date
  // approach in docs/accuracy-definitions.md. isClosing = UC or Closed, current
  // stage (Eric's rule: UC == Closed). isOfferPlus = offer-or-beyond, carry-forward
  // (a lead currently sitting in UC/Closed still counts as having reached offer —
  // never a false 0). Both the counts and the two "1 : N" ratios below move with
  // the window tab (7/14/mtd/90/180/365, 12mo is the primary view).
  const closingsCount = leads.filter((l) => isClosing(stageClass(l.stage))).length;
  const offersReached = leads.filter((l) => isOfferPlus(stageClass(l.stage))).length;
  const gciInPlay = closingsCount * avgGci;
  // "Leads per closing" / "Leads per offer" — 1 : N, N = leads in window ÷ count.
  const perClosingLabel = closingsCount > 0 ? `1 : ${Math.max(1, Math.round(total / closingsCount))}` : '—';
  const offerRatioLabel = offersReached > 0 ? `1 : ${Math.max(1, Math.round(total / offersReached))}` : '—';

  // Commission at risk — priced with each source's REAL conversion from this team's
  // own outcomes. A "closing" is a lead whose PERSON STAGE is Under Contract / Closed
  // (never the Deals tab). UC counts the same as Closed (Eric's rule). A source with no
  // closings yet falls back to the close-rate setting so risk never reads $0 on young
  // data. Conversion uses ALL synced leads (stable), applied to the zero-contact leads
  // in the current window.
  const allLeadsBySrc = new Map<string, number>();
  const closingsBySrc = new Map<string, number>();
  for (const l of data.leads) {
    const s = l.source_family ?? 'Other';
    allLeadsBySrc.set(s, (allLeadsBySrc.get(s) ?? 0) + 1);
    if (isClosing(stageClass(l.stage))) closingsBySrc.set(s, (closingsBySrc.get(s) ?? 0) + 1);
  }
  const convOf = (s: string) => {
    const nAll = allLeadsBySrc.get(s) ?? 0;
    const cAll = closingsBySrc.get(s) ?? 0;
    return cAll > 0 && nAll > 0 ? cAll / nAll : closeRate / 100;
  };
  let riskWin = 0;
  for (const l of leads) {
    if (l.flag === 'zero_contact') riskWin += convOf(l.source_family ?? 'Other') * avgGci;
  }
  const risk = { window: riskWin, annual: riskWin * (365 / Math.max(winDays, 1)) };

  // Per-agent rollup (srcs = this agent's lead count broken out by source family,
  // shown right in the row so lead distribution is visible without drilling).
  const byAgent = new Map<string, { zero: number; stuck: number; worked: number; total: number; srcs: Map<string, number> }>();
  for (const l of leads) {
    const a = ownerOf(l);
    const r = byAgent.get(a) ?? { zero: 0, stuck: 0, worked: 0, total: 0, srcs: new Map<string, number>() };
    r.total++;
    const sf = l.source_family || 'Other';
    r.srcs.set(sf, (r.srcs.get(sf) ?? 0) + 1);
    if (l.flag === 'zero_contact') r.zero++;
    else if (l.flag === 'stuck') r.stuck++;
    else if (l.flag === 'worked') r.worked++;
    byAgent.set(a, r);
  }
  const agents = [...byAgent.entries()].sort((a, b) => b[1].zero + b[1].stuck - (a[1].zero + a[1].stuck));

  // Drill-down context: contact info per agent (from the shared agents rows) +
  // FUB subdomain per team (for per-lead links).
  const contacts = new Map<string, { email: string | null; phone: string | null }>();
  for (const a of data.agents) contacts.set(norm(a.name), { email: a.email, phone: a.phone });
  // Manual pause lookup — the SOLE source of truth for "Paused" (see AgentNode above).
  const pauseByAgent = new Map<string, { id: string; is_paused: boolean; pause_reason: string | null; pause_note: string | null; paused_at: string | null }>();
  for (const a of data.agents) {
    pauseByAgent.set(norm(a.name), { id: a.id, is_paused: a.is_paused, pause_reason: a.pause_reason, pause_note: a.pause_note, paused_at: a.paused_at });
  }
  const subs = new Map<string, string | null>();
  for (const t of data.teams) subs.set(t.id, t.fub_subdomain);

  // Source mix + per-source flag breakdown + pay-model split.
  const bySource = new Map<string, { total: number; zero: number; stuck: number; worked: number; closings: number }>();
  for (const l of leads) {
    const s = l.source_family || 'Other';
    const r = bySource.get(s) ?? { total: 0, zero: 0, stuck: 0, worked: 0, closings: 0 };
    r.total++;
    if (l.flag === 'zero_contact') r.zero++;
    else if (l.flag === 'stuck') r.stuck++;
    else if (l.flag === 'worked') r.worked++;
    if (isClosing(stageClass(l.stage))) r.closings++;
    bySource.set(s, r);
  }
  const sources = [...bySource.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name, r]) => ({
      name, n: r.total, zero: r.zero, stuck: r.stuck, worked: r.worked,
      workedPct: r.total ? Math.round((r.worked / r.total) * 100) : 0,
      c: SOURCE_COLORS[name] ?? SOURCE_COLORS.Other,
      pay: payModel(name),
      // Closed + conversion are the SAME baseline as the tiles above: current
      // stage, created-date-windowed, straight off this source's slice of `leads`.
      closed: r.closings,
      convLabel: r.closings > 0 ? `1 : ${Math.max(1, Math.round(r.total / r.closings))}` : '—',
    }));
  const upfront = sources.filter((s) => s.pay === 'upfront').reduce((s, x) => s + x.n, 0);
  const atClose = sources.filter((s) => s.pay === 'atclose').reduce((s, x) => s + x.n, 0);

  // Accountability rollup (strike cases are already a 30-day window server-side).
  const strikesByAgent = new Map<string, number>();
  for (const c of data.cases) {
    const a = c.assigned_to || 'Unassigned';
    strikesByAgent.set(a, (strikesByAgent.get(a) ?? 0) + 1);
  }
  const pauseCount = [...strikesByAgent.values()].filter((n) => n >= strikeLimit).length;
  const newStrikes7d = data.cases.filter((c) => Date.parse(c.opened_at) >= Date.now() - 7 * 86400_000).length;
  const openCases = data.cases.filter((c) => c.status === 'open').length;
  const activeAgents = [...byAgent.keys()].filter((a) => isPerson(a)).length;
  const headroom = Math.max(0, activeAgents * capacity - total);

  // ── Pause watch — broker-set rules (Settings) that pause new lead flow ──────
  const pauseVolumeOn = data.settings?.pause_volume_on !== false;       // default on (existing behavior)
  const pauseVolumeLeads = Math.max(1, Number(data.settings?.pause_volume_leads ?? capacity)); // own threshold; falls back to capacity
  const pauseNoCloseOn = data.settings?.pause_no_close_on === true;     // broker opts in
  const pauseNoCloseLeads = Math.max(1, Number(data.settings?.pause_no_close_leads ?? 30));
  // Clean slate: only judge the no-closings drought over the era we've actually been
  // tracking closings. FUB has no stage history, so a legacy book reads as "never
  // produced" and falsely trips the rule. null = count all history (today's behavior).
  const pauseNoCloseSince = data.settings?.pause_no_close_since ? Date.parse(data.settings.pause_no_close_since) : null;
  const pausedByAgent = new Map<string, PauseReason[]>();
  const addPause = (a: string, r: PauseReason) => pausedByAgent.set(a, [...(pausedByAgent.get(a) ?? []), r]);

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
  if (pauseVolumeOn) {
    const monthByAgent = new Map<string, number>();
    for (const l of data.leads) {
      if (!l.assigned_to) continue;
      if (l.fub_created && Date.parse(l.fub_created) < monthStart) continue;
      monthByAgent.set(l.assigned_to, (monthByAgent.get(l.assigned_to) ?? 0) + 1);
    }
    for (const [a, n] of monthByAgent) if (n >= pauseVolumeLeads) addPause(a, { kind: 'capacity', count: n, cap: pauseVolumeLeads });
  }
  if (pauseNoCloseOn) {
    // Carry-forward: a lead "produced" if it EVER reached Under Contract / Closed
    // per the dated person_stage_log — not the current-stage snapshot. So a deal
    // that went UC then fell through (or advanced past UC) still counts as a
    // production point and resets the drought, instead of falsely penalizing the
    // agent. Seed (pre-log) hits are intentionally included here: "did it ever
    // happen" doesn't need a date. (docs/accuracy-definitions.md — the same
    // carry-forward principle behind offer rate / closings.)
    const producedPersons = new Set<number>();
    for (const h of data.stageLog) {
      if (h.fub_person_id != null && (h.stage_class === 'uc' || h.stage_class === 'closed')) producedPersons.add(h.fub_person_id);
    }
    const leadsByAgent = new Map<string, LeadRow[]>();
    for (const l of data.leads) {
      if (!l.assigned_to) continue;
      if (pauseNoCloseSince != null) {
        if (!l.fub_created) continue;                                 // unknown intake date → exclude while a slate is set
        if (Date.parse(l.fub_created) < pauseNoCloseSince) continue;  // pre-slate lead → doesn't count toward the drought
      }
      const arr = leadsByAgent.get(l.assigned_to);
      if (arr) arr.push(l); else leadsByAgent.set(l.assigned_to, [l]);
    }
    for (const [a, ls] of leadsByAgent) {
      if (ls.length < pauseNoCloseLeads) continue;                                     // not enough leads to be a drought
      if (ls.some((l) => stageClass(l.stage) === 'uc')) continue;                      // a lead under contract right now → producing
      const byNewest = [...ls].sort((x, y) =>
        (y.fub_created ? Date.parse(y.fub_created) : 0) - (x.fub_created ? Date.parse(x.fub_created) : 0));
      let drought = byNewest.length;
      for (let i = 0; i < byNewest.length; i++) {
        const pid = byNewest[i].fub_person_id;
        if (pid != null && producedPersons.has(pid)) { drought = i; break; }           // carry-forward: ever reached UC/closed
      }
      if (drought >= pauseNoCloseLeads) addPause(a, { kind: 'no_close', count: drought, cap: pauseNoCloseLeads });
    }
  }
  const pausedCount = pausedByAgent.size;

  // Per-agent offers/closings — SAME baseline as the team tiles: current stage,
  // created-date-windowed, straight off `leads` via ownerOf(). Trend arrows
  // (▲/▼ vs the prior period) are removed for now — see the AgentStat comment
  // above; they return once person_stage_log accrues real dated history.
  const statsByAgent = new Map<string, AgentStat>();
  for (const l of leads) {
    const a = norm(ownerOf(l));
    const r = statsByAgent.get(a) ?? { offersReached: 0, closings: 0 };
    const sc = stageClass(l.stage);
    if (isOfferPlus(sc)) r.offersReached++;
    if (isClosing(sc)) r.closings++;
    statsByAgent.set(a, r);
  }
  const closingsByAgent = new Map<string, number>();
  for (const [a, r] of statsByAgent) if (r.closings > 0) closingsByAgent.set(a, r.closings);
  const drill: Drill = { leads, contacts, subs, closings: closingsByAgent, paused: pausedByAgent, stats: statsByAgent };

  // ── Derive the constellation / triage / roster nodes from the REAL rollup ───
  // status: paused (tripped a pause rule) → at_risk (any strike, high zero+stuck,
  // or low worked%) → on_track. ring size ∝ real lead count. dominant source = the
  // source family the agent holds the most of. Pond/unassigned buckets are kept
  // (they're real owners of un-worked leads) but flagged as non-person so their
  // per-agent actions/drill match the previous behavior.
  const nodes: AgentNode[] = agents.map(([agent, r]) => {
    const strikes = strikesByAgent.get(agent) ?? 0;
    const paused = pausedByAgent.get(agent) ?? [];        // auto pause-watch reasons (recommendation only)
    const manual = pauseByAgent.get(norm(agent));
    const pauseRecommended = paused.length > 0 || strikes >= strikeLimit;
    const workedP = r.total ? Math.round((r.worked / r.total) * 100) : 0;
    // 'paused' status is MANUAL ONLY (manual?.is_paused). Auto rules (pause-watch,
    // strike limit) fall into 'at_risk' + the softer pauseRecommended flag — they
    // never claim the agent is "Paused".
    let status: AgentStatus = 'on_track';
    if (manual?.is_paused) status = 'paused';
    else if (pauseRecommended || strikes > 0 || r.zero + r.stuck >= Math.max(2, Math.ceil(r.total * 0.4)) || (r.total >= 3 && workedP < 55)) status = 'at_risk';
    const domSrc = [...r.srcs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Other';
    return {
      agent, person: isPerson(agent), total: r.total, zero: r.zero, stuck: r.stuck,
      worked: r.worked, workedPct: workedP, strikes, paused, pauseRecommended, source: domSrc, srcs: r.srcs, status,
      agentId: manual?.id ?? null, pauseReason: manual?.pause_reason ?? null,
      pauseNote: manual?.pause_note ?? null, pausedAt: manual?.paused_at ?? null,
    };
  });

  const winLabel = win === 'mtd' ? 'month to date' : win === '180' ? 'last 6 months' : win === '365' ? 'last 12 months' : `last ${win} days`;
  const HEAD: Record<View, { title: string; eyebrow: string }> = {
    overview: { title: 'Pulse — who’s working what.', eyebrow: `Lead accountability · ${org.name}` },
    accountability: { title: 'What to do today', eyebrow: 'Who needs action first · this week' },
    sources: { title: 'Sources', eyebrow: `Where your tracked leads come from · ${winLabel}` },
    settings: { title: 'Settings', eyebrow: 'Flag windows, strike rules & the $-at-risk math' },
  };

  const SUBNAV: Array<[View, string]> = [
    ['overview', 'pulse'], ['accountability', 'coach'], ['sources', 'prospect'], ['settings', 'rep'],
  ];

  const context = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {view !== 'settings' && (
        <div className="ps-winpills">
          {WINDOWS.map(([k, l]) => (
            <span key={k} className={`ps-winpill${win === k ? ' on' : ''}`} onClick={() => setWin(k)}>{l}</span>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="tru-dark">
      <HqShell
        orgName={org.name}
        eyebrow={HEAD[view].eyebrow}
        title={HEAD[view].title}
        context={context}
        onSignOut={() => signOutClean()}
        nav={{
          onHome: () => onHome?.(),
          onOpenPulse: () => setView('overview'),
          onOpenCoach: () => { window.location.hash = '/coach'; },
          onOpenRep: () => { window.location.hash = '/rep'; },
        }}
      >
        <div className="pulse-canvas" ref={canvasRef}>
          <div className="pulse-ambient" aria-hidden />

          {/* view switch (kept as a sub-nav so all four real views survive) */}
          <div className="ps-subnav reveal" style={{ marginBottom: 18 }}>
            {SUBNAV.map(([v, icon]) => (
              <button key={v} className={`ps-subnav-btn${view === v ? ' on' : ''}`} onClick={() => setView(v)}>
                <Icon name={icon} size={16} />
                {v === 'overview' ? 'Overview' : v === 'accountability' ? 'What to do today' : v[0].toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>

          {view === 'overview' && (total === 0 ? (
            <div className="card ps-emptyview reveal">
              <h3>No leads tracked yet</h3>
              <p>
                Leads sync in automatically from Follow Up Boss for every source you’ve enabled.
                Once your first lead comes in this window, tracked count, contact status, and the
                strike ledger all fill in here — nothing to configure.
              </p>
              <button className="btn" onClick={() => setView('settings')}>Check your sources →</button>
            </div>
          ) : (
            <Overview
              org={org} winLabel={winLabel}
              total={total} zero={zero} stuck={stuck} worked={worked} workedPct={workedPct}
              risk={risk} avgGci={avgGci} closeRate={closeRate}
              sources={sources}
              offerRatioLabel={offerRatioLabel} perClosingLabel={perClosingLabel} closingsCount={closingsCount} gciInPlay={gciInPlay}
              nodes={nodes}
              pauseCount={pauseCount} newStrikes7d={newStrikes7d} pausedCount={pausedCount} headroom={headroom}
              strikeLimit={strikeLimit}
              drill={drill}
              onRefresh={() => void load()}
            />
          ))}

          {view === 'accountability' && (
            <Accountability
              strikesByAgent={strikesByAgent} strikeLimit={strikeLimit}
              pauseCount={pauseCount} newStrikes7d={newStrikes7d} openCases={openCases}
              paused={pausedByAgent} pauseWatchOn={pauseVolumeOn || pauseNoCloseOn}
            />
          )}
          {view === 'sources' && <Sources sources={sources} total={total} upfront={upfront} atClose={atClose} />}
          {view === 'settings' && data.settings && (
            <SettingsView initial={data.settings} onSaved={() => void load()} />
          )}
        </div>
      </HqShell>
    </div>
  );
}

/* ============================================================
   OVERVIEW — the bento + constellation + triage + roster + spine
   ============================================================ */
function Overview(p: {
  org: { id: string; name: string }; winLabel: string;
  total: number; zero: number; stuck: number; worked: number; workedPct: number;
  risk: { window: number; annual: number }; avgGci: number; closeRate: number;
  sources: Array<{ name: string; n: number; c: string; workedPct: number; zero: number }>;
  offerRatioLabel: string; perClosingLabel: string; closingsCount: number; gciInPlay: number;
  nodes: AgentNode[];
  pauseCount: number; newStrikes7d: number; pausedCount: number; headroom: number;
  strikeLimit: number;
  drill: Drill;
  onRefresh: () => void;
}) {
  const srcTotal = p.sources.reduce((a, s) => a + s.n, 0);
  const acct = [
    { icon: 'shield', label: 'Pause recommended', value: p.pauseCount, note: `at ${p.strikeLimit}+ strikes / 30 days`, tone: 'warn' },
    { icon: 'target', label: 'New strikes this week', value: p.newStrikes7d, note: 'opened in the last 7 days', tone: '' },
    { icon: 'clock', label: 'Pause rec · pause watch', value: p.pausedCount, note: 'tripped a volume/no-close rule', tone: '' },
    { icon: 'coach', label: 'Coverage headroom', value: p.headroom, note: 'capacity vs. tracked intake', tone: 'good' },
  ];
  return (
    <>
      {/* ============ HERO BENTO ============ */}
      <section className="ps-bento">
        {/* Anchor: commission at risk */}
        <article className="card ps-risk reveal">
          <div className="ps-risk-glow" />
          <span className="risk-eyebrow"><Icon name="shield" size={16} /> Commission at risk</span>
          <div className="ps-risk-stat">
            <div className="ps-risk-num">
              $<CountUp value={p.risk.annual} fmt={(n) => Math.round(n).toLocaleString()} />
              <span className="ps-risk-unit">/yr</span>
            </div>
          </div>
          <p className="ps-risk-note">
            {p.zero} lead{p.zero === 1 ? '' : 's'} nobody personally worked, priced at each source’s
            real conversion (UC + Closed ÷ leads, your own data) × {money(p.avgGci)} avg. Young sources
            fall back to your {p.closeRate}% setting.
          </p>
          <RiskSpark />
        </article>

        {/* Centerpiece: Worked gauge + satellite chips (REAL tracked/zero/stuck) */}
        <article className="card ps-worked reveal" data-delay="80">
          <div className="panel-head">
            <h3>Worked · {p.winLabel}</h3>
            <span className="panel-sub">Share of {p.total} tracked leads touched</span>
          </div>
          <div className="ps-worked-body">
            <WorkedGauge pct={p.workedPct} />
            <div className="ps-satellites">
              <Chip value={p.total} label="Tracked" />
              <Chip value={p.zero} label="Zero contact" />
              <Chip value={p.stuck} label="Stuck in Lead" />
            </div>
          </div>
        </article>

        {/* Production cluster — REAL person-stage production */}
        <article className="card ps-gci reveal" data-delay="140">
          <div className="ps-gci-glow" />
          <span className="ps-tile-eyebrow">Gross commission</span>
          <div className="ps-gci-body">
            <div className="ps-gci-num">$<CountUp value={p.gciInPlay} fmt={(n) => Math.round(n).toLocaleString()} /></div>
            <div className="ps-gci-label">GCI closed · all sources</div>
            <svg className="ps-arc" viewBox="0 0 120 40" preserveAspectRatio="none" aria-hidden>
              <path d="M2 34 Q40 30 60 20 T118 4" fill="none" stroke="url(#psRiskLine)" strokeWidth="2.5" strokeLinecap="round" />
              <circle cx="118" cy="4" r="3.5" fill="var(--accent-hi)" />
            </svg>
          </div>
        </article>
        <article className="card ps-prod ps-prod-a reveal" data-delay="180">
          <BigNum value={p.closingsCount} label="Under contract + closed" />
        </article>
        <article className="card ps-prod ps-prod-b reveal" data-delay="220">
          <div className="ps-prod-inner">
            <div className="ps-prod-num">{p.perClosingLabel}</div>
            <div className="ps-prod-label">Leads per closing</div>
          </div>
        </article>
        <article className="card ps-prod ps-prod-c reveal" data-delay="260">
          {/* §3a: stable all-time 1:N, NOT a windowed % — reads as a funnel with
              "Leads per closing" beside it (ps-prod-b). Never moves with the tab. */}
          <div className="ps-prod-inner">
            <div className="ps-prod-num">{p.offerRatioLabel}</div>
            <div className="ps-prod-label">Leads per offer</div>
          </div>
        </article>
      </section>

      <DividerWave />

      {/* ============ LEADS BY SOURCE — proportion bar (REAL source mix) ============ */}
      {p.sources.length > 0 && (
        <section className="ps-source reveal">
          <div className="panel-head">
            <h3>Leads by source</h3>
            <span className="panel-sub">Where the pipeline comes from · {srcTotal} leads · {p.winLabel}</span>
          </div>
          <div className="ps-source-bar">
            {p.sources.map((s, i) => (
              <div
                key={s.name}
                className="ps-source-seg"
                title={`${s.name} · ${s.n} lead${s.n === 1 ? '' : 's'} · ${s.workedPct}% worked`}
                style={{
                  flexGrow: s.n,
                  background: `linear-gradient(180deg, ${s.c}, color-mix(in srgb, ${s.c} 72%, #000))`,
                  animationDelay: `${i * 120}ms`,
                }}
              >
                {srcTotal > 0 && s.n / srcTotal > 0.06 && <span className="ps-source-seg-val">{s.n}</span>}
              </div>
            ))}
          </div>
          <div className="ps-source-legend">
            {p.sources.map((s) => (
              <span key={s.name} className="ps-source-leg">
                <i style={{ background: s.c }} /> {s.name}
                <b>{s.n}</b>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* ============ TEAM HEALTH FIELD (REAL per-agent nodes) ============ */}
      <TeamHealth nodes={p.nodes} drill={p.drill} strikeLimit={p.strikeLimit} onRefresh={p.onRefresh} />

      {/* ============ ACCOUNTABILITY SPINE (REAL counts) ============ */}
      <section className="ps-acct reveal">
        <div className="panel-head">
          <h3>Accountability this week</h3>
          <span className="panel-sub">3-strike will-not-skill</span>
        </div>
        <ol className="ps-spine">
          {acct.map((a, i) => (
            <li key={a.label} className={`ps-spine-node ${a.tone}`} style={{ animationDelay: `${i * 90}ms` }}>
              <span className="ps-spine-mark"><Icon name={a.icon} size={16} /></span>
              <div className="ps-spine-body">
                <div className="ps-spine-top">
                  <span className="ps-spine-label">{a.label}</span>
                  <SpineValue value={a.value} />
                </div>
                <div className="ps-spine-note">{a.note}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* one shared gradient def for the arcs/sparks */}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
        <defs>
          <linearGradient id="psRiskLine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--accent-hi)" />
            <stop offset="1" stopColor="var(--terracotta)" />
          </linearGradient>
        </defs>
      </svg>
    </>
  );
}

/* ============================================================
   TEAM HEALTH — triage column + constellation + roster.
   All three derive from the SAME real `nodes` array.
   ============================================================ */
function TeamHealth({ nodes, drill, strikeLimit, onRefresh }: { nodes: AgentNode[]; drill: Drill; strikeLimit: number; onRefresh: () => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(() => {
    try { return sessionStorage.getItem('pulse.open') || null; } catch { return null; }
  });
  const rosterRef = useRef<HTMLDivElement | null>(null);
  // Keep the leader's place across a Memory-Saver discard-reload: persist the open
  // agent, and on mount re-surface + scroll to it (or clear it if that agent is gone).
  useEffect(() => {
    try { if (open) sessionStorage.setItem('pulse.open', open); else sessionStorage.removeItem('pulse.open'); } catch { /* private mode */ }
  }, [open]);
  useEffect(() => {
    if (open && nodes.some((n) => n.agent === open)) {
      setQ(open);
      // Land on the reopened agent, not the top. A single rAF fires before the data
      // paint + reveal animations settle the layout (and the browser's own scroll
      // restore can reset us), so re-assert the scroll a couple beats later.
      const toAgent = () => rosterRef.current?.scrollIntoView({ block: 'start' });
      const t1 = setTimeout(toAgent, 300);
      const t2 = setTimeout(toAgent, 800);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
    if (open) setOpen(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Triage = the real agents who need action first: paused (manual) / pause-recommended
  // (auto rules, incl. strikes) / zero-contact.
  const triage = useMemo(
    () => nodes.filter((a) => a.status === 'paused' || a.pauseRecommended || a.zero > 0).slice(0, 6),
    [nodes],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return nodes;
    return nodes.filter((a) => a.agent.toLowerCase().includes(needle) || a.source.toLowerCase().includes(needle));
  }, [q, nodes]);
  const CAP = 12;
  const shown = filtered.slice(0, CAP);

  const statusCounts = (s: AgentStatus) => nodes.filter((a) => a.status === s).length;
  const toggle = (a: string) => setOpen((o) => (o === a ? null : a));
  // Opening from a ring / triage card: surface the agent in the roster (search by
  // name so they're never hidden past the cap or an active filter), open their
  // drill-down, and bring the roster into view. Same drill component either way.
  const pick = (agent: string) => {
    setQ(agent);
    setOpen(agent);
    requestAnimationFrame(() => rosterRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  };

  return (
    <section className="ps-field">
      <div className="panel-head reveal">
        <h3>Team health · {nodes.length} agent{nodes.length === 1 ? '' : 's'}</h3>
        <span className="panel-sub">Triage the few, scan the whole roster</span>
      </div>

      <div className="ps-field-grid">
        {/* Triage column */}
        <div className="ps-triage reveal">
          <div className="ps-triage-head">
            <span className={`ps-triage-count${triage.length === 0 ? ' clear' : ''}`}>{triage.length}</span>
            <div>
              <div className="ps-triage-title">Need you this week</div>
              <div className="ps-triage-sub">paused · pause rec · zero contact</div>
            </div>
          </div>
          <div className="ps-triage-list">
            {triage.length === 0 ? (
              <div className="ps-triage-empty">Clean board — nobody paused, striking out, or sitting on an untouched lead.</div>
            ) : triage.map((a) => (
              <div key={a.agent} className={`ps-triage-card status-${a.status}`} onClick={() => pick(a.agent)}>
                <div className="ps-triage-dot" style={{ background: STATUS_META[a.status].color }} />
                <div className="ps-triage-info">
                  <div className="ps-triage-name">{a.agent}</div>
                  <div className="ps-triage-meta">
                    {a.status === 'paused' ? pauseTitle(a)
                      : a.strikes >= strikeLimit ? `${a.strikes} strikes`
                      : a.zero > 0 ? `${a.zero} zero-contact`
                      : a.pauseRecommended ? 'Pause recommended' : STATUS_META[a.status].label}
                    {' · '}{a.total} leads · {a.workedPct}% worked
                  </div>
                </div>
                <button className="ps-prep" onClick={(e) => { e.stopPropagation(); pick(a.agent); }} aria-label={`Open ${a.agent}`}>
                  <Icon name="pulse" size={15} /> Open
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Constellation */}
        <div className="ps-const-wrap reveal" data-delay="100">
          <Constellation nodes={nodes} onPick={pick} />
          <div className="ps-const-legend">
            {(Object.keys(STATUS_META) as AgentStatus[]).map((k) => (
              <span key={k} className="ps-leg">
                <i style={{ background: STATUS_META[k].color }} /> {STATUS_META[k].label}
                <b>{statusCounts(k)}</b>
              </span>
            ))}
            <span className="ps-leg-note">ring size = lead load · click to drill in</span>
          </div>
        </div>
      </div>

      {/* Searchable capped roster — clicking a row opens the SAME drill-down */}
      <div className="ps-roster reveal" data-delay="120" ref={rosterRef}>
        <div className="ps-roster-head">
          <div className="ps-search">
            <Icon name="prospect" size={16} />
            <input
              className="ps-search-input"
              placeholder={`Search ${nodes.length} agent${nodes.length === 1 ? '' : 's'} by name or source…`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <span className="ps-roster-count">
            Showing {shown.length} of {filtered.length}
            {filtered.length !== nodes.length ? ` (of ${nodes.length})` : ''}
          </span>
        </div>
        <div className="table-wrap">
          <table className="tru-table">
            <thead>
              <tr>
                <th>Agent</th><th>By source</th><th>Leads</th><th>Zero</th><th>Stuck</th><th>Worked</th><th>Strikes</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => {
                const isOpen = open === a.agent;
                return (
                  <FragmentRow key={a.agent}>
                    <tr className={`rowlink${a.status === 'paused' ? ' row-paused' : ''}${isOpen ? ' row-open' : ''}`} onClick={() => toggle(a.agent)}>
                      <td>
                        <span className="cell-agent">
                          <span className="cell-name">{a.agent}</span>
                          {a.status === 'paused' && <span className="pill-paused" title={pauseTitle(a)}>⏸ Paused</span>}
                          {a.status !== 'paused' && a.pauseRecommended && <span className="pill-strike">Pause rec</span>}
                          <span className="cell-caret">{isOpen ? '▾' : '▸'}</span>
                        </span>
                      </td>
                      <td>
                        <span className="src-chips">
                          {[...a.srcs.entries()].sort((x, y) => y[1] - x[1]).map(([sn, n]) => (
                            <span className="src-chip" key={sn} title={`${sn} · ${n} lead${n === 1 ? '' : 's'}`}>
                              <i style={{ background: SOURCE_COLORS[sn] ?? SOURCE_COLORS.Other }} />{n}
                            </span>
                          ))}
                        </span>
                      </td>
                      <td>{a.total}</td>
                      <td className={a.zero > 0 ? 'cell-warn' : ''}>{a.zero}</td>
                      <td>{a.stuck}</td>
                      <td><span className={`cell-worked ${a.workedPct < 60 ? 'low' : ''}`}>{a.workedPct}%</span></td>
                      <td><span className={`cell-strikes s${Math.min(3, a.strikes)}`}>{a.strikes}</span></td>
                    </tr>
                    {isOpen && (
                      <tr className="drill-tr">
                        <td colSpan={7}>
                          <AgentDrill node={a} drill={drill} onRefresh={onRefresh} />
                        </td>
                      </tr>
                    )}
                  </FragmentRow>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ color: 'var(--text-50)', textAlign: 'center', padding: 28 }}>
                    No agents match “{q}”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > CAP && (
          <div className="ps-roster-more">
            {filtered.length - CAP} more — refine the search to narrow the roster.
          </div>
        )}
      </div>
    </section>
  );
}

/* ============================================================
   CONSTELLATION — each ring = one REAL agent. color = status,
   size ∝ real lead count. Lens re-sorts by real status /
   performance (worked% − strike penalty) / dominant source.
   ============================================================ */
type Lens = 'status' | 'performance' | 'source';
type Pos = { x: number; y: number };
const CW = 640;
const CH = 420;
const LENSES: { key: Lens; label: string }[] = [
  { key: 'status', label: 'By status' },
  { key: 'performance', label: 'By performance' },
  { key: 'source', label: 'By source' },
];

/** Small deterministic LCG keyed off a seed number (stable jitter). */
function rng(seed: number) {
  let s = (seed * 2654435761) & 0x7fffffff;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}
function clamp(x: number, y: number, rad: number): Pos {
  return { x: Math.max(rad + 6, Math.min(CW - rad - 6, x)), y: Math.max(rad + 6, Math.min(CH - rad - 6, y)) };
}
const scoreOf = (a: AgentNode) => a.workedPct - a.strikes * 8;

// Cluster geometry, hoisted so BOTH the layout math and the halo render use the same
// centers. Every lens draws its own colored "category" halos (not just By status).
const STATUS_CENTERS: Record<AgentStatus, { x: number; y: number; spread: number }> = {
  on_track: { x: CW * 0.66, y: CH * 0.42, spread: 200 },
  at_risk: { x: CW * 0.3, y: CH * 0.32, spread: 120 },
  paused: { x: CW * 0.24, y: CH * 0.76, spread: 90 },
};
const SRC_SLOTS = [
  { x: CW * 0.28, y: CH * 0.44, spread: 150 },
  { x: CW * 0.62, y: CH * 0.34, spread: 120 },
  { x: CW * 0.78, y: CH * 0.72, spread: 110 },
  { x: CW * 0.45, y: CH * 0.6, spread: 110 },
];
// Soft halo tints, cycled per source cluster so each source reads as its own group.
const SRC_HALO = ['var(--accent-soft)', 'var(--sea-soft)', 'rgba(192,107,79,0.14)', 'rgba(91,157,240,0.13)'];

function Constellation({ nodes, onPick }: { nodes: AgentNode[]; onPick: (agent: string) => void }) {
  const [lens, setLens] = useState<Lens>('status');
  const [hover, setHover] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);

  // Ring geometry — size scales by real lead load (relative to the busiest agent).
  const rings = useMemo(() => {
    const maxLeads = Math.max(1, ...nodes.map((n) => n.total));
    return nodes.map((a, i) => {
      const rad = 5 + (a.total / maxLeads) * 11;
      return { a, rad, core: Math.max(1.5, rad * 0.32), i };
    });
  }, [nodes]);

  // Top sources → cluster centers for the "By source" lens (real dominant sources).
  const topSources = useMemo(() => {
    const c = new Map<string, number>();
    for (const n of nodes) c.set(n.source, (c.get(n.source) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  }, [nodes]);

  const layouts = useMemo(() => {
    const status: Pos[] = rings.map(({ a, rad, i }) => {
      const r = rng(i * 13 + 3);
      const ctr = STATUS_CENTERS[a.status];
      const ang = r() * Math.PI * 2;
      const dist = Math.pow(r(), 0.7) * ctr.spread;
      return clamp(ctr.x + Math.cos(ang) * dist, ctr.y + Math.sin(ang) * dist * 0.72, rad);
    });
    const scores = rings.map((n) => scoreOf(n.a));
    const lo = Math.min(...scores, 0);
    const hi = Math.max(...scores, 1);
    const performance: Pos[] = rings.map(({ rad, i }, idx) => {
      const t = (scores[idx] - lo) / (hi - lo || 1);
      const x = 70 + t * (CW - 70 - 46);
      const r = rng(i * 29 + 11);
      const y = CH * 0.52 + (r() - 0.5) * 2 * (CH * 0.34);
      return clamp(x, y, rad);
    });
    const source: Pos[] = rings.map(({ a, rad, i }) => {
      const r = rng(i * 17 + 5);
      const slot = SRC_SLOTS[Math.max(0, topSources.indexOf(a.source)) % SRC_SLOTS.length];
      const ang = r() * Math.PI * 2;
      const dist = Math.pow(r(), 0.7) * slot.spread;
      return clamp(slot.x + Math.cos(ang) * dist, slot.y + Math.sin(ang) * dist * 0.78, rad);
    });
    return { status, performance, source };
  }, [rings, topSources]);

  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    const t = window.setTimeout(() => setMounted(true), 250);
    return () => { cancelAnimationFrame(id); window.clearTimeout(t); };
  }, []);

  const pos = layouts[lens];
  const paused = nodes.filter((a) => a.status === 'paused').length;
  const atRisk = nodes.filter((a) => a.status === 'at_risk').length;
  const insight: Record<Lens, string> = {
    status: paused + atRisk === 0 ? 'Every agent is on track — no action needed this week.' : `${paused} paused · ${atRisk} at risk — action needed this week.`,
    performance: 'Ranked by worked % minus a strike penalty — the long tail sits left.',
    source: topSources[0] ? `${topSources[0]} is the dominant pipe across the floor.` : 'Lead sources across the roster.',
  };
  const hoverNode = hover != null ? rings[hover] : null;

  return (
    <div className="ps-constellation" data-lens={lens}>
      <div className="ps-lens" role="tablist" aria-label="Constellation lens">
        {LENSES.map((l) => (
          <button key={l.key} role="tab" aria-selected={lens === l.key}
            className={`ps-lens-btn ${lens === l.key ? 'is-active' : ''}`} onClick={() => setLens(l.key)}>
            {l.label}
          </button>
        ))}
      </div>
      <div className="ps-insight" key={lens}>{insight[lens]}</div>

      <div className="ps-const-stage">
        <svg viewBox={`0 0 ${CW} ${CH}`} className="ps-const-svg" role="img" aria-label="Team health constellation">
          <defs>
            <radialGradient id="psConstGlow" cx="50%" cy="45%" r="60%">
              <stop offset="0" stopColor="var(--accent-soft)" />
              <stop offset="1" stopColor="transparent" />
            </radialGradient>
          </defs>
          <rect x="0" y="0" width={CW} height={CH} fill="url(#psConstGlow)" />

          <g className="ps-halos" key={lens}>
            {lens === 'status' && (
              <>
                <circle cx={CW * 0.66} cy={CH * 0.42} r={150} fill="var(--sea-soft)" opacity="0.5" />
                <circle cx={CW * 0.3} cy={CH * 0.32} r={96} fill="var(--accent-soft)" opacity="0.7" />
                <circle cx={CW * 0.24} cy={CH * 0.76} r={74} fill="rgba(192,107,79,0.10)" />
              </>
            )}
            {lens === 'performance' && (
              <>
                <circle cx={CW * 0.2} cy={CH * 0.5} r={126} fill="rgba(192,107,79,0.13)" opacity="0.9" />
                <circle cx={CW * 0.52} cy={CH * 0.5} r={126} fill="var(--accent-soft)" opacity="0.7" />
                <circle cx={CW * 0.84} cy={CH * 0.5} r={126} fill="var(--sea-soft)" opacity="0.6" />
              </>
            )}
            {lens === 'source' && topSources.slice(0, SRC_SLOTS.length).map((src, i) => (
              <g key={src}>
                <circle cx={SRC_SLOTS[i].x} cy={SRC_SLOTS[i].y} r={SRC_SLOTS[i].spread * 0.82} fill={SRC_HALO[i % SRC_HALO.length]} opacity="0.6" />
                <text x={SRC_SLOTS[i].x} y={SRC_SLOTS[i].y} textAnchor="middle" style={{ fontSize: 13, fontWeight: 700, fill: 'var(--text-40)', pointerEvents: 'none' }}>{src}</text>
              </g>
            ))}
          </g>
          <g className="ps-axis" style={{ opacity: lens === 'performance' ? 1 : 0 }}>
            <line x1={54} y1={CH - 26} x2={CW - 30} y2={CH - 26} stroke="var(--border-soft)" strokeWidth="1" />
            <text x={58} y={CH - 10} className="ps-axis-cap">lower ← performance</text>
            <text x={CW - 34} y={CH - 10} textAnchor="end" className="ps-axis-cap">performance → higher</text>
          </g>

          <g className={`ps-nodes ${mounted ? 'is-in' : ''} ${hover != null ? 'has-hover' : ''}`}>
            {rings.map((n, idx) => {
              const meta = STATUS_META[n.a.status];
              const pt = pos[idx];
              const isHover = hover === idx;
              const stagger = Math.min(idx * 8, 1100);
              return (
                <g key={n.a.agent} className={`ps-node ${isHover ? 'is-hover' : ''}`}
                  transform={`translate(${pt.x} ${pt.y})`}
                  style={{ ['--enter-delay' as string]: `${stagger}ms` }}
                  onMouseEnter={() => setHover(idx)}
                  onMouseLeave={() => setHover((h) => (h === idx ? null : h))}
                  onClick={() => onPick(n.a.agent)}>
                  <circle className="ps-node-halo" r={n.rad + 8} fill="none" stroke={meta.color} />
                  <circle className="ps-node-ring" r={n.rad} fill={meta.soft} stroke={meta.color} />
                  <circle className="ps-node-core" r={n.core} fill={meta.color} />
                </g>
              );
            })}
          </g>
        </svg>

        {hoverNode && <HoverCard node={hoverNode.a} pos={pos[hover!]} onPick={onPick} />}
      </div>
    </div>
  );
}

function HoverCard({ node, pos, onPick }: { node: AgentNode; pos: Pos; onPick: (a: string) => void }) {
  const meta = STATUS_META[node.status];
  const leftPct = (pos.x / CW) * 100;
  const topPct = (pos.y / CH) * 100;
  const flip = leftPct > 62;
  return (
    <div className={`ps-hcard ${flip ? 'flip' : ''}`} style={{ left: `${leftPct}%`, top: `${topPct}%` }}>
      <div className="ps-hcard-top">
        <span className="ps-hcard-name">{node.agent}</span>
        <span className="ps-hcard-pill" style={{ color: meta.color, background: meta.soft, borderColor: meta.color }}>{meta.label}</span>
      </div>
      <div className="ps-hcard-worked">
        <div className="ps-hcard-bar"><span style={{ width: `${node.workedPct}%`, background: meta.color }} /></div>
        <b>{node.workedPct}%</b> worked
      </div>
      <div className="ps-hcard-stats">
        <span>{node.total} leads</span>
        <span>{node.source}</span>
        <span className={node.strikes >= 2 ? 'warn' : ''}>{node.strikes} strike{node.strikes === 1 ? '' : 's'}</span>
      </div>
      <button className="ps-hcard-btn" onClick={() => onPick(node.agent)}>
        <Icon name="pulse" size={14} /> Open agent
      </button>
    </div>
  );
}

/* ============================================================
   AGENT DRILL — the REAL per-lead drill-down (same behavior as
   before): flag chips, closings stat, pre-written texts/email,
   by-source breakdown, and the per-lead list with FUB deep-links.
   ============================================================ */
const FLAG_LABEL: Record<string, string> = { zero_contact: 'Zero contact', stuck: 'In Lead', worked: 'Worked' };

/** The manual pause control — the ONLY thing that can make an agent's status
 *  read "Paused". One compact row: a toggle, and (when on) a reason dropdown +
 *  an optional note for "Other". Hidden entirely when there's no agent id to
 *  write to (demo mode, or a pond/unassigned bucket — those never reach here
 *  since the caller only renders this for `node.person`). */
function PauseControl({ agentId, isPaused, reason, note, pausedAt, onSaved }: {
  agentId: string | null; isPaused: boolean; reason: string | null; note: string | null;
  pausedAt: string | null; onSaved: () => void;
}) {
  const [checked, setChecked] = useState(isPaused);
  const [r, setR] = useState(reason ?? 'at_capacity');
  const [n, setN] = useState(note ?? '');
  const [busy, setBusy] = useState(false);

  // Stay in sync with a fresh load() (e.g. another tab/leader changed it) as long
  // as nothing is in flight from THIS control — never clobber a pending edit.
  useEffect(() => {
    if (busy) return;
    setChecked(isPaused);
    setR(reason ?? 'at_capacity');
    setN(note ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPaused, reason, note]);

  if (!agentId) return null; // no id to match — never call the write

  async function commit(nextChecked: boolean, nextReason: string, nextNote: string) {
    setBusy(true);
    try {
      await setAgentPause(agentId!, {
        isPaused: nextChecked,
        reason: nextChecked ? nextReason : null,
        note: nextChecked && nextReason === 'other' ? nextNote : null,
      });
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ps-pausectl">
      <label className="ad-toggle" style={{ marginBottom: 0 }}>
        <input
          type="checkbox" checked={checked} disabled={busy}
          onChange={(e) => { const c = e.target.checked; setChecked(c); void commit(c, r, n); }}
        />
        <span className="ad-toggle-track"><span className="ad-toggle-dot" /></span>
      </label>
      <span className="ps-pausectl-label">Pause this agent</span>
      {checked && (
        <>
          <span className="ps-pausectl-reasonlbl">Reason</span>
          <select
            className="ad-input ps-pausectl-select" value={r} disabled={busy}
            onChange={(e) => { const v = e.target.value; setR(v); void commit(true, v, n); }}
          >
            {PAUSE_REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <a
            className="ps-abtn sm" href="https://premieragent.zillow.com/leads/routing/routing"
            target="_blank" rel="noopener noreferrer"
            title="Open Zillow lead routing to pause this agent"
          >Pause in Zillow ↗</a>
          {r === 'other' && (
            <input
              className="ad-input ps-pausectl-note" placeholder="Say why…" value={n} disabled={busy}
              onChange={(e) => setN(e.target.value)}
              onBlur={() => void commit(true, r, n)}
            />
          )}
          {pausedAt && <span className="ps-pausectl-since">since {new Date(pausedAt).toLocaleDateString()}</span>}
        </>
      )}
    </div>
  );
}

function AgentDrill({ node, drill, onRefresh }: { node: AgentNode; drill: Drill; onRefresh: () => void }) {
  const agent = node.agent;
  const [flagF, setFlagF] = useState<string>('all');
  const mine = drill.leads.filter((l) => ownerOf(l) === agent);
  const shown = flagF === 'all' ? mine : mine.filter((l) => l.flag === flagF);
  const bySrc = new Map<string, number>();
  for (const l of mine) { const s = l.source_family || 'Other'; bySrc.set(s, (bySrc.get(s) ?? 0) + 1); }
  const srcRows = [...bySrc.entries()].sort((a, b) => b[1] - a[1]);
  const c = drill.contacts.get(norm(agent));
  // This agent's current-stage, created-date-windowed offers/closings (see AgentStat).
  // No ▲/▼ trend yet — returns once person_stage_log accrues real dated history.
  const stat = drill.stats.get(norm(agent));
  const chips: Array<[string, string, number]> = [
    ['all', 'All', node.total],
    ['zero_contact', 'Zero contact', node.zero],
    ['stuck', 'In Lead', node.stuck],
    ['worked', 'Worked', node.worked],
  ];
  const paused = drill.paused.get(agent);
  const first = agent.split(' ')[0];
  const noClose = paused?.find((r) => r.kind === 'no_close');
  const pauseMsg = noClose
    ? `Hey ${first} — I'm holding new leads for now. You've taken ${noClose.count} since your last under-contract, and the team rule is something has to go under contract every ${noClose.cap}. Let's get on a call, work the pipeline you already have, and get one across — the moment it lands, leads turn right back on. I'm in it with you.`
    : `Hey ${first} — awesome month! You've hit your lead capacity, so I'm holding new leads off your plate for a bit. Nothing wrong at all on your end — I just want you locked in on closing what you already have. Keep crushing it. 🙌`;
  const fubLink = (l: LeadRow) => {
    const sub = drill.subs.get(l.team_id);
    return l.fub_person_id ? `https://${sub ? sub + '.followupboss.com' : 'app.followupboss.com'}/2/people/view/${l.fub_person_id}` : null;
  };
  const needLeads = mine.filter((l) => l.flag === 'zero_contact' || l.flag === 'stuck');
  // A FUB "name" that's really a system placeholder (Zuser…/User123, a random token,
  // or a bare phone number) carries no signal — relabel those "Unnamed lead" so the
  // text reads clean. Keep such a lead only if it still has a FUB link the agent can
  // open; a nameless, link-less lead isn't actionable, so drop it.
  const isPlaceholderName = (n?: string | null) => {
    const s = (n ?? '').trim();
    if (!s) return true;
    if (/^z?user\d+$/i.test(s)) return true;
    return /\d/.test(s) && !/\s/.test(s);
  };
  const remindLeads = needLeads.filter((l) => !isPlaceholderName(l.name) || fubLink(l));
  // Numbered, FULL list — no cap. Every lead shows its FUB link so the agent can tap
  // straight through; a placeholder name is relabeled "Unnamed lead" but still linked.
  const leadLines = remindLeads
    .map((l, i) => {
      const label = isPlaceholderName(l.name) ? 'Unnamed lead' : l.name;
      const link = fubLink(l);
      return link ? `${i + 1}. ${label} — ${link}` : `${i + 1}. ${label}`;
    })
    .join('\n');
  const remindN = remindLeads.length;
  const remindMsg = `${first} — ${remindN} lead${remindN === 1 ? '' : 's'} ${remindN === 1 ? 'needs' : 'need'} a first touch (never contacted or stuck in Lead). Please work ${remindN === 1 ? 'this' : 'these'} today:\n\n${leadLines}`;
  const digits = c?.phone ? c.phone.replace(/[^+\d]/g, '') : null;
  const sms = (body: string) => (digits ? `sms:${digits}?&body=${encodeURIComponent(body)}` : null);
  const emailHref = c?.email
    ? `mailto:${c.email}?subject=${encodeURIComponent('Your leads this week')}&body=${encodeURIComponent(remindN > 0 ? remindMsg : `Hey ${first} — quick check-in on your pipeline. Anything I can help with this week?`)}`
    : null;

  return (
    <div className="ps-drill">
      {node.person && (
        <PauseControl
          agentId={node.agentId}
          isPaused={node.status === 'paused'}
          reason={node.pauseReason}
          note={node.pauseNote}
          pausedAt={node.pausedAt}
          onSaved={onRefresh}
        />
      )}
      {/* Auto pause-watch — a SOFT recommendation, never claims the agent is paused.
          Hidden once a leader has manually paused (the control above already says so). */}
      {node.status !== 'paused' && paused?.map((r) => (
        <div className="ps-pausebar rec" key={r.kind}>
          <span className="ps-pausebar-tag">⏸ PAUSE RECOMMENDED</span>
          {r.kind === 'capacity'
            ? <span><b>At capacity</b> — {r.count} of {r.cap} leads taken this month. Consider routing new leads elsewhere until next month.</span>
            : <span><b>No closings</b> — {r.count} leads taken since their last under-contract (rule: every {r.cap} needs one).</span>}
        </div>
      ))}
      <div className="ps-drill-head">
        <div className="ps-drill-chips">
          {chips.map(([k, l, n]) => (
            <span key={k} className={`ps-fchip${flagF === k ? ' on' : ''}`} onClick={() => setFlagF(k)}>{l} <b>{n}</b></span>
          ))}
          <span className="ps-fchip stat">
            Offers <b>{stat?.offersReached ?? 0}</b>
          </span>
          <span className="ps-fchip stat">
            Closings <b>{drill.closings.get(norm(agent)) ?? 0}</b>
          </span>
        </div>
        {node.person && (
          <div className="ps-drill-acts">
            {paused && sms(pauseMsg) && <a className="ps-abtn warm" href={sms(pauseMsg)!} title={noClose ? 'Pre-written: leads hold until one goes under contract — supportive' : "Warm, pre-written: you're at capacity — nothing wrong, keep going"}>💬 Pause text</a>}
            {remindN > 0 && sms(remindMsg) && <a className="ps-abtn" href={sms(remindMsg)!} title={`Nudge ${first} on ${remindN} un-worked leads`}>💬 Reminder ({remindN})</a>}
            {emailHref ? <a className="ps-abtn" href={emailHref}>✉ Email</a> : <span className="ps-abtn off" title="No email on file — add it in FUB">✉ No email</span>}
            {digits ? <a className="ps-abtn" href={`sms:${digits}`}>💬 Text</a> : <span className="ps-abtn off" title="No mobile on file — add it in FUB">💬 No mobile</span>}
          </div>
        )}
      </div>
      {srcRows.length > 0 && (
        <div className="ps-drill-src">
          <span className="ps-drill-src-lbl">BY SOURCE</span>
          {srcRows.map(([name, n]) => (
            <span className="ps-drill-src-chip" key={name}>
              <i style={{ background: SOURCE_COLORS[name] ?? SOURCE_COLORS.Other }} />
              {name} <b>{n}</b>
            </span>
          ))}
        </div>
      )}
      <div className="ps-drill-list">
        {shown.length === 0 ? (
          <div style={{ color: 'var(--text-50)', fontSize: 13, padding: '10px 2px' }}>No leads match this filter in the current window.</div>
        ) : shown.map((l, i) => {
          const href = fubLink(l);
          const cls = l.flag === 'worked' ? 'ok' : l.flag === 'stuck' ? 'warn' : 'bad';
          return (
            <div className="ps-leadline" key={i}>
              <i style={{ background: SOURCE_COLORS[l.source_family ?? 'Other'] ?? SOURCE_COLORS.Other }} />
              <span className="ln">{l.name || 'Lead'}</span>
              <span className="muted">{l.source_family ?? 'Other'}{l.stage ? ` · ${l.stage}` : ''}{l.pond && l.assigned_to ? ` · Pond: ${l.pond}` : ''}</span>
              <span className={`ps-lead-pill ${cls}`}>{FLAG_LABEL[l.flag ?? ''] ?? l.flag}</span>
              {href && <a className="ps-abtn sm" href={href} target="_blank" rel="noreferrer">FUB ↗</a>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================
   ACCOUNTABILITY view (restyled dark, same real data)
   ============================================================ */
function Accountability(p: {
  strikesByAgent: Map<string, number>; strikeLimit: number;
  pauseCount: number; newStrikes7d: number; openCases: number;
  paused: Map<string, PauseReason[]>; pauseWatchOn: boolean;
}) {
  const rows = [...p.strikesByAgent.entries()].filter(([a]) => a !== 'Unassigned').sort((a, b) => b[1] - a[1]);
  const pausedRows = [...p.paused.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const clean = rows.length === 0 && p.pauseCount === 0 && p.newStrikes7d === 0;
  const kpis = [
    { label: 'Pause recommended', value: p.pauseCount, tone: 'warn' },
    { label: 'New strikes (7d)', value: p.newStrikes7d, tone: '' },
    { label: 'Open cases', value: p.openCases, tone: '' },
    { label: 'Strike limit', value: p.strikeLimit, tone: 'good' },
  ];
  return (
    <>
      <section className="ps-source reveal" style={{ marginBottom: 18 }}>
        <div className="ps-source-legend" style={{ margin: 0, gap: 32 }}>
          {kpis.map((k) => (
            <span key={k.label} className="ps-source-leg" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
              <span className="ps-spine-val" style={{ color: k.tone === 'warn' ? 'var(--terracotta)' : k.tone === 'good' ? 'var(--sea-hi)' : 'var(--text-strong)' }}>
                <SpineValue value={k.value} />
              </span>
              {k.label}
            </span>
          ))}
        </div>
      </section>

      {clean && (
        <article className="card ps-risk reveal" style={{ minHeight: 'auto', borderColor: 'rgba(74,124,111,0.4)' }}>
          <span className="risk-eyebrow" style={{ color: 'var(--sea-hi)' }}><Icon name="shield" size={16} /> Clean board</span>
          <div className="ps-gci-num" style={{ fontSize: 42 }}>0 strikes</div>
          <p className="ps-risk-note">
            No agent has crossed the {p.strikeLimit}-strike threshold in the last 30 days, and no new
            strikes opened this week. The pipeline discipline is holding — nothing to act on right now.
          </p>
        </article>
      )}

      <section className="ps-acct reveal" style={{ marginTop: 18 }}>
        <div className="panel-head"><h3>How the ledger works</h3></div>
        <p className="panel-sub" style={{ lineHeight: 1.6 }}>
          A strike opens when an agent leaves a tracked lead un-worked (no call and fewer than two
          outbound texts) or lets one stall in the Lead stage. Reaching {p.strikeLimit} strikes in a
          rolling 30 days triggers a coach-confirmed pause recommendation — never an automatic action.
        </p>
      </section>

      <section className="ps-roster reveal" style={{ marginTop: 18 }}>
        <div className="panel-head"><h3>Recommended pauses · new leads held</h3><span className="panel-sub">Pause in Zillow, then confirm here</span></div>
        <div className="table-wrap">
          <table className="tru-table">
            <thead><tr><th>Agent</th><th>Why</th><th>Turns back on when</th></tr></thead>
            <tbody>
              {!p.pauseWatchOn ? (
                <tr><td colSpan={3} style={{ color: 'var(--text-50)', textAlign: 'center', padding: 22 }}>Pause watch is off — set your rules in Settings.</td></tr>
              ) : pausedRows.length === 0 ? (
                <tr><td colSpan={3} style={{ color: 'var(--text-50)', textAlign: 'center', padding: 22 }}>Nobody’s paused — every agent is inside the rules.</td></tr>
              ) : pausedRows.map(([a, reasons]) => (
                <tr key={a}>
                  <td><span className="cell-agent"><span className="cell-name">{a}</span><span className="pill-strike">⏸ Pause rec</span><a className="ps-abtn sm" href="https://premieragent.zillow.com/leads/routing/routing" target="_blank" rel="noopener noreferrer" title="Open Zillow lead routing to pause this agent">Pause in Zillow ↗</a></span></td>
                  <td>{reasons.map((r) => (
                    <div key={r.kind} className={r.kind === 'no_close' ? 'cell-warn' : ''} style={{ fontWeight: 600, color: r.kind === 'no_close' ? 'var(--terracotta)' : 'var(--accent-hi)' }}>
                      {r.kind === 'capacity' ? `${r.count} of ${r.cap} leads this month` : `${r.count} leads since last under-contract (rule: ${r.cap})`}
                    </div>
                  ))}</td>
                  <td style={{ color: 'var(--text-50)' }}>{reasons.some((r) => r.kind === 'no_close') ? 'Something goes under contract' : 'The month rolls over'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="ps-roster reveal" style={{ marginTop: 18 }}>
        <div className="panel-head"><h3>Strikes by agent · last 30 days</h3></div>
        <div className="table-wrap">
          <table className="tru-table">
            <thead><tr><th>Agent</th><th>Strikes (30d)</th><th>Status</th></tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={3} style={{ color: 'var(--text-50)', textAlign: 'center', padding: 22 }}>No strikes on record — clean board.</td></tr>
              ) : rows.map(([a, s]) => {
                const pause = s >= p.strikeLimit;
                return (
                  <tr key={a}>
                    <td><span className="cell-agent"><span className="cell-name">{a}</span>{pause && <span className="pill-strike">Pause rec</span>}</span></td>
                    <td><span className={`cell-strikes s${Math.min(3, s)}`}>{s}</span></td>
                    <td className={pause ? 'cell-warn' : ''} style={{ color: pause ? 'var(--terracotta)' : s > 0 ? 'var(--accent-hi)' : 'var(--text-60)' }}>{pause ? 'Pause recommended' : s > 0 ? 'On watch' : 'Clear'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/* ============================================================
   SOURCES view (restyled dark, same real data)
   ============================================================ */
function Sources(p: {
  sources: Array<{ name: string; n: number; c: string; pay: 'upfront' | 'atclose'; closed: number; convLabel: string }>;
  total: number; upfront: number; atClose: number;
}) {
  const srcTotal = p.sources.reduce((a, s) => a + s.n, 0);
  return (
    <>
      {p.sources.length > 0 && (
        <section className="ps-source reveal" style={{ marginBottom: 18 }}>
          <div className="panel-head"><h3>Source mix</h3><span className="panel-sub">{srcTotal} tracked leads</span></div>
          <div className="ps-source-bar">
            {p.sources.map((s, i) => (
              <div key={s.name} className="ps-source-seg" title={`${s.name} · ${s.n}`}
                style={{ flexGrow: s.n, background: `linear-gradient(180deg, ${s.c}, color-mix(in srgb, ${s.c} 72%, #000))`, animationDelay: `${i * 120}ms` }}>
                {srcTotal > 0 && s.n / srcTotal > 0.06 && <span className="ps-source-seg-val">{s.n}</span>}
              </div>
            ))}
          </div>
          <div className="ps-source-legend">
            {p.sources.map((s) => (
              <span key={s.name} className="ps-source-leg"><i style={{ background: s.c }} /> {s.name}<b>{s.n}</b></span>
            ))}
          </div>
        </section>
      )}

      <div className="ps-field-grid" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 18 }}>
        <section className="ps-acct reveal">
          <div className="panel-head"><h3>Paid up front</h3></div>
          <div className="ps-gci-num" style={{ fontSize: 40 }}><CountUp value={p.upfront} /></div>
          <p className="panel-sub" style={{ marginTop: 8 }}>Subscription / ad spend — Realtor.com, Homes.com, Facebook, Google. Un-worked here is real wasted spend.</p>
        </section>
        <section className="ps-acct reveal" data-delay="80">
          <div className="panel-head"><h3>Pay at close</h3></div>
          <div className="ps-gci-num" style={{ fontSize: 40 }}><CountUp value={p.atClose} /></div>
          <p className="panel-sub" style={{ marginTop: 8 }}>Referral fee at close — Zillow, referral networks. Un-worked here is untapped GCI, not out-of-pocket.</p>
        </section>
      </div>

      <section className="ps-roster reveal" data-delay="120">
        <div className="panel-head"><h3>Every source</h3></div>
        <div className="table-wrap">
          <table className="tru-table">
            <thead><tr><th>Source</th><th>Leads</th><th>Share</th><th>Closed (UC+)</th><th>Conversion</th><th>How you pay</th></tr></thead>
            <tbody>
              {p.sources.map((s) => (
                <tr key={s.name}>
                  <td><span className="cell-agent"><i style={{ background: s.c, width: 10, height: 10, borderRadius: 3, display: 'inline-block' }} /><span className="cell-name">{s.name}</span></span></td>
                  <td>{s.n}</td>
                  <td>{p.total ? Math.round((s.n / p.total) * 100) : 0}%</td>
                  <td>{s.closed}</td>
                  <td>{s.convLabel === '—' ? <span style={{ color: 'var(--text-50)' }}>—</span> : s.convLabel}</td>
                  <td><span className={s.pay === 'atclose' ? 'pill-strike' : 'pill-paused'} style={s.pay === 'atclose' ? {} : { color: 'var(--sea-hi)', background: 'var(--sea-soft)', borderColor: 'rgba(74,124,111,0.4)' }}>{PAY_LABEL[s.pay]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

/* ============================================================
   SETTINGS view (restyled dark, same real save)
   ============================================================ */
function SettingsView({ initial, onSaved }: { initial: Settings; onSaved: () => void }) {
  const [form, setForm] = useState<Settings>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof Settings) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: Number(e.target.value) });

  async function save() {
    setBusy(true); setMsg(null);
    try {
      await saveSettings(form);
      setMsg({ ok: true, text: 'Saved. New numbers apply on the next sync.' });
      onSaved();
    } catch {
      setMsg({ ok: false, text: 'Could not save — check your connection and try again.' });
    } finally {
      setBusy(false);
    }
  }

  // Plain function returning JSX (NOT a component): a component defined inside
  // render remounts on every keystroke and drops input focus after one digit.
  const F = (k: keyof Settings, label: string, hint: string, suffix?: string) => (
    <div className="ps-setrow" key={k}>
      <div><div className="ps-setlabel">{label}</div><div className="ps-sethint">{hint}</div></div>
      <div className="ps-setinput">
        <input type="number" value={String(form[k] ?? '')} onChange={set(k)} />
        {suffix && <span className="suffix">{suffix}</span>}
      </div>
    </div>
  );

  const SOURCE_OPTS: Array<[string, string]> = [
    ['Zillow', 'Zillow Preferred / Flex'],
    ['Realtor.com MVIP', 'Realtor.com MVIP (Market VIP / Opcity)'],
    ['Realtor.com', 'Realtor.com (paid up front)'],
    ['Homes.com', 'Homes.com'],
    ['Facebook', 'Facebook / Instagram'],
    ['Google', 'Google / LSA'],
    ['Referrals', 'Referral networks'],
  ];
  const allSourceKeys = SOURCE_OPTS.map(([k]) => k);
  const checkedSources = form.sources && form.sources.length ? form.sources : allSourceKeys;
  const toggleSource = (k: string) => {
    const next = checkedSources.includes(k) ? checkedSources.filter((x) => x !== k) : [...checkedSources, k];
    if (!next.length) return; // at least one source stays on
    setForm({ ...form, sources: next });
  };

  return (
    <div className="card ps-settings reveal">
      <div className="ps-setrow block">
        <div className="ps-setlabel">Follow Up Boss connection</div>
        <div className="ps-sethint" style={{ marginBottom: 10 }}>
          Your API key connects every TRU product — Pulse, Coach, and the rest — to this team’s
          Follow Up Boss. Enter it once here; paste a new one anytime a key is rotated or stops working.
        </div>
        <FubConnect />
      </div>

      {msg && <div className={msg.ok ? 'ok' : 'err'} style={{ margin: '10px 0' }}>{msg.text}</div>}

      <div className="ps-setrow block">
        <div className="ps-setlabel">Lead sources you pay for</div>
        <div className="ps-sethint" style={{ marginBottom: 10 }}>Only checked sources count on the board — every KPI, chart, and per-agent number follows.</div>
        <div className="ps-src-grid">
          {SOURCE_OPTS.map(([k, label]) => (
            <label key={k} className="ps-src-opt">
              <input type="checkbox" checked={checkedSources.includes(k)} onChange={() => toggleSource(k)} />
              {label}
            </label>
          ))}
        </div>
      </div>

      {F('avg_gci', 'Average GCI per deal', 'Drives the commission-at-risk math.', '$')}
      {F('close_rate', 'Worked-lead close rate', '% of properly worked leads that close.', '%')}
      {F('window_hours', 'Contact window', "Hours a new lead can sit before it’s flagged.", 'hrs')}
      {F('strike_limit', 'Strike limit', 'Strikes in 30 days that trigger a pause recommendation.')}
      {F('per_agent_capacity', 'Per-agent capacity', 'Leads one agent can work well — sets coverage headroom.')}

      <div className="ps-setrow block">
        <div className="ps-setlabel">Pause watch</div>
        <div className="ps-sethint" style={{ marginBottom: 10 }}>
          Your rules for pausing new lead flow to an agent. Both are computed live from the
          synced FUB data on every load — full history, nothing tracked from today forward.
          A paused agent gets the ⏸ badge on the board and shows up on the Accountability
          tab — routing stays your call.
        </div>
        <label className="ps-src-opt" style={{ marginBottom: 8 }}>
          <input type="checkbox" checked={form.pause_volume_on !== false} onChange={() => setForm({ ...form, pause_volume_on: form.pause_volume_on === false })} />
          Pause at monthly volume — agent takes the leads below in one calendar month
        </label>
        <label className="ps-src-opt">
          <input type="checkbox" checked={form.pause_no_close_on === true} onChange={() => setForm({ ...form, pause_no_close_on: form.pause_no_close_on !== true })} />
          Pause on no closings — agent takes the leads below without an under-contract
        </label>
      </div>
      {F('pause_volume_leads', 'Monthly volume cap', 'Leads taken this month that trigger the volume pause. Resets when the month rolls over.')}
      {F('pause_no_close_leads', 'Leads without a closing', 'Counted live from their FUB history: leads taken since their last under-contract. Any UC — from any lead — resets it, but something has to go under contract or the leads stop.')}
      <div className="ps-setrow">
        <div>
          <div className="ps-setlabel">Clean-slate date</div>
          <div className="ps-sethint">Only leads received on or after this date count toward the no-closings rule. Set it to today to give everyone a fresh start; leave blank to count all history. (We can only enforce this rule over the period we’ve been tracking closings.)</div>
        </div>
        <div className="ps-setinput" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <input
            type="date"
            value={form.pause_no_close_since ? String(form.pause_no_close_since).slice(0, 10) : ''}
            onChange={(e) => setForm({ ...form, pause_no_close_since: e.target.value ? new Date(e.target.value).toISOString() : null })}
          />
          <button type="button" className="btn" style={{ padding: '4px 12px' }} onClick={() => setForm({ ...form, pause_no_close_since: new Date().toISOString() })}>Today</button>
          <button type="button" className="btn ghost" style={{ padding: '4px 12px' }} onClick={() => setForm({ ...form, pause_no_close_since: null })}>Clear</button>
        </div>
      </div>

      <button className="btn" onClick={save} disabled={busy} style={{ marginTop: 18 }}>{busy ? 'Saving…' : 'Save settings'}</button>
    </div>
  );
}

/* ============================================================
   Small presentational helpers
   ============================================================ */
function FragmentRow({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function WorkedGauge({ pct }: { pct: number }) {
  const size = 208;
  const stroke = 16;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c - (pct / 100) * c;
  return (
    <div className="ps-gauge" style={{ width: size, height: size }}>
      <div className="ps-gauge-glow" />
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id="psWorkedGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--accent-hi)" />
            <stop offset="1" stopColor="var(--accent)" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r + 9} fill="none" stroke="var(--track-outer)" strokeWidth="1" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track-fill-2)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#psWorkedGrad)" strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off}
          transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset 1.4s var(--ease)' }} />
        <circle cx={size / 2} cy={size / 2} r={r - stroke} fill="none" stroke="var(--track-hairline)" strokeWidth="1" />
      </svg>
      <div className="ps-gauge-center">
        <div className="ps-gauge-num">{pct}%</div>
        <div className="ps-gauge-cap">Worked</div>
      </div>
    </div>
  );
}

function Chip({ value, label }: { value: number; label: string }) {
  const { ref, val } = useCountUp(value);
  return (
    <div className="ps-chip">
      <div className="ps-chip-num"><span ref={ref}>{val}</span></div>
      <div className="ps-chip-label">{label}</div>
    </div>
  );
}

function BigNum({ value, label, suffix = '' }: { value: number; label: string; suffix?: string }) {
  const { ref, val } = useCountUp(value);
  return (
    <div className="ps-prod-inner">
      <div className="ps-prod-num"><span ref={ref}>{val}</span>{suffix}</div>
      <div className="ps-prod-label">{label}</div>
    </div>
  );
}

function SpineValue({ value }: { value: number }) {
  const { ref, val } = useCountUp(value);
  return <span className="ps-spine-val" ref={ref}>{val}</span>;
}

function RiskSpark() {
  const pts = [22, 26, 21, 30, 25, 34, 40, 52, 61];
  const w = 320;
  const h = 130;
  const max = 66;
  const x = (i: number) => (i * w) / (pts.length - 1);
  const y = (v: number) => h - (v / max) * h;
  const line = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(v)}`).join(' ');
  const area = `${line} L${w},${h} L0,${h} Z`;
  return (
    <svg className="risk-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="psRiskFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(192,107,79,0.34)" />
          <stop offset="1" stopColor="rgba(192,107,79,0)" />
        </linearGradient>
        <linearGradient id="psRiskSparkLine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--accent-hi)" />
          <stop offset="1" stopColor="var(--terracotta)" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#psRiskFill)" />
      <path d={line} fill="none" stroke="url(#psRiskSparkLine)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="risk-spark-line" />
      <circle cx={x(pts.length - 1)} cy={y(pts[pts.length - 1])} r="5" fill="var(--terracotta)" />
    </svg>
  );
}

function DividerWave() {
  return (
    <div className="ps-divider" aria-hidden>
      <svg viewBox="0 0 1200 60" preserveAspectRatio="none">
        <path d="M0 40 C 200 10, 420 55, 640 30 S 1050 5, 1200 34 L1200 60 L0 60 Z" fill="var(--accent-soft)" />
        <path d="M0 40 C 200 10, 420 55, 640 30 S 1050 5, 1200 34" fill="none" stroke="var(--accent-line)" strokeWidth="1.5" />
      </svg>
    </div>
  );
}
