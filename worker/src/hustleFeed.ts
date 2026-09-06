// Consume the original publisher's scores; never recalculate a competing score.
export interface WeeklyDashboard {
  teams: Array<{id:string; hustle:{latest:null|{
    weekEnding:string; capturedAt:string; deliveryStatus:string; runStatus:string;
    agents:Array<{agent:string;score:number|null;action:string;recentConnections:number;
      recentConverted:number;earlierConnections:number;earlierConverted:number;offers:number}>;
  }}}>;
}
export const HUSTLE_TEAM_BY_DOMAIN: Record<string,string> = {
  compass627:'costigan', signaturerealtynj28:'signature',
  themooregroupe:'scottmoore', woosleygroup:'woosley',
};
export function hustleFeed(dashboard:WeeklyDashboard, team:string, roster:Array<{id:string;name:string}>) {
  const matches=dashboard.teams.filter(row=>row.id===team);
  if(matches.length!==1) return {weekEnding:null,scores:[]};
  const report=matches[0].hustle.latest;
  // The publisher falls back to bundled preview fixtures. They are not live publications.
  if(!report || report.deliveryStatus==='PREVIEW_VERIFIED' || report.runStatus==='FINALIZED_LOCAL')
    return {weekEnding:null,scores:[]};
  // A delivery receipt alone does not clear a withheld/active analysis status.
  if(report.runStatus!=='FINALIZED') return {weekEnding:null,scores:[]};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(report.weekEnding) || !Number.isFinite(Date.parse(report.capturedAt)))
    throw new Error('Invalid report dates');
  const normalize=(name:string)=>name.trim().toLowerCase().replace(/\s+/g,' ');
  const scores=report.agents.map((agent,index)=>{
    if(agent.score!==null && (!Number.isFinite(agent.score)||agent.score<0||agent.score>100))
      throw new Error('Invalid published score');
    const matched=roster.filter(row=>normalize(row.name)===normalize(agent.agent));
    return {
      id:`weekly:${team}:${report.weekEnding}:${index}`,agent_id:matched.length===1?matched[0].id:null,
      agent_name:agent.agent,week_ending:report.weekEnding,final_score:agent.score,
      evidence_label:'Original weekly report',eligibility:null,ranking_eligible:null,
      offers_recent:agent.offers,broker_action:agent.action,captured_at:report.capturedAt,
      action_reason:`Recent window: ${agent.recentConverted} converted connections out of ${agent.recentConnections}. Earlier window: ${agent.earlierConverted} out of ${agent.earlierConnections}. Recent offers: ${agent.offers}. These are the weekly publisher’s inputs; Pulse has not recalculated its score.`,
    };
  });
  return {weekEnding:report.weekEnding,scores};
}
