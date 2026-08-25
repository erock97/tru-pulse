// Turning the analysis's shorthand into something a broker can act on.
//
// The coaching points arrive as internal labels — "Same-day text on every
// no-answer", "Call first on late leads", "Review the short callback calls".
// Read cold by somebody who was not in the analysis they produce one reaction:
// I don't know what that means.
//
// Three things have to happen, and they are one job rather than three, because
// each needs the same context:
//
//   1. SAY IT PLAINLY, WITH THE PROOF. The first attempt rewrote from the label
//      alone and it showed — "Texts late leads instead of calling them" left a
//      broker asking what a late lead is, because nothing in the label said and
//      the model was guessing at its own input. With the quotes in hand it can
//      say which, and it can back a strong claim: "makes the buyer chase her for
//      updates" is worth sending only when it can add that the buyer texted
//      three times before a reply. A claim a broker cannot check is a claim
//      they should not repeat to an agent.
//
//   2. MERGE WHAT IS ONE CONVERSATION. One agent came back with "opens calls
//      talking about being away", "calls end right after hello", and "gets past
//      the greeting but never books a time" as three separate items. That is one
//      conversation, and left alone she takes three of the four slots in her own
//      team's brief. Word overlap cannot see it — the phrasings share almost
//      nothing — so the judgement goes where the reading already is.
//
//   3. DROP WHAT IS AIMED AT THE COACH. "Review the short callback calls" is an
//      instruction to whoever is doing the analysis, not an observation about
//      the agent. True, and useless in a brief telling a broker who to talk to.
//
// Raw fetch rather than the SDK, matching worker/src/practice.ts: this Worker
// carries no runtime dependencies and adding one for a single call would be out
// of step with everything around it.

import type { Env } from '../env.js';

const API = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-5';

export interface IssueToExplain {
  id: string;
  agentName: string;
  title: string;
  buyers: string[];
  evidence: Array<{ lead: string | null; quote: string; channel: string | null }>;
}

export interface IssueGroup {
  /** Every issue folded into this one. First is kept; the rest point at it. */
  ids: string[];
  /** One sentence, naming the behaviour and the proof. */
  plain: string;
  /** Aimed at the coach rather than the agent — keep it, never show it. */
  coachFacing: boolean;
}

export function canExplain(env: Env): boolean {
  return !!env.ANTHROPIC_API_KEY;
}

const SYSTEM = `You prepare a real estate broker's morning brief.

You get coaching observations about ONE agent, written as internal labels, each
with the buyers involved and quotes from the actual calls and messages.

Do three things.

1. GROUP. Some items are the same conversation described differently. Group
   those. Items about genuinely different habits stay separate. When unsure,
   keep them separate - merging two real problems into one hides one of them.

2. JUDGE WHO IT IS ABOUT. An item telling the COACH to do something - "review
   these calls", "check the recordings", "look at what happened" - is aimed at
   the analyst, not the agent. Mark it coachFacing. An item describing what the
   AGENT did or failed to do is not coachFacing, however it is worded.

3. WRITE ONE SENTENCE per group, for the broker.
   - Say what the agent is DOING. Not what to call it, not what to do about it.
   - Where the quotes support it, add the observable proof after a comma:
     "makes the buyer chase her for updates, they texted three times before a
     reply". Only when the quotes actually show it. Never invent a number.
   - If a label is vague, the quotes decide what it means. "Late leads" might be
     leads contacted long after they arrived, or leads contacted late at night -
     read the evidence and say which. If the evidence does not settle it, write
     the safer, narrower claim.
   - Under 130 characters. Third person, no name, no trailing period.
   - Plain words. No "cadence", "touchpoints", "leverage", "engagement".

Reply as JSON only, no prose:
{"groups":[{"ids":["<id>","<id>"],"plain":"...","coachFacing":false}]}
Every id you were given must appear in exactly one group.`;

function buildInput(issues: IssueToExplain[]): string {
  return issues.map((i) => {
    const ev = i.evidence.slice(0, 4)
      .map((e) => `      - ${e.lead ?? 'a buyer'}${e.channel ? ` (${e.channel})` : ''}: "${e.quote}"`)
      .join('\n');
    return `  id: ${i.id}\n  label: "${i.title}"\n  buyers (${i.buyers.length}): `
      + `${i.buyers.slice(0, 6).join(', ') || 'unknown'}\n`
      + (ev ? `    evidence:\n${ev}` : '    evidence: none recorded');
  }).join('\n\n');
}

/**
 * Analyse one agent's issues together.
 *
 * Per agent rather than per team, because grouping is only ever a question
 * about one person's habits — and a prompt carrying forty agents at once would
 * both cost more and invite cross-agent merges that make no sense.
 *
 * Returns nothing on failure. A failure here must never cost the brief: the
 * caller keeps the original label, which reads worse but is not wrong.
 */
export async function analyseAgentIssues(
  env: Env,
  agentName: string,
  issues: IssueToExplain[],
): Promise<IssueGroup[]> {
  if (!canExplain(env) || issues.length === 0) return [];

  const res = await fetch(API, {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY as string,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      output_config: { effort: 'medium' },
      messages: [{
        role: 'user',
        content: `Agent: ${agentName}\n\n${buildInput(issues)}`,
      }],
    }),
  });

  if (!res.ok) return [];
  const body = (await res.json().catch(() => null)) as any;
  const text: string = (body?.content ?? [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n');

  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return [];
  let parsed: any;
  try { parsed = JSON.parse(match[0]); } catch { return []; }

  const known = new Set(issues.map((i) => i.id));
  const seen = new Set<string>();
  const groups: IssueGroup[] = [];
  for (const g of parsed?.groups ?? []) {
    // Only ids we actually sent, and only once each. A reply that invents an id
    // or double-assigns one is malformed, and quietly dropping the bad part
    // beats writing a merge nobody asked for.
    const ids = (Array.isArray(g?.ids) ? g.ids : [])
      .map(String)
      .filter((id: string) => known.has(id) && !seen.has(id));
    if (!ids.length) continue;
    const plain = String(g?.plain ?? '').replace(/^["']|["'.]+$/g, '').trim();
    if (!plain) continue;
    ids.forEach((id: string) => seen.add(id));
    groups.push({ ids, plain: plain.slice(0, 160), coachFacing: !!g?.coachFacing });
  }
  return groups;
}
