import type { PipelineLead } from './pipeline';

export const PROGRESSION = [
  ['lead', 'Lead received'], ['attempted', 'Attempted contact'],
  ['spoke', 'Spoke with customer'], ['appointment', 'Appointment set'],
  ['met', 'Met with customer'], ['showing', 'Showing homes'],
  ['offer', 'Submitting offers'], ['uc', 'Under contract'], ['closed', 'Closed'],
] as const;
export interface ProgressEvent {
  team_id: string; person_id: number; from_stage: string | null; to_stage: string;
  occurred_at: string | null; upstream_id: string; upstream_kind: string;
}
export interface ProgressProof {
  basis: string; source: string; eventId: string | null;
  // An exit proves prior occupancy, not the original achievement date.
  at: string | null;
}
export interface ProgressRow {
  key: string; label: string; count: number; percent: number | null; leadKeys: string[];
}
const names: string[][] = [
  ['lead', 'new', 'new lead', 'uncontacted'],
  ['attempted', 'attempted contact', 'attempting contact'],
  ['spoke', 'spoke with customer', 'contacted'], ['appointment', 'appointment set'],
  ['met', 'met with', 'met with customer'], ['showing', 'showing homes'],
  ['offer', 'offers', 'submitting offers', 'offer submitted'],
  ['uc', 'under contract', 'pending', 'escrow'], ['closed', 'sale closed'],
];
export function progressionRank(stage: string | null | undefined) {
  const normalized = (stage || '').trim().replace(/\s+/g, ' ').toLowerCase();
  return names.findIndex(aliases => aliases.includes(normalized));
}
/** Eric's progression rule: later steps include all preceding steps, once per lead.
 * Nurture/rejected are dispositions, never ranks or a reason to remove progress. */
export function progressForLead(lead: PipelineLead, events: ProgressEvent[], now: number, currentCategory?: string) {
  const proof: Record<string, ProgressProof> = {};
  const grant = (stage: string | null | undefined, source: string, at: string | null, eventId: string | null) => {
    const rank = progressionRank(stage);
    for (const [key] of PROGRESSION.slice(0, rank + 1)) {
      const old = proof[key];
      if (!old || at && (!old.at || Date.parse(at) < Date.parse(old.at))) {
        proof[key] = { basis: stage!, source, at, eventId };
      }
    }
  };
  const knownDate = (date: string | null | undefined) => date && Number.isFinite(Date.parse(date)) && Date.parse(date) <= now ? date : null;
  grant('lead', 'received', knownDate(lead.fub_created), null);
  grant(lead.stage, lead.historicalOnly ? 'historical snapshot' : 'current stage', null, null);
  if (progressionRank(lead.stage) < 0 && ['under_contract', 'closed'].includes(currentCategory || '')) {
    grant(currentCategory === 'closed' ? 'closed' : 'uc', 'team reporting mapping', null, null);
  }
  for (const [stage, saved] of Object.entries(lead.history || {})) {
    if (!saved || saved.date && Date.parse(saved.date) > now) continue;
    grant(stage, 'historical backfill', knownDate(saved.date), saved.eventId || null);
  }
  for (const event of events) {
    if (event.team_id !== lead.team_id || event.person_id !== lead.fub_person_id) continue;
    if (event.occurred_at && (!Number.isFinite(Date.parse(event.occurred_at)) || Date.parse(event.occurred_at) > now)) continue;
    grant(event.from_stage, event.upstream_kind, null, event.upstream_id);
    grant(event.to_stage, event.upstream_kind, knownDate(event.occurred_at), event.upstream_id);
  }
  return proof;
}
