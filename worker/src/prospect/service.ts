// TRU Prospect service layer — orchestrates a Circle campaign run and disposition
// logging over the pure pipeline + Supabase store. Called by the Worker routes.
import type { Env } from '../env.js';
import type { Db } from '../db.js';
import { buildCircleCampaign } from './circle.js';
import type { CircleSummary } from './circle.js';
import type { ProspectGateConfig } from './gate.js';
import { prospectProviders } from './providers.js';
import { supabaseProspectStore } from './store.js';
import { generateOpeners, type DossierNeighbor, type DossierChannel } from './dossier.js';
import { buildOutboundCampaign, type OutboundChannel } from './circle.js';
import { fakeExpiredListings, fakeFsboListings } from './providers.js';
import { importEncKey, decryptKey } from '../crypto.js';
import { fubCreatePerson, fubAddNote, fubAddTask } from '../fub.js';

// After the queue is built, generate a per-neighbor "reason to call" opener in ONE
// batched Claude call and store it on each dialable row. Best-effort: any failure
// leaves openers empty — the call list itself is unaffected. Returns the count.
//
// Cross-campaign dedup: before calling Claude, check whether this org already has a
// recent (30d) opener for the same person from a DIFFERENT campaign and reuse it
// verbatim — overlapping circles otherwise re-dossier the same neighbors for free.
async function attachDossiers(env: Env, database: Db, orgId: string, campaignId: string, subject: string, channel: DossierChannel = 'circle'): Promise<number> {
  const rows = await database.select(
    'prospect_call_queue',
    `campaign_id=eq.${campaignId}&state=in.(queued,manual)&select=id,person_id`,
  );
  if (!rows.length) return 0;
  const personIds = [...new Set(rows.map((r: any) => r.person_id))];

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const recent = await database.select(
    'prospect_call_queue',
    `org_id=eq.${orgId}&campaign_id=neq.${campaignId}&person_id=in.(${personIds.join(',')})&dossier=not.is.null&updated_at=gte.${cutoff}&select=person_id,dossier,updated_at&order=updated_at.desc`,
  );
  const reusableByPerson = new Map<string, string>();
  for (const r of recent as any[]) {
    const opener = r.dossier?.opener;
    if (opener && !reusableByPerson.has(r.person_id)) reusableByPerson.set(r.person_id, opener);
  }

  const reusableRows = (rows as any[]).filter((r) => reusableByPerson.has(r.person_id));
  const freshRows = (rows as any[]).filter((r) => !reusableByPerson.has(r.person_id));

  let count = 0;
  for (const r of reusableRows) {
    await database.update('prospect_call_queue', `id=eq.${r.id}`, {
      dossier: { opener: reusableByPerson.get(r.person_id), reused: true },
      updated_at: new Date().toISOString(),
    });
    count++;
  }
  if (!freshRows.length) return count;

  const personIdsFresh = [...new Set(freshRows.map((r: any) => r.person_id))];
  const people = await database.select('prospect_people', `id=in.(${personIdsFresh.join(',')})&select=id,full_name,property_id`);
  const propIds = [...new Set((people as any[]).map((p) => p.property_id).filter(Boolean))];
  const props = propIds.length
    ? await database.select('prospect_properties', `id=in.(${propIds.join(',')})&select=id,address_line1,equity_pct,tenure_years,list_price,days_on_market,listing_status`)
    : [];
  const personById = new Map((people as any[]).map((p) => [p.id, p]));
  const propById = new Map((props as any[]).map((p) => [p.id, p]));

  const neighbors: DossierNeighbor[] = freshRows.map((r) => {
    const person = personById.get(r.person_id);
    const prop = person?.property_id ? propById.get(person.property_id) : null;
    return {
      id: r.id,
      name: person?.full_name ?? null,
      address: prop?.address_line1 ?? null,
      equityPct: prop?.equity_pct ?? null,
      tenureYears: prop?.tenure_years ?? null,
      daysOnMarket: prop?.days_on_market ?? null,
      listPrice: prop?.list_price ?? null,
      listingStatus: prop?.listing_status ?? null,
    };
  });

  const openers = await generateOpeners(env, subject, neighbors, channel);
  for (const [queueId, opener] of openers) {
    await database.update('prospect_call_queue', `id=eq.${queueId}`, { dossier: { opener }, updated_at: new Date().toISOString() });
  }
  return count + openers.size;
}

async function loadGateConfig(database: Db, orgId: string): Promise<ProspectGateConfig> {
  const rows = await database.select('prospect_settings', `org_id=eq.${orgId}&select=*`);
  const s = rows[0] as Record<string, any> | undefined;
  return {
    orgId,
    quietStartHour: s?.quiet_start_hour ?? 8,
    quietEndHour: s?.quiet_end_hour ?? 21,
    defaultTimezone: s?.default_timezone ?? 'America/Los_Angeles',
    maxAttempts: s?.max_attempts ?? 6,
    dncPolicy: s?.dnc_policy ?? { circle: 'block', expired: 'manual', fsbo: 'manual' },
    recordingConsentRequired: s?.recording_consent_required ?? false,
  };
}

