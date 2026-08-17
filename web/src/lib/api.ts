import { actAs, actAsReturn } from './authClient';
import { currentUser, hasActAsReturn, refreshAuth, signOut } from './auth';
import {
  SHOW_LIKE_A_PRO_ANSWERS,
  SHOW_LIKE_A_PRO_CARDS,
  SHOW_LIKE_A_PRO_ID,
  SHOW_LIKE_A_PRO_QS,
  SHOW_LIKE_A_PRO_TITLE,
} from './showLikeAPro';
import {
  WINNING_FIRST_CONVERSATION_ANSWERS,
  WINNING_FIRST_CONVERSATION_CARDS,
  WINNING_FIRST_CONVERSATION_ID,
  WINNING_FIRST_CONVERSATION_QS,
  WINNING_FIRST_CONVERSATION_TITLE,
} from './winningFirstConversation';

const WORKER_URL = import.meta.env.VITE_WORKER_URL as string;

/** ?demo=1 → render the dashboard with seeded data, no auth, no backend. */
export const isDemo =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1';

/**
 * Call the Worker as the signed-in user.
 *
 * We send the httpOnly session cookie and NO Authorization header — the browser has no
 * token to send, which is the point. The Worker fills the header in from its own
 * session record. `credentials: 'include'` is what makes the browser attach the cookie
 * cross-origin to api.truhq.co; without it every call looks signed-out, and the reply
 * needs Access-Control-Allow-Credentials coming back or the browser discards it.
 */
export async function workerFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = {
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...((init.headers as Record<string, string>) ?? {}),
  };
  return fetch(WORKER_URL + path, { ...init, headers, credentials: 'include' });
}

/**
 * Org, agent row and org role in one answer.
 *
 * These three used to be three separate round trips made on nearly every load, and
 * between them they decide which screen someone even sees. We ask the Worker once and
 * cache the reply for the rest of the tick, so the three callers below stay
 * independent without becoming three requests again.
 */
interface Me {
  org: { id: string; name: string; plan: string } | null;
  agent: AgentIdentity | null;
  role: string | null;
}
let mePromise: Promise<Me> | null = null;

async function me(): Promise<Me> {
  if (!mePromise) {
    mePromise = workerFetch('/data/me')
      .then((r) => (r.ok ? (r.json() as Promise<Me>) : { org: null, agent: null, role: null }))
      .catch(() => ({ org: null, agent: null, role: null }));
    // Cleared on the next tick so a later call (after signing in, or after acting as
    // a team) asks again rather than replaying the previous person's answer.
    void mePromise.finally(() => { queueMicrotask(() => { mePromise = null; }); });
  }
  return mePromise;
}

export async function myOrg(): Promise<{ id: string; name: string; plan: string } | null> {
  return (await me()).org;
}

