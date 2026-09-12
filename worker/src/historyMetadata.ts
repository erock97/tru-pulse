import type {Db} from './db.js';
type Snapshot={orgId:string;teamId?:string;[key:string]:unknown};
/** Called only after the authenticated membership check in /data/history. */
export async function readHistoryVersion(database:Db,orgId:string,legacy:Snapshot|null){
 const accounts=await database.select('history_accounts',`org_id=eq.${orgId}&select=account_id,team_id,org_id`);
 if(accounts.some(a=>a.org_id!==orgId))throw Error('History account scope mismatch');
 if(accounts.length!==1)return {snapshot:legacy,version:null,coverage:{state:accounts.length?'unresolved_multiple_teams':'unresolved_account',complete:false}};
 const account=accounts[0];
 if(legacy?.teamId&&legacy.teamId!==account.team_id)throw Error('Legacy history scope mismatch');
 const jobs=await database.select('history_jobs',`account_id=eq.${account.account_id}&select=id,from_at,cutoff,source_policy,state,census_complete,expected_people,unresolved_people,profile_dispositions&order=created_at.desc&limit=1`);
 const publications=await database.select('history_publications',`team_id=eq.${account.team_id}&select=id,version_id,previous_version_id,published_at&order=id.desc&limit=1`);
 let snapshot=legacy,publishedJobId:string|null=null;
 const publication=publications[0];
 if(publication){
  if(!/^[a-f0-9]{64}$/.test(publication.version_id))throw Error('Invalid history version');
  const versions=await database.select('history_snapshot_versions',`version_id=eq.${publication.version_id}&team_id=eq.${account.team_id}&org_id=eq.${orgId}&select=org_id,team_id,job_id,snapshot`);
  const version=versions[0];
  if(!version||version.org_id!==orgId||version.team_id!==account.team_id||version.snapshot?.orgId!==orgId||version.snapshot?.teamId!==account.team_id)throw Error('History version scope mismatch');
  snapshot=version.snapshot;
  publishedJobId=version.job_id;
 }
 return {snapshot,version:publication??null,coverage:jobs[0]?{...jobs[0],complete:jobs[0].id===publishedJobId&&jobs[0].state==='published'&&jobs[0].unresolved_people===0}:{state:legacy?'legacy_snapshot_only':'not_started',complete:false}};
}
