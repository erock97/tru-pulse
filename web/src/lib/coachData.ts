// coachData.ts
// TRU HQ — native Coach data layer.
// Ported straight from the standalone Coaching app's truData.js (loadRoster,
// teamMix, loadProfile/deriveProfile, loadGoalBundle/loadCheckins/loadCommitments)
// and the framework consts they need (ARCH, LL, QUAD_COLOR, TRAIT_LABELS, funnel,
// confidence). Same Supabase project (yeyoteredgunhvhqmais) that HQ already talks
// to, so the queries + RLS scoping are identical — only the client import and the
// TypeScript types are new.
//
// WRITES: the 1:1 Prep + Goal/Commitment sheets in the agent drill-in deliberately
// write coaching data (the owner wants it saved/logged). The write functions ported
// below (loadGoalBundle create/seed, saveGoalFields, toggle/add/update/deleteCommitment,
// saveCheckin) touch ONLY the coaching tables — goals, commitments, checkins — via the
// same shared-DB/RLS access the reads already use. No auth/user/other-table writes.

import { supabase } from './supabase';
import { isDemo } from './api';
import {
  PERSONAL_TYPES, PERSONAL_LABELS, WORK_LABELS, divergence,
  ARCH, LL, TRAIT_LABELS,
  type Axis, type Pole, type AxisResult,
} from './assessmentData';

/* ============================================================
   FRAMEWORK CONSTS (ported from truFramework.js — the parts the
   roster/profile derivation depends on).
   ARCH / LL / TRAIT_LABELS now come from assessmentData.ts (the single
   source of truth for archetype names) so Coach and the public reveal
   never show diverging archetype names for the same code.
   ============================================================ */

export type Arch = (typeof ARCH)[string];
export type Lens = (typeof LL)[string];

export const QUAD_COLOR: Record<string, string> = {
  Achiever: '#2E8B57', Striver: '#2F6BB0', Independent: '#A9791F', Detractor: '#C0492F',
};

// GOAL FUNNEL MATH — quarterly transactions → leads needed → monthly / weekly.
export function funnel({ allocated, cvrPercent }: { allocated: number; cvrPercent: number }) {
  const ceil = (x: number) => Math.max(0, Math.ceil(x));
  const perQuarter = allocated > 0 ? ceil(allocated / (cvrPercent / 100)) : 0;
  return { perQuarter, perMonth: ceil(perQuarter / 3), perWeek: ceil(perQuarter / 13) };
}

// Confidence from number of times assessed (more takes = more concrete).
export function confidence(takes: number): { pct: number; label: string } {
  if (takes >= 4) return { pct: 93, label: 'Locked in' };
  if (takes >= 3) return { pct: 85, label: 'Confirmed' };
  if (takes >= 2) return { pct: 72, label: 'Forming' };
  return { pct: 54, label: 'Emerging' };
}

/* ============================================================
   SMALL PURE HELPERS (ported from truData.js)
   ============================================================ */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function initials(n?: string): string {
  return (n || '').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
}
export function firstName(n?: string): string {
  return (n || '').trim().split(/\s+/)[0] || 'there';
}
export function monthYear(iso: string): string {
  const d = new Date(iso);
  return MON[d.getMonth()] + ' ' + d.getFullYear();
}
export function daysSince(iso?: string | null): number {
  if (!iso) return 99;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}
function spanLabel(oldestIso?: string, newestIso?: string): string {
  if (!oldestIso) return 'just now';
  const months = Math.max(0, Math.round((new Date(newestIso!).getTime() - new Date(oldestIso).getTime()) / (1000 * 60 * 60 * 24 * 30)));
  if (months <= 0) return 'just now';
  if (months === 1) return '1 month';
  if (months < 12) return months + ' months';
  const y = Math.round(months / 12);
  return y === 1 ? '1 year' : y + ' years';
}

// ── pace / heartbeat from a check-in's age ──────────────────────
export interface Pace { pace: string; paceColor: string; paceBg: string; paceShort: string }
export function paceFromDays(lastDays: number, hasAny: boolean): Pace {
  if (lastDays >= 14) {
    return {
      pace: hasAny ? 'Stalled' : 'No check-ins',
      paceColor: '#F0696A', paceBg: 'rgba(240,105,106,.14)', paceShort: 'Needs you',
    };
  }
  if (lastDays >= 7) {
    return { pace: 'Slipping', paceColor: '#E0A340', paceBg: 'rgba(224,163,64,.14)', paceShort: 'Check in' };
  }
  return { pace: 'On track', paceColor: '#3ECF8E', paceBg: 'rgba(62,207,142,.14)', paceShort: 'On track' };
}

function archOf(code: string): Arch { return ARCH[code] || ARCH['P-Rec-R-I']; }
function llOf(code: string): Lens { return LL[code] || LL['P-Rec-R-I']; }

/* ============================================================
   ROSTER — agents + latest assessment + latest check-in.
   (ported from truData.loadRoster)
   ============================================================ */
export interface RosterAgent extends Pace {
  id: string;
  teamId: string | null;
  name: string;
  code: string;
  personalCode: string | null;
  emoji: string;
  color: string;
  archName: string;
  quad: string;
  initials: string;
  tileBg: string;
  days: number;
  due: boolean;
  lastDays: number;
  lastLabel: string;
  lastFocus: string;
  takes: number;
  token: string | null;
}

interface AgentRow {
  id: string;
  team_id: string | null;
  token: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  created_at: string;
  coaching_enabled?: boolean | null;
  assessments: Array<{ code: string; taken_at: string }> | null;
  checkins: Array<{ created_at: string; met: unknown; leads: unknown; convos: unknown; focus: string | null }> | null;
}

export async function loadRoster(cadenceDays = 90): Promise<RosterAgent[]> {
  // Demo/preview: render a believable Sample Realty roster with NO backend, so Coach
  // is previewable on ?demo=1 like every other tab. Never touches Supabase.
  const pcodes: Record<string, string> = {};
  let data: AgentRow[] | null;
  if (isDemo) {
    data = demoAgentRows();
  } else {
    const res = await supabase
      .from('agents')
      .select('id, team_id, token, name, email, phone, created_at, coaching_enabled, assessments(code, taken_at), checkins(created_at, met, leads, convos, focus)')
      .order('created_at', { ascending: true });
    if (res.error) throw res.error;
    data = res.data as AgentRow[] | null;

    // Best-effort: personal (baseline) codes. The column may not exist — if so, skip.
    const pcRes = await supabase.from('agents').select('id, personal_code');
    if (!pcRes.error && pcRes.data) {
      (pcRes.data as Array<{ id: string; personal_code: string | null }>).forEach((x) => {
        if (x.personal_code) pcodes[x.id] = x.personal_code;
      });
    }
  }

  return (data || [])
    .map((agent): RosterAgent | null => {
      const assessments = (agent.assessments || [])
        .slice()
        .sort((a, b) => new Date(b.taken_at).getTime() - new Date(a.taken_at).getTime());
      const checkins = (agent.checkins || [])
        .slice()
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      // Coach = a lead-curated cohort, not the whole Pulse roster: agents the leader
      // hasn't added via "Add agents to Coach" (coaching_enabled=false) never appear
      // here. Demo rows are marked coaching_enabled below so ?demo=1 keeps rendering.
      if (!agent.coaching_enabled) return null;
      const latest = assessments[0] || null;
      if (!latest) return null; // not-yet-assessed cohort members show in the "Not yet assessed" lane (derived in Coach.tsx from loadFullRoster), not this archetype roster
      const code = latest.code;
      const ar = archOf(code);
      const lc = llOf(code);
      const lastDays = checkins.length ? daysSince(checkins[0].created_at) : 99;
      const pace = paceFromDays(lastDays, checkins.length > 0);
      const days = daysSince(latest.taken_at);
      const lastLabel = lastDays >= 99 ? 'never'
        : lastDays === 0 ? 'today'
          : lastDays === 1 ? 'yesterday'
            : lastDays + 'd ago';
      return {
        id: agent.id,
        teamId: agent.team_id ?? null,
        name: agent.name,
        code,
        personalCode: pcodes[agent.id] || null,
        emoji: ar.emoji,
        color: ar.color,
        archName: ar.name,
        quad: lc.quad,
        initials: initials(agent.name),
        tileBg: ar.color + '22',
        days,
        due: days >= cadenceDays,
        lastDays,
        lastLabel,
        lastFocus: checkins[0]?.focus || '',
        takes: assessments.length,
        token: agent.token,
        ...pace,
      };
    })
    .filter((x): x is RosterAgent => Boolean(x));
}

