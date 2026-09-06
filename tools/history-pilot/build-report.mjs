import fs from 'node:fs/promises';import path from 'node:path';import {calculate} from './metrics.mjs';
const root=path.resolve(process.argv[2]||'');if(!process.argv[2])throw Error('Pass checkpoint directory');
const inventory=JSON.parse(await fs.readFile(path.join(root,'inventory.json'),'utf8'));
if(inventory.account!=='compass627')throw Error('Wrong tenant');
const histories={};for(const person of inventory.people){try{const h=JSON.parse(await fs.readFile(path.join(root,'leads',person.id+'.json'),'utf8'));if(h.account!=='compass627'||h.personId!==person.id)throw Error('Ownership mismatch');histories[person.id]=h;}catch(e){if(e.code!=='ENOENT')throw e;}}
const data={...inventory,histories};const options={start:'2026-01-01',end:'2026-09-05',source:'Zillow Preferred',timezone:'America/Los_Angeles'};
const rows=calculate(data,options);const totals=rows.reduce((a,r)=>{a.leads+=r.total;a.nurtureNow+=r.nurtureNow;a.incomplete+=r.incomplete;a.unknown+=r.unknown;for(const k in r.counts)a[k]=(a[k]||0)+r.counts[k];return a;},{leads:0,nurtureNow:0,incomplete:0,unknown:0});
await fs.writeFile(path.join(root,'summary.json'),JSON.stringify({options,totals,agents:rows.map(({leads,...r})=>r)},null,2));
const template=await fs.readFile(new URL('./report.html',import.meta.url),'utf8');
const core=(await fs.readFile(new URL('./metrics.mjs',import.meta.url),'utf8')).replaceAll('export ','');
const html=template.replace('/* CORE */',core).replace('/* DATA */',JSON.stringify(data).replaceAll('<','\\u003c'));
await fs.writeFile(path.join(root,'costigan-historical-pilot.html'),html);
console.log(JSON.stringify({report:path.join(root,'costigan-historical-pilot.html'),totals},null,2));
