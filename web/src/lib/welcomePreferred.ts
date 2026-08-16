import type { CourseQuestion, LessonCard } from './api';

/** Screen count shown on the learn card (`≈ N min · N screens · 7-question quiz`). */
export const WELCOME_PREFERRED_SCREEN_COUNT = 14;

/**
 * Welcome to Preferred (Module 1) lesson screens.
 * Keep in sync with the first MODULES entry in `db/rep_curriculum.mjs`.
 * Do not run that seed against a live project from this change.
 */
export const WELCOME_PREFERRED_CARDS: LessonCard[] = [
  {
    t: 'intro',
    title: 'A welcome from your team leader',
    body: 'From the person who built this team — why you’re here, and what the standard looks like.',
  },
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
];

/** Quiz prompts/choices only — the answer key stays in the demo grader closure. */
export const WELCOME_PREFERRED_QS: CourseQuestion[] = [
  { id: 'w1', idx: 1, prompt: 'Your minimum Pickup Rate as a Preferred agent is…', choices: ['10%', '25% — answer the initial call and accept the lead', '60%', 'There is no individual bar'] },
  { id: 'w2', idx: 2, prompt: 'The PCVR standard is…', choices: ['1% or higher', '25% or higher', '4% or higher', '50% or higher'] },
  { id: 'w3', idx: 3, prompt: 'Of the buyers you move to Met With, what share must reach pre-approval?', choices: ['None — pre-approval is the lender’s job', 'At least 10%', 'All of them', '4%'] },
  { id: 'w4', idx: 4, prompt: 'You just finished a first real conversation with a connection. The stage becomes…', choices: ['Met With', 'Spoke With', 'Appointment Set', 'Showing Homes'] },
  { id: 'w5', idx: 5, prompt: 'Deals must be logged in…', choices: ['A spreadsheet', 'Zillow’s portal', 'Follow Up Boss', 'Email to your leader'] },
  { id: 'w6', idx: 6, prompt: 'A buyer you’re actively touring homes with sits in…', choices: ['Met With', 'Under Contract', 'Showing Homes', 'Spoke With'] },
  { id: 'w7', idx: 7, prompt: 'A seller just signed with you. Their stage is…', choices: ['Listing Agreement', 'Sales Closed', 'Spoke With', 'Appointment Set'] },
];

export function welcomePreferredCopy(): string {
  return JSON.stringify({ cards: WELCOME_PREFERRED_CARDS, qs: WELCOME_PREFERRED_QS });
}