/* Demo roster (Sample Realty) — raw agent rows fed through the SAME mapper above,
   so every derived field (archetype, pace, health) is computed the real way. Only
   returned under ?demo=1. Varied paces exercise the on-track / slipping / stalled /
   no-check-in states so the whole Coach dashboard renders in preview + sales demos. */
function demoAgentRows(): AgentRow[] {
  const now = Date.now();
  const DAY = 86400_000;
  const iso = (d: number) => new Date(now - d * DAY).toISOString();
  const mk = (
    id: string, name: string, code: string,
    assessedDays: number, lastCheckinDays: number | null, focus: string,
  ): AgentRow => ({
    id, team_id: 'demo', token: null, name, email: null, phone: null,
    coaching_enabled: true,
    created_at: iso(assessedDays),
    assessments: [{ code, taken_at: iso(assessedDays) }],
    checkins: lastCheckinDays === null ? [] : [
      { created_at: iso(lastCheckinDays), met: 3, leads: 14, convos: 6, focus },
    ],
  });
  return [
    mk('demo-c1', 'Trevor Holland', 'P-Pro-R-D', 42, 2, 'Speed-to-lead on every Zillow connect'),
    mk('demo-c2', 'Dana Cole', 'T-Pro-V-I', 58, 9, 'Move pre-approval earlier in the call'),
    mk('demo-c3', 'Priya Nair', 'P-Rec-R-I', 31, 17, 'Rebuild the daily follow-up cadence'),
    mk('demo-c4', 'Marcus Delgado', 'P-Pro-V-I', 76, 4, 'Run ALMS on every first conversation'),
    mk('demo-c5', 'Maria Lopez', 'T-Pro-R-I', 21, null, 'First check-in — set the baseline'),
    mk('demo-c6', 'Sam Whitfield', 'P-Rec-V-D', 95, 24, 'Reset the standard, hold the line'),
  ];
}

export const QUADNOTE: Record<string, string> = {
  Achiever: 'Mostly self-driven Achievers. Challenge them with bigger targets and autonomy — resist the urge to manage what they can own.',
  Striver: 'Several Strivers on the team. They grow in safety and structure before stretch — this is where your 1:1 time pays the highest return.',
  Independent: 'Independents in the mix. Earn credibility first, then coach engagement, not skill — their ability is rarely the gap.',
  Detractor: 'Watch the Detractors closely — re-engagement comes before any performance conversation.',
};

// Team-mix segments for the dashboard "how your team is wired" bar.
export interface TeamSeg { label: string; count: number; color: string; pct: number }
export function teamMix(roster: RosterAgent[]): { segs: TeamSeg[]; note: string } {
  const quadCount: Record<string, number> = {};
  roster.forEach((r) => { quadCount[r.quad] = (quadCount[r.quad] || 0) + 1; });
  const total = roster.length || 1;
  const segs: TeamSeg[] = Object.keys(quadCount).map((q) => ({
    label: q, count: quadCount[q], color: QUAD_COLOR[q] || '#5B9DF0',
    pct: Math.round((quadCount[q] / total) * 100),
  }));
  let domQuad = 'Striver'; let domN = -1;
  Object.keys(quadCount).forEach((q) => { if (quadCount[q] > domN) { domN = quadCount[q]; domQuad = q; } });
  return { segs, note: QUADNOTE[domQuad] || QUADNOTE.Striver };
}

/* ============================================================
   PROFILE derivation for one agent (Growth tab).
   (ported from truData.loadProfile / deriveProfile)
   ============================================================ */
interface AssessmentRow {
  code: string;
  taken_at: string;
  energy_p?: number; energy_t?: number;
  approach_pro?: number; approach_rec?: number;
  deal_r?: number; deal_v?: number;
  decision_d?: number; decision_i?: number;
}

export async function loadProfile(agentId: string): Promise<Profile> {
  // Demo/preview: loadRoster's demo path never touches Supabase, but this
  // function previously always did — for a fake demo-cN id that Supabase
  // call errors, and since AgentDrill awaits loadProfile + loadCheckins
  // together via Promise.all, that one rejection was silently swallowing
  // BOTH results (profile AND check-ins never rendered in ?demo=1). Derive
  // the same way real data does, just from the seeded demo assessment row.
  if (isDemo) {
    const demoAgent = demoAgentRows().find((a) => a.id === agentId);
    const rows: AssessmentRow[] = (demoAgent?.assessments || []).map((a) => ({ code: a.code, taken_at: a.taken_at }));
    return deriveProfile(rows, null, null);
  }
  const { data, error } = await supabase
    .from('assessments')
    .select('code, taken_at, energy_p, energy_t, approach_pro, approach_rec, deal_r, deal_v, decision_d, decision_i')
    .eq('agent_id', agentId)
    .order('taken_at', { ascending: false });
  if (error) throw error;

  // Best-effort: the personal (baseline) profile. Agents assessed on the old
  // site (business-only) have no personal_code/personal_axes — the columns
  // or the row itself may come back empty. Degrade to null, never throw.
  let personalCode: string | null = null;
  let personalAxes: Record<Axis, { letter: Pole; pct: number }> | null = null;
  const pRes = await supabase.from('agents').select('personal_code, personal_axes').eq('id', agentId).maybeSingle();
  if (!pRes.error && pRes.data) {
    const row = pRes.data as { personal_code: string | null; personal_axes: Record<Axis, { letter: Pole; pct: number }> | null };
    personalCode = row.personal_code ?? null;
    personalAxes = row.personal_axes ?? null;
  }

  return deriveProfile((data as AssessmentRow[] | null) || [], personalCode, personalAxes);
}

// AXIS_ORDER mirrors assessmentData.ts's (private) axis order — the 4-letter
// codes (both personal_code and the business `code`) are always
// energy-approach-deal-decision, so splitting a code on '-' in this order
// lines up with AxisResult.axes position-by-position.
const AXIS_KEYS: Axis[] = ['energy', 'approach', 'deal', 'decision'];

// Build a minimal AxisResult from a 4-letter code alone (pct is irrelevant to
// divergence()/label lookups, which only compare/read the letter).
function codeToAxisResult(code: string, axes?: Record<Axis, { letter: Pole; pct: number }> | null): AxisResult {
  if (axes) return { code, axes };
  const letters = code.split('-') as Pole[];
  const built = {} as AxisResult['axes'];
  AXIS_KEYS.forEach((ax, i) => { built[ax] = { letter: letters[i], pct: 50 }; });
  return { code, axes: built };
}

