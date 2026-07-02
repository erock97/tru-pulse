// TRU Rep — the Live Sim. Browser voice calls against an AI buyer (Retell web
// calls), graded server-side against the ALMS rubric (Claude). The agent talks;
// the persona is injected per-call via Retell dynamic variables.
import type { Env } from './env.js';
import type { Db } from './db.js';

const RETELL = 'https://api.retellai.com';

// ── The buyer personas — each maps to a motivation type taught in Module 3 ──
export interface Persona {
  key: string;
  name: string;
  label: string;
  blurb: string;       // what the agent sees on the scenario card
  prompt: string;      // the buyer's system prompt (Retell dynamic variable)
}

export const PERSONAS: Persona[] = [
  {
    key: 'first_timer',
    name: 'Maya',
    label: 'The first-time buyer',
    blurb: 'Just asked about a 3-bed on Sycamore. Warm, chatty, a little nervous — big life reason for the move.',
    prompt: `You are Maya Torres, 29, a first-time homebuyer. You just clicked "contact agent" on a 3-bed house on Sycamore Lane on Zillow, and this agent is calling you back within minutes. You are on the phone with them now.

Your situation (reveal naturally, never as a list): you and your husband Dan rent an apartment in Riverside; you just found out you're having twins, so the apartment is suddenly too small; you want to be moved in before the babies come — about five months out. You liked Sycamore for the backyard. You also half-remember a house on Kessler Ave you saved.

How to behave: friendly, a little nervous, chatty when you feel heard. If the agent asks an open question about why you're looking or what's going on, share the twins news warmly. If they respond to the twins with real human warmth, you relax and get noticeably more cooperative. If they ignore it or jump to business, get slightly shorter with them.

Appointment behavior: if they offer a vague "sometime," deflect ("we're pretty busy…"). If they offer a concrete either/or with two specific times, hesitate once ("let me think — Dan works Thursdays…") then accept one.

Guardrails: if they ask about your financing, pre-approval, credit, or whether you have another agent this early, get uncomfortable and pull back ("oh — we're not really there yet…"). Never volunteer everything at once; make them earn it with good questions. Speak in short, natural phone sentences — this is a spoken conversation, not an essay. Never break character, never mention being an AI.`,
  },
  {
    key: 'relocator',
    name: 'David',
    label: 'The relocating family',
    blurb: 'Moving from out of state for a job that starts soon. Efficient, on a clock, zero patience for fluff.',
    prompt: `You are David Chen, 41, relocating from Denver for a job that starts in six weeks. You inquired about a 4-bed near the Maple Grove school district on Zillow and this agent is calling you back. You are on the phone now.

Your situation (reveal only when asked good questions): wife, two kids (9 and 12), schools matter most; you're flying in for ONE weekend in two weeks and need to see as many homes as possible; company gives a relocation stipend; your Denver house is already under contract.

How to behave: polite but brisk and time-boxed — you respect competence and speed. If the agent is organized (offers to line up multiple homes, mentions a plan for your visit weekend), warm up noticeably. If they're vague or slow, say you have another call soon.

Appointment behavior: you WANT an appointment — but only commit if they propose something concrete. The perfect offer is a plan for your visit weekend. Accept a concrete either/or immediately.

Guardrails: if they ask about financing or "do you have an agent," say flatly "I'm talking to a few people" and get cooler. Short spoken sentences. Never break character, never mention being an AI.`,
  },
  {
    key: 'investor',
    name: 'Rhonda',
    label: 'The investor',
    blurb: 'Asked about a duplex. Wants numbers, not narratives. Tests whether you can skip the backyard poetry.',
    prompt: `You are Rhonda Pierce, 55, a small-scale real estate investor. You inquired about a duplex on 8th Street on Zillow. You are on the phone with the agent now.

Your situation (reveal when asked): you own two rentals already; you buy for cash flow; you care about rents, taxes, roof age, and days on market; you'd expand to anything within 20 minutes of downtown if the numbers work; you can move fast — cash-adjacent financing.

How to behave: dry, direct, mildly testing. If the agent talks about "charming kitchens" or lifestyle, cut in: "What do the units rent for?" If they engage on numbers competently (or honestly say they'll pull the data and name WHEN you'll have it), you respect that and open up.

Appointment behavior: you'll meet to walk the property if they offer a concrete time AND promise the rent roll / numbers at the meeting. Vague follow-up offers get "just email me."

Guardrails: questions about YOUR finances are fine — you answer investors-style. But if they sound like they're reading a script, call it out ("you sound like you're reading something"). Short spoken sentences. Never break character, never mention being an AI.`,
  },
  {
    key: 'early_browser',
    name: 'Sam',
    label: 'The “just looking” browser',
    blurb: 'Clicked a listing at lunch. “Super early, just curious.” The test: do you serve them or dismiss them?',
    prompt: `You are Sam Whitaker, 33, renting, casually browsing Zillow on your lunch break. You clicked "contact agent" on a bungalow mostly out of curiosity. Now an agent is calling and you feel slightly sheepish about it.

Your situation (buried — only surfaces if they make you comfortable): your lease renews in four months and rent is jumping $300; your girlfriend just moved in; you've never talked to a lender and assume you can't afford to buy — but you actually might. The truth is you're closer to buying than you think, and part of you knows it.

How to behave: open with an apology-ish deflection: "oh — honestly we're just looking, it's super early." If the agent pushes for commitment or acts salesy, politely end the call within a couple more exchanges. If they make it zero-pressure and useful (offer a casual look at a couple homes "just to calibrate," or ask a genuinely curious question), you engage more and the lease detail can slip out.

Appointment behavior: you will NOT book a formal consult. You WILL accept a casual, zero-pressure look ("sure, Saturday could work I guess") if it's framed as no-commitment calibration with a concrete time.

Guardrails: any money/pre-approval question this early makes you laugh nervously and retreat ("yeah we're nowhere near that"). Short spoken sentences. Never break character, never mention being an AI.`,
  },
];

