/** Content-free source evidence. Storage only: the Worker remains the calculation owner. */
export interface ResponseTiming {
  schemaVersion: '1.0';
  collectedAt: string;
  eligibility: 'complete' | 'partial' | 'unknown';
  episodes: TimingEpisode[];
}
export interface TimingEpisode {
  id: string;
  leadId: string;
  leadName: string;
  /** FUB user ID, not a TRU agent UUID. Scoped to the enclosing report's team. */
  sourceAgentId: string | null;
  assignment: null | { sourceEventId: string; at: string; endedAt: string | null };
  history: 'complete' | 'partial' | 'unknown';
  observedThrough: string;
  events: TimingEvent[];
}
export interface TimingEvent {
  id: string;
  sourceEventId: string | null;
  transport: 'call' | 'fub_sms' | 'zillow_message' | 'unknown';
  senderId: string | null;
  direction: 'outbound' | 'inbound' | 'unknown';
  automation: 'personal' | 'automated' | 'unknown';
  delivery: 'sent' | 'delivered' | 'read' | 'failed' | 'queued' | 'unknown';
  at: string | null;
  timestampBasis: 'sent_at' | 'call_started_at' | 'visible_datetime' | 'record_created_at' | 'unknown';
}

type Obj = Record<string, unknown>;
const object = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v);
const instant = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)) return false;
  const date = v.slice(0, 10);
  const [hour, minute, second] = v.slice(11, 19).split(':').map(Number);
  return hour < 24 && minute < 60 && second < 60 && Number.isFinite(Date.parse(v)) && new Date(date).toISOString().slice(0, 10) === date;
};
const exact = (o: Obj, keys: string[]) => Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o, k));
const oneOf = (v: unknown, values: string[]) => typeof v === 'string' && values.includes(v);

/** Reject rather than truncate: partial evidence must never masquerade as complete. */
export function validateResponseTiming(value: unknown):
  { ok: true; value: ResponseTiming } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const fail = (path: string) => { if (errors.length < 20) errors.push(`responseTiming.${path} is invalid`); };
  if (!object(value) || !exact(value, ['schemaVersion', 'collectedAt', 'eligibility', 'episodes'])) {
    return { ok: false, errors: ['responseTiming must contain only the versioned evidence fields'] };
  }
  if (value.schemaVersion !== '1.0') fail('schemaVersion');
  if (!instant(value.collectedAt)) fail('collectedAt');
  if (!oneOf(value.eligibility, ['complete', 'partial', 'unknown'])) fail('eligibility');
  if (!Array.isArray(value.episodes) || value.episodes.length > 2000) {
    fail('episodes'); return { ok: false, errors };
  }
  const episodeIds = new Set<string>();
  let eventCount = 0;
  for (const [i, ep] of value.episodes.entries()) {
    const p = `episodes[${i}]`;
    if (!object(ep) || !exact(ep, ['id', 'leadId', 'leadName', 'sourceAgentId', 'assignment', 'history', 'observedThrough', 'events'])) { fail(p); continue; }
    if (!identifier(ep.id) || episodeIds.has(ep.id)) fail(`${p}.id`);
    else episodeIds.add(ep.id);
    if (!identifier(ep.leadId)) fail(`${p}.leadId`);
    if (typeof ep.leadName !== 'string' || !ep.leadName.trim() || ep.leadName.length > 200 || /[\x00-\x1f\x7f-\x9f]/.test(ep.leadName)) fail(`${p}.leadName`);
    if (ep.sourceAgentId !== null && !identifier(ep.sourceAgentId)) fail(`${p}.sourceAgentId`);
    if (!oneOf(ep.history, ['complete', 'partial', 'unknown'])) fail(`${p}.history`);
    if (!instant(ep.observedThrough) || (instant(value.collectedAt) && Date.parse(ep.observedThrough) > Date.parse(value.collectedAt))) fail(`${p}.observedThrough`);
    if (ep.assignment !== null) {
      const a = ep.assignment;
      if (!object(a) || !exact(a, ['sourceEventId', 'at', 'endedAt']) || !identifier(a.sourceEventId) || !instant(a.at)
        || !identifier(ep.sourceAgentId) || (a.endedAt !== null && (!instant(a.endedAt) || Date.parse(a.endedAt) <= Date.parse(a.at)
          || (instant(ep.observedThrough) && Date.parse(a.endedAt) > Date.parse(ep.observedThrough))))
        || (instant(ep.observedThrough) && Date.parse(a.at as string) > Date.parse(ep.observedThrough))) fail(`${p}.assignment`);
    }
    if (!Array.isArray(ep.events) || ep.events.length > 1000) { fail(`${p}.events`); continue; }
    eventCount += ep.events.length;
    if (eventCount > 10000) { fail('events exceeds 10000'); break; }
    const ids = new Set<string>();
    const sourceIds = new Set<string>();
    for (const [j, event] of ep.events.entries()) {
      const q = `${p}.events[${j}]`;
      if (!object(event) || !exact(event, ['id', 'sourceEventId', 'transport', 'senderId', 'direction', 'automation', 'delivery', 'at', 'timestampBasis'])) { fail(q); continue; }
      if (!identifier(event.id) || ids.has(event.id)) fail(`${q}.id`); else ids.add(event.id);
      if (event.sourceEventId !== null && !identifier(event.sourceEventId)) fail(`${q}.sourceEventId`);
      if (identifier(event.sourceEventId)) {
        const key = `${event.transport}:${event.sourceEventId}`;
        if (sourceIds.has(key)) fail(`${q}.duplicateSource`); else sourceIds.add(key);
      }
      if (!oneOf(event.transport, ['call', 'fub_sms', 'zillow_message', 'unknown'])) fail(`${q}.transport`);
      if (event.senderId !== null && !identifier(event.senderId)) fail(`${q}.senderId`);
      if (!oneOf(event.direction, ['outbound', 'inbound', 'unknown'])) fail(`${q}.direction`);
      if (!oneOf(event.automation, ['personal', 'automated', 'unknown'])) fail(`${q}.automation`);
      if (!oneOf(event.delivery, ['sent', 'delivered', 'read', 'failed', 'queued', 'unknown'])) fail(`${q}.delivery`);
      if (!oneOf(event.timestampBasis, ['sent_at', 'call_started_at', 'visible_datetime', 'record_created_at', 'unknown'])) fail(`${q}.timestampBasis`);
      if (event.at === null ? event.timestampBasis !== 'unknown' : !instant(event.at)
        || (instant(ep.observedThrough) && Date.parse(event.at) > Date.parse(ep.observedThrough))) fail(`${q}.at`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: structuredClone(value) as unknown as ResponseTiming };
}