function computeDivergences(
  businessCode: string,
  personalCode: string | null,
  personalAxes: Record<Axis, { letter: Pole; pct: number }> | null,
): { axis: Axis; personalLabel: string; workLabel: string }[] {
  if (!personalCode) return [];
  const personal = codeToAxisResult(personalCode, personalAxes);
  const business = codeToAxisResult(businessCode);
  return divergence(personal, business).map((axis) => ({
    axis,
    personalLabel: PERSONAL_LABELS[personal.axes[axis].letter],
    workLabel: WORK_LABELS[business.axes[axis].letter],
  }));
}

const DIM_NAMES = ['Energy', 'Approach', 'Deal Style', 'Decisions'];
function lvColor(lv: number): string { return lv >= 3 ? '#3ECF8E' : lv === 2 ? '#5B9DF0' : '#9fb0c4'; }
function lvBg(lv: number): string { return lv >= 3 ? 'rgba(62,207,142,.15)' : lv === 2 ? 'rgba(91,157,240,.15)' : 'rgba(255,255,255,.07)'; }

export interface DimStatus { label: string; statusLabel: string; color: string; mark: string }
export interface HistoryRow { date: string; level: number; dot: string; nameColor: string; levelColor: string; levelBg: string; hasShift: boolean; shiftLabel: string }
export interface Shift { dim: string; from: string; to: string; when: string }
export interface Profile {
  code: string; takes: number; confPct: number; confLabel: string; confColor: string;
  confBg: string; span: string; dimStatus: DimStatus[]; curLvl: number;
  history: HistoryRow[]; grew: number; shift: Shift | null;
  archName: string; emoji: string; color: string; tagline: string;
  quad: string; law: string; signal: string; unlock: string;
  personalCode: string | null;
  personalType: { name: string; desc: string; strengths: string[]; watch: string } | null;
  divergences: { axis: Axis; personalLabel: string; workLabel: string }[];
}

export function deriveProfile(
  rows: AssessmentRow[],
  personalCode: string | null = null,
  personalAxes: Record<Axis, { letter: Pole; pct: number }> | null = null,
): Profile {
  const takes = rows.length || 1;
  const latest = rows[0] || null;
  const code = latest ? latest.code : 'P-Rec-R-I';
  const prev = rows[1] || null;
  const conf = confidence(takes);
  const confColor = conf.pct >= 90 ? '#3ECF8E' : conf.pct >= 75 ? '#5B9DF0' : conf.pct >= 60 ? '#E0A340' : '#F0888A';
  const span = rows.length
    ? spanLabel(rows[rows.length - 1].taken_at, rows[0].taken_at)
    : 'just now';

  // dimension-settling chips: lock the first N dimensions as takes accumulate
  const lockedN = Math.min(takes, 4);
  const dimStatus: DimStatus[] = DIM_NAMES.map((d, idx) => {
    const lk = idx < lockedN;
    return { label: d, statusLabel: lk ? 'Settled' : 'Forming', color: lk ? '#3ECF8E' : '#E0A340', mark: lk ? '✓' : '○' };
  });

  // change detection by comparing the two most-recent codes
  const ll = llOf(code);
  const curLvl = ll.max >= 3 ? 3 : 2;
  let shift: Shift | null = null;
  if (prev && prev.code !== code && latest) {
    const a = code.split('-') as Pole[]; const b = prev.code.split('-') as Pole[];
    const idx = a.findIndex((x, i) => x !== b[i]);
    if (idx >= 0) {
      shift = {
        dim: DIM_NAMES[idx],
        from: TRAIT_LABELS[b[idx]] || b[idx],
        to: TRAIT_LABELS[a[idx]] || a[idx],
        when: monthYear(latest.taken_at),
      };
    }
  }

  // history rows (most-recent first), level implied by archetype ceiling
  const history: HistoryRow[] = rows.slice(0, 4).map((r, idx) => {
    const lv = (LL[r.code]?.max ?? 2) >= 3 ? 3 : 2;
    return {
      date: monthYear(r.taken_at),
      level: lv,
      dot: idx === 0 ? archOf(r.code).color : lvColor(lv),
      nameColor: idx === 0 ? '#33281A' : '#8A7A63',
      levelColor: lvColor(lv),
      levelBg: lvBg(lv),
      hasShift: !!(shift && shift.when === monthYear(r.taken_at) && idx === 0),
      shiftLabel: shift ? shift.dim + ' shifted' : '',
    };
  });
  const oldestLvl = history.length ? history[history.length - 1].level : curLvl;
  const grew = curLvl - oldestLvl;

  const ar = archOf(code);
  const personalType = personalCode ? (PERSONAL_TYPES[personalCode] ?? null) : null;
  const divergences = computeDivergences(code, personalCode, personalAxes);
  return {
    code, takes, confPct: conf.pct, confLabel: conf.label, confColor,
    confBg: confColor + '22', span, dimStatus, curLvl, history, grew, shift,
    archName: ar.name, emoji: ar.emoji, color: ar.color, tagline: ar.tagline,
    quad: ll.quad, law: ll.law, signal: ll.signal, unlock: ll.unlock,
    personalCode: personalCode ?? null, personalType, divergences,
  };
}

/* ============================================================
   GOALS + COMMITMENTS + CHECK-INS (ported read-only slices)
   ============================================================ */
export interface Goal { agent_id: string; team_id?: string | null; quarter: string; q_goal: number; alloc_company: number; cvr_company: number; cvr_sphere: number }
export interface Commitment { id: string; agent_id: string; team_id?: string | null; source: string; text: string; is_custom: boolean; done: boolean }
export interface Checkin { id: string; agent_id: string; created_at: string; met: unknown; leads: number | null; convos: number | null; win: string | null; focus: string | null }

/* ============================================================
   STRUCTURED LEADERSHIP 1:1 — DATA LAYER (Block 4a)
   Built to COACH_1ON1_STRUCTURED_DESIGN.md §1–§3. `checkins` (above) stays the
   unchanged session spine; these are the two child tables from the design's
   proposal SQL (db/hq_coach_1on1_structured.sql — NOT YET APPLIED to any DB):
     checkin_items  — agent-visible wins / per-session next commitments
     checkin_leader — LEADER-ONLY checklist state + private note (no agent RLS
                      policy exists on this table; never fetch it for an agent
                      view — see loadCheckinLeader below).
   Nothing here is wired into any UI yet; that's Blocks 4b (leader form) and 4c
   (agent recap). Every loader/writer has an isDemo branch and never hits
   Supabase under ?demo=1.
   ============================================================ */

// Tri-state "did we meet" value the structured form's pills send — same three
// strings the existing checkins.met column and Past 1:1s pills already speak
// (metStatus() in Coach.tsx), so there is no migration: a structured save just
// writes one of these three straight into checkins.met.
export type MetStatus = 'yes' | 'partial' | 'no';
export const MET_LABELS: Record<MetStatus, string> = { yes: 'Met', partial: 'Partial', no: 'Missed' };