export async function provisionOrg(
  orgName: string,
  teams: Array<{ name: string; fubKey: string; subdomain?: string }>,
): Promise<{ orgId: string; teamIds: string[] }> {
  const res = await workerFetch('/provision', {
    method: 'POST',
    body: JSON.stringify({ orgName, teams }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; orgId?: string; teamIds?: string[] };
  if (!res.ok) throw new Error(body.error ?? 'Provisioning failed');
  return body as { orgId: string; teamIds: string[] };
}

export async function triggerSync(): Promise<unknown> {
  if (isDemo) return {};
  const res = await workerFetch('/sync', {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Sync failed');
  return res.json();
}

// ── TRU Rep — agent onboarding / certification ──────────────────────────────
export interface RepModule {
  id: string; idx: number; title: string; summary: string | null; body: string | null; pass_pct: number;
  questions: number; cards?: LessonCard[] | null;
  // Authoring (Block 2) — undefined for rows fetched before these columns existed at the callsite.
  author_id?: string | null; source?: 'system' | 'custom'; status?: 'draft' | 'published' | 'archived';
}
export interface RepProgressRow { agent_id: string; module_id: string; status: string; score: number | null; passed_at: string | null; signed_off_at?: string | null }
export interface RepAgent { id: string; name: string; email: string | null; invited: boolean }
export interface RepPracticeRow { agent_id: string; scenario: string; status: string; score: number | null; passed: boolean | null; created_at: string }
export interface RepData { modules: RepModule[]; progress: RepProgressRow[]; agents: RepAgent[]; practice: RepPracticeRow[] }

export async function loadRep(): Promise<RepData> {
  if (isDemo) return demoRep();
  // Belt-and-suspenders: `active` is the runtime switch, `status` is the authoring
  // lifecycle (Block 1/4). Both must read 'published/true' for a live module — the
  // 24 shared TRU modules (org_id null) got status DEFAULT 'published' NOT NULL
  // (hq_rep_authoring.sql) and pre-existing rows were backfilled to 'published', so
  // this filter does not hide the built-in curriculum.
  type AgentRow = { id: string; name: string; email: string | null; auth_id: string | null };
  let mods: Omit<RepModule, 'questions'>[];
  let qs: Array<{ module_id: string }>;
  let prog: RepProgressRow[];
  let agentRows: AgentRow[];
  let prac: RepPracticeRow[];

  // Five reads, made once by the Worker as this user — five cross-origin round trips
  // become one, and RLS still decides every row.
  const res = await workerFetch('/data/rep/board');
  if (!res.ok) throw new Error('Could not load the certification board.');
  const d = (await res.json()) as {
    modules: Omit<RepModule, 'questions'>[]; questions: Array<{ module_id: string }>;
    progress: RepProgressRow[]; agents: AgentRow[]; practice: RepPracticeRow[];
  };
  [mods, qs, prog, agentRows, prac] = [d.modules ?? [], d.questions ?? [], d.progress ?? [], d.agents ?? [], d.practice ?? []];

  const qcount = new Map<string, number>();
  qs.forEach((q) => qcount.set(q.module_id, (qcount.get(q.module_id) ?? 0) + 1));
  return {
    modules: mods.map((m) => ({ ...m, questions: qcount.get(m.id) ?? 0 })),
    progress: prog,
    agents: agentRows.map((a) => ({ id: a.id, name: a.name, email: a.email, invited: !!a.auth_id })),
    practice: prac,
  };
}

// ── Agent side: identity + the course ───────────────────────────────────────
export interface AgentIdentity { id: string; org_id: string; name: string; team_id: string }
export interface CourseQuestion { id: string; idx: number; prompt: string; choices: string[] }
/** One lesson screen. t: text | intro | stat | stats | drill | callout | script | dialogue | compare | section | video | steps | media. */
export interface LessonCard {
  t: string;
  n?: string;            // section — the part label ("Part 1")
  k?: string;            // kicker label (text cards)
  body?: string;         // text / callout ("\n\n" = paragraph break)
  big?: string;          // stat headline number
  label?: string;        // stat label
  src?: string;          // stat source line
  items?: Array<{ big: string; label: string }>;  // stats grid
  prompt?: string;       // drill
  choices?: string[];    // drill
  answer?: number;       // drill (practice — instant feedback, ungraded)
  explain?: string;      // drill
  title?: string;        // script / dialogue / video / steps / media heading
  lines?: string[];      // script — the exact words to say
  turns?: Array<{ who: string; say: string }>;    // dialogue — 'lead' | 'agent'
  good?: string[];       // compare — DO column
  // media (t:'media') — an uploaded rep-media asset (Block 1/2 authoring),
  // distinct from t:'video' below (which embeds an external Loom/YouTube url).
  kind?: 'video' | 'pdf' | 'slide';   // media — asset kind
  path?: string;                      // media — object key in the rep-media bucket
  bad?: string[];        // compare — DON'T column
  url?: string;          // video — Loom share/embed URL (empty renders the intro treatment, not a dead player)
  steps?: string[];      // steps — a pipeline/stage ladder
  // slide (t:'slide') — ONE slide of a named deck under /public/decks, rendered
  // natively. `deck` is the json basename, `slide` the 1-based slide number.
  // (`n` is already taken above by the section card's part label.)
  deck?: string;
  slide?: number;
}
// Omit<'status'>: RepModule.status is the authoring lifecycle (draft/published/
// archived); CourseModule.status below is the learner's progress status
// (not_started/in_progress/passed) — same name, different domain, so it's
// deliberately overridden rather than reused.
export interface CourseModule extends Omit<RepModule, 'status'> { qs: CourseQuestion[]; cards: LessonCard[]; status: string; score: number | null; passed_at: string | null; signed: boolean }
export interface GradeReview { idx: number; your: number; correct_index: number; is_correct: boolean; explain: string | null }
export interface GradeResult { score: number; passed: boolean; correct: number; total: number; review: GradeReview[] }

/** The logged-in user's agent row (null if they're not an agent). */
export async function myAgent(): Promise<AgentIdentity | null> {
  return (await me()).agent;
}

/** Link this fresh login to an agent row by verified email; returns agent id or null. */
export async function claimAgent(): Promise<string | null> {
  const res = await workerFetch('/data/claim-agent', { method: 'POST', body: '{}' });
  if (!res.ok) return null;
  return ((await res.json()) as { agentId: string | null }).agentId;
}

/** Leader: sign off a fully-certified agent (stamps every passed module). */
export async function signOffAgent(agentId: string): Promise<void> {
  if (isDemo) return;
  const who = (await currentUser())?.email ?? 'team leader';
  const res = await workerFetch('/data/rep/sign-off', {
    method: 'POST', body: JSON.stringify({ agentId, who }),
  });
  if (!res.ok) throw new Error('Could not sign this agent off.');
}

/** Leader/admin: mint an invite (or re-invite) link for an agent. */
export async function inviteAgent(agentId: string): Promise<{ link: string; email: string; reinvite: boolean }> {
  const res = await workerFetch('/rep/invite', {
    method: 'POST',
    body: JSON.stringify({ agentId }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; link?: string; email?: string; reinvite?: boolean };
  if (!res.ok || !body.link) throw new Error(body.error ?? 'Could not create invite');
  return { link: body.link, email: body.email ?? '', reinvite: !!body.reinvite };
}

// ── TRU Rep — authoring (Block 2: Worker endpoints only; UI is Block 3) ─────

/** Leader/admin: mint a signed upload URL for a media asset in the private `rep-media` bucket. */
export async function signRepUpload(
  orgId: string,
  ext: string,
  contentType?: string,
): Promise<{ path: string; token: string; signedUrl: string }> {
  const res = await workerFetch('/rep/uploads/sign', {
    method: 'POST',
    body: JSON.stringify({ org_id: orgId, ext, contentType }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; path?: string; token?: string; signedUrl?: string };
  if (!res.ok || !body.path || !body.token || !body.signedUrl) throw new Error(body.error ?? 'Could not sign upload');
  return { path: body.path, token: body.token, signedUrl: body.signedUrl };
}

/** Leader/admin: create (no id) or update (id set) a source='custom' module for their org. */
export async function saveRepModule(input: {
  id?: string; org_id: string; title: string; summary?: string | null;
  cards?: LessonCard[]; pass_pct?: number; status?: 'draft' | 'published' | 'archived';
}): Promise<RepModule> {
  const res = await workerFetch('/rep/modules', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => ({}))) as RepModule & { error?: string };
  if (!res.ok) throw new Error((body as { error?: string }).error ?? 'Could not save module');
  return body;
}

/** Leader/admin: author/replace ALL quiz questions for a custom module (delete-all + insert). */
export async function saveRepQuestions(
  moduleId: string,
  questions: Array<{ prompt: string; choices: string[]; answer: number; explain?: string | null; idx?: number }>,
): Promise<{ count: number; questions: unknown[] }> {
  const res = await workerFetch(`/rep/modules/${moduleId}/questions`, {
    method: 'POST',
    body: JSON.stringify({ questions }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; count?: number; questions?: unknown[] };
  if (!res.ok) throw new Error(body.error ?? 'Could not save questions');
  return { count: body.count ?? 0, questions: body.questions ?? [] };
}

/** Leader/admin: archive a custom module (status='archived', active=false). */
export async function archiveRepModule(moduleId: string): Promise<void> {
  const res = await workerFetch(`/rep/modules/${moduleId}/archive`, {
    method: 'POST',
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? 'Could not archive module');
}

/** The signed-in user's membership role in this org ('admin' | 'leader' | 'coach'), or
 *  null if they aren't a member. Mirrors the Worker's own isOrgLeaderOrAdmin() gate
 *  (memberships.role in ('admin','leader')) — used client-side ONLY to decide whether
 *  to show the authoring UI; the Worker re-checks on every write regardless. */
export async function myOrgRole(_orgId: string): Promise<string | null> {
  if (isDemo) return 'admin';
  return (await me()).role;
}

/** Leader/admin: this org's own authored modules (source='custom'), at ANY status —
 *  draft/published/archived — for the module-manager list. Deliberately separate from
 *  loadRep() above, which stays the learner-facing published+active feed (Block 4 owns
 *  that filter); this is authoring-only and never touches loadRep/loadCourse. */
export async function loadRepCustomModules(orgId: string): Promise<RepModule[]> {
  if (isDemo) return [];
  const res = await workerFetch(`/data/rep/custom-modules?orgId=${encodeURIComponent(orgId)}`);
  if (!res.ok) throw new Error('Could not load your modules.');
  const d = (await res.json()) as { modules: Omit<RepModule, 'questions'>[] };
  return (d.modules ?? []).map((m) => ({ ...m, questions: 0 }));
}

/** Leader/admin: prompt/choices for a custom module's existing quiz questions, via the
 *  same answer-hiding view agents read (rep_questions_public) — there is no Worker GET
 *  endpoint that returns answer/explain back out (by design: the save endpoint returns
 *  them only in direct response to a save). So re-opening an already-authored quiz can
 *  prefill prompts/choices but NOT which choice is correct — the editor UI must make the
 *  leader re-confirm the correct answer for each carried-over question before saving. */
export async function loadRepQuestionsMasked(moduleId: string): Promise<Array<{ id: string; idx: number; prompt: string; choices: string[] }>> {
  const res = await workerFetch(`/data/rep/questions-masked?moduleId=${encodeURIComponent(moduleId)}`);
  if (!res.ok) throw new Error('Could not load these questions.');
  const d = (await res.json()) as { questions: Array<{ id: string; idx: number; prompt: string; choices: string[] }> };
  return d.questions ?? [];
}

/** Learner OR leader/admin: mint a SHORT-LIVED signed download URL for a rep-media
 *  object so it can be played/embedded in the course. Learner agents are NOT org
 *  `memberships` (storage RLS only grants members), so they cannot mint their own
 *  client-side `createSignedUrl` — the Worker mints this with the service role and
 *  authorizes the caller (learner scoped to their own org, or a leader/admin of the
 *  object's org) against the path's org_id segment. Never call Supabase Storage
 *  directly for this from the browser. */
export async function signRepMediaDownload(path: string): Promise<string> {
  const res = await workerFetch(`/rep/media/sign-download?path=${encodeURIComponent(path)}`, {
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; url?: string };
  if (!res.ok || !body.url) throw new Error(body.error ?? 'Could not load this file');
  return body.url;
}

/** Leader/admin ONLY: the real (unmasked) prompt/choices/answer/explain for a
 *  source='custom' module's quiz, for prefilling the editor without the
 *  re-confirm-every-answer friction `loadRepQuestionsMasked` requires. The Worker
 *  re-verifies the module is source='custom' AND the caller is a leader/admin of
 *  its org before returning anything — this must NEVER be reachable for a system
 *  module or by a learner. */
export async function loadRepQuestionsForEdit(
  moduleId: string,
): Promise<Array<{ idx: number; prompt: string; choices: string[]; answer: number; explain: string | null }>> {
  const res = await workerFetch(`/rep/modules/${moduleId}/answers`, {
  });
  const body = (await res.json().catch(() => ({}))) as
    { error?: string; questions?: Array<{ idx: number; prompt: string; choices: string[]; answer: number; explain: string | null }> };
  if (!res.ok || !body.questions) throw new Error(body.error ?? 'Could not load the existing quiz');
  return body.questions;
}

/** Leader/admin: upload a lesson media file to the private `rep-media` bucket.
 *
 *  The Worker signs the upload and hands back a complete URL whose token IS the
 *  authorisation, so this is a plain PUT — no database client and no key in the
 *  browser. It used to go through supabase-js's uploadToSignedUrl, which is the only
 *  reason this file needed a Supabase client at all.
 *
 *  Returns the object path to embed in a `{ t:'media' }` LessonCard. */
export async function uploadRepMedia(file: File, orgId: string): Promise<string> {
  const dot = file.name.lastIndexOf('.');
  const ext = (dot >= 0 ? file.name.slice(dot + 1) : (file.type.split('/')[1] ?? 'bin')).toLowerCase();
  const { path, signedUrl } = await signRepUpload(orgId, ext, file.type || undefined);
  const res = await fetch(signedUrl, {
    method: 'PUT',
    headers: file.type ? { 'Content-Type': file.type } : {},
    body: file,
  });
  if (!res.ok) throw new Error('Could not upload this file.');
  return path;
}

// Self-contained course for ?demo=1 (previews + sales demos).
// July modules are hidden. This catalog is Winning the First Conversation
// (Day 2) and Show Like a Pro (Day 3). Opening either hits SlideView.
// Official Training is omitted: zillow-day1.json is not on this branch.
const DEMO_COURSE: Array<CourseModule & { answers: number[] }> = [
  {
    id: WINNING_FIRST_CONVERSATION_ID,
    idx: 1,
    title: WINNING_FIRST_CONVERSATION_TITLE,
    summary: 'The first conversation, advocate not gatekeeper, four beats (LEAD), appointment on the first call, follow-up when they don’t pick up.',
    body: 'Day 2 of Zillow Preferred onboarding — Winning the First Conversation. Thirty-one slides.',
    pass_pct: 80,
    questions: WINNING_FIRST_CONVERSATION_QS.length,
    status: 'not_started',
    score: null,
    passed_at: null,
    signed: false,
    answers: WINNING_FIRST_CONVERSATION_ANSWERS,
    cards: WINNING_FIRST_CONVERSATION_CARDS,
    qs: WINNING_FIRST_CONVERSATION_QS,
  },
  {
    id: SHOW_LIKE_A_PRO_ID,
    idx: 2,
    title: SHOW_LIKE_A_PRO_TITLE,
    summary: 'The showing, touring agreement before you go, two or three homes never one, sidewalk five questions, leave with an appointment.',
    body: 'Day 3 of Zillow Preferred onboarding — Show Like a Pro. Thirty-one slides.',
    pass_pct: 80,
    questions: SHOW_LIKE_A_PRO_QS.length,
    status: 'not_started',
    score: null,
    passed_at: null,
    signed: false,
    answers: SHOW_LIKE_A_PRO_ANSWERS,
    cards: SHOW_LIKE_A_PRO_CARDS,
    qs: SHOW_LIKE_A_PRO_QS,
  },
];

export function demoCatalogTitles(): string[] {
  return DEMO_COURSE.map((m) => m.title);
}

/** Agent's own view: every module with its questions (answer-less) + own progress. */
export async function loadCourse(agentId: string): Promise<CourseModule[]> {
  if (isDemo) return DEMO_COURSE.map(({ answers, ...m }) => { void answers; return m; });
  // Same belt-and-suspenders status filter as loadRep() above — see its comment.
  type ModRow = Omit<RepModule, 'questions'> & { cards: LessonCard[] | null };
  type ProgRow = { module_id: string; status: string; score: number | null; passed_at: string | null; signed_off_at: string | null };
  let modRows: ModRow[];
  let qRows: Array<CourseQuestion & { module_id: string }>;
  let progRows: ProgRow[];

  const res = await workerFetch(`/data/rep/course?agentId=${encodeURIComponent(agentId)}`);
  if (!res.ok) throw new Error('Could not load your course.');
  const d = (await res.json()) as {
    modules: ModRow[]; questions: Array<CourseQuestion & { module_id: string }>; progress: ProgRow[];
  };
  [modRows, qRows, progRows] = [d.modules ?? [], d.questions ?? [], d.progress ?? []];

  const byMod = new Map<string, CourseQuestion[]>();
  qRows.forEach((q) => {
    const arr = byMod.get(q.module_id) ?? [];
    arr.push({ id: q.id, idx: q.idx, prompt: q.prompt, choices: q.choices });
    byMod.set(q.module_id, arr);
  });
  const progByMod = new Map(progRows.map((p) => [p.module_id, p]));
  return modRows.map((m) => {
    const qlist = byMod.get(m.id) ?? [];
    const p = progByMod.get(m.id);
    // No structured cards yet → fall back to the body as plain text cards.
    const cards: LessonCard[] = m.cards?.length
      ? m.cards
      : (m.body ?? '').split(/(?<=[.!?])\s+/).reduce<string[]>((acc, s, i) => { const k = Math.floor(i / 2); acc[k] = acc[k] ? acc[k] + ' ' + s : s; return acc; }, []).map((body) => ({ t: 'text', body }));
    return { ...m, questions: qlist.length, qs: qlist, cards, status: p?.status ?? 'not_started', score: p?.score ?? null, passed_at: p?.passed_at ?? null, signed: !!p?.signed_off_at };
  });
}

// ── The Live Sim — audio practice calls ─────────────────────────────────────
export interface SimScenario { key: string; name: string; label: string; blurb: string }
export interface SimBreakdown {
  a: { score: number; note: string }; l: { score: number; note: string };
  m: { score: number; note: string }; s: { score: number; note: string };
  flags: string[]; best_moment: string; coach_note: string;
}
export interface SimResult { score: number; passed: boolean; breakdown: SimBreakdown; durationS: number | null }
export interface SimAttempt { id: string; scenario: string; status: string; score: number | null; passed: boolean | null; created_at: string }

export async function simScenarios(): Promise<{ configured: boolean; scenarios: SimScenario[] }> {
  if (isDemo) {
    return {
      configured: true,
      scenarios: [
        { key: 'first_timer', name: 'Maya', label: 'The first-time buyer', blurb: 'Just asked about a 3-bed on Sycamore. Warm, chatty, a little nervous — big life reason for the move.' },
        { key: 'relocator', name: 'David', label: 'The relocating family', blurb: 'Moving from out of state for a job that starts soon. Efficient, on a clock, zero patience for fluff.' },
        { key: 'investor', name: 'Rhonda', label: 'The investor', blurb: 'Asked about a duplex. Wants numbers, not narratives. Tests whether you can skip the backyard poetry.' },
        { key: 'early_browser', name: 'Sam', label: 'The “just looking” browser', blurb: 'Clicked a listing at lunch. “Super early, just curious.” The test: do you serve them or dismiss them?' },
      ],
    };
  }
  const res = await workerFetch('/rep/practice/scenarios');
  return (await res.json()) as { configured: boolean; scenarios: SimScenario[] };
}

export async function simStart(scenario: string): Promise<{ practiceId: string; accessToken: string }> {
  const res = await workerFetch('/rep/practice/start', {
    method: 'POST',
    body: JSON.stringify({ scenario }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; practiceId?: string; accessToken?: string };
  if (!res.ok || !body.accessToken) throw new Error(body.error ?? 'Could not start the call');
  return { practiceId: body.practiceId as string, accessToken: body.accessToken };
}

export async function simFinish(practiceId: string): Promise<SimResult> {
  const res = await workerFetch('/rep/practice/finish', {
    method: 'POST',
    body: JSON.stringify({ practiceId }),
  });
  const body = (await res.json().catch(() => ({}))) as SimResult & { error?: string };
  if (!res.ok) throw new Error(body.error ?? 'Could not grade the call');
  return body;
}

// Demo: a canned graded call so the whole sim flow demos without a mic.
export function demoSimResult(): SimResult {
  return {
    score: 86, passed: true, durationS: 214,
    breakdown: {
      a: { score: 23, note: 'Strong either/or close — “Thursday at 5 or Saturday morning” — and it assumed the showing.' },
      l: { score: 20, note: 'Widened to Kessler Ave nicely; never mapped whether they need to sell first.' },
      m: { score: 25, note: 'Heard the twins news and gave it a real beat — “congratulations, so space is the mission” — textbook.' },
      s: { score: 18, note: 'Recapped needs and the booked time, but skipped the timeline in the playback.' },
      flags: [],
      best_moment: '“Twins — congratulations! Okay, so more space just became the mission.”',
      coach_note: 'You win these calls with warmth, and it showed the moment the twins came up. Tighten the summary: needs, timeline, booked time — all three, every call. And one Location beat earlier would have surfaced the sell-first question before the close.',
    },
  };
}

/** The agent's own sim attempts (RLS: self-read). */
export async function mySimAttempts(agentId: string): Promise<SimAttempt[]> {
  if (isDemo) return [];
  const res = await workerFetch(`/data/rep/practice?agentId=${encodeURIComponent(agentId)}`);
  if (!res.ok) return [];
  return ((await res.json()) as { practice: SimAttempt[] | null }).practice ?? [];
}

/** Submit a module's answers for server-side grading. */
export async function gradeQuiz(moduleId: string, answers: number[]): Promise<GradeResult> {
  if (isDemo) {
    const m = DEMO_COURSE.find((d) => d.id === moduleId);
    const key = m?.answers ?? [];
    let correct = 0;
    const review: GradeReview[] = key.map((ans, i) => {
      const your = answers[i] ?? -1;
      const is_correct = your === ans;
      if (is_correct) correct++;
      return { idx: i + 1, your, correct_index: ans, is_correct, explain: null };
    });
    const total = key.length || 1;
    const score = Math.round((correct / total) * 100);
    const passed = score >= (m?.pass_pct ?? 80);
    if (m) { // persist within the demo session so the ring/checkmarks advance
      m.passed_at = passed ? new Date().toISOString() : m.passed_at;
      m.status = passed ? 'passed' : 'in_progress';
      m.score = passed ? score : m.score;
    }
    return { score, passed, correct, total, review };
  }
  const res = await workerFetch('/rep/grade', {
    method: 'POST',
    body: JSON.stringify({ moduleId, answers }),
  });
  const body = (await res.json().catch(() => ({}))) as GradeResult & { error?: string };
  if (!res.ok) throw new Error(body.error ?? 'Could not grade quiz');
  return body;
}

function demoRep(): RepData {
  const modules: RepModule[] = [
    {
      id: WINNING_FIRST_CONVERSATION_ID,
      idx: 1,
      title: WINNING_FIRST_CONVERSATION_TITLE,
      summary: 'The first conversation, advocate not gatekeeper, four beats (LEAD), appointment on the first call, follow-up when they don’t pick up.',
      body: 'Day 2 of Zillow Preferred onboarding — Winning the First Conversation. Thirty-one slides.',
      pass_pct: 80,
      questions: WINNING_FIRST_CONVERSATION_QS.length,
      cards: WINNING_FIRST_CONVERSATION_CARDS,
    },
    {
      id: SHOW_LIKE_A_PRO_ID,
      idx: 2,
      title: SHOW_LIKE_A_PRO_TITLE,
      summary: 'The showing, touring agreement before you go, two or three homes never one, sidewalk five questions, leave with an appointment.',
      body: 'Day 3 of Zillow Preferred onboarding — Show Like a Pro. Thirty-one slides.',
      pass_pct: 80,
      questions: SHOW_LIKE_A_PRO_QS.length,
      cards: SHOW_LIKE_A_PRO_CARDS,
    },
  ];
  const agents: RepAgent[] = [
    { id: 'a1', name: 'Maria Lopez', email: 'maria@example.com', invited: true },
    { id: 'a2', name: 'Sam Whitfield', email: 'sam@example.com', invited: true },
    { id: 'a3', name: 'Dana Cole', email: 'dana@example.com', invited: false },
  ];
  const progress: RepProgressRow[] = [
    { agent_id: 'a1', module_id: WINNING_FIRST_CONVERSATION_ID, status: 'passed', score: 100, passed_at: '2026-06-17' },
    { agent_id: 'a1', module_id: SHOW_LIKE_A_PRO_ID, status: 'passed', score: 100, passed_at: '2026-06-18' },
    { agent_id: 'a2', module_id: WINNING_FIRST_CONVERSATION_ID, status: 'in_progress', score: null, passed_at: null },
    { agent_id: 'a2', module_id: SHOW_LIKE_A_PRO_ID, status: 'in_progress', score: null, passed_at: null },
  ];
  const practice: RepPracticeRow[] = [
    { agent_id: 'a1', scenario: 'first_timer', status: 'graded', score: 86, passed: true, created_at: '2026-06-28' },
    { agent_id: 'a1', scenario: 'early_browser', status: 'graded', score: 71, passed: false, created_at: '2026-06-27' },
  ];
  return { modules, progress, agents, practice };
}

// ── Platform-owner console (the HQ "act as a team" tile) ────────────────────
export interface AdminLeader { id: string; name: string; email: string; team_name: string; org_name: string }

/** List every team leader — 403/null unless the caller is a platform admin. */
export async function adminLeaders(): Promise<AdminLeader[] | null> {
  if (isDemo) return null;
  try {
    const res = await workerFetch('/admin/leaders', {
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { leaders?: AdminLeader[] };
    return j.leaders ?? [];
  } catch {
    return null;
  }
}

/** Become a team leader: the Worker mints a one-time token, we verify it here —
 *  the session in THIS browser becomes theirs (their RLS applies everywhere). */
export async function adminActAs(email: string): Promise<void> {
  // The whole swap happens in the Worker. The owner's own session stays alive
  // server-side under its own id, so nothing needs stashing here.
  //
  // What this replaced is worth remembering: the browser used to hold the OWNER's
  // access AND refresh token in localStorage for the duration — the single
  // highest-privilege secret this app ever handed out. There is no longer anywhere
  // in the browser for it to live.
  await actAs(email);
  await refreshAuth();
}

/** Is there a way back to the owner's own HQ? The Worker answers — the browser holds
 *  nothing to inspect. */
export function hasAdminReturn(): boolean {
  return hasActAsReturn();
}

/** Exit impersonation: restore the owner's own session so they land back on their
 *  HQ (the act-as picker) — NOT the login screen. Only a genuinely dead owner
 *  session falls back to sign-out. */
export async function adminReturn(): Promise<void> {
  // Leave whatever product route we were impersonating in; land on the HQ home.
  try { window.location.hash = '/'; } catch { /* noop */ }
  // restored:false means the owner's session aged out while they were away, so the
  // Worker has signed them out rather than leaving them somewhere they can't leave.
  await actAsReturn().catch(() => ({ restored: false }));
  await refreshAuth();
}

/** Sign out AND drop any stashed owner-return token. Now that the token lives in
 *  localStorage (durable), a raw signOut while impersonating would otherwise leave a
 *  stale return handle behind that shows a phantom "Exit — switch teams" next login. */
export async function signOutClean(): Promise<void> {
  await signOut();
}

/** Update the org's thresholds / audit math. Writes go through the Worker (RLS
 *  keeps the browser read-only), which patches org_settings with the service role.
 *  `org_id` names the org being edited — the SAME row loadDashboard() read back —
 *  so the save can never land on a different company than the one on screen. The
 *  Worker still re-checks that the caller is a leader/admin of it. */
export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  if (isDemo) return;
  const res = await workerFetch('/settings', {
    method: 'POST',
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error('Save failed');
}

// ── Follow Up Boss connection (the ONE key per team, shared across all TRU products) ──
export interface Connection {
  teamId: string;
  name: string;
  connected: boolean;
  subdomain: string | null;
  lastSync: string | null;
}
export async function loadConnection(): Promise<Connection[]> {
  if (isDemo) return [{ teamId: 'demo', name: 'Sample Realty', connected: true, subdomain: 'sample', lastSync: new Date().toISOString() }];
  const res = await workerFetch('/connection', {});
  if (!res.ok) return [];
  return res.json();
}
export async function connectFub(fubKey: string, teamId?: string): Promise<{ ok: boolean; subdomain: string | null }> {
  if (isDemo) return { ok: true, subdomain: 'sample' };
  const res = await workerFetch('/connect-fub', {
    method: 'POST',
    body: JSON.stringify({ fubKey, teamId }),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; subdomain?: string | null; error?: string };
  if (!res.ok) throw new Error(body.error || 'Could not connect to Follow Up Boss.');
  return { ok: !!body.ok, subdomain: body.subdomain ?? null };
}

// ── Admin (platform owner): every team's connection in one board, and setting a
//    team's key on their behalf — no impersonation needed. ──
export interface AdminConnection {
  teamId: string;
  name: string;
  orgName: string;
  connected: boolean;
  subdomain: string | null;
  lastSync: string | null;
}
export async function adminConnections(): Promise<AdminConnection[]> {
  if (isDemo) return [];
  const res = await workerFetch('/admin/connections', {});
  if (!res.ok) return [];
  const j = (await res.json()) as { connections?: AdminConnection[] };
  return j.connections ?? [];
}
export async function adminConnectFub(teamId: string, fubKey: string): Promise<{ ok: boolean; subdomain: string | null }> {
  const res = await workerFetch('/admin/connect-fub', {
    method: 'POST',
    body: JSON.stringify({ teamId, fubKey }),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; subdomain?: string | null; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error || 'Could not connect to Follow Up Boss.');
  return { ok: true, subdomain: body.subdomain ?? null };
}

export interface LeadRow {
  team_id: string;
  assigned_to: string | null;
  flag: string | null;
  source_family: string | null;
  name?: string | null;
  stage?: string | null;
  fub_person_id?: number | null;
  fub_created?: string | null;
  pond?: string | null;
}
export interface AgentRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  // Manual pause (leader-set; sole source of truth for "Paused" — see hq_agent_pause.sql).
  is_paused: boolean;
  pause_reason: string | null;   // at_capacity | no_closings | on_leave | coaching | other
  pause_note: string | null;     // free text, used when pause_reason = 'other'
  paused_at: string | null;
}
export interface DealRow {
  team_id: string;
  stage: string | null;
  stage_class: string | null;   // offer | uc | closed | other
  price: number | null;
  commission: number | null;
  agent_name: string | null;
  fub_person_id?: number | null; // joins the deal to its lead (and so its source)
  projected_close: string | null;
  fub_created: string | null;
}
export interface CaseRow {
  assigned_to: string | null;
  status: string;
  opened_at: string;
}
// person_stage_log — the dated carry-forward achievement hits that back Section 1's
// accuracy work (docs/accuracy-definitions.md). One row per (lead, stage) the first
// time it's reached. No source_family of its own — join to LeadRow.fub_person_id ->
// source_family in shared/metrics.ts if a numerator needs to be scoped by source.
export interface StageLogRow {
  fub_person_id: number;
  stage_class: string | null; // offer | uc | closed | other
  changed_at: string | null;  // null = dateless (seed, pre-history)
  date_source: string | null; // live | deal_close_date | seed | tableau
  agent_user_id: number | string | null;
  agent_name: string | null;
  team_id?: string;
}
export interface Settings {
  // The org this settings row belongs to. Carried through the form and echoed back
  // on save so a save always targets the org that was actually on screen — a user
  // who belongs to more than one org would otherwise have had the Worker pick.
  org_id?: string;
  avg_gci: number;
  close_rate: number;
  window_hours: number;
  strike_limit: number;
  per_agent_capacity: number;
  sources?: string[] | null;   // enabled source families; null/absent = all
  // Pause watch — broker-set rules for pausing new lead flow to an agent.
  pause_volume_on?: boolean | null;     // rule 1: agent hits N leads this month
  pause_volume_leads?: number | null;   // rule 1 threshold (defaults to per_agent_capacity)
  pause_no_close_on?: boolean | null;   // rule 2: N leads taken since their last UC/close
  pause_no_close_leads?: number | null; // rule 2 threshold (default 30)
  pause_no_close_since?: string | null; // rule 2 clean-slate: only count leads created on/after this ISO date; null = all history
}
export interface DashboardData {
  teams: Array<{ id: string; name: string; fub_subdomain: string | null }>;
  settings: Settings | null;
  leads: LeadRow[];
  cases: CaseRow[];
  agents: AgentRow[];
  deals: DealRow[];
  stageLog: StageLogRow[];
}



export async function loadDashboard(): Promise<DashboardData> {
  if (isDemo) return demoDashboard();
  // One call to the Worker, which reads Supabase AS THIS USER so the same row-level
  // policies apply. Also collapses eight cross-origin round trips into one, which a
  // phone on a bad connection notices.
  const res = await workerFetch('/data/dashboard');
  if (!res.ok) throw new Error('Could not load your dashboard.');
  const d = (await res.json()) as DashboardData;
  return {
    teams: d.teams ?? [],
    settings: d.settings ?? null,
    leads: d.leads ?? [],
    cases: d.cases ?? [],
    agents: d.agents ?? [],
    deals: d.deals ?? [],
    stageLog: d.stageLog ?? [],
  };
}

// ── demo data (mirrors the mockup; aggregates to 543 / 21 / 67 / ~84%) ──────────
function demoDashboard(): DashboardData {
  const agentSpec: Array<[string, number, number, number, number, number]> = [
    ['Trevor Holland', 62, 8, 12, 42, 4],
    ['Jordan Blake', 58, 6, 14, 38, 3],
    ['Dana Cole', 71, 5, 9, 57, 2],
    ['Priya Nair', 49, 2, 6, 41, 1],
    ['Marcus Delgado', 55, 0, 8, 47, 1],
    ['Maria Lopez', 44, 0, 3, 41, 0],
    ['Sam Whitfield', 38, 0, 2, 36, 0],
    ['Unassigned', 166, 0, 13, 153, 0],
  ];
  const srcDist: Array<[string, number]> = [
    ['Zillow', 210],
    ['Realtor.com', 140],
    ['Homes.com', 80],
    ['Facebook', 70],
    ['Google', 28],
    ['Referrals', 15],
  ];
  const srcPool: string[] = [];
  srcDist.forEach(([name, n]) => {
    for (let i = 0; i < n; i++) srcPool.push(name);
  });
  let si = 0;
  const dayMs = 86400_000;
  const leads: LeadRow[] = [];
  const cases: CaseRow[] = [];
  // Section 1 (accuracy): every demo lead needs a fub_person_id + fub_created so
  // shared/metrics.ts (created-date windowed denominator) has something to chew on —
  // without these, computeWindowedMetrics excludes every demo lead as "dateless" and
  // the accuracy tiles all render zero. Spread deterministically across ~13 months so
  // the window tabs visibly move.
  let leadPersonId = 1;
  for (const [name, paid, zero, stuck, , strikes] of agentSpec) {
    for (let i = 0; i < paid; i++) {
      const flag = i < zero ? 'zero_contact' : i < zero + stuck ? 'stuck' : 'worked';
      const ponded = name === 'Unassigned';
      const daysAgo = (leadPersonId * 37) % 400;
      leads.push({
        team_id: 'demo',
        assigned_to: ponded ? null : name,
        flag,
        source_family: srcPool[si++ % srcPool.length],
        pond: ponded ? 'New Buyer Pond' : null,
        fub_person_id: leadPersonId,
        fub_created: new Date(Date.now() - daysAgo * dayMs).toISOString(),
      });
      leadPersonId++;
    }
    for (let s = 0; s < strikes; s++) {
      cases.push({ assigned_to: name, status: 'open', opened_at: new Date(Date.now() - (s + 1) * 3 * 86400_000).toISOString() });
    }
  }
  // Demo deals: 27 closings (16 closed + 11 UC) off 543 leads ≈ 1:20, and
  // 54 offer-or-beyond ≈ 10% offer rate — the numbers the pitch tells.
  const deals: DealRow[] = [];
  const dealAgents = ['Trevor Holland', 'Jordan Blake', 'Dana Cole', 'Priya Nair', 'Marcus Delgado', 'Maria Lopez'];
  const dealSrcCycle = ['Zillow', 'Realtor.com', 'Homes.com', 'Facebook', 'Google', 'Referrals'];
  // Section 1 (accuracy): a matching stageLog hit per deal, so the ?demo=1 preview has
  // something for shared/metrics.ts to chew on once Block 3 wires it up. fub_person_id
  // is synthetic and demo-only — never overlaps with a real team's ids. Each deal also
  // gets a mirrored `leads` row (below) — without it, the stageLog hit's fub_person_id
  // has no matching lead, shared/metrics.ts can't resolve its source family, and the
  // hit is silently excluded from every accuracy number (offer rate/closings/conversion
  // all read zero in the preview).
  const stageLog: StageLogRow[] = [];
  let demoPersonId = 900000;
  const mk = (n: number, cls: string, stage: string, closeInDays: number) => {
    for (let i = 0; i < n; i++) {
      const personId = demoPersonId++;
      const agent = dealAgents[i % dealAgents.length];
      const srcFamily = dealSrcCycle[i % dealSrcCycle.length];
      const createdIso = new Date(Date.now() - (5 + (i % 22)) * dayMs).toISOString();
      deals.push({
        team_id: 'demo', stage, stage_class: cls,
        price: 380_000 + (i % 7) * 45_000, commission: 9_000 + (i % 5) * 1_800,
        agent_name: agent, fub_person_id: personId,
        projected_close: new Date(Date.now() + closeInDays * dayMs - (i % 20) * dayMs).toISOString(),
        fub_created: createdIso,
      });
      stageLog.push({
        fub_person_id: personId, stage_class: cls, team_id: 'demo',
        changed_at: new Date(Date.now() - (i % 20) * dayMs).toISOString(),
        date_source: 'live', agent_user_id: null, agent_name: agent,
      });
      leads.push({
        team_id: 'demo', assigned_to: agent, flag: 'worked',
        // The Overview money tiles classify closings/offers off `leads.stage`
        // (isClosing(stageClass(l.stage))) — NOT off deals/stageLog — so the demo
        // lead MUST carry the same stage string as its deal, or GCI/closings/leads-per
        // read $0/"—". 'Closed'→closed, 'Pending'→uc, 'Offer'→offer (see shared/flags.ts).
        stage,
        source_family: srcFamily, fub_person_id: personId, fub_created: createdIso,
      });
    }
  };
  mk(16, 'closed', 'Closed', -2);
  mk(11, 'uc', 'Pending', 18);
  mk(27, 'offer', 'Offer', 30);
  return {
    teams: [{ id: 'demo', name: 'Main office', fub_subdomain: null }],
    settings: { avg_gci: 10000, close_rate: 2, window_hours: 48, strike_limit: 3, per_agent_capacity: 20, pause_volume_on: true, pause_volume_leads: 20, pause_no_close_on: true, pause_no_close_leads: 30 },
    leads,
    cases,
    agents: [],
    deals,
    stageLog,
  };
}

// ── Coach assessment intake ─────────────────────────────────────────────
export async function resolveCohortRoster(token: string): Promise<{ id: string; name: string }[]> {
  // No login by design — the join token IS the authorisation. It goes to the Worker
  // rather than the database directly, which puts rate limiting and validation in
  // front of the only unauthenticated surface in the system.
  const res = await workerFetch('/public/resolve-cohort-roster', {
    method: 'POST', body: JSON.stringify({ p_token: token }),
  });
  if (!res.ok) throw new Error('This team link could not be opened.');
  const d = (await res.json()) as { data?: { id: string; name: string }[] };
  return d.data ?? [];
}

export async function submitCohortAssessment(input: {
  token: string; agentId: string; personalCode: string; personalAxes: unknown;
  businessCode: string; tallies: Record<string, number>; answers: unknown;
}): Promise<{ agent_id: string; token: string }> {
  const args = {
    p_token: input.token, p_agent_id: input.agentId, p_personal_code: input.personalCode,
    p_personal_axes: input.personalAxes, p_business_code: input.businessCode,
    p_tallies: input.tallies, p_answers: input.answers,
  };
  const res = await workerFetch('/public/submit-assessment', {
    method: 'POST', body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error('Could not save your assessment.');
  const d = (await res.json()) as { data: { agent_id: string; token: string } };
  return d.data;
}

export async function setCoaching(agentId: string, on: boolean): Promise<void> {
  const res = await workerFetch('/data/coach/agent-flags', {
    method: 'POST', body: JSON.stringify({ agentId, coaching: on }),
  });
  if (!res.ok) throw new Error('Could not change coaching for this agent.');
}

// ── Manual agent pause (leader-set; sole source of truth for "Paused") ─────
// Shares setCoaching()'s endpoint; the Worker gates both on org membership, the same
// check the database functions made (db/hq_agent_pause.sql).
export async function setAgentPause(
  agentId: string,
  opts: { isPaused: boolean; reason?: string | null; note?: string | null },
): Promise<void> {
  if (isDemo) return;
  const res = await workerFetch('/data/coach/agent-flags', {
    method: 'POST',
    body: JSON.stringify({
      agentId, pause: opts.isPaused, reason: opts.reason ?? null, note: opts.note ?? null,
    }),
  });
  if (!res.ok) throw new Error('Could not change this agent’s pause.');
}

// ── Platform owner: intake a new brokerage ──────────────────────────────────
export interface IntakeLeaderResult {
  name: string;
  email: string;
  status: 'invited' | 'email_failed' | 'failed';
  link?: string;
  error?: string;
}
export interface IntakeResult { orgId: string; teamIds: string[]; leaders: IntakeLeaderResult[] }

export async function adminIntake(input: {
  orgName: string;
  teams: Array<{ name: string; fubKey: string; subdomain?: string }>;
  leaders: Array<{ name: string; email: string; teamIndex: number }>;
}): Promise<IntakeResult> {
  const res = await workerFetch('/admin/intake', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(body.error ?? 'Could not create the team.');
  return body as IntakeResult;
}

export async function adminResendInvite(o: {
  email: string; name?: string; orgName?: string;
}): Promise<{ sent: boolean; link?: string }> {
  const res = await workerFetch('/admin/resend-invite', {
    method: 'POST',
    body: JSON.stringify(o),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(body.error ?? 'Could not resend the invite.');
  return body as { sent: boolean; link?: string };
}
