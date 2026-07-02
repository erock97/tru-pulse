// AI dossier — the per-lead "reason to call" opener, channel-aware (circle /
// expired / fsbo). ONE batched Claude call for the whole dialable list (cheap,
// fast), matching the Anthropic pattern in practice.ts. Compliance-aware: warm,
// honest, never pushy, never steering by any protected class.

import type { Env } from '../env.js';

export type DossierChannel = 'circle' | 'expired' | 'fsbo';

export interface DossierNeighbor {
  id: string; // the call_queue row id (what we write the opener back onto)
  name: string | null;
  address: string | null;
  equityPct?: number | null;
  tenureYears?: number | null;
  // Listing context (expired / fsbo)
  daysOnMarket?: number | null;
  listPrice?: number | null;
  listingStatus?: string | null;
}

const COMPLIANCE = `- Warm, conversational, first person, spoken — one line, not a paragraph, not a pitch.
- NEVER reference how you got their number or their info; never imply urgency or pressure.
- NEVER use language that steers by or references any protected class (family status, religion, race, national origin, disability, etc.). Keep it about the home and the market only.`;

const SYSTEMS: Record<DossierChannel, string> = {
  circle: `You write short, warm, compliant phone openers for a real estate agent doing neighborhood "circle prospecting" after a nearby sale. Natural and human, never salesy. Output ONLY valid JSON.`,
  expired: `You write short, warm, EMPATHETIC phone openers for a real estate agent reaching out to owners whose home listing just expired unsold. Lead with empathy (their home didn't sell), never blame, never gloat. You are a helpful professional, not a vulture. Output ONLY valid JSON.`,
  fsbo: `You write short, warm, VALUE-FIRST phone openers for a real estate agent reaching out to for-sale-by-owner sellers. FSBO owners are wary of agents, so lead with genuine value (a buyer, a free net-sheet), never a hard listing pitch. Respectful and low-pressure. Output ONLY valid JSON.`,
};

function line(n: DossierNeighbor, channel: DossierChannel): string {
  const money = (v?: number | null) => (v ? `$${Math.round(v / 1000)}k` : null);
  const bits: string[] = [];
  if (channel !== 'circle') {
    if (n.listPrice) bits.push(`listed ~${money(n.listPrice)}`);
    if (n.daysOnMarket != null) bits.push(`${n.daysOnMarket} days on market`);
  }
  const ctx = bits.length ? ` (${bits.join(', ')})` : '';
  return `- id:${n.id} | ${n.name ?? 'Owner'}${n.address ? ` at ${n.address}` : ''}${ctx}`;
}

const GOAL: Record<DossierChannel, string> = {
  circle: `Lead with the nearby sale as the genuine reason for the call ("I just helped sell a home a few doors down…"), then end with a soft, low-pressure question about whether they've thought about a move.`,
  expired: `Open with empathy that their home came off the market unsold, position yourself as someone who does things differently, and end with a soft question about whether they still hope to sell / would consider a fresh approach. Do NOT promise a price.`,
  fsbo: `Open by acknowledging they're selling on their own and respecting that, lead with a concrete value offer (a possible buyer, a free net-sheet/pricing check), and end with a soft question about whether they'd welcome that help — NOT a listing pitch.`,
};

function prompt(subject: string, neighbors: DossierNeighbor[], channel: DossierChannel): string {
  const list = neighbors.map((n) => line(n, channel)).join('\n');
  return `Context for the agent: "${subject}".

For EACH lead below, write ONE opening line (max ~28 words) the agent can say when the person answers the phone. Rules:
- ${GOAL[channel]}
${COMPLIANCE}

Leads:
${list}

Return ONLY a JSON array, one object per lead, exactly:
[{"id":"<the id>","opener":"<the line>"}]`;
}

/**
 * Generate openers for a batch of leads on a channel. Returns Map<queueRowId,opener>.
 * Never throws — dossiers are a nicety; a campaign must still produce its call list.
 */
export async function generateOpeners(
  env: Env,
  subject: string,
  neighbors: DossierNeighbor[],
  channel: DossierChannel = 'circle',
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!env.ANTHROPIC_API_KEY || neighbors.length === 0) return out;
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
        max_tokens: Math.min(4000, 300 + neighbors.length * 70),
        system: [{ type: 'text', text: SYSTEMS[channel], cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: prompt(subject, neighbors, channel) }],
      }),
    });
    if (!res.ok) return out;
    const j = (await res.json()) as { content: Array<{ type: string; text?: string }> };
    const text = j.content.find((c) => c.type === 'text')?.text ?? '';
    const arr = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1)) as Array<{ id: string; opener: string }>;
    for (const item of arr) {
      if (item?.id && typeof item.opener === 'string') out.set(item.id, item.opener.trim());
    }
  } catch {
    // Swallow — the call list is already built; openers just stay empty.
  }
  return out;
}
