import {it,expect,vi} from 'vitest';
import {readHistoryVersion} from './historyMetadata.js';
const org='org',team='team',legacy={orgId:org,teamId:team,leads:[]};
it('returns incomplete coverage metadata without replacing the legacy snapshot',async()=>{
 const select=vi.fn(async(table:string)=>table==='history_accounts'?[{account_id:1,team_id:team,org_id:org}]:table==='history_jobs'?[{state:'partial',unresolved_people:5}]:[]);
 const result=await readHistoryVersion({select} as any,org,legacy);expect(result.snapshot).toBe(legacy);expect(result.coverage.complete).toBe(false);expect(select.mock.calls.every(([,q]:any)=>typeof q==='string')).toBe(true);
});
it('rejects a foreign immutable snapshot even if the pointer exists',async()=>{
 const select=vi.fn(async(table:string)=>table==='history_accounts'?[{account_id:1,team_id:team,org_id:org}]:table==='history_publications'?[{version_id:'a'.repeat(64)}]:table==='history_snapshot_versions'?[{org_id:'foreign',team_id:team,snapshot:legacy}]:[]);
 await expect(readHistoryVersion({select} as any,org,legacy)).rejects.toThrow('scope mismatch');
});
it('returns the promoted immutable snapshot with its receipt',async()=>{
 const snapshot={...legacy,through:'2026-09-12T03:00:00Z'};
 const select=vi.fn(async(table:string)=>table==='history_accounts'?[{account_id:1,team_id:team,org_id:org}]:table==='history_publications'?[{version_id:'a'.repeat(64)}]:table==='history_snapshot_versions'?[{org_id:org,team_id:team,job_id:'job',snapshot}]:[{id:'job',state:'published',unresolved_people:0}]);
 const result=await readHistoryVersion({select} as any,org,legacy);expect(result.snapshot).toEqual(snapshot);expect(result.coverage.complete).toBe(true);
});