// 'focus' is retained only for legacy round-trip (the DB check constraint still
// lists it); the leader form no longer PRODUCES focus items — "next focuses" was
// merged into the single "Next commitments" list. Nothing new is ever a focus.
export type CheckinItemKind = 'win' | 'focus' | 'commitment';
// Per-session commitment lifecycle. null = not yet reviewed in a later 1:1.
export type CommitmentStatus = 'done' | 'partial' | 'missed';
export const COMMITMENT_STATUS_LABELS: Record<CommitmentStatus, string> = {
  done: 'Done', partial: 'Partial', missed: 'Missed',
};

export interface CheckinItem {
  id: string;
  agentId: string;
  checkinId: string;
  kind: CheckinItemKind;
  body: string;
  position: number;
  status: CommitmentStatus | null;      // commitment rows only
  reviewedIn: string | null;            // checkin id where this was reviewed, if any
  createdAt: string;
}

// LEADER-ONLY. Must never be fetched by, or rendered on, any agent-facing view
// (AgentCourse / the recap in Block 4c). There is deliberately no loader that
// an agent code path could call to get this by accident — see loadCheckinLeader.
export interface CheckinLeader {
  checkinId: string;
  agentId: string;
  checklistVersion: string;
  checklist: Record<string, boolean>;   // { "<step_id>": true, ... }
  privateNote: string | null;
  createdAt: string;
  updatedAt: string;
}

// A checkins row enriched with its structured children, for the leader-side
// Past 1:1s detail (Block 4b). Legacy quick check-ins simply have empty
// items/no leader row — they render exactly as they do today.
export interface CheckinBundle extends Checkin {
  items: CheckinItem[];
  leader: CheckinLeader | null;
}

// The one review outcome a leader records per open commitment when running
// the NEXT session (design §1b: "review last 1:1's commitments").
export interface CommitmentReview { itemId: string; status: CommitmentStatus }

/* ── The standard "TRU Leadership 1:1" checklist (tru-1on1-v1) ──────────────
   Verbatim from the design doc §3. Lives in code, not the DB — checkin_leader
   stamps `checklist_version` per row so a future customizable-checklist phase
   can render historical sessions against the right prompt set. Steps marked
   `auto` are the ones the leader form (4b) auto-ticks when the matching
   capture section has content (review / win / next); the leader can untick.
   `short` is the one-word label the collapsed step-strip shows at a glance
   (Open · Review · Celebrate · Coach · Commit); `title` + `cue` only appear
   when the leader taps a step open. */
export interface ChecklistStep { id: string; short: string; title: string; cue: string; auto?: boolean }
export const ONE_ON_ONE_CHECKLIST_VERSION = 'tru-1on1-v1';
// Trimmed to the five essential moves of a great 1:1 — a clean arc the leader
// can hold in their head: Open → Review → Celebrate → Coach → Commit. The three
// ⚡ steps (review / win / next) auto-tick as their matching capture section
// fills, so the checklist stays honest at zero extra clicks. The softer steps
// from the original eight (open-only "how are they arriving" survives as the
// opener; "connect to the goal" and "book the next 1:1" fold into coach/next;
// "ask what's blocking" folds into the coaching moment) were cut so the guide
// reads as a tight leadership doc, not a wall of prompts.
export const ONE_ON_ONE_CHECKLIST: ChecklistStep[] = [
  { id: 'open', short: 'Open', title: 'Open on them, not the numbers.',
    cue: 'Two minutes of real catch-up before any coaching. How are they actually arriving — energized, scattered, guarded? Read the person before you read the pipeline.' },
  { id: 'review', short: 'Review', title: 'Review every commitment from last time.', auto: true,
    cue: 'Walk each one: done, partial, or missed. Meet a miss with curiosity, not judgment — "What got in the way?" Skip this and you teach them commitments are optional.' },
  { id: 'win', short: 'Celebrate', title: 'Celebrate one specific win.', auto: true,
    cue: 'Name the exact behavior, not just the number — "You followed up five times on that Zillow lead" beats "great month." What gets celebrated gets repeated.' },
  { id: 'coach', short: 'Coach', title: 'Coach one move — to how they’re wired.',
    cue: 'Ask what’s in their way and where they need you, then pick the single highest-leverage adjustment — and coach it to the person in front of you, not a generic playbook. One move, matched to them.' },
  { id: 'next', short: 'Commit', title: 'Set the next commitments — in their words.', auto: true,
    cue: 'They say it, you write it. Specific and countable ("10 sphere conversations by Friday"), never vague ("work the database"). If they can’t say it back, it isn’t set.' },
];

/* ── Archetype-tailored coaching cues ───────────────────────────────────────
   Surfaced on the "Celebrate a win" (praise) and "Coach one move" (coach)
   steps, keyed to the CURRENT agent's archetype (RosterAgent.quad —
   Achiever / Independent / Striver, with a Detractor fallback for the
   re-engagement case). This is what turns the standard checklist into a
   leadership coach: the same five steps adapt to how THIS person best
   receives recognition and grows. Content is Eric-approved microcopy. */
export interface ArchetypeCue { praise: string; coach: string }
export const ARCHETYPE_CUES: Record<string, ArchetypeCue> = {
  Achiever: {
    praise: 'Praise the result, then raise the bar. Recognition lands hardest when it’s tied to the next, bigger target — and a little more room to run.',
    coach: 'Stretch them. Hand over a bigger target and more autonomy; Achievers grow on something to own, not something to be managed through.',
  },
  Independent: {
    praise: 'Praise the judgment, not the effort. Name the smart call they made — they want to be seen as competent and credible, not congratulated for trying.',
    coach: 'Earn credibility first. Independents open up once they trust you know the work — then coach engagement and buy-in, rarely raw skill.',
  },
  Striver: {
    praise: 'Warm, specific, and reassuring. Point to the exact progress and tell them it’s working — confidence is the unlock, so build it before you stretch.',
    coach: 'Safety before stretch. Give structure and one clear next step they can win; steady footing first, bigger asks once they feel solid.',
  },
  Detractor: {
    praise: 'Find something genuine to acknowledge — being seen is the first thread back. Keep it real; re-engagement starts here.',
    coach: 'Reconnect before you correct. With a disengaged agent the work is re-engagement first — hold the performance push until they’re back in the room.',
  },
};

// GOAL DEFAULTS + quarter options (ported verbatim from truData.js). loadGoalBundle
// seeds a goal from these on first open so an agent always has a starting funnel.
export const GOAL_DEFAULTS = { quarter: 'Q3 2026', q_goal: 6, alloc_company: 3, cvr_company: 4.0, cvr_sphere: 12.0 } as const;
export const QUARTERS = ['Q3 2026', 'Q4 2026', 'Q1 2027', 'Q2 2027', 'Q3 2027'];

// Generate the base commitments from the funnel + archetype letters (ported).
// COMPANY = execution on the leads the team FEEDS them; SPHERE = the agent's own
// engine, where a weekly activity count is a fair lever.
export interface BaseCommitment { source: string; text: string }
export function generateBaseCommitments(code: string, goal: Goal): BaseCommitment[] {
  const [pEn, , pDe, pDi] = code.split('-');
  const qGoal = goal.q_goal;
  const allocC = Math.min(goal.alloc_company, qGoal);
  const allocS = Math.round((qGoal - allocC) * 10) / 10;
  const sph = funnel({ allocated: allocS, cvrPercent: goal.cvr_sphere });
  return [
    { source: 'company', text: 'Respond to every new lead within 5 minutes — speed wins the leads you’re given' },
    { source: 'company', text: pDe === 'V' ? 'Make 5+ follow-up attempts per lead across the first 14 days' : 'Give every lead a personal, relationship-first follow-up sequence' },
    { source: 'company', text: pDi === 'D' ? 'Log each lead’s source + outcome to sharpen your real conversion rate' : 'Trust your read — prioritize the leads showing genuine motivation' },
    { source: 'sphere', text: `Have ${sph.perWeek} sphere conversations each week (${sph.perMonth}/month)` },
    { source: 'sphere', text: pDe === 'R' ? 'Send 3 handwritten notes to past clients each week' : 'Send 1 high-value market update to your database weekly' },
    { source: 'sphere', text: pEn === 'P' ? 'Host 1 in-person touchpoint each week — coffee, event, or pop-by' : 'Publish 1 piece of content your sphere will want to share' },
  ];
}

