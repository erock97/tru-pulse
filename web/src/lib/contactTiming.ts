import type {ContactAgentResult} from '../../../shared/contactSpeed';
export function elapsedContact(seconds:number|null,upperBound=false):string {
 if(seconds===null||!Number.isFinite(seconds)||seconds<0)return 'Not established';
 const whole=upperBound?Math.ceil(seconds):Math.round(seconds);
 const hours=Math.floor(whole/3600),minutes=Math.floor(whole%3600/60),remaining=whole%60;
 return [hours?`${hours}h`:'',minutes?`${minutes}m`:'',remaining||(!hours&&!minutes)?`${remaining}s`:''].filter(Boolean).join(' ');
}
export function contactTimingSummary(agent:ContactAgentResult):string {
 if(agent.averageSeconds!==null)return `${elapsedContact(agent.averageSeconds)} average · ${agent.measured}/${agent.total} leads`;
 const timed=agent.results.filter(r=>r.first&&r.seconds!==null&&r.status==='response_recorded');
 if(!timed.length)return 'See contact findings';
 // Display each recorded bound, not a made-up exact average or the fastest lead alone.
 return timed.map(r=>`Within ${elapsedContact(r.seconds,true)}`).join(' / ')+ (agent.total>1?` · ${timed.length}/${agent.total} leads`:'');
}