export interface RunCircleInput {
  orgId: string;
  teamId?: string | null;
  agentId?: string | null;
  name?: string;
  center: { latitude: number; longitude: number };
  radiusMeters?: number;
  limit?: number;
}

export async function runCircleCampaign(
  env: Env,
  database: Db,
  input: RunCircleInput,
): Promise<{ campaignId: string; summary: CircleSummary; providersLive: boolean; dossiers: number }> {
  const config = await loadGateConfig(database, input.orgId);
  // Circle people need a team_id so a warm disposition can find that team's FUB
  // key for writeback. Default to the org's first active team when unspecified.
  let teamId = input.teamId ?? null;
  if (!teamId) {
    const teams = await database.select('teams', `org_id=eq.${input.orgId}&is_active=eq.true&select=id&limit=1`);
    teamId = (teams[0]?.id as string) ?? null;
  }
  const campaign = await database.insert('prospect_campaigns', {
    org_id: input.orgId,
    team_id: teamId,
    created_by_agent: input.agentId ?? null,
    channel: 'circle',
    name: input.name ?? 'Circle campaign',
    config: { radius_m: input.radiusMeters ?? 500, center: input.center },
  });
  const providers = prospectProviders(env);
  const store = supabaseProspectStore(env);
  const summary = await buildCircleCampaign(
    { neighborSource: providers.neighborSource, skipTracer: providers.skipTracer, dncScrubber: providers.dncScrubber, store },
    {
      orgId: input.orgId,
      teamId,
      campaignId: campaign.id,
      center: input.center,
      radiusMeters: input.radiusMeters ?? 500,
      limit: input.limit ?? 50,
      agentId: input.agentId ?? undefined,
    },
    config,
    new Date(),
  );
  // Best-effort AI openers for the dialable rows (never fails the run).
  let dossiers = 0;
  try {
    dossiers = await attachDossiers(env, database, input.orgId, campaign.id, input.name ?? 'A nearby home just sold');
  } catch {
    dossiers = 0;
  }
  return { campaignId: campaign.id, summary, providersLive: providers.live, dossiers };
}

type ListingChannel = Exclude<OutboundChannel, 'circle'>; // 'expired' | 'fsbo'

export interface RunOutboundInput {
  orgId: string;
  teamId?: string | null;
  agentId?: string | null;
  channel: ListingChannel;
  name?: string;
  limit?: number;
  // Farm radius (miles) the operator pulled from. The demo feed is already sized
  // by `limit`; this is captured on the campaign so the real MLS/feed adapter can
  // geo-filter to this radius when providers go live.
  radiusMiles?: number;
}

const OUTBOUND_SUBJECT: Record<ListingChannel, string> = {
  expired: 'Reaching out to homeowners whose listing just expired unsold — a fresh, no-pressure approach.',
  fsbo: 'Reaching out to for-sale-by-owner sellers with genuine value first (a possible buyer or a free pricing check).',
};

/**
 * Expired / FSBO campaigns: pull today's listings (stubbed feed), then run the
 * SAME buildOutboundCampaign pipeline as circle — only the lead source + script
 * differ. DNC posture for these channels defaults to 'manual' (see gate config).
 */
export async function runOutboundCampaign(
  env: Env,
  database: Db,
  input: RunOutboundInput,
): Promise<{ campaignId: string; summary: CircleSummary; providersLive: boolean; dossiers: number }> {
  const config = await loadGateConfig(database, input.orgId);
  let teamId = input.teamId ?? null;
  if (!teamId) {
    const teams = await database.select('teams', `org_id=eq.${input.orgId}&is_active=eq.true&select=id&limit=1`);
    teamId = (teams[0]?.id as string) ?? null;
  }
  const limit = input.limit ?? 25;
  const records = input.channel === 'expired' ? fakeExpiredListings(limit) : fakeFsboListings(limit);

  const campaign = await database.insert('prospect_campaigns', {
    org_id: input.orgId,
    team_id: teamId,
    created_by_agent: input.agentId ?? null,
    channel: input.channel,
    name: input.name ?? (input.channel === 'expired' ? 'Expired listings' : 'FSBO listings'),
    config: { limit, radius_mi: input.radiusMiles ?? null },
  });

  const providers = prospectProviders(env);
  const store = supabaseProspectStore(env);
  const summary = await buildOutboundCampaign(
    { skipTracer: providers.skipTracer, dncScrubber: providers.dncScrubber, store },
    { orgId: input.orgId, teamId, campaignId: campaign.id, channel: input.channel, agentId: input.agentId ?? undefined, records },
    config,
    new Date(),
  );

  let dossiers = 0;
  try {
    dossiers = await attachDossiers(env, database, input.orgId, campaign.id, input.name ?? OUTBOUND_SUBJECT[input.channel], input.channel);
  } catch {
    dossiers = 0;
  }

  return { campaignId: campaign.id, summary, providersLive: providers.live, dossiers };
}

