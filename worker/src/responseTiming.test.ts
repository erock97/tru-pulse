import { sha256 } from '../../shared/reportReceipt';
import { describe, it, expect, vi } from 'vitest';
import { validateResponseTiming, type ResponseTiming } from '../../shared/responseTiming.js';
import { validateCoachBrief } from '../../shared/coachBrief.js';
import { handleCoachBriefIngest } from './coachBriefIngest.js';
import type { Env } from './env.js';
import laptopReport from './responseTiming.synthetic.json';

function evidence(): ResponseTiming {
  return { schemaVersion: '1.0', collectedAt: '2026-09-07T10:00:00Z', eligibility: 'partial', episodes: [{
    id: 'episode-1', leadId: '123', leadName: 'Example Lead', sourceAgentId: '7', assignment: null,
    history: 'partial', observedThrough: '2026-09-07T09:59:00Z', events: [{
      id: 'event-1', sourceEventId: null, transport: 'zillow_message', senderId: null,
      direction: 'outbound', automation: 'unknown', delivery: 'unknown', at: '2026-09-06T18:01:00Z', timestampBasis: 'visible_datetime',
    }],
  }] };
}
const report = (responseTiming?: unknown, schemaVersion = '1.3') => ({
  schemaVersion, run: { runId: 'synthetic-run', trigger: 'personal', teamId: 'costigan', startDate: '2026-08-31', endDate: '2026-09-06' },
  agents: [], findings: [], ...(responseTiming === undefined ? {} : { responseTiming }),
});
describe('response timing evidence intake', () => {
  it('accepts the returned laptop synthetic report unchanged', () => {
    const result = validateCoachBrief(laptopReport);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.brief.responseTiming).toEqual(laptopReport.responseTiming);
  });
  it('retains unknown timestamp provenance and source precision without calculating a duration', () => {
    const input = evidence();
    input.episodes[0].events[0].at = '2026-09-06T18:01:00.123456Z';
    input.episodes[0].events[0].timestampBasis = 'unknown';
    const result = validateResponseTiming(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(input);
  });
  it('rejects rollover time and assignment endings after observation', () => {
    const input = evidence(); input.collectedAt = '2026-09-07T24:00:00Z';
    expect(validateResponseTiming(input).ok).toBe(false);
    input.collectedAt = '2026-09-07T10:00:00Z';
    input.episodes[0].assignment = { sourceEventId: 'assignment-1', at: '2026-09-06T18:00:00Z', endedAt: '2026-09-08T00:00:00Z' };
    expect(validateResponseTiming(input).ok).toBe(false);
  });
  it('preserves Zillow and unknown baseline without manufacturing a duration', () => {
    const input = evidence(); const result = validateCoachBrief(report(input));
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error('invalid');
    expect(result.brief.responseTiming).toEqual(input);
    expect(result.brief.responseTiming!.episodes[0]).not.toHaveProperty('responseSeconds');
    input.episodes[0].leadName = 'Changed';
    expect(result.brief.responseTiming!.episodes[0].leadName).toBe('Example Lead');
  });
  it.each(['1.0', '1.1', '1.2'])('preserves legacy %s reports', version => {
    expect(validateCoachBrief(report(undefined, version)).ok).toBe(true);
    expect(validateCoachBrief(report(evidence(), version)).ok).toBe(false);
  });
  it.each([
    ['computed summary', (x: any) => { x.summary = { average: 60 }; }],
    ['foreign tenant', (x: any) => { x.episodes[0].tenantId = 'other'; }],
    ['message body', (x: any) => { x.episodes[0].events[0].body = 'private'; }],
    ['duplicate episode', (x: any) => { x.episodes.push(structuredClone(x.episodes[0])); }],
    ['duplicate event', (x: any) => { x.episodes[0].events.push(structuredClone(x.episodes[0].events[0])); }],
    ['invalid date', (x: any) => { x.collectedAt = '2026-02-30T10:00:00Z'; }],
    ['missing timezone', (x: any) => { x.collectedAt = '2026-09-07T10:00:00'; }],
    ['future observation', (x: any) => { x.episodes[0].observedThrough = '2026-09-08T10:00:00Z'; }],
    ['unproven assignment', (x: any) => { x.episodes[0].assignment = { at: '2026-09-06T18:00:00Z', endedAt: null }; }],
    ['oversized batch', (x: any) => { x.episodes = Array(2001).fill(x.episodes[0]); }],
    ['duration assertion', (x: any) => { x.episodes[0].responseSeconds = 60; }],
  ])('rejects %s rather than silently dropping evidence', (_, mutate) => {
    const input = evidence(); mutate(input); expect(validateResponseTiming(input).ok).toBe(false);
  });
  it('requires a source agent and ordered boundaries for assignment evidence', () => {
    const input = evidence();
    input.episodes[0].assignment = { sourceEventId: 'assignment-1', at: '2026-09-06T18:00:00Z', endedAt: null };
    expect(validateResponseTiming(input).ok).toBe(true);
    input.episodes[0].sourceAgentId = null;
    expect(validateResponseTiming(input).ok).toBe(false);
  });
  it('stores timing through the immutable receipt RPC without activity reads', async () => {
    const teamId='11111111-1111-4111-8111-111111111111';
    const database = { select: vi.fn(async () => []), rpc: vi.fn(async () => ({replayed:false,receipt:{publicationStatus:'held'}})) };
    const input=evidence(); const body=report(input); body.run.teamId=teamId;
    const response=await handleCoachBriefIngest(new Request('https://offline.test/coach/weekly-report',{method:'POST',headers:{Authorization:'Bearer test'},body:JSON.stringify(body)}),{COACH_REPORT_CLIENTS:JSON.stringify([{id:'test',role:'producer',tokenHash:await sha256('test'),teamIds:[teamId]}])} as Env,new URL('https://offline.test/coach/weekly-report'),{},database as any);
    expect(response!.status).toBe(201);
    const call=database.rpc.mock.calls[0] as unknown as [string,any];
    expect(call[0]).toBe('coach_receipt_accept');
    expect(call[1]).toMatchObject({p_team:teamId,p_payload:{responseTiming:input}});
  });
});
