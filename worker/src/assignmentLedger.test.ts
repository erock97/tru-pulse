import {it,expect} from 'vitest';
import {assignmentObservation as observe} from './assignmentLedger';
const person={id:1,name:'Lead',assignedUserId:7,assignedTo:'Agent',created:'2026-09-01T00:00:00Z',updated:'2026-09-07T00:00:00Z'};
it('captures first observation as a bounded interval rather than inventing an assignment date',()=>expect(observe(undefined,person,'2026-09-07T01:00:00Z')?.event).toMatchObject({from:person.created,through:'2026-09-07T01:00:00Z',agentId:'7'}));
it('does not count repeated webhooks or ordinary edits as new assignments',()=>{const initial=observe(undefined,person,'2026-09-07T01:00:00Z')!;expect(observe(initial.next,person,'2026-09-07T02:00:00Z')?.event).toBeNull();});
it('captures transfer to another agent and excludes pond ownership',()=>{const initial=observe(undefined,person,'2026-09-07T01:00:00Z')!;expect(observe(initial.next,{...person,assignedUserId:8},'2026-09-07T02:00:00Z')?.event?.agentId).toBe('8');expect(observe(initial.next,{...person,assignedPondId:2},'2026-09-07T02:00:00Z')?.event).toBeNull();});
it('rejects stale observations',()=>{const initial=observe(undefined,person,'2026-09-07T01:00:00Z')!;expect(observe(initial.next,{...person,updated:'2026-09-06T00:00:00Z'},'2026-09-07T02:00:00Z')).toBeNull();});