// Live funnel numbers for a goal (front-end only, no DB) — ported verbatim.
export interface GoalFunnel {
  qGoal: number; allocC: number; allocS: number; pctC: number; pctS: number;
  comp: { perQuarter: number; perMonth: number; perWeek: number };
  sph: { perQuarter: number; perMonth: number; perWeek: number };
}
export function goalFunnel(goal: Goal): GoalFunnel {
  const qGoal = goal.q_goal;
  const allocC = Math.min(goal.alloc_company, qGoal);
  const allocS = Math.round((qGoal - allocC) * 10) / 10;
  const comp = funnel({ allocated: allocC, cvrPercent: goal.cvr_company });
  const sph = funnel({ allocated: allocS, cvrPercent: goal.cvr_sphere });
  const pctC = qGoal > 0 ? Math.round((allocC / qGoal) * 100) : 0;
  return { qGoal, allocC, allocS, pctC, pctS: 100 - pctC, comp, sph };
}

// Load the full goal bundle for an agent; CREATE the goal + SEED the base
// commitments on first open so the agent has a checklist immediately.
// This is the write-path restoration — the earlier HQ port made it read-only.
export async function loadGoalBundle(
  agentId: string,
  teamId: string | null,
  code: string,
): Promise<{ goal: Goal | null; commitments: Commitment[] }> {
  let { data: goal } = await supabase.from('goals').select('*').eq('agent_id', agentId).maybeSingle();
  if (!goal) {
    const insert = { agent_id: agentId, team_id: teamId, ...GOAL_DEFAULTS };
    const res = await supabase.from('goals').insert(insert).select().single();
    goal = res.data;
  }
  let { data: commitments } = await supabase.from('commitments').select('*').eq('agent_id', agentId);
  commitments = commitments || [];
  if (commitments.length === 0 && goal) {
    const rows = generateBaseCommitments(code, goal as Goal).map((c) => ({
      agent_id: agentId, team_id: teamId, source: c.source, text: c.text, is_custom: false, done: false,
    }));
    const res = await supabase.from('commitments').insert(rows).select();
    commitments = res.data || [];
  }
  return { goal: (goal as Goal | null) ?? null, commitments: (commitments as Commitment[] | null) || [] };
}

export async function saveGoalFields(agentId: string, fields: Partial<Goal>): Promise<Goal | null> {
  const { data } = await supabase.from('goals').update(fields).eq('agent_id', agentId).select().single();
  return (data as Goal | null) ?? null;
}
export async function setQuarter(agentId: string, quarter: string): Promise<Goal | null> {
  return saveGoalFields(agentId, { quarter });
}
export async function toggleCommitment(id: string, done: boolean): Promise<void> {
  await supabase.from('commitments').update({ done }).eq('id', id);
}
export async function clearCommitments(agentId: string): Promise<void> {
  const { error } = await supabase.from('commitments').delete().eq('agent_id', agentId);
  if (error) throw error;
}
export async function addCommitment(
  agentId: string,
  teamId: string | null,
  source: string,
  text: string,
): Promise<Commitment | null> {
  const { data } = await supabase.from('commitments')
    .insert({ agent_id: agentId, team_id: teamId, source, text, is_custom: true, done: false })
    .select().single();
  return (data as Commitment | null) ?? null;
}
// Edit a saved commitment in place; mark it custom so a later goal change won't
// overwrite the leader's hand-edit.
export async function updateCommitment(id: string, fields: Partial<Commitment>): Promise<Commitment | null> {
  const { data } = await supabase.from('commitments')
    .update({ ...fields, is_custom: true }).eq('id', id)
    .select().single();
  return (data as Commitment | null) ?? null;
}
export async function deleteCommitment(id: string): Promise<void> {
  const { error } = await supabase.from('commitments').delete().eq('id', id);
  if (error) throw error;
}

export async function loadCommitments(agentId: string): Promise<Commitment[]> {
  const { data } = await supabase.from('commitments').select('*').eq('agent_id', agentId);
  return (data as Commitment[] | null) || [];
}

export async function loadCheckins(agentId: string): Promise<Checkin[]> {
  // Demo/preview: seeded 1:1 history, no backend — mirrors loadRoster's demo path.
  if (isDemo) return demoCheckinRows()[agentId] || [];
  const { data } = await supabase.from('checkins')
    .select('*').eq('agent_id', agentId).order('created_at', { ascending: false });
  return (data as Checkin[] | null) || [];
}

/* Demo 1:1 history (Sample Realty) — feeds the "Past 1:1s" read-back view in
   AgentDrill under ?demo=1. Kept independent from demoAgentRows()'s single
   embedded checkin (which only drives roster pace/health badges), but the
   NEWEST row per agent below intentionally matches that embedded checkin's
   days-ago + focus text, so the roster card and the drill-in history never
   contradict each other. demo-c1/c2/c3/c4/c6 get 2-4 past 1:1s; demo-c5
   (Maria Lopez — "first check-in" on the roster) is left with none so the
   empty state previews too. */
function demoCheckinRows(): Record<string, Checkin[]> {
  const now = Date.now();
  const DAY = 86400_000;
  const iso = (d: number) => new Date(now - d * DAY).toISOString();
  let seq = 0;
  const mk = (
    agentId: string, daysAgo: number, met: 'yes' | 'partial' | 'no',
    leads: number | null, convos: number | null, win: string | null, focus: string | null,
  ): Checkin => ({
    id: `demo-ci-${agentId}-${seq++}`, agent_id: agentId,
    created_at: iso(daysAgo), met, leads, convos, win, focus,
  });

  return {
    // Trevor Holland — matches roster's "2d ago · Speed-to-lead on every Zillow connect".
    'demo-c1': [
      mk('demo-c1', 2, 'yes', 16, 7, 'Booked 3 showings off pure speed-to-lead.', 'Speed-to-lead on every Zillow connect'),
      mk('demo-c1', 16, 'yes', 12, 5, 'Finally cracked the 5-minute response habit.', 'Tighten the follow-up sequence past day 3'),
      mk('demo-c1', 30, 'partial', 9, 4, 'Good week on volume.', 'Get faster on the very first response'),
    ],
    // Dana Cole — matches roster's "9d ago · Move pre-approval earlier in the call".
    'demo-c2': [
      mk('demo-c2', 9, 'yes', 11, 6, 'Pre-approval moved into call #1 on two deals this week.', 'Move pre-approval earlier in the call'),
      mk('demo-c2', 23, 'partial', 8, 5, 'Some progress, still slipping to call #2 sometimes.', 'Lock pre-approval into the opening script'),
      mk('demo-c2', 37, 'yes', 10, 6, 'Great sphere outreach week.', 'Start asking for pre-approval up front'),
      mk('demo-c2', 51, 'no', 4, 2, null, 'Rebuild consistency after a slow month'),
    ],
    // Priya Nair — matches roster's "17d ago · Rebuild the daily follow-up cadence".
    'demo-c3': [
      mk('demo-c3', 17, 'partial', 7, 3, 'Cadence restarted after the gap.', 'Rebuild the daily follow-up cadence'),
      mk('demo-c3', 45, 'no', 3, 1, null, 'Get back to a daily follow-up habit'),
    ],
    // Marcus Delgado — matches roster's "4d ago · Run ALMS on every first conversation".
    'demo-c4': [
      mk('demo-c4', 4, 'yes', 14, 8, 'ALMS landed cleanly on both calls I listened to.', 'Run ALMS on every first conversation'),
      mk('demo-c4', 19, 'yes', 13, 7, 'Strong week, confident on the phone.', 'Keep ALMS consistent under pressure'),
    ],
    // Maria Lopez (demo-c5) — no history yet on the roster either; left out on
    // purpose so the "no logged 1:1s yet" empty state has a real agent to show it on.
    // Sam Whitfield — matches roster's "24d ago · Reset the standard, hold the line".
    'demo-c6': [
      mk('demo-c6', 24, 'no', 2, 1, null, 'Reset the standard, hold the line'),
      mk('demo-c6', 52, 'no', 1, 0, null, 'Get back to baseline activity'),
    ],
  };
}