export function personaByKey(key: string): Persona | undefined {
  return PERSONAS.find((p) => p.key === key);
}

// ── One Retell agent per persona, each with its own voice ───────────────────
// Voice casting: preferred ids first, then any voice matching the gender.
const PERSONA_VOICES: Record<string, { prefs: string[]; gender: string }> = {
  first_timer: { prefs: ['11labs-Chloe', '11labs-Anna'], gender: 'female' },              // Maya, 29
  relocator: { prefs: ['11labs-Adrian', '11labs-Brian', '11labs-Anthony'], gender: 'male' }, // David, 41
  investor: { prefs: ['11labs-Dorothy', '11labs-Kate', '11labs-Amy'], gender: 'female' },   // Rhonda, 55
  early_browser: { prefs: ['11labs-Billy', '11labs-Anthony', '11labs-Adrian'], gender: 'male' }, // Sam, 33
};

const AGENT_PREFIX = 'TRU Rep — ';
const VOICE_SPEED = 0.9;        // Eric: default was too fast
const RESPONSIVENESS = 0.65;    // wait a natural beat before speaking

interface RetellAgent { agent_id: string; agent_name?: string; response_engine?: { llm_id?: string } }

async function retell(env: Env, path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${RETELL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.RETELL_API_KEY}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`retell ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

/** Create/update the four persona agents (voice cast + speed + patience). */
export async function setupPersonaAgents(env: Env): Promise<Record<string, { agent_id: string; voice_id: string }>> {
  const [voices, agents] = await Promise.all([
    retell(env, '/list-voices') as Promise<Array<{ voice_id: string; gender?: string; provider?: string }>>,
    retell(env, '/list-agents') as Promise<RetellAgent[]>,
  ]);
  // Reuse the shared {{persona_prompt}} LLM from the original agent.
  const base = agents.find((a) => a.agent_id === env.RETELL_AGENT_ID) ?? agents[0];
  const llmId = base?.response_engine?.llm_id;
  if (!llmId) throw new Error('base practice LLM not found — run setup_practice_agent.mjs first');

  const pickVoice = (key: string): string => {
    const want = PERSONA_VOICES[key];
    const hit = want.prefs.find((v) => voices.some((x) => x.voice_id === v));
    if (hit) return hit;
    const byGender = voices.find((v) => v.provider === 'elevenlabs' && (v.gender ?? '').toLowerCase() === want.gender)
      ?? voices.find((v) => (v.gender ?? '').toLowerCase() === want.gender);
    return byGender?.voice_id ?? voices[0].voice_id;
  };

  const out: Record<string, { agent_id: string; voice_id: string }> = {};
  for (const p of PERSONAS) {
    const name = AGENT_PREFIX + p.name;
    const voice_id = pickVoice(p.key);
    const settings = {
      voice_id, voice_speed: VOICE_SPEED, responsiveness: RESPONSIVENESS,
      enable_backchannel: true, interruption_sensitivity: 0.9,
      end_call_after_silence_ms: 20000, max_call_duration_ms: 600000,
    };
    const existing = agents.find((a) => a.agent_name === name);
    if (existing) {
      await retell(env, `/update-agent/${existing.agent_id}`, { method: 'PATCH', body: JSON.stringify(settings) });
      out[p.key] = { agent_id: existing.agent_id, voice_id };
    } else {
      const created = await retell(env, '/create-agent', {
        method: 'POST',
        body: JSON.stringify({ agent_name: name, language: 'en-US', response_engine: { type: 'retell-llm', llm_id: llmId }, ...settings }),
      });
      out[p.key] = { agent_id: created.agent_id, voice_id };
    }
  }
  return out;
}

// Persona → agent id, resolved by name and cached for the isolate's lifetime.
const agentCache = new Map<string, string>();
export async function agentIdForPersona(env: Env, persona: Persona): Promise<string> {
  const cached = agentCache.get(persona.key);
  if (cached) return cached;
  const agents = (await retell(env, '/list-agents')) as RetellAgent[];
  const hit = agents.find((a) => a.agent_name === AGENT_PREFIX + persona.name);
  const id = hit?.agent_id ?? (env.RETELL_AGENT_ID as string);
  agentCache.set(persona.key, id);
  return id;
}

// ── Retell: create a browser (web) call with the persona's own agent ────────
export async function createWebCall(env: Env, persona: Persona): Promise<{ callId: string; accessToken: string }> {
  const agentId = await agentIdForPersona(env, persona);
  const res = await fetch(`${RETELL}/v2/create-web-call`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RETELL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent_id: agentId,
      retell_llm_dynamic_variables: { persona_prompt: persona.prompt, persona_name: persona.name },
    }),
  });
  if (!res.ok) throw new Error(`retell create-web-call ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { call_id: string; access_token: string };
  return { callId: j.call_id, accessToken: j.access_token };
}

