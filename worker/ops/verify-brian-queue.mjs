// Explicit production synthetic verification. Run only when authorized.
// Reads the existing client token from the environment; never writes credentials.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const token=process.env.TRUEHQ_COACH_TOKEN;
if (!token) throw new Error('Existing client credential is required in the environment.');
const base='https://api.truhq.co/coach/run-events';
const id=randomUUID(), batch='synthetic-brian-'+randomUUID(), fingerprint='synthetic-brian-'+id;
async function request(path,method='GET',body) {
  const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  return {status:r.status,body:await r.json()};
}
const incident={schemaVersion:1,incidentId:id,fingerprint,batchId:batch,accountId:'synthetic-brian-integration',
  // Deliberately old synthetic timestamp tests ordering without changing other tickets.
  occurredAt:'2000-01-01T00:00:00.000Z',severity:'nonfatal',scope:'event',stage:'synthetic_verification',
  code:'SYNTHETIC_BRIAN_INTEGRATION',title:'Synthetic Brian queue integration',
  explanation:'A synthetic parser variation was reported for integration testing.',impact:'No production work was affected.',
  nextStep:'Use only synthetic evidence for this integration test.',action:'synthetic_test',continued:true,
  technical:{stage:'synthetic_verification',code:'SYNTHETIC_BRIAN_INTEGRATION',fingerprint,message:'Synthetic bounded diagnostic.'}};
const push={schemaVersion:1,batchId:batch,status:'attention_required',counts:{fatal:0,nonfatal:1},incidents:[incident]};
let r=await request('','POST',push);assert.equal(r.status,200);assert.equal(r.body.incidentsNew,1);
r=await request('','POST',push);assert.equal(r.body.incidentsNew,0);
r=await request('/agent-queue?limit=1');assert.equal(r.status,200);assert.equal(r.body.tickets[0]?.incidentId,id);
let version=r.body.tickets[0].version;
const claim={agentId:'brian',expectedVersion:version,leaseSeconds:300};
const races=await Promise.all([request('/'+id+'/claim','POST',claim),request('/'+id+'/claim','POST',claim)]);
assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);assert.equal(races.find(r=>r.status===409).body.code,'CLAIM_CONFLICT');
version=races.find(r=>r.status===200).body.version;
r=await request('/'+id+'/claim','POST',{...claim,expectedVersion:version});assert.equal(r.status,409);assert.equal(r.body.code,'CLAIM_CONFLICT');
r=await request('/'+id+'/claim/renew','POST',{...claim,expectedVersion:version});assert.equal(r.status,200);version=r.body.version;
const update={agentId:'brian',expectedVersion:version,status:'investigating',diagnosis:'The synthetic parser variation was reproduced safely.',nextStep:'Continue testing with synthetic evidence only.'};
r=await request('/'+id,'PATCH',update);assert.equal(r.status,200);version=r.body.version;
r=await request('/'+id,'PATCH',update);assert.equal(r.status,409);assert.equal(r.body.code,'VERSION_CONFLICT');
r=await request('/'+id+'/claim/release','POST',{agentId:'brian',expectedVersion:version,diagnosis:'The synthetic queue integration passed.',nextStep:'Continue the synthetic laptop integration test.'});assert.equal(r.status,200);assert.equal(r.body.status,'open');version=r.body.version;
// Optional UI phase: a short lease lets an administrator verify release controls.
if(process.argv.includes('--ui-claim')) {
  r=await request('/'+id+'/claim','POST',{...claim,expectedVersion:version});assert.equal(r.status,200);version=r.body.version;
}
console.log(JSON.stringify({ok:true,incidentId:id,batchId:batch,fingerprint,version,status:r.body.status,
  checks:['ingestion','idempotent redelivery','limit-one retrieval','simultaneous claim conflict','active claim conflict','renewal','investigation update','duplicate update conflict','release']},null,2));