/* ── Demo structured detail, keyed to demoCheckinRows()'s `demo-ci-*` ids ────
   So the spine (checkins) and the detail (checkin_items/checkin_leader) agree
   under ?demo=1. Only two agents get full structured sessions, on purpose:
     Trevor Holland (demo-c1) — three structured sessions where each session
       reviews the PRIOR session's commitments and sets new ones; the newest
       session's two commitments are left unreviewed (status null) — this is
       the demo agent with OPEN commitments for the 4b "review last 1:1"
       step to render against.
     Dana Cole (demo-c2) — four structured sessions where every commitment
       set has since been reviewed by the following session, and the latest
       session sets none — the contrast "fully reviewed, nothing pending"
       empty state.
   Priya Nair (demo-c3), Marcus Delgado (demo-c4), Sam Whitfield (demo-c6) are
   left legacy-only (no rows here) so the "old record, no structured detail"
   rendering is previewable. Maria Lopez (demo-c5) has no check-ins at all
   already (demoCheckinRows), so she keeps the empty state untouched.
   Leader-only fields (checklist + private_note) are prefixed "LEADER-ONLY
   (demo):" so Block 4c's agent-view audit has an obvious tripwire — if that
   string ever renders on the agent side, the leak is instantly visible. */
interface DemoStructured { items: CheckinItem[]; leader: CheckinLeader | null }
function demoStructuredData(): Record<string, DemoStructured> {
  const now = Date.now();
  const DAY = 86400_000;
  const iso = (d: number) => new Date(now - d * DAY).toISOString();
  let itemSeq = 0;
  const item = (
    agentId: string, checkinId: string, daysAgo: number,
    kind: CheckinItemKind, body: string,
    status: CommitmentStatus | null = null, reviewedIn: string | null = null,
  ): CheckinItem => ({
    id: `demo-cit-${itemSeq++}`, agentId, checkinId, kind, body,
    position: 0, status, reviewedIn, createdAt: iso(daysAgo),
  });
  const leader = (
    agentId: string, checkinId: string, daysAgo: number,
    checklist: Record<string, boolean>, privateNote: string,
  ): CheckinLeader => ({
    checkinId, agentId, checklistVersion: ONE_ON_ONE_CHECKLIST_VERSION, checklist,
    privateNote: `LEADER-ONLY (demo): ${privateNote}`,
    createdAt: iso(daysAgo), updatedAt: iso(daysAgo),
  });
  const FULL_CHECKLIST = { open: true, review: true, win: true, coach: true, next: true };

  // ── Trevor Holland (demo-c1) — checkin ids from demoCheckinRows(): -0 (2d,
  // newest), -1 (16d), -2 (30d, oldest). ──────────────────────────────────
  const c1 = 'demo-c1';
  const c1Oldest = 'demo-ci-demo-c1-2', c1Mid = 'demo-ci-demo-c1-1', c1New = 'demo-ci-demo-c1-0';
  const trevor: [string, DemoStructured][] = [
    [c1Oldest, {
      items: [
        item(c1, c1Oldest, 30, 'win', 'Good week on volume.'),
        // Set here; reviewed two sessions later (c1Mid).
        item(c1, c1Oldest, 30, 'commitment', 'Respond within 5 minutes on every new Zillow lead', 'done', c1Mid),
        item(c1, c1Oldest, 30, 'commitment', 'Log call outcomes the same day', 'partial', c1Mid),
      ],
      leader: leader(c1, c1Oldest, 30,
        { ...FULL_CHECKLIST, coach: false },
        'watch his temper on lost leads — coach patience, not urgency.'),
    }],
    [c1Mid, {
      items: [
        item(c1, c1Mid, 16, 'win', 'Finally cracked the 5-minute response habit.'),
        // Set here; reviewed in the newest session (c1New).
        item(c1, c1Mid, 16, 'commitment', 'Add a day-3 follow-up touch on every lead', 'done', c1New),
        item(c1, c1Mid, 16, 'commitment', 'Text a market update to 5 sphere contacts', 'missed', c1New),
      ],
      leader: leader(c1, c1Mid, 16, FULL_CHECKLIST,
        'starting to trust the process — ease off the daily check-ins.'),
    }],
    [c1New, {
      items: [
        item(c1, c1New, 2, 'win', 'Booked 3 showings off pure speed-to-lead.'),
        // OPEN — not yet reviewed. This is the pair loadOpenCommitments()
        // surfaces for Trevor's next 1:1.
        item(c1, c1New, 2, 'commitment', 'Call every new lead within 5 minutes, no exceptions this week'),
        item(c1, c1New, 2, 'commitment', 'Send 3 handwritten notes to past clients'),
      ],
      leader: leader(c1, c1New, 2,
        { ...FULL_CHECKLIST, coach: false },
        'ready for a stretch goal next quarter — do not mention this to him yet.'),
    }],
  ];

  // ── Dana Cole (demo-c2) — checkin ids: -3 (9d, newest), -4 (23d), -5 (37d),
  // -6 (51d, oldest). Every commitment set gets reviewed by the following
  // session; the newest session sets none — nothing left open. ─────────────
  const c2 = 'demo-c2';
  const c2Oldest = 'demo-ci-demo-c2-6', c2Third = 'demo-ci-demo-c2-5', c2Mid = 'demo-ci-demo-c2-4', c2New = 'demo-ci-demo-c2-3';
  const dana: [string, DemoStructured][] = [
    [c2Oldest, {
      items: [
        item(c2, c2Oldest, 51, 'commitment', 'Call 10 past clients this week', 'done', c2Third),
      ],
      leader: leader(c2, c2Oldest, 51,
        { ...FULL_CHECKLIST, coach: false, next: false },
        'coming out of a slump — keep this one encouraging, not corrective.'),
    }],
    [c2Third, {
      items: [
        item(c2, c2Third, 37, 'win', 'Great sphere outreach week.'),
        item(c2, c2Third, 37, 'commitment', 'Ask about pre-approval on every first call', 'partial', c2Mid),
      ],
      leader: leader(c2, c2Third, 37, FULL_CHECKLIST, 'momentum is back — good week to stretch her.'),
    }],
    [c2Mid, {
      items: [
        item(c2, c2Mid, 23, 'commitment', 'Add pre-approval ask to opening script, use it on every call', 'done', c2New),
      ],
      leader: leader(c2, c2Mid, 23, { ...FULL_CHECKLIST, win: false }, 'no win logged this session — worth naming one next time even a small one.'),
    }],
    [c2New, {
      items: [
        item(c2, c2New, 9, 'win', 'Pre-approval moved into call #1 on two deals this week.'),
        // No new commitment set this session — Dana has nothing open.
      ],
      leader: leader(c2, c2New, 9, FULL_CHECKLIST, 'fully caught up — good candidate for a quarterly goal bump.'),
    }],
  ];

  return Object.fromEntries([...trevor, ...dana]);
}

