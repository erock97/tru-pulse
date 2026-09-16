import {useEffect,useRef,useState} from 'react';
import type {PipelineReport} from '../../../shared/pipeline';
import {inquiryValue,valueSummary,type InquiryValue} from '../../../shared/pipelineValue';
import {isDemo,workerFetch} from '../lib/api';

const money=(n:number|null)=>n===null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
/** Synthetic evidence is confined to the explicitly labelled demo. */
export function demoValues(report:PipelineReport):Record<string,InquiryValue>{
 return Object.fromEntries(report.leads.map((l,i)=>[l.key,inquiryValue({checkedAt:report.generatedAt,receivedAt:l.fub_created,complete:i%13!==0,
  events:i%7===0?[]:[{id:'sample-'+i,type:i%11===0?'Seller Inquiry':'Property Inquiry',created:l.fub_created!,
   property:{price:i%9===0?3000:275000+(i%17)*25000,forRent:i%19===0?1:0}}]},l.historicalOnly)]));
}
export function PipelineValue({report,agentKey}:{report:PipelineReport;agentKey:string}){
 const [values,setValues]=useState<Record<string,InquiryValue>>(()=>isDemo?demoValues(report):{});
 const [open,setOpen]=useState(false),[filter,setFilter]=useState('all'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const generation=useRef(0);
 useEffect(()=>{generation.current++;setValues(isDemo?demoValues(report):{});setBusy(false);setError('');return()=>{generation.current++;};},[report]);
 const leads=report.leads.filter(l=>!agentKey||l.ownerKey===agentKey),summary=valueSummary(leads,values);
 const scope=report.agents.find(a=>a.key===agentKey)?.name || 'Selected team leads';
 async function check(){
  const keys=summary.rows.filter(r=>r.value.status==='unchecked').slice(0,5).map(r=>r.key);
  if(!keys.length)return;const version=generation.current;setBusy(true);setError('');
  try{
   const response=await workerFetch('/data/pipeline/property-values',{method:'POST',body:JSON.stringify({...report.filters,snapshotId:report.snapshotId,leadKeys:keys})});
   const data=await response.json();
   if(!response.ok)throw Error(data.error || 'Inquiry check failed. Retry.');
   if(data.snapshotId!==report.snapshotId)throw Error('The pipeline changed. Refresh and retry.');
   if(version===generation.current)setValues(old=>({...old,...data.values}));
  }catch(e){if(version===generation.current)setError((e as Error).message);}
  finally{if(version===generation.current)setBusy(false);}
 }
 const rows=summary.rows.filter(r=>filter==='all'||filter==='included'&&r.value.status==='included'||filter==='seller'&&r.value.status==='seller'||filter==='excluded'&&!['included','seller'].includes(r.value.status));
 return <section className="pipeline-card pipeline-value" aria-label="Estimated property volume">
  <div className="pipeline-card-head"><div><span className="pipeline-eyebrow">Inquiry-based estimate · USD</span><h3>Estimated property volume</h3><p className="pipeline-caption">{scope} · all current stages in this received-date selection</p></div><span>Testing preview</span></div>
  <div className="pipeline-value-summary"><button className="pipeline-value-amount" aria-label="View property volume evidence" onClick={()=>{setOpen(true);setFilter('included');}}>{money(summary.amount)}</button>
   <div><strong>{summary.included} of {summary.total} leads included</strong><p>{summary.excluded} excluded · {summary.unchecked} not checked · {summary.sellerCount} seller estimates</p></div>
  </div>
  <p className="pipeline-caption">Earliest available property inquiry near lead creation. Includes nurture, rejected and closed leads in this selection; this is not active deal value, commission or expected revenue. No extrapolation for missing amounts.</p>
  {summary.sellerCount>0&&<p className="pipeline-caption">Seller estimates, separately: <button className="pipeline-number" onClick={()=>{setOpen(true);setFilter('seller');}}>{money(summary.sellerAmount)} · {summary.sellerCount} leads</button></p>}
  <div className="pipeline-value-actions"><button className="pipeline-button" onClick={()=>{setOpen(!open);setFilter('all');}}>{open?'Hide value evidence':'Review included and excluded leads'}</button>
   {!isDemo&&<button className="pipeline-button" disabled={busy||summary.unchecked===0} onClick={()=>void check()}>{busy?'Checking FUB inquiries…':'Check next '+Math.min(5,summary.unchecked)+' leads'}</button>}</div>
  {!isDemo&&<p className="pipeline-caption">Read-only checks run in batches of five. Results last until the report is refreshed or filters change. Unchecked leads are not treated as zero value.</p>}
  {isDemo&&<p className="pipeline-caption">Illustrative amounts and evidence only; these values are not from the Zillow report or live FUB records.</p>}
  {error&&<p role="alert" className="pipeline-notice">{error}</p>}
  <details className="pipeline-value-policy"><summary>How amounts are selected</summary><p>Each unique lead counts once. We use the earliest accessible inquiry within five minutes of lead creation, never the contact price or a later higher-priced property. Rentals, payment signals, conflicting first inquiries, incomplete event pages and missing prices are excluded. Amounts below $25,000 or above $100 million require review; a low amount alone does not prove it is a mortgage payment. Missing rental classification is also excluded.</p><p>FUB can restrict events from API access. This is the earliest available inquiry, not a guarantee of complete original-inquiry history. Seller inquiries are separate estimates. Historical-only leads need a current identity refresh.</p></details>
  {open&&<div className="pipeline-value-evidence"><label>Show evidence<select aria-label="Filter property value evidence" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All leads</option><option value="included">Included buyer inquiries</option><option value="seller">Seller estimates</option><option value="excluded">Excluded / not checked</option></select></label>
   <p className="pipeline-caption">{rows.length} matching leads</p><ul>{rows.map(({key,value})=>{const l=leads.find(l=>l.key===key)!;return <li key={key}><div><strong>{l.fubUrl?<a href={l.fubUrl} target="_blank" rel="noreferrer">{l.name || 'Unnamed lead'} ↗</a>:l.name || 'Unnamed lead'}</strong><small>{l.stage || 'No stage'} · {l.assigned_to || l.pond || 'Unassigned'}</small><small>{value.reason}</small>{value.amount===null&&value.observedAmount!==null&&<small>Excluded inquiry amount: {money(value.observedAmount)}</small>}{value.eventAt&&<small>Inquiry {new Date(value.eventAt).toLocaleString()} · event {value.eventId}</small>}{value.checkedAt&&<small>Checked {new Date(value.checkedAt).toLocaleString()}</small>}</div><span>{money(value.amount)}<small>{value.status==='included'?'Included':value.status==='seller'?'Seller estimate':'Excluded / '+value.status}</small></span></li>;})}</ul></div>}
 </section>;
}

