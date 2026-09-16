import type {PipelineReport,PipelineOwner} from './pipeline';
import type {PipelineInsight} from './pipelineInsights';
const pct=(v:number|null)=>v===null?'unavailable':v.toFixed(1)+'%';
export function metricCandidates(report:PipelineReport,agent:PipelineOwner):PipelineInsight[] {
  const card=(id:string,title:string,observation:string,interpretation:string,action:string,numerator:number,denominator:number):PipelineInsight=>({
    id,kind:'metric',title,observation,interpretation,action,evidence:[],metric:{label:title,numerator,denominator},
  });
  const cards=[
    card('contribution','Lead share and conversion share',
      agent.name+' owns '+agent.total+' of '+report.totals.total+' selected leads ('+pct(agent.leadShare)+') and '+agent.conversions+' of '+report.totals.conversions+' current conversions ('+pct(agent.conversionShare)+').',
      'These shares describe the current book. Lead age, source mix and reassignment can affect the comparison; they do not establish individual effort or cause.',
      'Discuss whether the leads in this book had comparable time and opportunity to convert. Use the same received-date and source filters when comparing agents, so differences in their books remain visible.',
      agent.conversions,report.totals.conversions),
    card('nurture','Outside the active pipeline · nurture',
      agent.nurture+' of '+agent.total+' leads are in nurture ('+pct(agent.nurturePct)+'); the team is at '+pct(report.totals.nurturePct)+'.',
      'Nurture can reflect a longer buyer timeline. The stage alone does not show whether the agent stopped trying or whether the buyer needs more time.',
      'Open the nurture leads together and ask what the buyers said about their timing and next steps. Use the published conversation evidence to decide which conversation needs coaching before recommending a change.',
      agent.nurture,agent.total),
    card('rejected','Outside the active pipeline · rejected',
      agent.rejected+' of '+agent.total+' leads are rejected ('+pct(agent.rejectedPct)+'); the team is at '+pct(report.totals.rejectedPct)+'.',
      'The label records a status, not a reason. It cannot distinguish an unsuitable lead from a conversation that ended prematurely.',
      'Review the reasons documented on the rejected leads with the agent. Where a published conversation shows a missed opportunity, discuss that specific moment and why the recommended response helps the buyer.',
      agent.rejected,agent.total),
  ];
  return cards.filter(c=>c.id==='contribution'||c.metric!.numerator>0);
}
