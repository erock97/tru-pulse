import { describe,it,expect,vi,beforeEach } from 'vitest';
import { handleAgentRunEvents } from './agentRunEvents.js';
import { validateAgentWrite, safeAgentText, safeRelativePath } from '../../shared/agentRunEvents.js';
import type { Db } from './db.js';
import type { Env } from './env.js';
const env={COACH_INGEST_TOKEN:'synthetic-test-key'} as Env;
let rpc: ReturnType<typeof vi.fn>;
beforeEach(()=>{rpc=vi.fn(async(name:string)=>name==='coach_agent_rate_limit'?true:name==='coach_agent_queue'?[]:{ok:true,version:2,status:'investigating',claim:null});});
async function call(path='agent-queue',method='GET',body?:unknown,token='synthetic-test-key') {
  const req=new Request('https://api.truhq.co/coach/run-events/'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
  return (await handleAgentRunEvents(req,env,new URL(req.url),{}, {rpc} as unknown as Db))!;
}
const claim={agentId:'brian',expectedVersion:1,leaseSeconds:1800};
const update={agentId:'brian',expectedVersion:2,status:'investigating',diagnosis:'A synthetic parser variation was identified.',nextStep:'Review the bounded repair.'};
describe('Brian authenticated routes',()=>{
  it('returns an authenticated empty queue',async()=>{const r=await call();expect(await r.json()).toEqual({ok:true,tickets:[]});expect(rpc).toHaveBeenCalledWith('coach_agent_queue',{p_limit:1});});
  it('returns a sanitized ticket and valid limit',async()=>{rpc.mockImplementation(async n=>n==='coach_agent_rate_limit'?true:[{incidentId:'synthetic',version:1}]);expect(((await (await call('agent-queue?limit=5')).json()) as any).tickets).toHaveLength(1);});
  it.each(['','wrong'])('rejects unauthorized %s without database access',async token=>{expect((await call('agent-queue','GET',undefined,token)).status).toBe(401);expect(rpc).not.toHaveBeenCalled();});
  it.each(['0','6','1.0','1e0','-1','x','01','1&limit=2'])('rejects limit %s',async limit=>{expect((await call('agent-queue?limit='+limit)).status).toBe(422);});
  it('enforces shared rate limiting',async()=>{rpc.mockResolvedValue(false);const r=await call();expect(r.status).toBe(429);expect(r.headers.get('Retry-After')).toBe('60');expect(((await r.json()) as any).code).toBe('RATE_LIMITED');});
  it.each(['claim','claim/renew','claim/release',''])('dispatches exact mutation route %s',async suffix=>{const body=suffix==='claim'||suffix==='claim/renew'?claim:suffix==='claim/release'?{agentId:'brian',expectedVersion:2}:update;const r=await call('synthetic'+(suffix?'/'+suffix:''),suffix?'POST':'PATCH',body);expect(r.status).toBe(200);expect(rpc.mock.calls.at(-1)?.[0]).toBe('coach_agent_mutate');});
  it.each(['CLAIM_CONFLICT','VERSION_CONFLICT','CLAIM_EXPIRED','INVALID_STATUS_TRANSITION'])('returns stable %s',async code=>{rpc.mockImplementation(async n=>n==='coach_agent_rate_limit'?true:{code});const r=await call('synthetic/claim','POST',claim);expect(r.status).toBe(409);expect(((await r.json()) as any).code).toBe(code);});
  it('returns missing incident',async()=>{rpc.mockImplementation(async n=>n==='coach_agent_rate_limit'?true:{code:'INCIDENT_NOT_FOUND'});expect((await call('synthetic/claim','POST',claim)).status).toBe(404);});
  it('bounds streamed payload bytes',async()=>{expect((await call('synthetic','PATCH',' '.repeat(8193))).status).toBe(413);});
  it('rejects malformed JSON without echoing it',async()=>{const r=await call('synthetic','PATCH','{unsafe');expect(r.status).toBe(422);expect(await r.text()).not.toContain('unsafe');});
  it('suppresses database diagnostics',async()=>{rpc.mockRejectedValue(new Error('private diagnostic'));const r=await call();expect(r.status).toBe(503);expect(await r.text()).not.toContain('private');});
});
describe('Strict agent input',()=>{
  it('accepts requested fixed shape',()=>{expect(validateAgentWrite({...update,status:'fixed',remediation:'Handled the synthetic parser variation.',filesChanged:['src/parser.mjs'],testsRun:['parser regression']},'update').details).toEqual([]);});
  it('rejects unknown keys without reflecting them',()=>{expect(validateAgentWrite({...claim,'unsafe-value':'x'},'claim').details).toEqual(['unknownField']);});
  it.each([299,3601,1.5])('rejects lease %s',leaseSeconds=>{expect(validateAgentWrite({...claim,leaseSeconds},'claim').details).toContain('leaseSeconds');});
  it.each([0,-1,1.5,2147483647])('rejects version %s',expectedVersion=>{expect(validateAgentWrite({...claim,expectedVersion},'claim').details).toContain('expectedVersion');});
  it('forbids verified and another agent',()=>{expect(validateAgentWrite({...update,status:'verified',agentId:'other'},'update').details).toEqual(['agentId','status']);});
  it.each(['synthetic@example.test','212-555-0100','<div>html</div>','Authorization: Bearer synthetic','password=synthetic','cookie: synthetic','secret=synthetic','at fn\nat other','John Smith failed.','The customer said "private text".','C:\\synthetic\\file.mjs','/tmp/synthetic.mjs','const x = 1;','stdout: synthetic output','```code```'])('rejects prohibited content %s',text=>{expect(safeAgentText(text)).toBe(false);});
  it.each(['/tmp/file.mjs','C:/file.mjs','../file.mjs','src/../../file.mjs','src\\file.mjs','https://example.test/file','src/file name.mjs'])('rejects path %s',path=>{expect(safeRelativePath(path)).toBe(false);});
  it('bounds prose and arrays',()=>{expect(validateAgentWrite({...update,diagnosis:'x'.repeat(501),nextStep:'x'.repeat(301),filesChanged:Array(11).fill('src/a.ts'),testsRun:['x'.repeat(101)]},'update').details).toEqual(['diagnosis','nextStep','filesChanged','testsRun']);});
});
