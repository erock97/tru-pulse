import {day} from './metrics.mjs';
export function applyScope(inventory,sourceStarts,{end,timezone='America/Los_Angeles'}){
 if(!Array.isArray(inventory.users)||!inventory.users.length)throw Error('Current roster is required');
 const activeUserIds=inventory.users.filter(u=>u.status==='Active'&&u.role!=='Lender').map(u=>String(u.id));
 if(!activeUserIds.length)throw Error('No verified active roster members');
 const active=new Set(activeUserIds),seen=new Set();let excludedInactive=0;
 const people=inventory.people.filter(p=>{
  const start=sourceStarts[p.source],date=day(p.created,timezone);
  if(!start||!date||date<start||date>end)return false;
  if(!active.has(String(p.assignedUserId))){excludedInactive++;return false;}
  if(seen.has(p.id))return false;seen.add(p.id);return true;
 });
 return {...inventory,people,activeUserIds,sourceStarts,start:Object.values(sourceStarts).sort()[0],end,timezone,excludedInactive,rosterPolicy:'Only current FUB users with status Active, excluding lenders; grouped by current assigned user ID. Invited, missing and inactive users excluded.'};
}
