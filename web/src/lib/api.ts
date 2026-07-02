import { supabase } from './supabase';

const WORKER_URL = import.meta.env.VITE_WORKER_URL as string;

/** ?demo=1 → render the dashboard with seeded data, no auth, no backend. */
export const isDemo =
  typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1';

async function token(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? '';
}

/** RLS returns only the caller's org, so limit(1) is the user's org. */
export async function myOrg(): Promise<{ id: string; name: string; plan: string } | null> {
  const { data } = await supabase.from('orgs').select('id,name,plan').limit(1);
  return (data?.[0] as { id: string; name: string; plan: string }) ?? null;
}

export async function provisionOrg(
  orgName: string,
  teams: Array<{ name: string; fubKey: string; subdomain?: string }>,
): Promise<{ orgId: string; teamIds: string[] }> {
  const res = await fetch(WORKER_URL + '/provision', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await token()) },
    body: JSON.stringify({ orgName, teams }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; orgId?: string; teamIds?: string[] };
  if (!res.ok) throw new Error(body.error ?? 'Provisioning failed');
  return body as { orgId: string; teamIds: string[] };
}

export async function triggerSync(): Promise<unknown> {
  if (isDemo) return {};
  const res = await fetch(WORKER_URL + '/sync', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + (await token()) },
  });
  if (!res.ok) throw new Error('Sync failed');
  return res.json();
}

// ── TRU Rep — agent onboarding / certification ──────────────────────────────
export interface RepModule { id: string; idx: number; title: string; summary: string | null; body: string | null; pass_pct: number; questions: number; cards?: LessonCard[] | null }
export interface RepProgressRow { agent_id: string; module_id: string; status: string; score: number | null; passed_at: string | null; signed_off_at?: string | null }
export interface RepAgent { id: string; name: string; email: string | null; invited: boolean }
export interface RepPracticeRow { agent_id: string; scenario: string; status: string; score: number | null; passed: boolean | null; created_at: string }
export interface RepData { modules: RepModule[]; progress: RepProgressRow[]; agents: RepAgent[]; practice: RepPracticeRow[] }

export async function loadRep(): Promise<RepData> {
  if (isDemo) return demoRep();
  const [mods, qs, prog, agents, prac] = await Promise.all([
    supabase.from('rep_modules').select('id,idx,title,summary,body,pass_pct,cards').eq('active', true).order('idx'),
    supabase.from('rep_questions_public').select('module_id'),
    supabase.from('rep_progress').select('agent_id,module_id,status,score,passed_at,signed_off_at'),
    supabase.from('agents').select('id,name,email,auth_id').eq('excluded', false).order('name'),
    supabase.from('rep_practice').select('agent_id,scenario,status,score,passed,created_at'),
  ]);
  const qcount = new Map<string, number>();
  ((qs.data as Array<{ module_id: string }>) ?? []).forEach((q) => qcount.set(q.module_id, (qcount.get(q.module_id) ?? 0) + 1));
  return {
    modules: ((mods.data as Omit<RepModule, 'questions'>[]) ?? []).map((m) => ({ ...m, questions: qcount.get(m.id) ?? 0 })),
    progress: (prog.data as RepProgressRow[]) ?? [],
    agents: ((agents.data as Array<{ id: string; name: string; email: string | null; auth_id: string | null }>) ?? [])
      .map((a) => ({ id: a.id, name: a.name, email: a.email, invited: !!a.auth_id })),
    practice: (prac.data as RepPracticeRow[]) ?? [],
  };
}

// ── Agent side: identity + the course ───────────────────────────────────────
export interface AgentIdentity { id: string; org_id: string; name: string; team_id: string }
export interface CourseQuestion { id: string; idx: number; prompt: string; choices: string[] }
/** One lesson screen. t: text | stat | stats | drill | callout | script | dialogue | compare | section. */
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
  title?: string;        // script / dialogue / video / steps heading
  lines?: string[];      // script — the exact words to say
  turns?: Array<{ who: string; say: string }>;    // dialogue — 'lead' | 'agent'
  good?: string[];       // compare — DO column
  bad?: string[];        // compare — DON'T column
  url?: string;          // video — Loom share/embed URL (empty = "coming soon" placeholder)
  steps?: string[];      // steps — a pipeline/stage ladder
}
export interface CourseModule extends RepModule { qs: CourseQuestion[]; cards: LessonCard[]; status: string; score: number | null; passed_at: string | null; signed: boolean }
export interface GradeReview { idx: number; your: number; correct_index: number; is_correct: boolean; explain: string | null }
export interface GradeResult { score: number; passed: boolean; correct: number; total: number; review: GradeReview[] }