export async function getCall(env: Env, callId: string): Promise<{ transcript: string | null; durationS: number | null; status: string }> {
  const res = await fetch(`${RETELL}/v2/get-call/${callId}`, {
    headers: { Authorization: `Bearer ${env.RETELL_API_KEY}` },
  });
  if (!res.ok) throw new Error(`retell get-call ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { transcript?: string; call_status?: string; start_timestamp?: number; end_timestamp?: number };
  const durationS = j.start_timestamp && j.end_timestamp ? Math.round((j.end_timestamp - j.start_timestamp) / 1000) : null;
  return { transcript: j.transcript ?? null, durationS, status: j.call_status ?? 'unknown' };
}

// ── Grading: the ALMS rubric, applied by Claude to the transcript ───────────
export interface GradeBreakdown {
  a: { score: number; note: string };
  l: { score: number; note: string };
  m: { score: number; note: string };
  s: { score: number; note: string };
  flags: string[];
  best_moment: string;
  coach_note: string;
}

const GRADER_SYSTEM = `You grade real-estate agents' practice calls against the ALMS framework. You are strict but fair — a veteran coach, not a cheerleader. Output ONLY valid JSON.`;

function graderPrompt(personaLabel: string, transcript: string): string {
  return `Below is a transcript of a PRACTICE call. "Agent" is the human being graded; "User"/"${personaLabel}" lines are the AI buyer.

Grade the agent 0–25 on each ALMS beat:
- A (Appointment): did they go for a concrete appointment with an either/or of two specific times? Assumed the showing was happening? 25 = booked with either/or; ~15 = asked but vague; ≤5 = never asked.
- L (Location): did they widen from the one listing to the whole search ("what else would you like to see?") and map the move (own/rent, sell first, areas)?
- M (Motivation): did they ask an open "why now?" question, listen, and give a genuine beat of empathy when something personal surfaced?
- S (Summarize): did they play the plan back before ending — needs + timeline + the booked next step?

FLAGS (each is an automatic serious deduction, list any that occurred): asked about financing/pre-approval/credit on this first call; asked "do you already have an agent?"; interrogated with rapid-fire qualification; ended with no next step; talked over/ignored something personal the buyer shared.

Return ONLY this JSON shape:
{"a":{"score":0-25,"note":"one sentence"},"l":{"score":0-25,"note":"one sentence"},"m":{"score":0-25,"note":"one sentence"},"s":{"score":0-25,"note":"one sentence"},"flags":["..."],"best_moment":"short quote of their best line","coach_note":"2-3 sentences of direct coaching, addressed to the agent as 'you'"}

TRANSCRIPT:
${transcript}`;
}

export async function gradeTranscript(env: Env, personaLabel: string, transcript: string): Promise<{ score: number; breakdown: GradeBreakdown }> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY as string,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      system: [{ type: 'text', text: GRADER_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: graderPrompt(personaLabel, transcript) }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  const text = j.content.find((c) => c.type === 'text')?.text ?? '';
  const jsonText = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  const b = JSON.parse(jsonText) as GradeBreakdown;
  const raw = (b.a.score + b.l.score + b.m.score + b.s.score);
  const penalty = Math.min(30, (b.flags?.length ?? 0) * 10);
  const score = Math.max(0, raw - penalty);
  return { score, breakdown: b };
}

// ── The route handlers (wired in index.ts) ──────────────────────────────────
export function simConfigured(env: Env): boolean {
  return !!(env.RETELL_API_KEY && env.RETELL_AGENT_ID && env.ANTHROPIC_API_KEY);
}

export async function agentFromAuth(database: Db, userId: string): Promise<{ id: string; org_id: string } | null> {
  const rows = await database.select('agents', `auth_id=eq.${userId}&select=id,org_id`);
  return (rows[0] as { id: string; org_id: string }) ?? null;
}
