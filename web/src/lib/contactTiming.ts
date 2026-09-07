import type {ContactAgentResult} from '../../../shared/contactSpeed';
export function elapsedContact(seconds:number|null,upperBound=false):string {
 if(seconds===null||!Number.isFinite(seconds)||seconds<0)return 'Not established';
 const whole=upperBound?Math.ceil(seconds):Math.round(seconds);
 const hours=Math.floor(whole/3600),minutes=Math.floor(whole%3600/60),remaining=whole%60;
 return [hours?`${hours}h`:'',minutes?`${minutes}m`:'',remaining||(!hours&&!minutes)?`${remaining}s`:''].filter(Boolean).join(' ');
}
export function contactTimingSummary(agent:ContactAgentResult):string {
 if(agent.averageSeconds===null)return 'See contact findings';
 return `${agent.averageIsUpperBound?'Within ':''}${elapsedContact(agent.averageSeconds,agent.averageIsUpperBound)} average · ${agent.responseCount??agent.measured}/${agent.total} leads`;
}