/** The logged-in user's agent row (null if they're not an agent). */
export async function myAgent(): Promise<AgentIdentity | null> {
  const { data: u } = await supabase.auth.getUser();
  const uid = u.user?.id;
  if (!uid) return null;
  const { data } = await supabase.from('agents').select('id,org_id,name,team_id').eq('auth_id', uid).limit(1);
  return (data?.[0] as AgentIdentity) ?? null;
}

/** Link this fresh login to an agent row by verified email; returns agent id or null. */
export async function claimAgent(): Promise<string | null> {
  const { data, error } = await supabase.rpc('claim_agent');
  if (error) return null;
  return (data as string) ?? null;
}

/** Leader: sign off a fully-certified agent (stamps every passed module). */
export async function signOffAgent(agentId: string): Promise<void> {
  if (isDemo) return;
  const { data: u } = await supabase.auth.getUser();
  const who = u.user?.email ?? 'team leader';
  const { error } = await supabase
    .from('rep_progress')
    .update({ signed_off_by: who, signed_off_at: new Date().toISOString() })
    .eq('agent_id', agentId)
    .eq('status', 'passed');
  if (error) throw new Error(error.message);
}

/** Leader/admin: mint an invite (or re-invite) link for an agent. */
export async function inviteAgent(agentId: string): Promise<{ link: string; email: string; reinvite: boolean }> {
  const res = await fetch(WORKER_URL + '/rep/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await token()) },
    body: JSON.stringify({ agentId }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; link?: string; email?: string; reinvite?: boolean };
  if (!res.ok || !body.link) throw new Error(body.error ?? 'Could not create invite');
  return { link: body.link, email: body.email ?? '', reinvite: !!body.reinvite };
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
  const [mods, qs, prog] = await Promise.all([
    supabase.from('rep_modules').select('id,idx,title,summary,body,pass_pct,cards').eq('active', true).order('idx'),
    supabase.from('rep_questions_public').select('id,module_id,idx,prompt,choices').order('idx'),
    supabase.from('rep_progress').select('module_id,status,score,passed_at,signed_off_at').eq('agent_id', agentId),
  ]);
  const byMod = new Map<string, CourseQuestion[]>();
  ((qs.data as Array<CourseQuestion & { module_id: string }>) ?? []).forEach((q) => {
    const arr = byMod.get(q.module_id) ?? [];
    arr.push({ id: q.id, idx: q.idx, prompt: q.prompt, choices: q.choices });
    byMod.set(q.module_id, arr);
  });
  const progByMod = new Map((((prog.data as Array<{ module_id: string; status: string; score: number | null; passed_at: string | null; signed_off_at: string | null }>) ?? [])).map((p) => [p.module_id, p]));
  return ((mods.data as Array<Omit<RepModule, 'questions'> & { cards: LessonCard[] | null }>) ?? []).map((m) => {
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
  const res = await fetch(WORKER_URL + '/rep/practice/scenarios');
  return (await res.json()) as { configured: boolean; scenarios: SimScenario[] };
}

export async function simStart(scenario: string): Promise<{ practiceId: string; accessToken: string }> {
  const res = await fetch(WORKER_URL + '/rep/practice/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await token()) },
    body: JSON.stringify({ scenario }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; practiceId?: string; accessToken?: string };
  if (!res.ok || !body.accessToken) throw new Error(body.error ?? 'Could not start the call');
  return { practiceId: body.practiceId as string, accessToken: body.accessToken };
}

export async function simFinish(practiceId: string): Promise<SimResult> {
  const res = await fetch(WORKER_URL + '/rep/practice/finish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await token()) },
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
  const { data } = await supabase
    .from('rep_practice')
    .select('id,scenario,status,score,passed,created_at')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false });
  return (data as SimAttempt[]) ?? [];
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
  const res = await fetch(WORKER_URL + '/rep/grade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await token()) },
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
    { id: 'm3', idx: 4, title: 'Working a Paid Lead End to End', summary: 'What "worked" actually means.', body: 'A lead counts as WORKED when…', pass_pct: 80, questions: 7 },
    { id: 'm4', idx: 5, title: 'Follow-Up Discipline & the CRM', summary: 'The system only works if the CRM tells the truth.', body: 'Your CRM is the single source of truth…', pass_pct: 80, questions: 7 },
  ];
  const agents: RepAgent[] = [
    { id: 'a1', name: 'Maria Lopez', email: 'maria@example.com', invited: true },
    { id: 'a2', name: 'Sam Whitfield', email: 'sam@example.com', invited: true },
    { id: 'a3', name: 'Dana Cole', email: 'dana@example.com', invited: false },
  ];
  const progress: RepProgressRow[] = [
    { agent_id: 'a1', module_id: 'm1', status: 'passed', score: 100, passed_at: '2026-06-20' },
    { agent_id: 'a1', module_id: 'm2', status: 'passed', score: 90, passed_at: '2026-06-22' },
    { agent_id: 'a1', module_id: 'm3', status: 'in_progress', score: null, passed_at: null },
    { agent_id: 'a2', module_id: 'm1', status: 'passed', score: 80, passed_at: '2026-06-25' },
    { agent_id: 'a2', module_id: 'm2', status: 'in_progress', score: null, passed_at: null },
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
    const res = await fetch(WORKER_URL + '/admin/leaders', {
      headers: { Authorization: 'Bearer ' + (await token()) },
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
  const res = await fetch(WORKER_URL + '/admin/impersonate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await token()) },
    body: JSON.stringify({ email }),
  });
  const j = (await res.json().catch(() => ({}))) as { token_hash?: string; type?: string; error?: string };
  if (!res.ok || !j.token_hash) throw new Error(j.error ?? 'Could not start the session');
  // Stash the OWNER's session first, so Exit can restore it without a re-login.
  const { data: cur } = await supabase.auth.getSession();
  if (cur.session) {
    try {
      sessionStorage.setItem('hq_admin_return', JSON.stringify({ at: cur.session.access_token, rt: cur.session.refresh_token }));
    } catch { /* private mode — Exit falls back to sign-out */ }
  }
  const { error } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: j.token_hash });
  if (error) throw error;
}

/** Is this browser inside an impersonated session (owner tokens stashed)? */
export function hasAdminReturn(): boolean {
  try { return !!sessionStorage.getItem('hq_admin_return'); } catch { return false; }
}

/** Exit impersonation: restore the owner's own session (falls back to sign-out). */
export async function adminReturn(): Promise<void> {
  let saved: { at: string; rt: string } | null = null;
  try { saved = JSON.parse(sessionStorage.getItem('hq_admin_return') ?? 'null'); } catch { saved = null; }
  try { sessionStorage.removeItem('hq_admin_return'); } catch { /* noop */ }
  if (!saved) { await supabase.auth.signOut(); return; }
  const { error } = await supabase.auth.setSession({ access_token: saved.at, refresh_token: saved.rt });
  if (error) await supabase.auth.signOut();
}

/** Update the org's thresholds / audit math. Writes go through the Worker (RLS
 *  keeps the browser read-only), which patches org_settings with the service role. */
export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  if (isDemo) return;
  const res = await fetch(WORKER_URL + '/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await token()) },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error('Save failed');
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
  name: string;
  email: string | null;
  phone: string | null;
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
export interface Settings {
  avg_gci: number;
  close_rate: number;
  window_hours: number;
  strike_limit: number;
  per_agent_capacity: number;
  sources?: string[] | null;   // enabled source families; null/absent = all
}
export interface DashboardData {
  teams: Array<{ id: string; name: string; fub_subdomain: string | null }>;
  settings: Settings | null;
  leads: LeadRow[];
  cases: CaseRow[];
  agents: AgentRow[];
  deals: DealRow[];
}

export async function loadDashboard(): Promise<DashboardData> {
  if (isDemo) return demoDashboard();
  const sinceIso = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [teams, settings, leads, cases, agents, deals] = await Promise.all([
    supabase.from('teams').select('id,name,fub_subdomain'),
    supabase.from('org_settings').select('avg_gci,close_rate,window_hours,strike_limit,per_agent_capacity,sources').limit(1),
    supabase.from('leads').select('team_id,assigned_to,flag,source_family,name,stage,fub_person_id,fub_created,pond'),
    supabase.from('accountability_cases').select('assigned_to,status,opened_at').gte('opened_at', sinceIso),
    supabase.from('agents').select('name,email,phone'),
    // Degrades to [] until the deals table exists (supabase-js returns an error, not a throw).
    supabase.from('deals').select('team_id,stage,stage_class,price,commission,agent_name,fub_person_id,projected_close,fub_created'),
  ]);
  return {
    teams: (teams.data as DashboardData['teams']) ?? [],
    settings: (settings.data?.[0] as Settings) ?? null,
    leads: (leads.data as LeadRow[]) ?? [],
    cases: (cases.data as CaseRow[]) ?? [],
    agents: (agents.data as AgentRow[]) ?? [],
    deals: (deals.data as DealRow[]) ?? [],
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
  const leads: LeadRow[] = [];
  const cases: CaseRow[] = [];
  for (const [name, paid, zero, stuck, , strikes] of agentSpec) {
    for (let i = 0; i < paid; i++) {
      const flag = i < zero ? 'zero_contact' : i < zero + stuck ? 'stuck' : 'worked';
      const ponded = name === 'Unassigned';
      leads.push({
        team_id: 'demo',
        assigned_to: ponded ? null : name,
        flag,
        source_family: srcPool[si++ % srcPool.length],
        pond: ponded ? 'New Buyer Pond' : null,
      });
    }
    for (let s = 0; s < strikes; s++) {
      cases.push({ assigned_to: name, status: 'open', opened_at: new Date(Date.now() - (s + 1) * 3 * 86400_000).toISOString() });
    }
  }
  // Demo deals: 27 closings (16 closed + 11 UC) off 543 leads ≈ 1:20, and
  // 54 offer-or-beyond ≈ 10% offer rate — the numbers the pitch tells.
  const dayMs = 86400_000;
  const deals: DealRow[] = [];
  const dealAgents = ['Trevor Holland', 'Jordan Blake', 'Dana Cole', 'Priya Nair', 'Marcus Delgado', 'Maria Lopez'];
  const mk = (n: number, cls: string, stage: string, closeInDays: number) => {
    for (let i = 0; i < n; i++) {
      deals.push({
        team_id: 'demo', stage, stage_class: cls,
        price: 380_000 + (i % 7) * 45_000, commission: 9_000 + (i % 5) * 1_800,
        agent_name: dealAgents[i % dealAgents.length],
        projected_close: new Date(Date.now() + closeInDays * dayMs - (i % 20) * dayMs).toISOString(),
        fub_created: new Date(Date.now() - (5 + (i % 22)) * dayMs).toISOString(),
      });
    }
  };
  mk(16, 'closed', 'Closed', -2);
  mk(11, 'uc', 'Pending', 18);
  mk(27, 'offer', 'Offer', 30);
  return {
    teams: [{ id: 'demo', name: 'Main office', fub_subdomain: null }],
    settings: { avg_gci: 10000, close_rate: 2, window_hours: 48, strike_limit: 3, per_agent_capacity: 20 },
    leads,
    cases,
    agents: [],
    deals,
  };
}

// ── TRU Prospect — agent-assist outbound (Circle Prospecting) ────────────────
export interface CircleSummary {
  neighbors: number; queued: number; manual: number; blocked: number;
  suppressed: number; uncallable: number; errors: number;
}
export interface ProspectGateDecision {
  verdict: 'allow' | 'manual' | 'block'; reason: string;
  blockers: string[]; requirements: string[]; priority: number;
}
export interface ProspectQueueItem {
  id: string; person_id: string; phone_e164: string | null; channel: string; priority: number;
  state: 'queued' | 'manual' | 'gate_blocked' | 'suppressed' | 'calling' | 'completed' | 'failed';
  next_eligible_at: string | null;
  last_gate_decision: ProspectGateDecision | null;
  dossier: { opener?: string } | null;
  person: { full_name: string | null; timezone: string | null; source: string | null } | null;
}

/** Run a circle campaign around a subject location; returns the campaign + a summary. */
export async function runCircle(
  center: { latitude: number; longitude: number },
  opts?: { name?: string; radiusMeters?: number; limit?: number },
): Promise<{ campaignId: string; summary: CircleSummary; providersLive: boolean; dossiers: number }> {
  const res = await fetch(WORKER_URL + '/prospect/circle/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await token()) },
    body: JSON.stringify({ center, ...opts }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; campaignId?: string; summary?: CircleSummary; providersLive?: boolean; dossiers?: number };
  if (!res.ok || !body.campaignId) throw new Error(body.error ?? 'Could not run campaign');
  return { campaignId: body.campaignId, summary: body.summary as CircleSummary, providersLive: !!body.providersLive, dossiers: body.dossiers ?? 0 };
}

/** Run an Expired or FSBO campaign (same pipeline as circle, feed-based source). */
export async function runListing(
  channel: 'expired' | 'fsbo',
  opts?: { name?: string; limit?: number },
): Promise<{ campaignId: string; summary: CircleSummary; providersLive: boolean; dossiers: number }> {
  const res = await fetch(WORKER_URL + '/prospect/listing/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await token()) },
    body: JSON.stringify({ channel, ...opts }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; campaignId?: string; summary?: CircleSummary; providersLive?: boolean; dossiers?: number };
  if (!res.ok || !body.campaignId) throw new Error(body.error ?? 'Could not run campaign');
  return { campaignId: body.campaignId, summary: body.summary as CircleSummary, providersLive: !!body.providersLive, dossiers: body.dossiers ?? 0 };
}

/** Load a campaign's compliance-tagged call queue (priority-ordered). */
export async function loadProspectQueue(campaignId?: string): Promise<ProspectQueueItem[]> {
  const q = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : '';
  const res = await fetch(WORKER_URL + '/prospect/queue' + q, {
    headers: { Authorization: 'Bearer ' + (await token()) },
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; items?: ProspectQueueItem[] };
  if (!res.ok) throw new Error(body.error ?? 'Could not load queue');
  return body.items ?? [];
}

// ── TRU Studio — social content calendar (Bundle B) ─────────────────────────
export interface SocialBrandKit {
  brokerageName?: string;
  licenseNumber?: string;
  disclosureText?: string;
  colors?: string[];
}
export interface SocialVoiceProfile {
  id?: string;
  org_id?: string;
  agent_id?: string;
  tone_summary?: string | null;
  sample_posts?: string[];
  audience?: string | null;
  brand_kit?: SocialBrandKit;
}
export interface SocialContentItem {
  id: string;
  scheduled_for: string;
  pillar: string;
  format: string;
  hook: string;
  caption: string;
  script: string | null;
  status: 'draft' | 'approved' | 'scheduled' | 'posted' | 'rejected';
  compliance: { fair_housing_ok?: boolean; disclosure_appended?: boolean; flags?: string[] };
}

export async function loadVoiceProfile(agentId?: string): Promise<SocialVoiceProfile> {
  const q = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
  const res = await fetch(WORKER_URL + '/social/voice-profile' + q, {
    headers: { Authorization: 'Bearer ' + (await token()) },
  });
  const body = (await res.json().catch(() => ({}))) as SocialVoiceProfile & { error?: string };
  if (!res.ok) throw new Error((body as any).error ?? 'Could not load voice profile');
  return body;
}

export async function saveVoiceProfile(
  input: { agentId?: string; samplePosts?: string[]; audience?: string; brandKit?: SocialBrandKit },
): Promise<SocialVoiceProfile> {
  const res = await fetch(WORKER_URL + '/social/voice-profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await token()) },
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => ({}))) as SocialVoiceProfile & { error?: string };
  if (!res.ok) throw new Error((body as any).error ?? 'Could not save voice profile');
  return body;
}

export async function generateSocialCalendar(
  input: { focus: string; agentId?: string; days?: number; startDate?: string },
): Promise<{ batchId: string; generated: number; flagged: number }> {
  const res = await fetch(WORKER_URL + '/social/calendar/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await token()) },
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; batchId?: string; generated?: number; flagged?: number };
  if (!res.ok || !body.batchId) throw new Error(body.error ?? 'Could not generate calendar');
  return { batchId: body.batchId, generated: body.generated ?? 0, flagged: body.flagged ?? 0 };
}

export async function loadSocialCalendar(agentId?: string): Promise<SocialContentItem[]> {
  const q = agentId ? `?agentId=${encodeURIComponent(agentId)}` : '';
  const res = await fetch(WORKER_URL + '/social/calendar' + q, {
    headers: { Authorization: 'Bearer ' + (await token()) },
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string; items?: SocialContentItem[] };
  if (!res.ok) throw new Error(body.error ?? 'Could not load calendar');
  return body.items ?? [];
}

export async function setSocialContentStatus(
  contentId: string,
  status: SocialContentItem['status'],
  agentId?: string,
): Promise<void> {
  const res = await fetch(WORKER_URL + '/social/content/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await token()) },
    body: JSON.stringify({ contentId, status, agentId }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? 'Could not update status');
}

/** Log a call outcome (one-tap). Advances the queue + propagates opt-outs. */
export async function logProspectDisposition(
  queueItemId: string,
  outcome: string,
  extra?: { notes?: string; nextAction?: string },
): Promise<void> {
  const res = await fetch(WORKER_URL + '/prospect/disposition', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await token()) },
    body: JSON.stringify({ queueItemId, outcome, ...extra }),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? 'Could not save outcome');
}
