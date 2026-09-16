import { calculatePipeline, type PipelineFilters, type PipelineLead } from './pipeline';
/** Transcribed screenshot arithmetic; demonstration only, never a live data fallback. */
export function pipelineFixture(filters?: PipelineFilters) {
  const now = new Date(), created = new Date(now.getFullYear(),now.getMonth(),1,12).toISOString();
  const names=['Alex Morgan','Taylor Reed','Team Profile','Jordan Ellis','Casey Lane','Riley Brooks','Sam Carter','Jamie Quinn','Drew Parker'];
  const stages=['New','Attempted contact','Spoke with customer','Appointment set','Met with customer','Showing homes','Submitting offers','Under contract','Sale closed','Nurture','Rejected'];
  const counts=[
    [8,7,15,2,13,6,0,1,11,76,26],[0,8,4,2,5,2,0,2,6,50,14],
    [3,1,8,1,4,3,0,0,0,33,14],[0,0,1,4,0,6,0,2,1,22,17],
    [0,4,2,1,3,4,1,3,0,25,2],[2,3,2,3,3,1,0,2,0,13,1],
    [0,1,7,4,2,0,0,2,0,7,5],[0,0,1,0,0,0,0,0,0,11,1],[0,0,5,0,1,0,0,1,0,3,0],
  ];
  const leads:PipelineLead[]=[];let id=0;
  counts.forEach((cs,a)=>cs.forEach((n,s)=>{for(let i=0;i<n;i++)leads.push({
    team_id:'demo-team',fub_person_id:++id,name:'Sample lead '+id,stage:stages[s],stage_id:s+1,
    assigned_to:names[a],assigned_user_id:a+1,assigned_pond_id:a===2?1:null,pond:a===2?'Team Profile':null,
    source:'Zillow',source_family:'Zillow',fub_created:created,synced_at:now.toISOString(),
  });}));
  return calculatePipeline({leads,teams:[{id:'demo-team',org_id:'demo',name:'Sample Realty',fub_subdomain:null}],
    agents:names.filter((_,i)=>i!==2).map(name=>({id:'demo-agent-'+(names.indexOf(name)+1),team_id:'demo-team',name,fub_user_id:names.indexOf(name)+1})),
    filters:filters || {orgId:'demo',teamId:null,from:null,through:now.toISOString(),timezone:'America/Los_Angeles',sources:[]},
    historyState:'demonstration',insightsEnabled:true,canMapStages:false});
}
