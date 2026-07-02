// Social Studio — AI content generation. Two Claude calls, both best-effort
// (never throw): derive an agent's voice/tone from past posts, then generate a
// full content calendar in ONE batched call (the efficiency multiplier — a
// 10hr/week grind compressed to a single generate-and-review sitting).

import type { Env } from '../env.js';

export interface BrandKit {
  brokerageName?: string;
  licenseNumber?: string;
  disclosureText?: string;
  colors?: string[];
}

const PILLAR_MIX = [
  { pillar: 'market', share: '~40%', desc: 'local/market authority — market updates, neighborhood spotlights, "is now a good time"' },
  { pillar: 'listing', share: '~25%', desc: "listings, just-listed/just-sold, coming-soon" },
  { pillar: 'social_proof', share: '~15%', desc: 'testimonials, closing-day moments, client wins' },
  { pillar: 'personality', share: '~10%', desc: 'behind-the-scenes, personality, day-in-the-life' },
  { pillar: 'education', share: '~10%', desc: 'buyer/seller process education, FAQ' },
] as const;

async function anthropic(env: Env, system: string, userPrompt: string, maxTokens: number): Promise<string | null> {
  if (!env.ANTHROPIC_API_KEY) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: maxTokens,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { content: Array<{ type: string; text?: string }> };
    return j.content.find((c) => c.type === 'text')?.text ?? null;
  } catch {
    return null;
  }
}

const TONE_SYSTEM = `You analyze a real estate agent's past social captions and describe their voice/tone in 2-3 sentences so another writer could imitate it convincingly. Focus on: sentence rhythm, formality, humor, emoji use, recurring phrases. Output ONLY the description, no preamble.`;

/** Derive a tone summary from an agent's past posts. Falls back to a neutral tone. */
export async function deriveVoiceTone(env: Env, samplePosts: string[]): Promise<string> {
  const FALLBACK = 'Warm, professional, and approachable — clear sentences, no jargon, a genuine local-expert tone.';
  if (samplePosts.length < 2) return FALLBACK;
  const prompt = `Past captions:\n${samplePosts.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\nDescribe this agent's voice.`;
  const text = await anthropic(env, TONE_SYSTEM, prompt, 300);
  return text?.trim() || FALLBACK;
}

export interface GeneratedPost {
  dayOffset: number; // 0..days-1, the caller maps this to a calendar date
  pillar: string;
  format: string;
  hook: string;
  caption: string;
  script: string | null;
}

const CALENDAR_SYSTEM = `You are a social media strategist for a real estate agent. You write a full month of post ideas — hooks, captions, and short video scripts where useful — that sound like a specific person, not a generic template pack. Output ONLY valid JSON.`;

function calendarPrompt(focus: string, tone: string, audience: string | null, days: number): string {
  const mix = PILLAR_MIX.map((p) => `${p.pillar} (${p.share}): ${p.desc}`).join('; ');
  return `Agent's voice: ${tone}
${audience ? `Target audience: ${audience}` : ''}
What's going on right now (use as real material, don't force it into every post): "${focus}"

Generate a ${days}-day content calendar. Content-pillar mix to follow loosely: ${mix}.

For each post:
- dayOffset: integer 0 to ${days - 1} (spread posts across the range; not every day needs one — aim for ~3-4/week of substantial posts plus lighter days)
- pillar: one of market | listing | social_proof | personality | education
- format: one of reel | carousel | story | graphic | email
- hook: the first line / on-screen text (max ~15 words, must earn attention in 1-2 seconds)
- caption: the full caption (2-5 sentences, in the agent's voice, natural line breaks with \\n where helpful)
- script: for reel/story formats, a short spoken script (2-4 sentences); null for graphic/carousel/email

Rules: never use discriminatory or steering language (no reference to family status, religion, race, national origin, disability, or "safe neighborhood" type coded language) — keep everything about the home, the market, and the service. Never fabricate a specific sold price, address, or client name unless it was given to you in "what's going on right now."

Return ONLY a JSON array of post objects, exactly:
[{"dayOffset":0,"pillar":"...","format":"...","hook":"...","caption":"...","script":"..."|null}]`;
}

/**
 * Generate a batch of posts for a content calendar. Returns [] (never throws) if
 * the key is missing, the call fails, or parsing fails — the caller decides how
 * to surface "nothing generated" to the agent.
 */
export async function generateCalendar(
  env: Env,
  input: { focus: string; tone: string; audience: string | null; days: number },
): Promise<GeneratedPost[]> {
  const text = await anthropic(
    env,
    CALENDAR_SYSTEM,
    calendarPrompt(input.focus, input.tone, input.audience, input.days),
    Math.min(8000, 400 + input.days * 180),
  );
  if (!text) return [];
  try {
    const arr = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)) as GeneratedPost[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
