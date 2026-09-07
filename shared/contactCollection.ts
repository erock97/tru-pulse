import type {ContactEvent} from './contactSpeed.js';
/** A complete CRM timeline is collection coverage, not proof that off-platform contact never occurred. */
export function normalizeContactTimeline(rows:any[],personId:string):ContactEvent[]{
 const seen=new Set<string>();const events:ContactEvent[]=[];
 for(const row of rows){
  if(String(row.personId)!==personId || !row.id || seen.has(row.id))throw Error('Invalid timeline identity');
  seen.add(row.id);
  if(!['InboxAppMessage','TextMessage','Call'].includes(row.type))continue;
  const i=row.item;if(!i)throw Error('Missing communication payload');
  if(row.type==='InboxAppMessage' && i.inboxApp?.name!=='Zillow Messages')throw Error('Unreviewed messaging channel');
  if(typeof i.isIncoming!=='boolean')throw Error('Unknown communication direction');
  const zillow=row.type==='InboxAppMessage',call=row.type==='Call';
  const sender=zillow?i.sender?.userId:i.userId;
  const participant=zillow?i.participants?.find((p:any)=>p.userId!=null&&p.userId===sender):null;
  const auto=Boolean(i.leadFlowRouteId||i.actionPlanId)||participant?.isAutomation===true;
  // Participant attribution alone is not evidence that an outbound Zillow message was manually initiated.
  const personal=auto?false: i.isIncoming?null : zillow ? (participant?.isAutomation===false && i.createdById===sender && sender>0 ? true:null) : sender>0 && (call?Boolean(i.startedAt):i.createdById===sender)?true:null;
  const at=call?(i.startedAt??null):zillow?(i.sentAt??null):(i.created??null);
  events.push({id:row.id,at,channel:call?'call':zillow?'zillow_message':'sms',direction:i.isIncoming?'inbound':'outbound',agentId:sender>0?String(sender):'',personal,timeVerified:typeof at==='string'&&Number.isFinite(Date.parse(at)),deliveryStatus:i.deliveryStatus??i.status??undefined,explanation:call?'Recorded call start; manual logs without a start remain unverified.':zillow?'Zillow Messages timeline record; sender, initiation and sent time retained.':'FUB text record; lead-flow and action-plan automation excluded.'});
 }
 return events;
}
