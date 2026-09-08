import { ingestReportIssues, rebuildIssuesFromReports } from './automation/coachIssues';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { handleReportReceipts } from './reportReceipts';
import { canonicalJson, parseReceiptJson, sha256 } from '../../shared/reportReceipt';
import type { Env } from './env';
import type { Db } from './db';
const team='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
let pg:PGlite; let env:Env;
const fixture=(id:string,partial=false)=>({schemaVersion:'1.3',run:{runId:id,teamId:team,trigger:'daily',startDate:'2030-01-01',endDate:'2030-01-07',generatedAt:'2030-01-08T00:00:00Z'},agents:[],findings:[],coverage:{schemaVersion:'1.0',scope:'report_window',rosterComplete:!partial,contacts:[]}});
const rpc=async(name:string,args:Record<string,unknown>)=>{const values=Object.values(args);const q=await pg.query<any>(`select public.${name}(${Object.keys(args).map((k,i)=>`${k} => $${i+1}`).join(',')}) as result`,values);return q.rows[0].result;};
const database={rpc,select:async(table:string,query:string)=>{if(table==='teams'){const id=query.match(/id=eq\.([^&]+)/)![1];return (await pg.query('select id from teams where id=$1 and is_active',[id])).rows;}if(table==='agents')return [];throw Error('Unexpected read '+table)}} as unknown as Db;
const send=async(path:string,body?:unknown,token='producer',method=body===undefined?'GET':'POST')=>handleReportReceipts(new Request('https://offline.test'+path,{method,headers:{Authorization:'Bearer '+token},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})}),env,new URL('https://offline.test'+path),{},database) as Promise<Response>;
const accept=async(id:string,partial=false)=>{const res=await send('/coach/weekly-report',fixture(id,partial));expect(res.status).toBe(201);return (await res.json() as any).receipt;};
const control=(receipt:any,action:string,op:string,extras={})=>({operationId:op,action,teamId:team,runId:receipt.runId,expectedHash:receipt.payloadHash,expectedRevision:receipt.revision,reason:'Offline synthetic verification',...extras});
const op=async(command:any)=>{const r=await send('/coach/weekly-report/control',command,'operator');return {status:r.status,body:await r.json() as any}};
const lookup=async(run:string)=>rpc('coach_receipt_lookup',{p_team:team,p_run:run});
beforeAll(async()=>{
 pg=new PGlite();
 await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;create table orgs(id uuid primary key);create table teams(id uuid primary key,org_id uuid references orgs(id),is_active boolean default true);create table agents(id uuid primary key);insert into orgs values('${team}'),('${other}');insert into teams values('${team}','${team}',true),('${other}','${other}',true);`);
 const report=readFileSync(new URL('../../db/hq_coach_weekly_report.sql',import.meta.url),'utf8');
 await pg.exec(report.slice(report.indexOf('create table if not exists coach_weekly_reports'),report.indexOf('-- 2. RLS')));
 const patterns=readFileSync(new URL('../../db/hq_coach_patterns.sql',import.meta.url),'utf8');
 for(const name of ['coach_team_state','coach_patterns','coach_pattern_findings']){const start=patterns.indexOf('create table if not exists '+name+' (');const end=patterns.indexOf('\n);',start)+4;await pg.exec(patterns.slice(start,end));}
 await pg.exec(readFileSync(new URL('../../supabase/migrations/20260908181709_report_receipt_controls.sql',import.meta.url),'utf8'));
 env={COACH_REPORT_CLIENTS:JSON.stringify([{id:'hermes',role:'producer',tokenHash:await sha256('producer'),teamIds:[team]},{id:'eric',role:'operator',tokenHash:await sha256('operator'),teamIds:[team]}])} as Env;
},30000);
afterAll(async()=>pg?.close());

describe('canonical payload hash',()=>{
 it('has a stable known digest',async()=>expect(await sha256(canonicalJson({}))).toBe('44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'));
 it('ignores object key order and whitespace, not array order',()=>{expect(canonicalJson(parseReceiptJson('{ "b":2,"a":1}'))).toBe('{"a":1,"b":2}');expect(canonicalJson([1,2])).not.toBe(canonicalJson([2,1]));});
 it.each(['{"x":1,"x":2}','{"a":{"x":1,"\\u0078":2}}','{"x":"\\ud800"}','{"n":9007199254740992}','{"n":1e400}','{"x":1} trailing'])('rejects ambiguous/noncanonical input %s',s=>expect(()=>parseReceiptJson(s)).toThrow());
 it('supports multibyte strings without Unicode normalization',()=>{expect(canonicalJson({x:'😀é'})).toBe('{"x":"😀é"}');expect(canonicalJson('é')).not.toBe(canonicalJson('e\u0301'))});
});

describe('real SQL receipts and HTTP',()=>{
 it('accepts complete daily reports HELD and returns hash computed by SQL',async()=>{const r=await accept('held');expect(r.publicationStatus).toBe('held');expect(r.storageStatus).toBe('stored');expect(r.derivedProcessing.status).toBe('not_required');expect(r.payloadHash).toBe(await sha256(canonicalJson(fixture('held'))));});
 it('metadata lookup exposes no contact payload',async()=>{const res=await send(`/coach/weekly-report/receipt?teamId=${team}&runId=held`);expect(res.status).toBe(200);const s=JSON.stringify(await res.json());expect(s).not.toContain('canonical_payload');expect(s).not.toContain('findings');expect(s).toContain('stored');});
 it('identical replay stays held and creates no new audit or report',async()=>{const res=await send('/coach/weekly-report',fixture('held'));expect(res.status).toBe(200);const b=await res.json() as any;expect(b.replayed).toBe(true);expect(b.receipt.revision).toBe(1);expect((await pg.query<any>("select count(*)::int n from coach_report_audit where report_id=$1",[b.receipt.reportId])).rows[0].n).toBe(1)});
 it('changed payload gets 409 without overwriting original',async()=>{const f=fixture('held');f.run.endDate='2030-01-08';expect((await send('/coach/weekly-report',f)).status).toBe(409);expect((await lookup('held')).revision).toBe(1)});
 it('rejects auth, cross-team access and producer release before RPC',async()=>{expect((await send(`/coach/weekly-report/receipt?teamId=${team}&runId=held`,undefined,'bad')).status).toBe(401);expect((await send(`/coach/weekly-report/receipt?teamId=${other}&runId=held`)).status).toBe(403);expect((await send('/coach/weekly-report/control',control(await lookup('held'),'release','forbidden'))).status).toBe(403)});
 it('unknown lookup returns 404',async()=>expect((await send(`/coach/weekly-report/receipt?teamId=${team}&runId=missing`)).status).toBe(404));
 it('first release is explicit, audited and derived complete',async()=>{const result=await op(control(await lookup('held'),'release','release-held'));expect(result.status).toBe(200);expect(result.body.receipt.publicationStatus).toBe('published');expect(result.body.receipt.derivedProcessing.status).toBe('complete');expect(result.body.receipt.revision).toBe(2)});
 it('old ingestion replay never changes a released receipt',async()=>{const res=await send('/coach/weekly-report',fixture('held'));expect((await res.json() as any).receipt.revision).toBe(2)});
 it('operation replay returns original operation result without new effects',async()=>{const r=await lookup('held');const result=await op(control({...r,revision:1},'release','release-held'));expect(result.body.replayed).toBe(true);expect(result.body.receipt.revision).toBe(2);});
 it('operation ID collision and stale revision rejected',async()=>{const r=await lookup('held');expect((await op(control(r,'withdraw','release-held'))).status).toBe(409);expect((await op(control({...r,revision:1},'withdraw','stale'))).status).toBe(409)});
 it('withdraw hides raw report and ingestion retry cannot restore it',async()=>{const r=await lookup('held');expect((await op(control(r,'withdraw','withdraw-held'))).body.receipt.publicationStatus).toBe('withdrawn');expect((await send('/coach/weekly-report',fixture('held')).then(r=>r.json()) as any).receipt.publicationStatus).toBe('withdrawn');expect((await pg.query<any>('select status from coach_weekly_reports where run_id=$1',['held'])).rows[0].status).toBe('held')});
 it('partial publication stays gated even for operator',async()=>{const r=await accept('partial',true);expect((await op(control(r,'release','release-partial'))).body.error).toBe('partial_release_disabled');expect((await lookup('partial')).revision).toBe(1)});
 it('held supersession is atomic and replacement remains held',async()=>{const a=await accept('old-held'),b=await accept('new-held');const result=await op(control(a,'supersede','replace-held',{replacement:{runId:b.runId,expectedHash:b.payloadHash,expectedRevision:b.revision}}));expect(result.body.receipt.publicationStatus).toBe('superseded');expect(result.body.replacementReceipt.publicationStatus).toBe('held');expect((await op(control(await lookup('old-held'),'release','cannot-resurrect'))).status).toBe(409)});
 it('cross-team run ID reuse rejected in SQL, regardless of HTTP caller',async()=>{const f={...fixture('held'),run:{...fixture('held').run,teamId:other}};await expect(rpc('coach_receipt_accept',{p_team:other,p_run:'held',p_canonical:canonicalJson(f),p_payload:f,p_links:{},p_actor:'test'})).rejects.toThrow('identity_conflict')});
 it('old direct upsert/remapping cannot mutate a managed report',async()=>{await expect(pg.query("update coach_weekly_reports set status='published' where run_id='partial'")).rejects.toThrow('explicit_control_required');await expect(pg.query("update coach_weekly_reports set team_id=$1 where run_id='partial'",[other])).rejects.toThrow('immutable_receipt')});
 it('same source evidence shared across reports survives withdrawal of one',async()=>{
  for(const id of ['evidence-a','evidence-b']){const f:any=fixture(id);f.agents=[{agentName:'Example',metrics:{},opportunities:[{explanation:'Observed',patternKey:'service',findingIds:['same-finding']}]}];f.findings=[{findingIndex:0,findingId:'same-finding',agentName:'Example',leadName:'Synthetic',occurredAt:'2030-01-03T12:00:00Z',quote:'Observed message'}];const res=await send('/coach/weekly-report',f);const r=(await res.json() as any).receipt;expect((await op(control(r,'release','release-'+id))).status).toBe(200)}
  expect((await pg.query<any>('select count(*)::int n from coach_pattern_findings')).rows[0].n).toBe(1);
  expect((await op(control(await lookup('evidence-a'),'withdraw','remove-a'))).status).toBe(200);
  expect((await pg.query<any>('select count(*)::int n from coach_pattern_findings')).rows[0].n).toBe(1);
  expect((await op(control(await lookup('evidence-b'),'withdraw','remove-b'))).status).toBe(200);
  expect((await pg.query<any>('select count(*)::int n from coach_pattern_findings')).rows[0].n).toBe(0);
 });
 it('derived failure rolls back release, receipt revision, operation and audit',async()=>{const r=await accept('fault');await pg.exec("create function fail_derived() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$;create trigger fail_test before insert on coach_team_state for each row execute function fail_derived();");const result=await op(control(r,'release','fault-op'));expect(result.status).toBe(503);expect((await lookup('fault')).publicationStatus).toBe('held');expect((await lookup('fault')).revision).toBe(1);expect((await pg.query<any>("select count(*)::int n from coach_report_operations where operation_id='fault-op'")).rows[0].n).toBe(0);await pg.exec('drop trigger fail_test on coach_team_state;drop function fail_derived();')});
 it('retries after an injected failure can complete once',async()=>expect((await op(control(await lookup('fault'),'release','fault-op'))).status).toBe(200));
 it('rejects duplicate JSON keys before any storage',async()=>expect((await send('/coach/weekly-report','{"run":{},"run":{}}')).status).toBe(422));
 it.each(['a','é','😀'])('whole envelope exact 4,000,000-byte boundary (%s)',async char=>{const f={...fixture('bytes-'+char.codePointAt(0)),padding:''};const base=JSON.stringify(f);const room=4000000-new TextEncoder().encode(base).length;const width=new TextEncoder().encode(char).length;f.padding=char.repeat(Math.floor(room/width))+' '.repeat(room%width);const raw=JSON.stringify(f);expect(new TextEncoder().encode(raw).length).toBe(4000000);expect((await send('/coach/weekly-report',raw)).status).toBe(201);expect((await send('/coach/weekly-report',raw+' ')).status).toBe(413)},15000);
 it('anon/authenticated cannot read receipts or invoke RPCs',async()=>{for(const role of ['anon','authenticated']){await pg.exec('set role '+role);await expect(pg.query('select * from coach_report_receipts')).rejects.toThrow();await expect(pg.query('select coach_receipt_lookup($1,$2)',[team,'held'])).rejects.toThrow();await pg.exec('reset role')}});
});

describe('lifecycle edge cases',()=>{
 it('replaying an old release command returns CURRENT withdrawn status',async()=>{const r=await lookup('held');const result=await op(control({...r,revision:1},'release','release-held'));expect(result.status).toBe(200);expect(result.body.replayed).toBe(true);expect(result.body.receipt.publicationStatus).toBe('withdrawn')});
 it('superseding a published report atomically publishes its held replacement',async()=>{const a=await accept('live-old'),b=await accept('live-new');await op(control(a,'release','live-old-release'));const r=await lookup(a.runId);const result=await op(control(r,'supersede','live-replace',{replacement:{runId:b.runId,expectedHash:b.payloadHash,expectedRevision:b.revision}}));expect(result.status).toBe(200);expect(result.body.receipt.publicationStatus).toBe('superseded');expect(result.body.replacementReceipt.publicationStatus).toBe('published');expect((await pg.query<any>("select count(*)::int n from coach_weekly_reports where run_id in ('live-old','live-new') and status='published'")).rows[0].n).toBe(1);});
 it('cannot bypass partial gate through supersession',async()=>{const a=await lookup('live-new'),b=await accept('partial-replacement',true);const result=await op(control(a,'supersede','blocked-replace',{replacement:{runId:b.runId,expectedHash:b.payloadHash,expectedRevision:b.revision}}));expect(result.status).toBe(409);expect((await lookup(a.runId)).publicationStatus).toBe('published');expect((await lookup(b.runId)).revision).toBe(1)});
 it('withdrawn report can be explicitly restored by a new audited release operation',async()=>{const r=await lookup('held');const result=await op(control(r,'release','restore-held'));expect(result.body.receipt.publicationStatus).toBe('published');expect(result.body.receipt.revision).toBe(4)});
 it('an operation belongs to its actor as well as its body',async()=>{const r=await lookup('held');const command=control({...r,revision:3},'release','restore-held');await expect(rpc('coach_receipt_control',{p_team:team,p_actor:'different-operator',p_command:command,p_canonical:canonicalJson(command),p_allow_partial:false})).rejects.toThrow('operation_conflict')});
 it('unknown legacy coverage is never upgraded to complete',async()=>{const f:any=fixture('legacy-shape');delete f.coverage;f.schemaVersion='1.0';const res=await send('/coach/weekly-report',f);expect((await res.json() as any).receipt.coverageState).toBe('unknown')});
 it('schema 1.3 coverage-only does not require or enable timing',async()=>{const r=await lookup('partial');expect(r.coverageState).toBe('partial');const row=(await pg.query<any>('select payload from coach_weekly_reports where id=$1',[r.reportId])).rows[0];expect(row.payload.responseTiming).toBeUndefined()});
 it('scope and hash cannot be replaced by a preexisting legacy row',async()=>{await pg.query("insert into coach_weekly_reports(run_id,team_id,org_id,team_slug,week_start,week_end,payload) values('preexisting',$1::uuid,$1::uuid,$1::text,'2030-01-01','2030-01-07','{}')",[team]);expect((await send('/coach/weekly-report',fixture('preexisting'))).status).toBe(409)});
 it('parallel identical accepts persist one receipt and one audit event',async()=>{const f=fixture('parallel');const responses=await Promise.all(Array.from({length:6},()=>send('/coach/weekly-report',f)));expect(responses.map(r=>r.status).sort()).toEqual([200,200,200,200,200,201]);const r=await lookup('parallel');expect((await pg.query<any>('select count(*)::int n from coach_report_audit where report_id=$1',[r.reportId])).rows[0].n).toBe(1)});
 it('parallel conflicting accepts select one immutable winner',async()=>{const a:any=fixture('race'),b:any={...fixture('race'),different:'value'};const responses=await Promise.all([send('/coach/weekly-report',a),send('/coach/weekly-report',b)]);expect(responses.map(r=>r.status).sort()).toEqual([201,409])});
 it('database constraints enforce run uniqueness',async()=>{const constraints=await pg.query<any>("select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='coach_report_receipts'::regclass and contype='u'");expect(constraints.rows.some(r=>r.definition==='UNIQUE (run_id)')).toBe(true)});
 it('supports service-role execution but does not permit audit rewriting',async()=>{await pg.exec('grant select,insert,update,delete on teams,agents,coach_weekly_reports,coach_patterns,coach_pattern_findings,coach_team_state to service_role;set role service_role');try{const f:any=fixture('service-test');const res=await send('/coach/weekly-report',f);expect(res.status).toBe(201);const r=(await res.json() as any).receipt;expect((await op(control(r,'release','service-release'))).status).toBe(200);await expect(pg.query('delete from coach_report_audit')).rejects.toThrow();await expect(pg.query('update coach_report_operations set actor=actor')).rejects.toThrow();}finally{await pg.exec('reset role')}});
 it('invalid/missing client configuration fails closed without legacy token fallback',async()=>{const saved=env.COACH_REPORT_CLIENTS;env.COACH_REPORT_CLIENTS=undefined;expect((await send('/coach/weekly-report',fixture('no-auth'))).status).toBe(503);env.COACH_REPORT_CLIENTS=saved});
 it('control body cannot contain tenant overrides or caller-supplied publication state',async()=>{const r=await lookup('held');expect((await op({...control(r,'withdraw','override'),publicationStatus:'published'})).status).toBe(422)});
 it('hash conflict includes unknown top-level fields instead of silently discarding them',async()=>{const f:any=fixture('hashed-extra');f.note='one';expect((await send('/coach/weekly-report',f)).status).toBe(201);f.note='two';expect((await send('/coach/weekly-report',f)).status).toBe(409)});
 it('release fails atomically if two sources reuse an evidence ID inconsistently',async()=>{const make=(id:string,quote:string)=>{const f:any=fixture(id);f.agents=[{agentName:'Proof',opportunities:[{explanation:'Observed',patternKey:'evidence',findingIds:['conflicting-evidence']}]}];f.findings=[{findingIndex:0,findingId:'conflicting-evidence',agentName:'Proof',leadName:'Synthetic',occurredAt:'2030-01-03T00:00:00Z',quote}];return f};for(const [id,quote]of [['conflict-a','first'],['conflict-b','different']])expect((await send('/coach/weekly-report',make(id,quote))).status).toBe(201);expect((await op(control(await lookup('conflict-a'),'release','conflict-first'))).status).toBe(200);expect((await op(control(await lookup('conflict-b'),'release','conflict-second'))).body.error).toBe('evidence_conflict');expect((await lookup('conflict-b')).publicationStatus).toBe('held');expect((await pg.query<any>("select quote from coach_pattern_findings where finding_id='conflicting-evidence'")).rows[0].quote).toBe('first');});
});

describe('int32 control revisions',()=>{
 it.each([0,-1,1.5,2147483648,9007199254740991,'1',null,true])('rejects invalid source and replacement revision %s before RPC',async value=>{
  let calls=0;
  const db={rpc:async()=>{calls++;throw Error('must not reach SQL')}} as unknown as Db;
  for(const replacement of [false,true]){
   const command:any={operationId:'boundary',action:replacement?'supersede':'release',teamId:team,runId:'boundary',expectedHash:'a'.repeat(64),expectedRevision:replacement?1:value,reason:'Offline boundary test'};
   if(replacement)command.replacement={runId:'replacement',expectedHash:'b'.repeat(64),expectedRevision:value};
   const url=new URL('https://offline.test/coach/weekly-report/control');
   const res=await handleReportReceipts(new Request(url,{method:'POST',headers:{Authorization:'Bearer operator'},body:JSON.stringify(command)}),env,url,{},db);
   expect(res!.status).toBe(422);expect(await res!.json()).toEqual({error:'invalid_control'});
  }
  expect(calls).toBe(0);
 });
 it.each([1,2147483647])('passes valid boundary %s to RPC for both references',async value=>{
  let calls=0;
  const db={rpc:async(_name:string,args:any)=>{calls++;expect(args.p_command.expectedRevision).toBe(value);expect(args.p_command.replacement.expectedRevision).toBe(value);throw Error('revision_conflict')}} as unknown as Db;
  const url=new URL('https://offline.test/coach/weekly-report/control');
  const command={operationId:'valid-boundary',action:'supersede',teamId:team,runId:'boundary',expectedHash:'a'.repeat(64),expectedRevision:value,reason:'Offline boundary test',replacement:{runId:'replacement',expectedHash:'b'.repeat(64),expectedRevision:value}};
  const res=await handleReportReceipts(new Request(url,{method:'POST',headers:{Authorization:'Bearer operator'},body:JSON.stringify(command)}),env,url,{},db);
  expect(res!.status).toBe(409);expect(await res!.json()).toEqual({error:'revision_conflict'});expect(calls).toBe(1);
 });
 it('revision exhaustion rolls back without publication, audit or counter reset',async()=>{
  const r=await accept('exhausted');
  await pg.query('update coach_report_receipts set revision=2147483647 where report_id=$1',[r.reportId]);
  const before=await lookup(r.runId);
  const result=await op(control(before,'release','exhausted-release'));
  expect(result).toEqual({status:503,body:{error:'receipt_transaction_failed'}});
  expect(await lookup(r.runId)).toEqual(before);
  expect((await pg.query<any>('select status from coach_weekly_reports where id=$1',[r.reportId])).rows[0].status).toBe('held');
  expect((await pg.query<any>("select count(*)::int n from coach_report_operations where operation_id='exhausted-release'")).rows[0].n).toBe(0);
  expect((await pg.query<any>('select count(*)::int n from coach_report_audit where report_id=$1',[r.reportId])).rows[0].n).toBe(1);
 });
});

describe('control recovery and transport',()=>{
 it('failed supersession rolls back both reports and leaves replacement held',async()=>{const a=await lookup('live-new'),b=await accept('replacement-fault');await pg.exec("create function fail_replace() returns trigger language plpgsql as $$ begin raise exception 'injected failure'; end $$;create trigger fail_replace_test before insert on coach_team_state for each row execute function fail_replace();");const result=await op(control(a,'supersede','replace-fault',{replacement:{runId:b.runId,expectedHash:b.payloadHash,expectedRevision:b.revision}}));expect(result.status).toBe(503);expect((await lookup(a.runId)).publicationStatus).toBe('published');expect((await lookup(b.runId)).publicationStatus).toBe('held');expect((await lookup(b.runId)).revision).toBe(1);await pg.exec('drop trigger fail_replace_test on coach_team_state;drop function fail_replace()')});
 it('partial control simulation in local SQL still requires explicit release, not replay',async()=>{const r=await accept('partial-local-simulation',true);const command=control(r,'release','explicit-partial-local');const result=await rpc('coach_receipt_control',{p_team:team,p_actor:'offline-operator',p_command:command,p_canonical:canonicalJson(command),p_allow_partial:true});expect(result.receipt.publicationStatus).toBe('published');const untouched=await accept('still-held',true);expect(untouched.publicationStatus).toBe('held');});
 it('a disabled team cannot receive new receipts, but existing receipt replay is stable',async()=>{await pg.query('update teams set is_active=false where id=$1',[team]);try{expect((await send('/coach/weekly-report',fixture('held')).then(r=>r.json()) as any).receipt.publicationStatus).toBe('published');expect((await send('/coach/weekly-report',fixture('inactive-new'))).status).toBe(404)}finally{await pg.query('update teams set is_active=true where id=$1',[team])}});
 it('receipt identity cannot be remapped with a different alias',async()=>{const f=fixture('alias');f.run.teamId='costigan';expect((await send('/coach/weekly-report',f)).status).toBe(422)});
 it('rejects duplicate lookup parameters',async()=>expect((await send(`/coach/weekly-report/receipt?teamId=${team}&runId=held&runId=other`)).status).toBe(422));
 it('strict UTF-8 rejects invalid byte sequences',async()=>{const url=new URL('https://offline.test/coach/weekly-report');const res=await handleReportReceipts(new Request(url,{method:'POST',headers:{Authorization:'Bearer producer'},body:new Uint8Array([0xff])}),env,url,{},database);expect(res!.status).toBe(422)});
 it('evidence from one agent cannot support another agent pattern',async()=>{const f:any=fixture('wrong-agent');f.agents=[{agentName:'A',opportunities:[{explanation:'Unsupported',patternKey:'bad',findingIds:['other-agent']}]}];f.findings=[{findingIndex:0,findingId:'other-agent',agentName:'B',quote:'Synthetic',leadName:'Example'}];const res=await send('/coach/weekly-report',f);const r=(await res.json() as any).receipt;expect((await op(control(r,'release','wrong-agent-release'))).status).toBe(200);expect((await pg.query<any>("select count(*)::int n from coach_patterns where pattern_key='bad'")).rows[0].n).toBe(0)});
});

it('controlled reports cannot enter the untracked legacy issue store',async()=>{let reads=0;const db={select:async()=>{reads++;return []}} as unknown as Db;expect(await ingestReportIssues(db,{team_id:team,payload:{},received_at:'2030-01-08',receipt_managed:true})).toEqual({created:0,updated:0,skipped:0,recurred:0});expect(reads).toBe(0);let query='';await rebuildIssuesFromReports({select:async(_table:string,q:string)=>{query=q;return []}} as unknown as Db);expect(query).toContain('receipt_managed=eq.false')});
