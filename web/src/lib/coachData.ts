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

/* ============================================================
   FRAMEWORK CONSTS (ported from truFramework.js — the parts the
   roster/profile derivation depends on).
   ============================================================ */

export interface Arch { name: string; emoji: string; color: string; tagline: string }
export const ARCH: Record<string, Arch> = {
  'P-Pro-R-D': { name: 'The Networked Powerhouse', emoji: '🔗', color: '#3B6FE0', tagline: 'Building empires one relationship at a time — with the data to back it up' },
  'P-Pro-R-I': { name: 'The Natural Connector', emoji: '✨', color: '#9B6CE0', tagline: 'Every conversation you have is a door — and you always find the handle' },
  'P-Pro-V-D': { name: 'The Relentless Achiever', emoji: '⚡', color: '#E0524F', tagline: 'More calls. More doors. More closings. Repeat.' },
  'P-Pro-V-I': { name: 'The Energized Hunter', emoji: '🎯', color: '#EE7A3A', tagline: "You don't wait for leads — you manufacture them" },
  'P-Rec-R-D': { name: 'The Trusted Advisor', emoji: '🏛️', color: '#1FA876', tagline: "Clients don't just hire you — they choose you, and they stay for life" },
  'P-Rec-R-I': { name: 'The Warm Nurturer', emoji: '🌱', color: '#E0A340', tagline: "You don't have to sell — people feel taken care of and they never leave" },
  'P-Rec-V-D': { name: 'The Market Authority', emoji: '📊', color: '#1BA6C9', tagline: "You don't chase business — your expertise makes clients come to you" },
  'P-Rec-V-I': { name: 'The Compelling Storyteller', emoji: '🎭', color: '#A972E8', tagline: "You help clients fall in love with their future before they've seen the price" },
  'T-Pro-R-D': { name: 'The Strategic Architect', emoji: '🏗️', color: '#3B6FE0', tagline: "You built a relationship machine — and it runs whether you're watching or not" },
  'T-Pro-R-I': { name: 'The Bold Visionary', emoji: '🔮', color: '#9B6CE0', tagline: "You see the market three moves ahead — and you're already in position" },
  'T-Pro-V-D': { name: 'The Performance Analyst', emoji: '📈', color: '#1FA88E', tagline: 'Your metrics tell you exactly what to do — and you do it' },
  'T-Pro-V-I': { name: 'The Instinct Closer', emoji: '⚔️', color: '#E0524F', tagline: 'When the window opens, you feel it — and you never miss it' },
  'T-Rec-R-D': { name: 'The Niche Specialist', emoji: '🏆', color: '#3B6FE0', tagline: "You don't compete for everything — you dominate something" },
  'T-Rec-R-I': { name: 'The Creative Navigator', emoji: '🧭', color: '#1BA6C9', tagline: 'You find a path where others see only dead ends' },
  'T-Rec-V-D': { name: 'The Systems Optimizer', emoji: '⚙️', color: '#1FA876', tagline: 'Your operation is the most efficient in the room — by design' },
  'T-Rec-V-I': { name: 'The Efficient Dealmaker', emoji: '💼', color: '#D9923A', tagline: 'Simple. Fast. Done. Every time.' },
};