// checkin_items only (agent-visible) — the primitive Block 4b's Past 1:1s
// detail AND Block 4c's agent recap both build on. Never returns leader data.
export async function loadCheckinItems(checkinId: string): Promise<CheckinItem[]> {
  if (isDemo) return (demoStructuredData()[checkinId]?.items || []).slice();
  const { data, error } = await supabase
    .from('checkin_items').select('*').eq('checkin_id', checkinId).order('position', { ascending: true });
  if (error) throw error;
  return (data || []).map(mapCheckinItemRow);
}

// checkin_leader — LEADER-ONLY. Only ever call this from leader-side code
// (Block 4b's Past 1:1s detail). Block 4c's agent recap must never call this.
export async function loadCheckinLeader(checkinId: string): Promise<CheckinLeader | null> {
  if (isDemo) return demoStructuredData()[checkinId]?.leader ?? null;
  const { data, error } = await supabase
    .from('checkin_leader').select('*').eq('checkin_id', checkinId).maybeSingle();
  if (error) throw error;
  return data ? mapCheckinLeaderRow(data) : null;
}

// The agent's unreviewed commitments across ALL prior sessions (design §1b:
// deliberately "all open", not just the immediately-prior checkin, so nothing
// falls through the cracks if a session was skipped or quick-logged). This is
// what Block 4b's "Last commitments" review group loads.
export async function loadOpenCommitments(agentId: string): Promise<CheckinItem[]> {
  if (isDemo) {
    const all = Object.values(demoStructuredData()).flatMap((s) => s.items);
    return all
      .filter((i) => i.agentId === agentId && i.kind === 'commitment' && i.status === null)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }
  const { data, error } = await supabase
    .from('checkin_items').select('*')
    .eq('agent_id', agentId).eq('kind', 'commitment').is('status', null)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(mapCheckinItemRow);
}

// Enriches an agent's full checkin history with its structured children, for
// the leader-side Past 1:1s detail (Block 4b). Legacy sessions (no child rows)
// come back with empty items / null leader and render exactly as today.
// LEADER-SIDE ONLY — includes checkin_leader. Block 4c's agent recap must use
// loadCheckinItems (above), never this.
export async function loadCheckinBundle(agentId: string): Promise<CheckinBundle[]> {
  const base = await loadCheckins(agentId);
  if (isDemo) {
    const structured = demoStructuredData();
    return base.map((c) => ({
      ...c,
      items: (structured[c.id]?.items || []).slice(),
      leader: structured[c.id]?.leader ?? null,
    }));
  }
  if (base.length === 0) return [];
  const ids = base.map((c) => c.id);
  const [itemsRes, leaderRes] = await Promise.all([
    supabase.from('checkin_items').select('*').in('checkin_id', ids).order('position', { ascending: true }),
    supabase.from('checkin_leader').select('*').in('checkin_id', ids),
  ]);
  if (itemsRes.error) throw itemsRes.error;
  if (leaderRes.error) throw leaderRes.error;
  const itemsByCheckin = new Map<string, CheckinItem[]>();
  (itemsRes.data || []).forEach((row: CheckinItemRow) => {
    const mapped = mapCheckinItemRow(row);
    const list = itemsByCheckin.get(mapped.checkinId) || [];
    list.push(mapped);
    itemsByCheckin.set(mapped.checkinId, list);
  });
  const leaderByCheckin = new Map<string, CheckinLeader>();
  (leaderRes.data || []).forEach((row: CheckinLeaderRow) => {
    const mapped = mapCheckinLeaderRow(row);
    leaderByCheckin.set(mapped.checkinId, mapped);
  });
  return base.map((c) => ({
    ...c,
    items: itemsByCheckin.get(c.id) || [],
    leader: leaderByCheckin.get(c.id) ?? null,
  }));
}

