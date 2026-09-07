import type {ContactSnapshot, ContactResult, ContactReport} from '../../shared/contactSpeed.js';
const ms=(s:string|null)=>s ? Date.parse(s):NaN;
/** Same calculation for backfills and refreshed snapshots; no model/API calls. */
export function calculateContactSpeed(snapshot:ContactSnapshot):ContactReport {
  if(snapshot.version!==1 || !Number.isFinite(ms(snapshot.from)) || !Number.isFinite(ms(snapshot.through)) || ms(snapshot.from)>=ms(snapshot.through) || !Number.isFinite(ms(snapshot.capturedAt))) throw Error('Invalid contact period');
  const through=Math.min(ms(snapshot.through),ms(snapshot.capturedAt));
  const weekStart=through-7*86400000;
  const groups=new Map<string,ContactResult[]>(),ids=new Set<string>();
  for(const lead of snapshot.leads){
    if(lead.orgId!==snapshot.orgId || !lead.agentId || !lead.leadId || ids.has(lead.leadId)) throw Error('Contact identity mismatch');
    ids.add(lead.leadId);
    if(ms(lead.createdAt)<ms(snapshot.from)||ms(lead.createdAt)>=ms(snapshot.through)||!Number.isFinite(ms(lead.createdAt))) throw Error('Lead outside contact period');
    const relevant=lead.events.filter(e=>e.direction==='outbound' && e.channel!=='email' && e.personal!==false);
    const events=relevant.filter(e=>e.agentId===lead.agentId && e.personal===true);
    const valid=events.filter(e=>e.timeVerified && Number.isFinite(ms(e.at)) && ms(e.at)>=ms(lead.createdAt) && ms(e.at)<=ms(snapshot.capturedAt)).sort((a,b)=>ms(a.at)-ms(b.at));
    let result:ContactResult={lead,status:'unknown',seconds:null,first:null,reason:'No verified first-contact sequence in the available records.'};
    if(lead.gap) result={...result,status:'missing_record',reason:'Communication was reported, but the corresponding record was not located.'};
    else if(lead.connection) result={...result,status:'connection',reason:'Zillow connection established; exact initial response time is not established.'};
    else if(lead.historyComplete && valid.length && !relevant.some(e=>e.personal===null || e.agentId!==lead.agentId || !e.timeVerified || !Number.isFinite(ms(e.at)) || ms(e.at)<ms(lead.createdAt))){
      result={...result,status:'measured',first:valid[0],seconds:(ms(valid[0].at)-ms(lead.createdAt))/1000,reason:'First verified personal call or message in the reviewed history, measured from CRM creation.'};
    }
    // Verified outreach is useful even when an earlier unrecorded interaction cannot be ruled out.
    // This is an upper bound, never an exact-first-response sample for averages or channel coaching.
    if(result.status!=='measured' && valid.length){
      result={...result,status:'response_recorded',first:valid[0],seconds:(ms(valid[0].at)-ms(lead.createdAt))/1000,reason:'Personal outreach is verified by this time. Earlier contact cannot be ruled out; excluded from first-contact averages and call-first scoring.'};
    }
    const rows=groups.get(lead.agentId)||[];rows.push(result);groups.set(lead.agentId,rows);
  }
  return {from:snapshot.from,through:snapshot.through,capturedAt:snapshot.capturedAt,agents:[...groups].map(([agentId,results])=>{
    const measured=results.filter(r=>r.status==='measured');
    const timed=results.filter(r=>r.first&&r.seconds!==null);
    const weekly=measured.filter(r=>ms(r.lead.createdAt)>=weekStart && ms(r.lead.createdAt)<through && ms(r.first!.at)<through);
    const callFirst=weekly.filter(r=>r.first!.channel==='call').length,textFirst=weekly.length-callFirst;
    const textPercent=weekly.length?100*textFirst/weekly.length:null;
    return {agentId,agentName:results[0].lead.agentName,total:results.length,measured:measured.length,averageSeconds:timed.length?timed.reduce((s,r)=>s+r.seconds!,0)/timed.length:null,responseCount:timed.length,averageIsUpperBound:timed.some(r=>r.status!=='measured'),results,skill:{from:new Date(weekStart).toISOString(),through:new Date(through).toISOString(),fullWindow:ms(snapshot.from)<=weekStart,callFirst,textFirst,textPercent,aboveThreshold:ms(snapshot.from)<=weekStart&&textPercent!==null&&textPercent>30,consistency:'observed_behavior' as const}};
  }).sort((a,b)=>a.agentName.localeCompare(b.agentName))};
}