export interface Lens { quad: string; signal: string; unlock: string; law: string; max: number }
export const LL: Record<string, Lens> = {
  'P-Pro-R-D': { quad: 'Achiever', signal: 'Cancels 1:1s or stops sharing wins — disengagement is forming.', unlock: 'Pick one newer agent and mentor them for 90 days — growing from a top producer into someone who develops others is their next leap.', law: 'Law of Addition', max: 3 },
  'P-Pro-R-I': { quad: 'Achiever', signal: 'Stops telling stories about clients — emotional disconnection is starting.', unlock: 'Take one thing they win at naturally and write it into a repeatable, step-by-step process — so it works even on an off day.', law: 'Law of Connection', max: 2 },
  'P-Pro-V-D': { quad: 'Achiever', signal: 'Starts making excuses for missed numbers rather than problem-solving them.', unlock: 'Take one activity off their plate and transfer it to someone they develop.', law: 'Law of Momentum', max: 3 },
  'P-Pro-V-I': { quad: 'Striver', signal: 'Energy spikes followed by silence — burning fast and crashing.', unlock: 'Implement one non-negotiable daily habit and hold it for 30 days.', law: 'Law of Momentum', max: 2 },
  'P-Rec-R-D': { quad: 'Achiever', signal: 'Clients stop referring — their reputation is their metric. Watch it closely.', unlock: 'Have them teach their client-care system to one other agent — multiplying their approach through others is the growth edge.', law: 'Law of Legacy', max: 3 },
  'P-Rec-R-I': { quad: 'Striver', signal: 'Becomes overly apologetic or starts over-explaining — feeling unsafe.', unlock: 'Have one direct, confident client conversation without softening the message.', law: 'Law of Connection', max: 2 },
  'P-Rec-V-D': { quad: 'Achiever', signal: 'Stops creating content or sharing market insights — lost sense of purpose as an expert.', unlock: 'Develop one other agent using their market-knowledge system.', law: 'Law of Priorities', max: 3 },
  'P-Rec-V-I': { quad: 'Striver', signal: 'Stories become about past wins, not future ones — forward energy is draining.', unlock: 'Turn one big win into a written case study they can show prospects — proof that backs up the story with results.', law: 'Law of Momentum', max: 2 },
  'T-Pro-R-D': { quad: 'Achiever', signal: 'Starts questioning the strategy rather than executing it — lost faith in the plan.', unlock: 'Build a scalable system and teach it to one person — teaching reveals the next growth edge.', law: 'Law of Priorities', max: 3 },
  'T-Pro-R-I': { quad: 'Independent', signal: 'Stops proposing new ideas — creative energy is being suppressed or ignored.', unlock: 'Complete one initiative start to finish without pivoting — proof they can close as well as open.', law: 'Law of Timing', max: 2 },
  'T-Pro-V-D': { quad: 'Achiever', signal: 'Starts rationalizing underperformance with data rather than diagnosing it.', unlock: 'Build a tracking system for one other agent and teach them to use it.', law: 'Law of Priorities', max: 3 },
  'T-Pro-V-I': { quad: 'Independent', signal: 'Slows down, starts missing obvious closes, becomes selective about which leads to pursue.', unlock: 'Win one deal through a slow-burn strategy that required sustained relationship investment.', law: 'Law of Timing', max: 3 },
  'T-Rec-R-D': { quad: 'Independent', signal: 'Becomes territorial about their niche process or resistant to any outside input.', unlock: 'Have them teach one teammate something only they know — the first step from solo expert to someone who lifts the team.', law: 'Law of Addition', max: 2 },
  'T-Rec-R-I': { quad: 'Independent', signal: "Quality of client communication drops — they're running on autopilot.", unlock: 'Document one complex transaction navigated successfully — that case study becomes a client-acquisition tool.', law: 'Law of Timing', max: 2 },
  'T-Rec-V-D': { quad: 'Achiever', signal: 'Starts optimizing the wrong things — busy on metrics that don\'t move the needle.', unlock: 'Have them package their best system into a version other agents can run — scaling it beyond themselves is the growth edge.', law: 'Law of Priorities', max: 3 },
  'T-Rec-V-I': { quad: 'Independent', signal: 'Completes tasks without engaging — tasks-over-outcomes mindset is setting in.', unlock: 'Have them call 3 past clients this month purely to reconnect, no agenda — relationships are the muscle their efficiency tends to skip.', law: 'Law of Connection', max: 2 },
};

export const QUAD_COLOR: Record<string, string> = {
  Achiever: '#2E8B57', Striver: '#2F6BB0', Independent: '#A9791F', Detractor: '#C0492F',
};

export const TRAIT_LABELS: Record<string, string> = {
  P: 'People-Oriented', T: 'Task-Oriented',
  Pro: 'Proactive', Rec: 'Authority Builder',
  R: 'Relationship-Focused', V: 'Volume-Driven',
  D: 'Data-Driven', I: 'Intuition-Led',
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
      .select('id, team_id, token, name, email, phone, created_at, assessments(code, taken_at), checkins(created_at, met, leads, convos, focus)')
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
      const latest = assessments[0] || null;
      if (!latest) return null; // not-yet-assessed agents show in invited/pending lanes, not the roster
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
  const { data, error } = await supabase
    .from('assessments')
    .select('code, taken_at, energy_p, energy_t, approach_pro, approach_rec, deal_r, deal_v, decision_d, decision_i')
    .eq('agent_id', agentId)
    .order('taken_at', { ascending: false });
  if (error) throw error;
  return deriveProfile((data as AssessmentRow[] | null) || []);
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
}

export function deriveProfile(rows: AssessmentRow[]): Profile {
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
    const a = code.split('-'); const b = prev.code.split('-');
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
  return {
    code, takes, confPct: conf.pct, confLabel: conf.label, confColor,
    confBg: confColor + '22', span, dimStatus, curLvl, history, grew, shift,
    archName: ar.name, emoji: ar.emoji, color: ar.color, tagline: ar.tagline,
    quad: ll.quad, law: ll.law, signal: ll.signal, unlock: ll.unlock,
  };
}

/* ============================================================
   GOALS + COMMITMENTS + CHECK-INS (ported read-only slices)
   ============================================================ */
export interface Goal { agent_id: string; team_id?: string | null; quarter: string; q_goal: number; alloc_company: number; cvr_company: number; cvr_sphere: number }
export interface Commitment { id: string; agent_id: string; team_id?: string | null; source: string; text: string; is_custom: boolean; done: boolean }
export interface Checkin { id: string; agent_id: string; created_at: string; met: unknown; leads: number | null; convos: number | null; win: string | null; focus: string | null }

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
  const { data } = await supabase.from('checkins')
    .select('*').eq('agent_id', agentId).order('created_at', { ascending: false });
  return (data as Checkin[] | null) || [];
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