interface CheckinItemRow {
  id: string; agent_id: string; checkin_id: string; kind: CheckinItemKind;
  body: string; position: number; status: CommitmentStatus | null;
  reviewed_in: string | null; created_at: string;
}
function mapCheckinItemRow(r: CheckinItemRow): CheckinItem {
  return {
    id: r.id, agentId: r.agent_id, checkinId: r.checkin_id, kind: r.kind,
    body: r.body, position: r.position, status: r.status,
    reviewedIn: r.reviewed_in, createdAt: r.created_at,
  };
}
interface CheckinLeaderRow {
  checkin_id: string; agent_id: string; checklist_version: string;
  checklist: Record<string, boolean>; private_note: string | null;
  created_at: string; updated_at: string;
}
function mapCheckinLeaderRow(r: CheckinLeaderRow): CheckinLeader {
  return {
    checkinId: r.checkin_id, agentId: r.agent_id, checklistVersion: r.checklist_version,
    checklist: r.checklist || {}, privateNote: r.private_note,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

/* ============================================================
   AGENT-SIDE 1:1 RECAP — "Your 1:1s" (Block 4c)
   The agent's own read-back of the 1:1s their leader logged. AGENT-SAFE by
   construction: it reads ONLY `checkins` (own rows via checkins_agent_self) +
   `checkin_items` (own rows via checkin_items_agent_read) and NEVER touches
   `checkin_leader` — see db/hq_coach_1on1_structured.sql:52-56, 103-104. Do not
   add a leader field to MyOneOnOne, and never call loadCheckinBundle from any
   agent view; that loader pulls the leader-only sidecar (checklist + private
   note) and exists for the leader drill-in only.
   ============================================================ */

// One agent-visible 1:1: the shared summary (date/met/win) plus the agent-safe
// child rows (wins + next commitments with their review outcome). No leader
// checklist, no private note — those never leave the leader surface.
export interface MyOneOnOne {
  id: string;                 // checkin id
  createdAt: string;
  met: MetStatus | null;
  win: string | null;         // legacy summary win (checkins.win) — fallback line
  focus: string | null;       // legacy summary focus (checkins.focus)
  wins: string[];             // checkin_items kind='win'
  commitments: CheckinItem[]; // checkin_items kind='commitment' (status pill = Done/Partial/Missed/Open)
}

function normMet(v: unknown): MetStatus | null {
  if (v === 'yes' || v === 'partial' || v === 'no') return v;
  if (v === true) return 'yes';
  if (v === false) return 'no';
  return null;
}

// The agent's own 1:1 history, newest first. Leader-private data is never
// fetched here (no checkin_leader query at all — the agent has no RLS grant on
// it, and this code path must never reference it). Legacy quick check-ins (no
// child rows) come back with empty wins/commitments and render as a plain line.
export async function loadMyOneOnOnes(agentId: string): Promise<MyOneOnOne[]> {
  if (isDemo) return demoMyOneOnOnes(agentId);
  const base = await loadCheckins(agentId); // agent-readable via checkins_agent_self
  if (base.length === 0) return [];
  const ids = base.map((c) => c.id);
  // AGENT-SAFE: checkin_items only. RLS (checkin_items_agent_read) already
  // restricts these to the caller's own rows; we scope by their checkin ids too.
  const { data, error } = await supabase
    .from('checkin_items').select('*').in('checkin_id', ids)
    .order('position', { ascending: true });
  if (error) throw error;
  const byCheckin = new Map<string, CheckinItem[]>();
  (data || []).forEach((row: CheckinItemRow) => {
    const m = mapCheckinItemRow(row);
    const list = byCheckin.get(m.checkinId) || [];
    list.push(m);
    byCheckin.set(m.checkinId, list);
  });
  return base.map((c) => {
    const items = byCheckin.get(c.id) || [];
    return {
      id: c.id, createdAt: c.created_at, met: normMet(c.met),
      win: c.win, focus: c.focus,
      wins: items.filter((i) => i.kind === 'win').map((i) => i.body),
      commitments: items.filter((i) => i.kind === 'commitment'),
    };
  });
}

/* Demo agent recap (Jordan Rivera, the ?demo=1 #/learn identity — App.tsx sets
   agent.id='demo-agent'). Three sessions cover all three renderings on one demo
   agent: a fresh structured session with OPEN commitments, an earlier one whose
   commitments were reviewed (Done/Partial pills), and a legacy-only session
   (no child rows → the plain win/focus line). NO leader data, ever — this is
   the exact surface the §2 leak audit checks. */
function demoMyOneOnOnes(agentId: string): MyOneOnOne[] {
  if (agentId !== 'demo-agent') return [];
  const now = Date.now();
  const DAY = 86400_000;
  const iso = (d: number) => new Date(now - d * DAY).toISOString();
  let s = 0;
  const commit = (checkinId: string, body: string, status: CommitmentStatus | null): CheckinItem => ({
    id: `demo-my-${s++}`, agentId, checkinId, kind: 'commitment', body,
    position: s, status, reviewedIn: null, createdAt: iso(0),
  });
  return [
    {
      id: 'demo-my-c0', createdAt: iso(3), met: 'yes',
      win: 'Closed my first buyer from the open-house list.', focus: 'Call every new lead within 5 minutes',
      wins: ['Closed my first buyer from the open-house list.', 'Held two open houses solo.'],
      commitments: [
        commit('demo-my-c0', 'Call every new lead within 5 minutes this week', null),
        commit('demo-my-c0', 'Preview 3 listings before Saturday’s showings', null),
      ],
    },
    {
      id: 'demo-my-c1', createdAt: iso(18), met: 'yes',
      win: 'Booked 4 showings in one week.', focus: 'Ask every buyer for pre-approval up front',
      wins: ['Booked 4 showings in one week.'],
      commitments: [
        commit('demo-my-c1', 'Set up a daily 9am call block', 'done'),
        commit('demo-my-c1', 'Ask every buyer for pre-approval up front', 'partial'),
      ],
    },
    {
      id: 'demo-my-c2', createdAt: iso(33), met: 'partial',
      win: null, focus: 'Build a consistent morning routine',
      wins: [], commitments: [],
    },
  ];
}

// Log a 1:1 / check-in (ported). Writes ONLY the checkins table.
export interface SaveCheckinArgs {
  agentId: string;
  teamId: string | null;
  loggedBy?: string | null;
  met?: unknown;
  leads?: number | null;
  convos?: number | null;
  win?: string | null;
  focus?: string | null;
  createdAt?: string | null;
}
export async function saveCheckin({
  agentId, teamId, loggedBy, met, leads, convos, win, focus, createdAt,
}: SaveCheckinArgs): Promise<Checkin | null> {
  const { data } = await supabase.from('checkins')
    .insert({
      agent_id: agentId, team_id: teamId, logged_by: loggedBy ?? null,
      met, leads: leads ?? null, convos: convos ?? null, win: win ?? null, focus: focus ?? null,
      ...(createdAt ? { created_at: createdAt } : {}),
    })
    .select().single();
  return (data as Checkin | null) ?? null;
}

// Structured 1:1 save (Block 4a writer for the Block 4b form) — calls the
// atomic `log_structured_checkin` RPC (db/hq_coach_1on1_structured.sql,
// proposal not yet applied) so checkins + checkin_items + checkin_leader all
// land in one transaction, with checkins.win/focus back-filled from the first
// win/focus for every existing summary read path (roster, Past 1:1s, token
// RPC). Never touches Supabase under isDemo — mirrors saveCheckin/`saveOneOnOneDraft`'s
// no-op-guarded demo behavior.
export interface SaveStructuredCheckinArgs {
  agentId: string;
  teamId: string | null;
  met: MetStatus;
  createdAt?: string | null;
  wins: string[];
  commitments: string[];
  reviews: CommitmentReview[];
  checklist: Record<string, boolean>;
  privateNote?: string | null;
}
export async function saveStructuredCheckin(args: SaveStructuredCheckinArgs): Promise<{ checkinId: string } | null> {
  if (isDemo) {
    // No-op: demo is read-only/preview-only, exactly like every other Coach write path.
    return { checkinId: `demo-structured-${Date.now()}` };
  }
  const { data, error } = await supabase.rpc('log_structured_checkin', {
    p_agent_id: args.agentId,
    p_team_id: args.teamId,
    p_met: args.met,
    p_created_at: args.createdAt ?? null,
    p_wins: args.wins,
    p_commitments: args.commitments,
    p_reviews: args.reviews.map((r) => ({ item_id: r.itemId, status: r.status })),
    p_checklist: args.checklist,
    p_private_note: args.privateNote ?? null,
  });
  if (error) throw error;
  return data ? { checkinId: data as string } : null;
}

/* ============================================================
   MODULE-LEVEL CACHE — keyed by org so returning to Coach renders
   INSTANTLY (mirrors Dashboard's _dashCache pattern).
   ============================================================ */
let _coachCache: { orgId: string; roster: RosterAgent[] } | null = null;
export function readCoachCache(orgId: string): RosterAgent[] | null {
  return _coachCache && _coachCache.orgId === orgId ? _coachCache.roster : null;
}
export function writeCoachCache(orgId: string, roster: RosterAgent[]): void {
  _coachCache = { orgId, roster };
}

export async function loadFullRoster(): Promise<{ id: string; name: string; coaching_enabled: boolean; hasAssessment: boolean }[]> {
  if (isDemo) return [];
  const { data, error } = await supabase
    .from('agents')
    .select('id, name, coaching_enabled, assessments(code)')
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((a: any) => ({
    id: a.id, name: a.name, coaching_enabled: !!a.coaching_enabled,
    hasAssessment: Array.isArray(a.assessments) && a.assessments.length > 0,
  }));
}

// One row per team, carrying the public cohort-assessment join link
// (#/assess?t=<join_token> — resolved by the resolve_cohort_roster RPC).
// "Copy team assessment link" in Coach.tsx builds the full URL from this.
export interface TeamLink { teamId: string; name: string; joinToken: string }
export async function loadTeamLinks(): Promise<TeamLink[]> {
  if (isDemo) return [];
  const { data, error } = await supabase
    .from('teams')
    .select('id, name, join_token')
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? [])
    .filter((t: any) => !!t.join_token)
    .map((t: any) => ({ teamId: t.id, name: t.name, joinToken: t.join_token }));
}
