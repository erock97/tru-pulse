import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readJson,atomicJson} from './ledger.mjs';
const [reportPath,out]=process.argv.slice(2);if(!out)throw Error('Usage: prepare-jobs.mjs private-coverage-report private-jobs-file');
const report=await readJson(reportPath);
let old=[];try{old=await readJson(out);}catch(e){if(e.code!=='ENOENT')throw e;}
const jobs=report.teams.map(t=>({id:old.find(j=>String(j.account_id)===String(t.accountId)&&j.cutoff===report.cutoff&&j.source_policy===report.policy)?.id??randomUUID(),account_id:String(t.accountId),from_at:report.from,cutoff:report.cutoff,source_policy:report.policy,state:'partial',census_complete:t.censusComplete,expected_people:t.eligible,unresolved_people:t.unresolved,profile_dispositions:report.profiles.filter(p=>p.team_id===t.teamId),failures:t.blockers.filter(b=>!b.startsWith('Forward retention code')).concat('Per-team webhook processing and historical/live overlap are not yet verified')}));
// Capture deployment timing is left unknown until a verified receipt supplies it.
await fs.mkdir(path.dirname(out),{recursive:true});await atomicJson(out,jobs);
console.log(JSON.stringify({jobs:jobs.length,profiles:jobs.reduce((n,j)=>n+j.profile_dispositions.length,0)}));
