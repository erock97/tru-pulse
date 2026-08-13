import { actAs, actAsReturn } from './authClient';
import { currentUser, hasActAsReturn, refreshAuth, signOut } from './auth';

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
/** One lesson screen. t: text | stat | stats | drill | callout | script | dialogue | compare | section | video | steps | media. */
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
  url?: string;          // video — Loom share/embed URL (empty = "coming soon" placeholder)
  steps?: string[];      // steps — a pipeline/stage ladder
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

// Self-contained course for ?demo=1 (previews + sales demos) — mirrors the real
// seeded curriculum's first two modules. Answer keys live only in this closure.
const DEMO_COURSE: Array<CourseModule & { answers: number[] }> = [
  {
    id: 'm0', idx: 1, title: 'Welcome to Preferred', summary: 'The program standards — and the pipeline that keeps you in it.',
    body: 'Three numbers Zillow holds you to, and the stages that must be used.',
    pass_pct: 80, questions: 7, status: 'in_progress', score: null, passed_at: null, signed: false, answers: [1, 2, 1, 1, 2, 2, 0],
    cards: [
      { t: 'video', title: 'A welcome from your team leader', url: '', body: 'Two minutes from the person who built this team — why you’re here, and what the standard looks like.' },
      { t: 'text', k: 'Welcome to Preferred', body: 'You’ve been handed something most agents grind for years to earn: a seat on a Zillow Preferred team. Buyers come to you — live transfers, warm handoffs, real people actively looking at homes today.\n\nThe seat isn’t free. Zillow holds every agent on this team to three numbers, and the team holds itself to a pipeline discipline that keeps those numbers visible. This module walks you through both — the standards and the stages — so nothing in this program ever surprises you.\n\nRead it slowly. Everything else in this course builds on what’s in here.' },
      { t: 'section', n: 'Part 1 of 2', title: 'The standards', body: 'Three numbers Zillow holds YOU to — from day one.' },
      { t: 'stat', big: '25%', label: 'minimum Pickup Rate — answering the INITIAL connection call and accepting the lead. Yours, not the team’s.', src: 'Zillow Preferred agent standard' },
      { t: 'stat', big: '4%', label: 'minimum PCVR — post-connection conversion rate. The share of your connections that become transactions.', src: 'Zillow Preferred agent standard' },
      { t: 'stat', big: '10%', label: 'minimum pre-approval rate for buyers you move to the Met With stage in Follow Up Boss.', src: 'Zillow Preferred agent standard' },
      { t: 'text', k: 'What these numbers actually ask of you', body: 'Pickup rate is the easiest standard to hold and the first one new agents drop: answer the initial call, say yes to the lead. That’s it. Every screened call is a buyer someone else gets to meet.\n\nPCVR is the long game. At 4%, roughly one connection in twenty-five becomes a transaction — and everything in this course (speed, ALMS, follow-up) exists to push your number past that floor.\n\nThe pre-approval rate is about honesty in the pipeline: Met With has to MEAN something. If you’re sitting down with buyers and one in ten isn’t getting pre-approved, the consults aren’t consults — they’re coffee.' },
      { t: 'section', n: 'Part 2 of 2', title: 'The pipeline', body: 'The stages that MUST be used in Follow Up Boss.' },
      { t: 'text', k: 'Stages are the language', body: 'Zillow and your leader read the funnel straight out of Follow Up Boss. When a stage is wrong or missing, the work becomes invisible — your pickup was real, your consult was real, but the system sees an abandoned lead.\n\nSo the stage ladder below isn’t a suggestion. It’s the shared language the whole program speaks, and every lead you touch should be sitting on the rung that matches reality.' },
      { t: 'steps', title: 'The required stages — in order', steps: ['Spoke With', 'Appointment Set', 'Met With', 'Showing Homes (buyers) / Listing Agreement (sellers)', 'Under Contract', 'Sales Closed'] },
      { t: 'video', title: 'How to log the deal in Follow Up Boss', url: 'https://www.loom.com/share/10e2b74d1e3949a8bdcf96e67b474907', body: 'Every deal must be logged in Follow Up Boss — this walkthrough shows exactly how.' },
      { t: 'drill', prompt: 'You just ended your first real phone conversation with a new connection. Which stage?', choices: ['Appointment Set', 'Spoke With', 'Met With', 'Leave them in Lead'], answer: 1, explain: 'A real conversation = Spoke With, the moment it ends. Appointment Set comes when a time is booked; Met With means you’ve actually sat down together.' },
      { t: 'drill', prompt: 'You toured two homes with the buyer this afternoon. Where do they sit now?', choices: ['Met With', 'Spoke With', 'Showing Homes', 'Under Contract'], answer: 2, explain: 'Touring = Showing Homes. Met With was the consult before it — the ladder moves one honest rung at a time.' },
      { t: 'callout', body: 'These standards aren’t hoops. They’re the exact reason the connections keep coming — to you, and to everyone on this team.' },
    ],
    qs: [
      { id: 'w1', idx: 1, prompt: 'Your minimum Pickup Rate as a Preferred agent is…', choices: ['10%', '25% — answer the initial call and accept the lead', '60%', 'There is no individual bar'] },
      { id: 'w2', idx: 2, prompt: 'The PCVR standard is…', choices: ['1% or higher', '25% or higher', '4% or higher', '50% or higher'] },
      { id: 'w3', idx: 3, prompt: 'Of the buyers you move to Met With, what share must reach pre-approval?', choices: ['None — pre-approval is the lender’s job', 'At least 10%', 'All of them', '4%'] },
      { id: 'w4', idx: 4, prompt: 'You just finished a first real conversation with a connection. The stage becomes…', choices: ['Met With', 'Spoke With', 'Appointment Set', 'Showing Homes'] },
      { id: 'w5', idx: 5, prompt: 'Deals must be logged in…', choices: ['A spreadsheet', 'Zillow’s portal', 'Follow Up Boss', 'Email to your leader'] },
      { id: 'w6', idx: 6, prompt: 'A buyer you’re actively touring homes with sits in…', choices: ['Met With', 'Under Contract', 'Showing Homes', 'Spoke With'] },
      { id: 'w7', idx: 7, prompt: 'A seller just signed with you. Their stage is…', choices: ['Listing Agreement', 'Sales Closed', 'Spoke With', 'Appointment Set'] },
    ],
  },
  {
    id: 'm1', idx: 2, title: 'The TRU Way: Speed to Lead', summary: 'Why the first five minutes decide the deal.',
    body: 'The first five minutes decide the deal.',
    pass_pct: 80, questions: 8, status: 'not_started', score: null, passed_at: null, signed: false, answers: [2, 1, 3, 2, 1, 2, 2, 1],
    cards: [
      { t: 'section', n: 'Part 1 of 3', title: 'Why speed wins', body: 'The perishable window — and the research behind it.' },
      { t: 'text', k: 'The mindset', body: 'A paid lead is not a to-do item — it’s a stopwatch that’s already running. Somewhere out there, a real person just spent twenty minutes on Zillow looking at kitchens, imagined their kids in the backyard, and then did something most people never do: they handed a stranger their phone number and asked to talk.\n\nThink about what happened before that form was submitted. They toured nine listings from their couch. They ran a mortgage calculator. They pictured the drive to work. By the time your phone buzzes, they are the most motivated they will ever be — and every minute afterward, ordinary life starts pulling them back. Dinner. A text from a friend. A second thought about the down payment.\n\nThat moment of intent is the most expensive, most perishable thing your team buys. It doesn’t age like wine. It ages like milk — and the clock started before you even saw the notification.' },
      { t: 'text', k: 'What the research actually measured', body: 'The obsession with response time isn’t folklore — it’s one of the most replicated findings in sales research. MIT and InsideSales.com audited millions of lead-response records and timed what happened when companies called back at minute one, minute five, minute thirty, and beyond.\n\nThe results weren’t a gentle slope. They were a cliff. The odds of ever reaching a lead — and of that lead becoming a client — collapse inside the first half hour, and almost all of the value sits inside the first five minutes.\n\nThree numbers from that research are worth taping to your monitor. Here they come.' },
      { t: 'stat', big: '21x', label: 'more likely to QUALIFY a lead when you call within 5 minutes instead of 30.', src: 'MIT / InsideSales.com Lead Response study' },
      { t: 'stat', big: '100x', label: 'more likely to actually CONNECT at minute 5 than at minute 30. After that the odds fall off a cliff.', src: 'Same study — response decay curve' },
      { t: 'stat', big: '78%', label: 'of buyers end up working with whoever responds FIRST. Second place gets a voicemail log.', src: 'Lead response industry research' },
      { t: 'text', k: 'What “fast” means in a real week', body: 'Nobody answers 100% of connection calls. You have showings, closings, a life. The standard isn’t perfection — it’s urgency as a default: when you can answer, you do. When you truly can’t, the lead gets a callback in minutes, not hours.\n\nThis is also why coverage matters. Walking into a listing appointment? Say so in the team chat, so calls route around you. A connection that rings three agents and reaches the fourth still counts as answered — the team’s number doesn’t care who picked up, only that someone did.\n\nTreat speed like a habit, not an event: notifications on, phone face-up, CRM app on the home screen. The agents who win at this aren’t faster humans. They’ve just removed every step between the buzz and the hello.' },
      { t: 'section', n: 'Part 2 of 3', title: 'The live-connect', body: 'Answering the call Zillow literally scores you on.' },
      { t: 'text', k: 'You are measured on this — personally', body: 'This isn’t just a habit your leader wants to see. Zillow scores YOUR Pickup Rate — answering the initial connection call and accepting the lead — and the agent bar is 25%. Miss it consistently and the connections stop routing to you, no matter how good you are once you’re in a conversation.\n\nIt stacks upward too: every agent’s pickups feed the team’s overall answer rate, the number Zillow uses to decide how many connections the whole team deserves. One agent screening calls drags everyone’s pipeline.\n\nOne more detail that surprises every new agent: the live call itself may never write to the CRM. Answering and staying on the line IS the record of your work. If you’re breathing, you pick up.', src: 'Zillow Preferred agent standard — 25% pickup rate' },
      { t: 'dialogue', title: 'The first 30 seconds — a live-connect done right', turns: [
        { who: 'agent', say: 'Hi, this is Jordan with the Costigan Group — I see you were just looking at the house on Sycamore. Great pick. What caught your eye?' },
        { who: 'lead', say: 'Oh — that was fast. Yeah, we liked the backyard, honestly. We’ve been renting and just started looking.' },
        { who: 'agent', say: 'Then you’re looking at the right time. I can get you into Sycamore this week — would Thursday at 5 work, or is Saturday morning better?' },
      ] },
      { t: 'text', k: 'Why that call worked', body: 'Play it back. “I see you were just looking at the house on Sycamore” — no interrogation, just proof he’s paying attention. “Great pick — what caught your eye?” — a compliment plus an easy question. The lead relaxes and starts talking about the backyard, which is motivation surfacing on its own, unprompted.\n\nThen the close: “I can get you into Sycamore this week — Thursday at 5, or Saturday morning?” No pause to qualify. No résumé. No “tell me about your financing.” Thirty seconds in, the buyer has what they wanted — momentum — and the agent has what he wanted: a time on the calendar.\n\nThat’s the whole trick. You don’t win the call by sounding impressive. You win it by making the next step feel easy.' },
      { t: 'drill', prompt: 'It’s 7:42pm and you’re mid-dinner. A Zillow live-connect rings. What do you do?', choices: ['Let it ring — call back within the hour', 'Answer it — step away and take the call', 'Text them tomorrow morning', 'Screenshot it and ask your team lead'], answer: 1, explain: 'A live-connect is a buyer standing in the doorway. At minute 30 you’re 100x less likely to ever reach them — and the missed ring hits YOUR 25% pickup rate. Dinner can wait five minutes.' },
      { t: 'section', n: 'Part 3 of 3', title: 'When they don’t pick up', body: 'Most leads won’t answer. The pros plan for it.' },
      { t: 'text', k: 'Expect the voicemail', body: 'Here’s what nobody tells new agents: most paid leads won’t answer your first call. Everyone screens unknown numbers now. That’s not failure — that’s the game. The difference between a pro and an amateur is that the pro has the next move loaded before the first ring.\n\nThe play is the double-dial: call, and if it rings out, call again immediately. A repeated call signals a real human with something time-sensitive — connect rates jump meaningfully on the second attempt. Then voicemail. Then an immediate text.\n\nAnd understand the voicemail’s real job: it isn’t the callback — it’s getting your text read. A voicemail from “Jordan, about the Sycamore house” turns your text from a stranger’s spam into a message they were expecting.' },
      { t: 'script', title: 'If they don’t pick up — say and send this', lines: [
        '“Hi, this is Jordan with the Costigan Group — you were just asking about the home on Sycamore. I’m around all evening, call or text me back at this number and I’ll get you in to see it this week.”',
        'Then text, immediately: “Hi, it’s Jordan — just left you a voicemail about the Sycamore house. Want me to line up a time to see it Thursday or Saturday?”',
      ] },
      { t: 'drill', prompt: 'A Realtor.com lead landed 3 minutes ago while you’re prepping a listing packet. First move?', choices: ['Finish the packet, then call tonight', 'Add them to tomorrow’s call block', 'Send a quick email so a touch is logged', 'Call right now — the prep can pause'], answer: 3, explain: 'Three minutes in, you’re still inside the 21x window. And an email isn’t a touch — it’s a receipt.' },
      { t: 'drill', prompt: 'You double-dialed at 9am, left a voicemail, texted. It’s 7pm — silence. What’s the move?', choices: ['Nothing — the ball’s in their court', 'One more call or text this evening — day one gets multiple touches', 'Mark the lead dead', 'Wait a week so you don’t seem desperate'], answer: 1, explain: 'Day one IS the window — and evenings are when buyers are back on their phones. One respectful evening touch doubles your shot at a connection without a whiff of desperation.' },
      { t: 'callout', body: 'Your team PAID for this lead. Realtor.com money is already spent; Zillow takes its cut at close. Every silent minute is you paying full price for a colder lead.' },
    ],
    qs: [
      { id: 'q1', idx: 1, prompt: 'Calling a new lead within 5 minutes instead of 30 makes you how much more likely to QUALIFY them?', choices: ['Twice as likely', 'About the same', 'About 21x more likely', '10% more likely'] },
      { id: 'q2', idx: 2, prompt: 'What share of buyers end up working with whoever responds FIRST?', choices: ['Around 10%', 'Around 78%', 'Around 40%', 'Around 25%'] },
      { id: 'q3', idx: 3, prompt: 'Why does answering a Zillow live-connect matter so much?', choices: ['It counts as two texts', 'It skips the appointment', 'It pays extra commission', 'It may never log in the CRM — the connect IS your proof of work'] },
      { id: 'q4', idx: 4, prompt: 'Zillow’s Pickup Rate standard for YOU as an agent is…', choices: ['There is no individual bar', '60%', '25% — answer the initial call and accept the lead', '90%'] },
      { id: 'q5', idx: 5, prompt: 'The goal of the very first touch is to…', choices: ['Fully qualify their finances', 'Be human, be fast, and set the next step', 'Pitch three listings', 'Ask who their agent is'] },
      { id: 'q6', idx: 6, prompt: 'A new paid lead lands while you’re prepping a listing packet. Best move?', choices: ['Finish the packet, call tonight', 'Add them to tomorrow’s call block', 'Pause the prep and call right now', 'Send an email so a touch is logged'] },
      { id: 'q7', idx: 7, prompt: 'Between minute 5 and minute 30, your odds of CONNECTING with a new lead…', choices: ['Improve as they settle in', 'Dip slightly', 'Collapse — roughly a 100x drop', 'Hold steady until 24 hours'] },
      { id: 'q8', idx: 8, prompt: 'They don’t answer your first call. The day-one play is…', choices: ['One voicemail is plenty', 'Double-dial, voicemail, then an immediate text with two showing times', 'Try again next week', 'Email and wait'] },
    ],
  },
  {
    id: 'm2', idx: 3, title: 'The ALMS Call Framework', summary: 'Appointment, Location, Motivation, Summarize — the whole call.',
    body: 'Four beats. One booked appointment.',
    pass_pct: 80, questions: 8, status: 'not_started', score: null, passed_at: null, signed: false, answers: [0, 1, 3, 1, 1, 2, 1, 1],
    cards: [
      { t: 'section', n: 'Part 1 of 3', title: 'The framework', body: 'Where ALMS comes from — and why frameworks beat winging it.' },
      { t: 'text', k: 'Where this comes from', body: 'ALMS isn’t something we invented on a whiteboard. Zillow built the ALM framework — Appointment, Location, Motivation — from listening to thousands of connection calls and measuring which ones turned into closings. We added the S, Summarize, because a call that ends without a playback is a call the buyer forgets by morning.\n\nThis is also a scored behavior: Zillow’s program standard is that 80% or more of your connection calls include a real appointment conversation. This framework is how you clear that bar without ever sounding like you’re reading one.\n\nFrameworks matter for one more reason: consistency is coachable. When every agent runs the same four beats, your leader can hear one call, point at one beat, and make you measurably better at it. Freestyle can’t be coached — it can only be admired or cringed at.' },
      { t: 'stat', big: '3x', label: 'more likely to TRANSACT when the buyer and agent confirm an appointment on the very first connection call.', src: 'Zillow Premier Agent performance data' },
      { t: 'text', k: 'Why the appointment is the whole game', body: 'An interested buyer with no appointment is a browser. An appointment converts interest into commitment — a time, a place, a person they’d feel bad canceling on. That’s basic psychology working in your favor: people keep appointments they’d have to break.\n\nIt also changes what you are to them. Without a meeting, you’re a search portal with a pulse — they’ll happily take listings from you and buy with whoever’s standing at the open house. With a meeting on the calendar, you’re their agent.' },
      { t: 'section', n: 'Part 2 of 3', title: 'The four beats', body: 'A, L, M, S — each with the exact words that work.' },
      { t: 'text', k: 'A — Appointment', body: 'The single goal of the call. You’re not selling a house tonight — you’re selling the next 20 minutes of their home search. Zillow’s own recommended line is disarmingly simple: “Great — when would you like to see 123 Main Street?”\n\nNotice it assumes the showing is happening; the only question is when. Give an either/or with two concrete times. “Sometime” is where appointments go to die.' },
      { t: 'script', title: 'The appointment ask — steal this', lines: [
        '“Great — when would you like to see the Sycamore house? I can do Thursday at 5, or Saturday morning if that’s easier.”',
        'If they hesitate: “Tell you what — let’s pencil Saturday at 10. If the week gets away from you, moving it is a ten-second text.”',
      ] },
      { t: 'text', k: 'L — Location', body: 'Zillow’s line: “In addition to 123 Main Street, what other properties in the area would you like to see?”\n\nThis one question quietly changes what you are to them. You stop being the agent for one listing and become the agent for their whole search — and it fills the showing appointment with more than one home, which Zillow’s data says helps buyers decide with confidence.\n\nLocation also surfaces the shape of the move: do they own where they are now? Do they need to sell first? Are they crossing school districts, or crossing the country? Each answer changes the plan you’ll build.' },
      { t: 'text', k: 'M — Motivation', body: 'The real driver. “What’s got you looking now?” A first-time buyer, a family relocating for a job, and an investor hunting a duplex will all answer that question completely differently — and each answer tells you the speed and the stakes of their move.\n\nWhen they volunteer something personal — a baby, a divorce, a job they just landed — give it a genuine beat of empathy before you move on. People book with agents who heard them.' },
      { t: 'dialogue', title: 'Motivation, done right', turns: [
        { who: 'agent', say: 'So what’s got you two looking right now?' },
        { who: 'lead', say: 'Honestly? We just found out we’re having twins. The apartment’s already too small.' },
        { who: 'agent', say: 'Twins — congratulations! Okay, so more space just became the mission, and the timeline’s real. Let’s find you a house before you need the second crib.' },
        { who: 'lead', say: 'Ha — yes. Exactly.' },
      ] },
      { t: 'text', k: 'Reading the motivation types', body: 'First-time buyers need education and reassurance — slow the call down, explain what happens next, treat the milestone like the big deal it is. Relocating families are on a clock — lead with logistics: school calendars, virtual tours, how fast you can line up a weekend of showings. Speed IS the service.\n\nInvestors want numbers, not narratives — rents, cap rates, days on market. Skip the backyard poetry. And downsizers are often leaving a family home of thirty years — the motivation is emotional, the timeline is theirs, and pushing it collapses the trust.\n\nSame four beats every time. Four completely different songs. Motivation tells you which one you’re playing.' },
      { t: 'text', k: 'S — Summarize', body: 'Play the whole call back in one breath: “So you’re hoping to be in Maple Grove before the school year, you’ll want three beds now that the twins are coming, and we’re meeting Thursday at 5 — I’ll have Sycamore plus two more lined up.”\n\nThey feel heard. The plan is locked. And you sound like the only organized person in their whole home search.' },
      { t: 'stat', big: '2+', label: 'minutes on the first call is where success rates climb. Rushing to hang up is how appointments evaporate.', src: 'Zillow Premier Agent call data' },
      { t: 'section', n: 'Part 3 of 3', title: 'Putting it together', body: 'A full call, the do/don’t list, and your reps.' },
      { t: 'dialogue', title: 'A full ALMS call — 90 seconds, condensed', turns: [
        { who: 'agent', say: 'Hi, this is Jordan with the Costigan Group — you asked about 214 Birchwood. What caught your eye?' },
        { who: 'lead', say: 'The garage, honestly. We need the storage. We’re renting over in Riverside right now.' },
        { who: 'agent', say: 'Riverside’s a quick hop. Besides Birchwood, anything else in that area you’ve been watching?' },
        { who: 'lead', say: 'There was one on Kessler we liked too.' },
        { who: 'agent', say: 'I’ll line up both. And what’s got you two making the move now?' },
        { who: 'lead', say: 'Lease is up in October, and we’re done paying rent.' },
        { who: 'agent', say: 'So: the garage matters, Birchwood and Kessler, in the new place before October. Thursday at 5 or Saturday at 10 — which works to see them both?' },
      ] },
      { t: 'compare', good: ['Answer fast, sound glad they called', 'Ask what caught their eye about the house', 'Offer two concrete showing times', 'Widen to the whole search (“what else would you like to see?”)', 'Summarize the plan before hanging up'], bad: ['Open with “are you pre-approved?”', 'Ask “do you already have an agent?”', 'Interrogate through a 20-question checklist', 'End with “call me whenever you’re ready”', 'Hang up without a booked next step'] },
      { t: 'drill', prompt: 'Which is the strongest MOTIVATION question?', choices: ['“How much do you have for a down payment?”', '“What’s got you thinking about a move right now?”', '“Do you already have an agent?”', '“What’s your credit score?”'], answer: 1, explain: 'Motivation opens their story. The other three slam the door — money and agent questions kill first-call trust.' },
      { t: 'drill', prompt: 'The lead says: “We just found out we’re having twins.” Best response?', choices: ['“OK. What’s your budget?”', '“Twins — congratulations! So more space just became the mission.”', '“Noted. Which zip codes?”', 'Skip it and go straight to booking'], answer: 1, explain: 'A beat of real empathy, then bridge it straight into the move. People book with agents who heard them.' },
      { t: 'drill', prompt: 'Which appointment ask actually gets on the calendar?', choices: ['“Call me whenever works”', '“Want to meet sometime?”', '“Are you free Thursday at 5, or is Saturday morning better?”', '“I’ll email you some times eventually”'], answer: 2, explain: 'Either/or with two concrete times — and it assumes the showing is happening. “Sometime” is where appointments go to die.' },
      { t: 'drill', prompt: 'The lead says: “Oh, we’re just looking — super early.” Best response?', choices: ['“Call me back when you’re serious.”', '“Totally fine — most great clients start early. Want a no-pressure look at two homes this weekend, just to calibrate?”', '“I’ll put you on my newsletter.”', '“Zillow said you wanted to talk to an agent.”'], answer: 1, explain: '“Early” is not a no — it’s a buyer without urgency yet. A zero-pressure tour builds the relationship months before the competition even calls back.' },
      { t: 'callout', body: 'Confirm the appointment on the first call and the odds of a closing triple. That’s not a coaching opinion — it’s Zillow’s own transaction data.' },
    ],
    qs: [
      { id: 'q9', idx: 1, prompt: 'Confirming an appointment on the very first connection call makes a transaction…', choices: ['3x more likely', 'Slightly more likely', 'Less likely — it’s pushy', 'No different'] },
      { id: 'q10', idx: 2, prompt: 'Which of these does NOT belong on an ALMS call?', choices: ['Asking what’s motivating the move', 'Asking if they already have an agent', 'Asking where they’re looking', 'Summarizing and locking the next step'] },
      { id: 'q11', idx: 3, prompt: 'Zillow’s recommended LOCATION question does what?', choices: ['Gets their home address', 'Confirms their zip code', 'Checks how far they’ll commute', 'Expands one listing into their whole home search — making you their agent, not the listing’s'] },
      { id: 'q12', idx: 4, prompt: 'The strongest appointment ask is…', choices: ['“Want to meet sometime?”', '“Are you free Thursday at 5, or is Saturday morning better?”', '“Call me whenever works”', '“I’ll email some times”'] },
      { id: 'q13', idx: 5, prompt: 'How long should a good first connection call run?', choices: ['Under 30 seconds — respect their time', 'Two minutes or more — that’s where success rates climb', 'At least 20 minutes', 'Length doesn’t matter'] },
      { id: 'q14', idx: 6, prompt: 'The point of Summarize is to…', choices: ['Recap your credentials', 'List every home in their range', 'Play it back so they feel heard and the plan is locked', 'Confirm their credit score'] },
      { id: 'q15', idx: 7, prompt: 'A relocating family differs from a first-time buyer mainly in…', choices: ['Nothing — buyers are buyers', 'The clock — relocators need speed and logistics; first-timers need education and reassurance', 'Credit score', 'Which portal they use'] },
      { id: 'q16', idx: 8, prompt: 'The lead says they’re “just looking, super early.” You…', choices: ['Tell them to call back when serious', 'Offer a no-pressure look at two homes to calibrate — early buyers become loyal clients', 'Add them to a newsletter and move on', 'Push for pre-approval first'] },
    ],
  },
];

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
    { id: 'm0', idx: 1, title: 'Welcome to Preferred', summary: 'The program standards — and the pipeline that keeps you in it.', body: 'Three numbers Zillow holds you to.', pass_pct: 80, questions: 7, cards: DEMO_COURSE[0].cards },
    { id: 'm1', idx: 2, title: 'The TRU Way: Speed to Lead', summary: 'Why the first five minutes decide the deal.', body: 'A paid lead is a stopwatch, not a to-do…', pass_pct: 80, questions: 8, cards: DEMO_COURSE[1].cards },
    { id: 'm2', idx: 3, title: 'The ALMS Call Framework', summary: 'Appointment, Location, Motivation, Summarize.', body: 'ALMS is the spine of every first call…', pass_pct: 80, questions: 8, cards: DEMO_COURSE[2].cards },
    { id: 'm3', idx: 4, title: 'Working a Paid Lead End to End', summary: 'What "worked" actually means.', body: 'A lead counts as WORKED when…', pass_pct: 80, questions: 7, cards: [
      { t: 'section', n: 'The one word', title: 'What "worked" means', body: 'A lead is worked when a real person actually tried to reach them — not when the CRM fired an autotext.' },
      { t: 'text', k: 'Worked is a verb', body: 'A paid lead counts as WORKED the moment you personally try to reach a real human — a live call, a real voicemail, a text you actually typed. An automated drip going out under your name is not you working the lead. It’s the system holding the door while you decide whether to walk through it.\n\nEvery lead sits in one of three states on your Pulse board: worked, stuck, or zero-contact. The whole job is keeping leads out of the bottom two — not by gaming the stage, but by doing the thing the stage is supposed to mean.' },
      { t: 'steps', title: 'Working a lead, start to finish', steps: ['Speed: first personal touch inside the window', 'Double-dial, voicemail, then a text you actually typed', 'Set the next step — a real time on the calendar', 'Log the honest stage in Follow Up Boss', 'Keep following up until they answer, book, or clearly say no'] },
      { t: 'drill', prompt: 'An autotext went out to a new lead an hour ago. No human has called. Is this lead "worked"?', choices: ['Yes — a touch is a touch', 'No — automated ≠ worked; it still needs a real attempt', 'Only if they replied', 'Yes, after 24 hours'], answer: 1, explain: 'Automation keeps the lead warm; it doesn’t count as you working it. Until a person tries to reach them, the lead is still zero-contact.' },
      { t: 'callout', body: 'Worked, stuck, or zero-contact — every lead is one of the three. The whole program is just keeping more of them in the first bucket.' },
    ] },
    { id: 'm4', idx: 5, title: 'Follow-Up Discipline & the CRM', summary: 'The system only works if the CRM tells the truth.', body: 'Your CRM is the single source of truth…', pass_pct: 80, questions: 7, cards: [
      { t: 'section', n: 'The scoreboard', title: 'The CRM tells the truth', body: 'Zillow and your leader read your whole funnel out of Follow Up Boss. If it’s wrong, your best work is invisible.' },
      { t: 'text', k: 'If it’s not in the CRM, it didn’t happen', body: 'You can make the perfect call, set the perfect appointment, and sit down with a buyer who’s ready — and if the stage in Follow Up Boss never moves, none of it shows up. The system doesn’t see effort. It sees stages.\n\nThat cuts both ways. A CRM that tells the truth protects you: it’s the record that the lead was answered, the consult happened, the deal is real. Keep it honest and it works for you. Let it drift and your pipeline lies about you.' },
      { t: 'steps', title: 'A simple follow-up cadence', steps: ['Day 1: multiple touches — call, voicemail, text', 'Days 2–7: a touch a day while intent is high', 'Weeks 2–4: every few days, mix call and text', 'Then a steady long-game rhythm until they act or opt out'] },
      { t: 'drill', prompt: 'You met with a buyer today but never updated their stage. What does the system show?', choices: ['Met With', 'An abandoned lead — your consult is invisible', 'Under Contract', 'It updates itself'], answer: 1, explain: 'The funnel is only as true as you keep it. An un-updated stage reads as a lead nobody worked — even though you did the work.' },
      { t: 'callout', body: 'The CRM isn’t paperwork. It’s the scoreboard the whole program is keeping — make sure it’s telling your story straight.' },
    ] },
  ];
  const agents: RepAgent[] = [
    { id: 'a1', name: 'Maria Lopez', email: 'maria@example.com', invited: true },
    { id: 'a2', name: 'Sam Whitfield', email: 'sam@example.com', invited: true },
    { id: 'a3', name: 'Dana Cole', email: 'dana@example.com', invited: false },
  ];
  const progress: RepProgressRow[] = [
    // Maria (a1) — fully certified: passed all 5 modules, so the gauge reads alive
    // (1 of 3 · ~33%) instead of a flat 0%. certifiedCount counts agents at 100%.
    { agent_id: 'a1', module_id: 'm0', status: 'passed', score: 100, passed_at: '2026-06-18' },
    { agent_id: 'a1', module_id: 'm1', status: 'passed', score: 100, passed_at: '2026-06-20' },
    { agent_id: 'a1', module_id: 'm2', status: 'passed', score: 90, passed_at: '2026-06-22' },
    { agent_id: 'a1', module_id: 'm3', status: 'passed', score: 90, passed_at: '2026-06-24' },
    { agent_id: 'a1', module_id: 'm4', status: 'passed', score: 80, passed_at: '2026-06-26' },
    // Sam (a2) — mid-program (started, not certified).
    { agent_id: 'a2', module_id: 'm0', status: 'passed', score: 90, passed_at: '2026-06-23' },
    { agent_id: 'a2', module_id: 'm1', status: 'passed', score: 80, passed_at: '2026-06-25' },
    { agent_id: 'a2', module_id: 'm2', status: 'in_progress', score: null, passed_at: null },
    // Dana (a3) — invited, not started.
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
