import {useEffect,useState} from 'react';
import {isDemo,workerFetch} from '../lib/api';
import type {ContactReport} from '../../../shared/contactSpeed';
import './contactSpeed.css';
const elapsed=(seconds:number|null)=>seconds===null?'Not established':seconds<60?`${Math.round(seconds)}s`:`${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m`;
const date=(s:string)=>new Date(s).toLocaleString();
function leadLink(url:string){try{const u=new URL(url);return u.protocol==='https:'&&/^[a-z0-9-]+\.followupboss\.com$/.test(u.hostname)?u.href:undefined;}catch{return undefined;}}
export function ContactSpeedPanel({orgId,coaching=false}:{orgId:string;coaching?:boolean}){
 const [report,setReport]=useState<ContactReport|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{let active=true;setReport(null);setLoading(true);setError('');(async()=>{if(isDemo)return null;const r=await workerFetch(`/data/contact-speed?orgId=${encodeURIComponent(orgId)}`);if(!r.ok)throw Error('Contact timing could not be loaded.');return (await r.json() as {report:ContactReport|null}).report;})().then(r=>{if(active)setReport(r);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[orgId,retry]);
 if(coaching && !loading && !error && !report) return null;
 return <section className="contact-speed"><h2>{coaching?'First-contact habits':'Speed to recorded contact'}</h2><p>CRM creation to the first verified personal call, text or Zillow message. Email and automatic outreach are excluded. This is not time from accepting the lead.</p>
 {error?<div role="alert">{error} <button onClick={()=>setRetry(x=>x+1)}>Retry</button></div>:loading?<p role="status">Loading contact evidence…</p>:!report?<p>No audited contact report is available for this team yet. Missing data is not a zero response time.</p>:<>
 <p className="contact-note">Report window: {date(report.from)} to {date(report.through)} (end excluded). Evidence collected {date(report.capturedAt)}. This report has its own window, independent of the lead-cohort filter.</p>
 {report.agents.map(a=><details className="contact-agent" key={a.agentId}><summary><strong>{a.agentName}</strong><span>{a.measured} of {a.total} leads measured</span><b>{elapsed(a.averageSeconds)}</b></summary>
 <p>Average = total elapsed time for the {a.measured} measured leads ÷ {a.measured || 'no eligible leads'}. Other leads are excluded, not counted as zero.</p>
 <h3>Call-first outreach</h3><p>{a.skill.callFirst} call-first · {a.skill.textFirst} text-first · {a.skill.textPercent===null?'No verified starts':`${a.skill.textPercent.toFixed(0)}% text-first`}.</p><p className="contact-note">Seven-day window: {date(a.skill.from)} to {date(a.skill.through)}. {a.skill.aboveThreshold?'Practice focus: lead with a phone call. Text-first outreach is above 30%. ':''}{!a.skill.fullWindow && 'This report does not cover the full seven days. '}These counts describe observed first attempts. Review the source context and practice the opening call; the counts alone do not establish fear or motivation.</p>
 {a.results.map(r=><details className="contact-lead" key={r.lead.leadId}><summary><span>Lead #{r.lead.leadId}</span><b>{r.status==='missing_record'?'Communication reported, record missing':r.status==='connection'?'Zillow connection recorded':elapsed(r.seconds)}</b></summary><p>{r.reason}</p><dl><dt>CRM created</dt><dd>{date(r.lead.createdAt)}</dd>{r.first&&<><dt>Contact</dt><dd>{r.first.channel.replace('_',' ')} · {date(r.first.at!)} · {r.first.id}</dd><dt>How counted</dt><dd>{r.first.explanation} Elapsed time: {elapsed(r.seconds)}.</dd></>}{r.lead.gap&&<><dt>Agent statement</dt><dd>{r.lead.gap.statement}</dd><dt>Recorded</dt><dd>{date(r.lead.gap.recordedAt)} · {r.lead.gap.sourceId}</dd><dt>What was checked</dt><dd>{r.lead.gap.checked}</dd></>}{r.lead.connection&&<><dt>Connection proof</dt><dd>{r.lead.connection.sourceId}: {r.lead.connection.explanation}</dd></>}</dl>{leadLink(r.lead.leadUrl)&&<a href={leadLink(r.lead.leadUrl)} target="_blank" rel="noopener noreferrer">Open contact in Follow Up Boss ↗</a>}</details>)}
 </details>)}
 </>}
 </section>;
}
