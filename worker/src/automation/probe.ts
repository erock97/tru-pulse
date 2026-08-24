/**
 * Read-only diagnostic: what does Follow Up Boss actually tell us about a lead's
 * calls and texts?
 *
 * Written to settle one question that decides the whole speed-to-lead rule. FUB
 * auto-sends a text the instant a lead arrives, and the rule must not count that
 * as an agent having made contact. Both this repo and the puller had it recorded
 * that a text message carries only id, personId, isIncoming, created and
 * message — no sender, no user, nothing marking it automated — which would have
 * forced us to infer "automated" from the text landing within seconds and then
 * backtest that guess.
 *
 * That record was wrong, and running this is how we found out. A text carries 24
 * fields, and the automated ones are marked outright:
 *
 *   leadFlowRouteId  set on the auto-response, null on anything a person sent.
 *                    THE discriminator. Verified across two teams with different
 *                    route ids (Costigan 8; Signature 47 and 59), and the split
 *                    is absolute — every flagged text landed in 1-2 seconds,
 *                    every unflagged one at 11 minutes or later.
 *   actionPlanId     0 throughout the sample, but modelled, so an action-plan
 *                    text elsewhere would be marked here rather than by timing.
 *   userId/userName  who FUB attributes the message to.
 *
 * So the detector is a lookup, not a guess. Keep this route: the same question
 * will come up for every new integration, and the answer is per-account.
 *
 * It also settled a second thing, less happily. `message` and `recordingUrl`
 * both come back as "* hidden for privacy reasons *", on both teams, and they
 * stay hidden when the request carries the registered-integration headers
 * (?asSystem=1). Unmasking them is a permission FUB grants an integration, not
 * something a parameter unlocks — which means transcribing calls in the
 * background is blocked until that conversation happens, and matching an
 * automated text by its wording was never possible at all.
 *
 * Returns the RAW, unmodelled payloads plus the union of keys across every
 * record. The union is the point: a field that is null on one record and set on
 * another is still a field we can use.
 */
import type { Db } from '../db.js';
import type { Env } from '../env.js';
import { fubGet } from '../fub.js';
import { importEncKey, decryptKey } from '../crypto.js';

/** Every key seen across a set of records, with how often it was non-null. */
function keyReport(records: any[]): Array<{ key: string; present: number; sample: unknown }> {
  const seen = new Map<string, { present: number; sample: unknown }>();
  for (const r of records) {
    if (!r || typeof r !== 'object') continue;
    for (const [k, v] of Object.entries(r)) {
      const cur = seen.get(k) ?? { present: 0, sample: null };
      // A key that is null everywhere is still worth reporting — its existence
      // tells us FUB models it, which is a different fact from its absence.
      if (v !== null && v !== undefined) {
        cur.present += 1;
        if (cur.sample === null) cur.sample = typeof v === 'object' ? JSON.stringify(v).slice(0, 120) : v;
      }
      seen.set(k, cur);
    }
  }
  return [...seen.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.present - a.present || a.key.localeCompare(b.key));
}

const secondsBetween = (a: unknown, b: unknown): number | null => {
  const ta = Date.parse(String(a ?? ''));
  const tb = Date.parse(String(b ?? ''));
  return Number.isFinite(ta) && Number.isFinite(tb) ? Math.round((ta - tb) / 1000) : null;
};

export interface ProbeOpts {
  teamId: string;
  /** Probe these people specifically. Otherwise the newest tracked leads. */
  personIds?: number[];
  /** How many recent leads to walk when no ids are given. */
  limit?: number;
  /**
   * Send the registered-integration headers on the activity reads.
   *
   * FUB masks message bodies and call recording URLs by default — both come
   * back as "* hidden for privacy reasons *". If that masking lifts for a
   * recognised system, then transcribing calls in the background is possible
   * and the agent can answer "what did they say on that call". If it does not,
   * that whole capability is off the table and it is better to know now.
   */
  asSystem?: boolean;
}

export async function probeActivity(env: Env, database: Db, opts: ProbeOpts) {
  const secret = await database.select('team_secrets', `team_id=eq.${opts.teamId}&select=fub_key_enc`);
  if (!secret.length) return { error: 'no FUB key for team' as const };
  const fubKey = await decryptKey(await importEncKey(env.FUB_ENC_KEY), (secret[0] as any).fub_key_enc);

  let people: any[];
  if (opts.personIds?.length) {
    const got = await Promise.all(
      opts.personIds.map(async (id) => (await fubGet(fubKey, `/people/${id}`)).body),
    );
    people = got.filter(Boolean);
  } else {
    const r = await fubGet(fubKey, '/people', { limit: Math.min(opts.limit ?? 12, 25), sort: '-created' });
    people = r.body?.people ?? [];
  }

  const allTexts: any[] = [];
  const allCalls: any[] = [];
  const leads: any[] = [];

  for (const p of people) {
    const sysHeaders: Record<string, string> = opts.asSystem && env.FUB_SYSTEM_KEY
      ? { 'X-System': env.FUB_SYSTEM_NAME || 'TruPulse', 'X-System-Key': env.FUB_SYSTEM_KEY }
      : {};
    const [t, c] = await Promise.all([
      fubGet(fubKey, '/textMessages', { personId: p.id, limit: 100 }, sysHeaders),
      fubGet(fubKey, '/calls', { personId: p.id, limit: 100 }, sysHeaders),
    ]);
    const texts: any[] = t.body?.textmessages ?? t.body?.textMessages ?? [];
    const calls: any[] = c.body?.calls ?? [];
    allTexts.push(...texts);
    allCalls.push(...calls);

    const outbound = texts
      .filter((m) => m.isIncoming !== true)
      .sort((a, b) => Date.parse(a.created ?? '') - Date.parse(b.created ?? ''));

    leads.push({
      personId: p.id,
      // First name + last initial only. A diagnostic is still somewhere a
      // client's lead list can leak from.
      name: `${String(p.firstName ?? p.name ?? '').split(' ')[0]} ${String(p.lastName ?? '').slice(0, 1)}`.trim(),
      source: p.source ?? null,
      created: p.created ?? null,
      assignedTo: p.assignedTo ?? null,
      assignedUserId: p.assignedUserId ?? null,
      assignedPondId: p.assignedPondId ?? null,
      counts: { texts: texts.length, outbound: outbound.length, calls: calls.length },
      // THE number this probe exists for: how long after the lead arrived did
      // the first outbound text land? An action-plan text shows up in seconds.
      // A human one does not.
      firstOutboundTextAfterSec: outbound.length ? secondsBetween(outbound[0].created, p.created) : null,
      secondOutboundTextAfterSec: outbound.length > 1 ? secondsBetween(outbound[1].created, p.created) : null,
      firstCallAfterSec: calls.length
        ? secondsBetween(
            calls.map((x) => x.created).sort()[0],
            p.created,
          )
        : null,
      // Truncated so one chatty lead cannot dominate the response, and so a
      // full conversation never lands in a log.
      firstOutboundTextBody: outbound.length ? String(outbound[0].message ?? '').slice(0, 160) : null,
      rawFirstOutboundText: outbound.length ? outbound[0] : null,
    });
  }

  return {
    teamId: opts.teamId,
    leadsProbed: leads.length,
    // The answer to "is there a sender field on a text?" is this list.
    textKeys: keyReport(allTexts),
    callKeys: keyReport(allCalls),
    personKeys: keyReport(people),
    leads,
  };
}