export interface DispositionInput {
  orgId: string;
  agentId?: string | null;
  queueItemId: string;
  outcome: string;
  notes?: string;
  nextAction?: string;
  nextActionAt?: string;
}

// Outcomes worth pushing into FUB as a real lead (warm). Cold/negative outcomes
// (no answer, bad number, not interested, opt-out) stay out of the CRM.
const WARM_OUTCOMES = new Set(['appointment', 'contact_interested', 'contact_not_ready', 'callback']);
const OUTCOME_TAG: Record<string, string> = {
  appointment: 'Appointment Set',
  contact_interested: 'Interested',
  contact_not_ready: 'Nurture',
  callback: 'Callback',
};

export async function logDisposition(
  env: Env,
  database: Db,
  input: DispositionInput,
): Promise<{ ok: true; dispositionId: string; fubSynced: boolean }> {
  const q = await database.select(
    'prospect_call_queue',
    `id=eq.${input.queueItemId}&org_id=eq.${input.orgId}&select=id,person_id`,
  );
  if (!q.length) throw new Error('queue item not found');
  const personId = q[0].person_id as string;
  const now = new Date().toISOString();

  const disp = await database.insert('prospect_dispositions', {
    org_id: input.orgId,
    person_id: personId,
    queue_item_id: input.queueItemId,
    agent_id: input.agentId ?? null,
    outcome: input.outcome,
    notes: input.notes ?? null,
    next_action: input.nextAction ?? null,
  });

  const state = input.outcome === 'opt_out' ? 'suppressed' : 'completed';
  await database.update('prospect_call_queue', `id=eq.${input.queueItemId}`, {
    state, last_attempt_at: now, updated_at: now,
  });

  const prows = await database.select(
    'prospect_people',
    `id=eq.${personId}&select=team_id,full_name,best_phone_e164,fub_person_id`,
  );
  const person = prows[0] as
    | { team_id: string | null; full_name: string | null; best_phone_e164: string | null; fub_person_id: number | null }
    | undefined;

  // A verbal opt-out is permanent and cross-channel — record it so the gate
  // suppresses this person everywhere from now on.
  if (input.outcome === 'opt_out') {
    await database.insert('prospect_opt_outs', {
      org_id: input.orgId, person_id: personId, phone_e164: person?.best_phone_e164 ?? null,
      channel: 'any', method: 'verbal_on_call', source: 'disposition',
    });
  }

  await database.insert('prospect_audit', {
    org_id: input.orgId, person_id: personId, event_type: 'disposition',
    payload: { outcome: input.outcome, queueItemId: input.queueItemId },
  });

  // Warm outcome → push the neighbor into Follow Up Boss as a lead (best-effort;
  // a FUB failure never fails the disposition).
  let fubSynced = false;
  if (WARM_OUTCOMES.has(input.outcome) && person?.team_id) {
    try {
      fubSynced = await pushDispositionToFub(env, database, personId, person, input);
    } catch {
      fubSynced = false;
    }
  }
  return { ok: true, dispositionId: disp.id, fubSynced };
}

async function pushDispositionToFub(
  env: Env,
  database: Db,
  personId: string,
  person: { team_id: string | null; full_name: string | null; best_phone_e164: string | null; fub_person_id: number | null },
  input: DispositionInput,
): Promise<boolean> {
  const secret = await database.select('team_secrets', `team_id=eq.${person.team_id}&select=fub_key_enc`);
  if (!secret.length) return false;
  const key = await decryptKey(await importEncKey(env.FUB_ENC_KEY), secret[0].fub_key_enc);

  let fubId = person.fub_person_id ? Number(person.fub_person_id) : null;
  if (!fubId) {
    fubId = await fubCreatePerson(
      key,
      {
        name: person.full_name,
        phone: person.best_phone_e164,
        source: 'TRU Prospect — Circle',
        tags: ['TRU Prospect', 'Circle Prospect', OUTCOME_TAG[input.outcome] ?? 'Interested'],
      },
      env.FUB_SYSTEM_KEY,
    );
    if (!fubId) return false;
    await database.update('prospect_people', `id=eq.${personId}`, { fub_person_id: fubId, updated_at: new Date().toISOString() });
  }

  const note = `TRU Prospect (Circle) — outcome: ${input.outcome}${input.notes ? `\n${input.notes}` : ''}`;
  await fubAddNote(key, fubId, note);
  if (input.outcome === 'appointment' || input.nextAction === 'call' || input.nextAction === 'text') {
    await fubAddTask(key, fubId, { description: `Follow up — TRU Prospect (${input.outcome})`, dueDate: input.nextActionAt });
  }

  await database.update('prospect_dispositions', `queue_item_id=eq.${input.queueItemId}`, { fub_synced_at: new Date().toISOString() });
  return true;
}
