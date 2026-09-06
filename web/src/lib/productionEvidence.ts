import type { StageLogRow } from './api';
import { inPulsePeriod, type PulsePeriod } from './pulsePeriod';
export type Milestone = 'offer' | 'uc' | 'closed';
/** Count direct, dated milestone records; never gate by lead creation. */
export function productionEvidence(hits: StageLogRow[], period: PulsePeriod, now = new Date()) {
  const first = new Map<string, StageLogRow>();
  let excluded = 0;
  for (const hit of hits) {
    if (!['offer','uc','closed'].includes(hit.stage_class ?? '')) continue;
    if (!hit.team_id || !hit.changed_at || !Number.isFinite(Date.parse(hit.changed_at)) || hit.date_source === 'seed') { excluded++; continue; }
    const key = `${hit.team_id}:${hit.fub_person_id}:${hit.stage_class}`;
    const prior = first.get(key);
    if (!prior || Date.parse(hit.changed_at) < Date.parse(prior.changed_at!)) first.set(key,hit);
  }
  const records = [...first.values()].filter(h => inPulsePeriod(h.changed_at,period,now));
  return { records, excluded, counts: Object.fromEntries(['offer','uc','closed'].map(k => [k,records.filter(h=>h.stage_class===k).length])) as Record<Milestone,number> };
}
