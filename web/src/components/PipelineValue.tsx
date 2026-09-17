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
 const [values,setValues]=useState<Record<string,InquiryValue>>(()=>isDemo?demoValues(report):(report.propertyValues || {}));
 const [open,setOpen]=useState(false),[filter,setFilter]=useState('all'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [automatic,setAutomatic]=useState(false);
 const [collectionError,setCollectionError]=useState('');
 const generation=useRef(0);
 useEffect(()=>{generation.current++;setValues(isDemo?demoValues(report):(report.propertyValues || {}));setBusy(false);setError('');return()=>{generation.current++;};},[report]);
 const leads=report.leads.filter(l=>!agentKey||l.ownerKey===agentKey),summary=valueSummary(leads,values);
 const scope=report.agents.find(a=>a.key===agentKey)?.name;
 async function refreshValues(){
  const version=generation.current;setBusy(true);setError('');
  try{
   const params=new URLSearchParams({orgId:report.filters.orgId,through:report.filters.through,timezone:report.filters.timezone});
   if(report.filters.teamId)params.set('teamId',report.filters.teamId);
   if(report.filters.from)params.set('from',report.filters.from);
   const response=await workerFetch('/data/pipeline/property-values?'+params);
   const data=await response.json();
   if(!response.ok)throw Error(data.error || 'Property values could not be refreshed. Retry.');
   if(version===generation.current&&data.values){setValues(data.values);setAutomatic(data.automatic===true);setCollectionError(data.collection?.some((c:{state:string})=>['retrying','unavailable'].includes(c.state))?'Property collection needs a retry. Existing prices remain available; failed lookups are not treated as missing prices.':'');}
  }catch(e){if(version===generation.current)setError((e as Error).message);}
  finally{if(version===generation.current)setBusy(false);}
 }
 const needsLookup=summary.unchecked>0||summary.failed>0;
 useEffect(()=>{
  if(isDemo||!agentKey||!needsLookup)return;
  void refreshValues();
  const timer=setInterval(()=>void refreshValues(),15000);
  return()=>clearInterval(timer);
 },[report,agentKey,needsLookup]);
 const pending=summary.unchecked+summary.failed+summary.historical;
 const rows=summary.rows.filter(r=>filter==='all'||filter==='included'&&r.value.status==='included'||filter==='seller'&&r.value.status==='seller'||filter==='pending'&&['unchecked','failed','historical'].includes(r.value.status)||filter==='excluded'&&!['included','seller','unchecked','failed','historical'].includes(r.value.status));
 if(!scope)return null;
 return <section className="pipeline-card pipeline-value" aria-label="Agent database value">
  <div className="pipeline-card-head"><div><span className="pipeline-eyebrow">{scope} · USD</span><h3>Estimated database value</h3><p className="pipeline-caption">Property prices for this agent’s leads in the selected received-date period</p></div></div>
  <div className="pipeline-value-summary">
   {pending>0?<strong>Database valuation is incomplete</strong>:<div><span className="pipeline-caption">Priced portion of the database</span><br/><button className="pipeline-value-amount" aria-label="View property volume evidence" onClick={()=>{setOpen(true);setFilter('included');}}>{money(summary.amount)}</button></div>}
   <div><strong>{summary.checked} of {summary.total} leads checked</strong><p>{summary.included} with buyer property prices · {summary.excluded} checked without a usable buyer price · {summary.sellerCount} seller estimates</p>
    {pending>0&&<p>{summary.unchecked} awaiting lookup · {summary.failed} lookup failures · {summary.historical} awaiting current identity</p>}</div>
  </div>
  <progress aria-label="Property lookup coverage" value={summary.checked} max={summary.total||1}/>
  <p className="pipeline-caption">Based on original property inquiries, including leads now in nurture, rejected or closed. Missing prices are not estimated. This is not a verified purchase budget, active deal value or expected revenue.</p>
  {pending>0&&summary.included>0&&<details><summary>View the priced portion so far</summary><button className="pipeline-number" aria-label="View property volume evidence" onClick={()=>{setOpen(true);setFilter('included');}}>{money(summary.amount)} across {summary.included} leads</button><p className="pipeline-caption">This subtotal does not represent the value of the full database.</p></details>}
  {summary.sellerCount>0&&<p className="pipeline-caption">Seller estimates, separately: <button className="pipeline-number" onClick={()=>{setOpen(true);setFilter('seller');}}>{money(summary.sellerAmount)} · {summary.sellerCount} leads</button></p>}
  <div className="pipeline-value-actions"><button className="pipeline-button" onClick={()=>{setOpen(!open);setFilter('all');}}>{open?'Hide value evidence':'Review included and excluded leads'}</button>
   {!isDemo&&<button className="pipeline-button" disabled={busy} onClick={()=>void refreshValues()}>{busy?'Refreshing values…':'Refresh values'}</button>}</div>
  {!isDemo&&automatic&&<p className="pipeline-caption">Property lookups run automatically for every team and continue when you leave this page. Results are saved; this view updates every 15 seconds.</p>}
  {isDemo&&<p className="pipeline-caption">Illustrative amounts and evidence only; these values are not from the Zillow report or live FUB records.</p>}
  {error&&<p role="alert" className="pipeline-notice">{error}</p>}
  {collectionError&&<p role="status" className="pipeline-notice">{collectionError} The server will retry automatically.</p>}
  <details className="pipeline-value-policy"><summary>How amounts are selected</summary><p>Each unique lead counts once. We use the earliest accessible inquiry within five minutes of lead creation, never the contact price or a later higher-priced property. Rentals, payment signals, conflicting first inquiries, incomplete event pages and missing prices are excluded. Amounts below $25,000 or above $100 million require review; a low amount alone does not prove it is a mortgage payment. Missing rental classification is also excluded.</p><p>FUB can restrict events from API access. This is the earliest available inquiry, not a guarantee of complete original-inquiry history. Seller inquiries are separate estimates. Historical-only leads need a current identity refresh.</p></details>
  {open&&<div className="pipeline-value-evidence"><label>Show evidence<select aria-label="Filter property value evidence" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All leads</option><option value="included">Buyer property prices</option><option value="seller">Seller estimates</option><option value="excluded">Checked without usable buyer price</option><option value="pending">Pending / failed lookups</option></select></label>
   <p className="pipeline-caption">{rows.length} matching leads</p><ul>{rows.map(({key,value})=>{const l=leads.find(l=>l.key===key)!;return <li key={key}><div><strong>{l.fubUrl?<a href={l.fubUrl} target="_blank" rel="noreferrer">{l.name || 'Unnamed lead'} ↗</a>:l.name || 'Unnamed lead'}</strong><small>{l.stage || 'No stage'} · {l.assigned_to || l.pond || 'Unassigned'}</small><small>{value.reason}</small>{value.amount===null&&value.observedAmount!==null&&<small>Excluded inquiry amount: {money(value.observedAmount)}</small>}{value.eventAt&&<small>Inquiry {new Date(value.eventAt).toLocaleString()} · event {value.eventId}</small>}{value.checkedAt&&<small>Checked {new Date(value.checkedAt).toLocaleString()}</small>}</div><span>{money(value.amount)}<small>{value.status==='included'?'Buyer property price':value.status==='seller'?'Seller estimate':value.status==='unchecked'?'Lookup pending':value.status==='failed'?'Lookup failed':value.status==='historical'?'Identity refresh needed':'Checked / '+value.status}</small></span></li>;})}</ul></div>}
 </section>;
}
