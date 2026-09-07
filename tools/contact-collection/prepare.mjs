import fs from 'node:fs';
import path from 'node:path';
import ts from '../../web/node_modules/typescript/lib/typescript.js';
const load=async file=>import('data:text/javascript;base64,'+Buffer.from(ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText).toString('base64'));
const {normalizeContactTimeline}=await load('../../shared/contactCollection.ts');
const {calculateContactSpeed}=await load('../../worker/src/contactSpeed.ts');
const [input,folder,reviewFile,output]=process.argv.slice(2);
if(!output)throw Error('Usage: node prepare.mjs snapshot collection-folder reviewed-coverage.json output.json');
const read=f=>JSON.parse(fs.readFileSync(f,'utf8').replace(/^\uFEFF/,''));
const snapshot=read(input),manifest=read(path.join(folder,'manifest.json')),review=read(reviewFile);
if(!manifest.complete||manifest.account!=='compass627'||manifest.orgId!==snapshot.orgId||review.orgId!==snapshot.orgId||manifest.leads.length!==snapshot.leads.length)throw Error('Unverified collection scope');
const updated=structuredClone(snapshot);updated.capturedAt=manifest.capturedAt;
for(const lead of updated.leads){
 const source=read(path.join(folder,lead.leadId+'.json'));
 if(!source.complete||String(source.personId)!==lead.leadId||manifest.leads.find(x=>x.id===lead.leadId)?.records!==source.timeline.length)throw Error('Missing or incomplete contact');
 const events=normalizeContactTimeline(source.timeline,lead.leadId),ids=new Set(events.map(e=>e.id));
 lead.events=[...events,...lead.events.filter(e=>!ids.has(e.id))];
 // Coverage review is explicit; a successful fetch alone never clears missing evidence.
 if(review.leads[lead.leadId]){if(lead.gap||lead.connection)throw Error('Cannot clear existing evidence caveat');lead.historyComplete=true;}
}
const report=calculateContactSpeed(updated);
fs.writeFileSync(output,JSON.stringify(updated,null,2));
fs.writeFileSync(output+'.report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({contacts:updated.leads.length,events:updated.leads.reduce((n,l)=>n+l.events.length,0),zillowMessages:updated.leads.reduce((n,l)=>n+l.events.filter(e=>e.channel==='zillow_message').length,0),agents:report.agents.map(a=>({name:a.agentName,measured:a.measured,total:a.total}))}));
