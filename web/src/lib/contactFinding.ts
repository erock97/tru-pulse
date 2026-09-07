import type {ContactResult} from '../../../shared/contactSpeed';
export function contactFinding(result:ContactResult):string {
  if(result.status==='response_recorded') return 'Personal response recorded; earliest timing not confirmed';
  if(result.status==='measured') return 'Agent contact recorded';
  if(result.status==='missing_record') return 'Communication mentioned; matching record missing';
  if(result.status==='connection') return 'Zillow connection recorded; timestamp missing';
  const outreach=result.lead.events.some(event=>event.direction==='outbound' && event.channel!=='email' && event.personal!==false);
  return outreach ? 'Contact visible; first-contact timing needs review' : 'No visible agent call or text in checked records';
}
