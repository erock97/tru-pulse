import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PROFILE as BASE_PROFILE, validateProfile } from '../../shared/agentProfile.js';
import { handlePersonalProfile } from './personalProfile.js';
import { handleDataRoutes } from './dataRoutes.js';
import { supabaseAsUser, type UserClient } from './asUser.js';
import type { Env } from './env.js';
vi.mock('./asUser.js', () => ({ supabaseAsUser: vi.fn() }));
const DEFAULT_PROFILE={...BASE_PROFILE,termsVersion:'2026-09-06'};
const values = new Map<string, unknown>();
const get = vi.fn(async (key: string) => values.get(key) ?? null);
const put = vi.fn(async (key: string, value: string) => { values.set(key, JSON.parse(value)); });
const remove = vi.fn(async(key:string)=>{values.delete(key);});
const select = vi.fn();
const client = { userId: 'owner-user', select } as unknown as UserClient;
const env = { SESSIONS: { get, put, delete:remove } } as unknown as Env;
const agent = { id: 'agent-1', org_id: 'org-1', team_id: 'team-1', fub_user_id: 17, name: 'Jordan Rivera' };
const call = (method = 'GET', body?: unknown, originOk = true) => handlePersonalProfile(new Request('https://api.truhq.co/data/personal-profile?userId=someone-else', { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env, client, {}, originOk);
beforeEach(() => { values.clear(); vi.clearAllMocks(); select.mockImplementation(async (table: string) => table === 'agents' ? [agent] : []); });
describe('profile validation', () => {
  it('keeps free text as text, with bounded lengths and a complete layout', () => { expect(validateProfile({ ...DEFAULT_PROFILE, bio: '  <script>hello</script>  ' }).bio).toBe('<script>hello</script>'); expect(() => validateProfile({ ...DEFAULT_PROFILE, bio: 'x'.repeat(1201) })).toThrow(); expect(() => validateProfile({ ...DEFAULT_PROFILE, sections: ['about', 'about', 'gallery', 'goals', 'interests'] })).toThrow(); });
  it.each(['https://example.com/track.jpg', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/jpeg;base64,YmFk'])('rejects unsafe or invalid images: %s', portrait => { expect(() => validateProfile({ ...DEFAULT_PROFILE, portrait })).toThrow(); });
  it('accepts a bounded PNG with a valid format header', () => { const portrait = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'; expect(validateProfile({ ...DEFAULT_PROFILE, portrait }).portrait).toBe(portrait); });
  it('rejects forged awards, identity fields and invalid theme values', () => { for (const extra of [{ badges: ['contract'] }, { userId: 'other' }, { theme: 'javascript:' }, { accent: 'red' }, { careerStart: '9999' }]) expect(() => validateProfile({ ...DEFAULT_PROFILE, ...extra })).toThrow(); });
});
describe('private personal profiles', () => {
  it('requires authentication before reaching private storage', async () => { vi.mocked(supabaseAsUser).mockResolvedValue(null); const url = new URL('https://api.truhq.co/data/personal-profile'); expect((await handleDataRoutes(new Request(url), env, url, {}))?.status).toBe(401); expect(get).not.toHaveBeenCalled(); });
  it('requires exactly one linked agent and fails closed on an identity lookup failure', async () => { select.mockResolvedValueOnce([]); expect((await call()).status).toBe(403); select.mockResolvedValueOnce([agent, agent]); expect((await call()).status).toBe(403); select.mockRejectedValueOnce(Error('offline')); expect((await call()).status).toBe(503); expect(get).not.toHaveBeenCalled(); });
  it('ignores the query owner and saves to the authenticated identity without a TTL', async () => { const response = await call('PUT', { ...DEFAULT_PROFILE, headline: 'My own words' }); expect(response.status).toBe(200); expect(select.mock.calls[0][1]).toContain('auth_id=eq.owner-user'); expect(put.mock.calls[0]).toHaveLength(2); expect(put.mock.calls[0][0]).toBe('agent-profile:v1:owner-user'); const read = await call(); expect((await read.json() as { profile: { headline: string } }).profile.headline).toBe('My own words'); expect(read.headers.get('Cache-Control')).toBe('private, no-store'); });
  it('rejects cross-origin writes, forged awards, unsupported verbs and oversized bodies', async () => { expect((await call('PUT', DEFAULT_PROFILE, false)).status).toBe(403); expect((await call('PUT', { ...DEFAULT_PROFILE, badges: [] })).status).toBe(400); expect((await call('PATCH')).status).toBe(405); expect((await call('PUT', { ...DEFAULT_PROFILE, bio: 'x'.repeat(2100001) })).status).toBe(413); expect(put).not.toHaveBeenCalled(); });
  it('reports failed saves instead of reporting success', async () => { put.mockRejectedValueOnce(Error('unavailable')); expect((await call('PUT', DEFAULT_PROFILE)).status).toBe(503); });
  it('awards verified passed assessments and keeps previous awards if records later disappear', async () => { select.mockImplementation(async (table: string) => table === 'agents' ? [agent] : table === 'rep_progress' ? [{ module_id: 'course-1', passed_at: '2026-01-01' }] : [{ id: 'course-1', title: 'Welcome to Preferred' }]); const first = await (await call()).json() as { badges: { id: string }[] }; expect(first.badges.map(b => b.id)).toEqual(['training:course-1']); expect(select.mock.calls.find(c => c[0] === 'rep_progress')?.[1]).toContain('agent_id=eq.agent-1&status=eq.passed'); select.mockImplementation(async (table: string) => table === 'agents' ? [agent] : []); const second = await (await call()).json() as { badges: { id: string }[] }; expect(second.badges).toEqual(first.badges); });
  it('counts distinct contract credits for the imported FUB identity and team, not matching names', async () => { const event = { team_id: 'team-1', fub_person_id: 1, agent_user_id: '17', stage_class: 'uc', changed_at: '2026-01-01' }; values.set('pulse-history:v1:org-1', { orgId: 'org-1', teamId: 'team-1', through: '2026-01-01', leads: Array.from({ length: 10 }, () => ({ assigned_to: agent.name, history: { uc: {} } })), stageLog: [event, { ...event, stage_class: 'closed' }, { ...event, fub_person_id: 2, agent_user_id: 99 }, { ...event, fub_person_id: 3, team_id: 'other' }, { ...event, fub_person_id: 4, changed_at: '2999-01-01' }] }); const result = await (await call()).json() as { badges: { id: string }[] }; expect(result.badges.map(b => b.id)).toEqual(['contracts:1']); });
  it('does not award from another organization or team', async () => { values.set('pulse-history:v1:org-1', { orgId: 'foreign', teamId: 'team-1', stageLog: [{ team_id: 'team-1', fub_person_id: 1, agent_user_id: 17, stage_class: 'uc', changed_at: '2026-01-01' }] }); expect((await (await call()).json() as { badges: unknown[] }).badges).toEqual([]); expect(put).not.toHaveBeenCalled(); });
  it('loads the profile even when accomplishment sources are unavailable', async () => { select.mockImplementation(async (table: string) => { if (table === 'agents') return [agent]; throw Error('offline'); }); const response = await call(); expect(response.status).toBe(200); expect((await response.json() as { badgeNotice: string }).badgeNotice).toContain('could not be checked'); });
});

describe('profile deletion and privacy choices',()=>{
 it('deletes only the authenticated user’s profile keys and does not require an active team',async()=>{
  values.set('agent-profile:v1:owner-user',{profile:DEFAULT_PROFILE});values.set('agent-profile-badges:v1:owner-user',[{id:'earned'}]);values.set('agent-profile:v1:other-user',{profile:DEFAULT_PROFILE});
  select.mockRejectedValue(Error('unlinked'));
  expect((await call('DELETE')).status).toBe(200);
  expect(select).not.toHaveBeenCalled();
  expect(values.has('agent-profile:v1:owner-user')).toBe(false);expect(values.has('agent-profile-badges:v1:owner-user')).toBe(false);expect(values.has('agent-profile:v1:other-user')).toBe(true);
 });
 it('blocks cross-origin deletion before any storage operation',async()=>{expect((await call('DELETE',undefined,false)).status).toBe(403);expect(put).not.toHaveBeenCalled();expect(remove).not.toHaveBeenCalled();});
 it('does not recreate deleted profiles or badge copies on a later read',async()=>{await call('DELETE');const result=await(await call()).json() as {deleted:boolean;badges:unknown[];updatedAt:unknown};expect(result.deleted).toBe(true);expect(result.badges).toEqual([]);expect(result.updatedAt).toBeNull();expect(select.mock.calls.filter(c=>c[0]==='rep_progress')).toHaveLength(0);});
 it('reports a partial deletion failure and permits a retry',async()=>{remove.mockRejectedValueOnce(Error('offline'));expect((await call('DELETE')).status).toBe(503);expect((await call('DELETE')).status).toBe(200);});
 it('requires the current upload agreement and records acceptance on a new save',async()=>{expect((await call('PUT',BASE_PROFILE)).status).toBe(400);expect(put).not.toHaveBeenCalled();const response=await call('PUT',DEFAULT_PROFILE);expect(response.status).toBe(200);expect((values.get('agent-profile:v1:owner-user') as {termsAcceptedAt:string}).termsAcceptedAt).toBeTruthy();});
 it('reads old profiles with safe customization defaults without accepting terms for the user',()=>{const {sectionTitles,coverPosition,portraitPosition,layout,termsVersion,...old}=BASE_PROFILE;const migrated=validateProfile(old);expect(migrated.layout).toBe('story');expect(migrated.coverPosition).toBe(50);expect(migrated.sectionTitles).toEqual({});expect(migrated.termsVersion).toBe('');});
 it('rejects invalid layout, crop positions and unknown or oversized titles',()=>{for(const fields of [{layout:'unsafe'},{coverPosition:101},{portraitPosition:NaN},{sectionTitles:{script:'bad'}},{sectionTitles:{about:'x'.repeat(49)}}])expect(()=>validateProfile({...DEFAULT_PROFILE,...fields})).toThrow();});
});

it('does not persist a badge refresh when deletion is recorded during source lookups',async()=>{
 select.mockImplementation(async(table:string)=>{if(table==='agents')return[agent];if(table==='rep_progress')return[{module_id:'course',passed_at:'2026-01-01'}];values.set('agent-profile-deleted:v1:owner-user',{deletedAt:'2026-09-06'});return[{id:'course',title:'Course'}];});
 const result=await(await call()).json() as {deleted:boolean};expect(result.deleted).toBe(true);expect(put).not.toHaveBeenCalled();
});
