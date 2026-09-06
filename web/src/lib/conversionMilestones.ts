import {isClosing,stageClass} from '../../../shared/flags';
export function hasContractMilestone(lead:{stage?:string|null;history?:Record<string,unknown>|null}):boolean {
  // One boolean per lead: closing proves the earlier contract milestone, but
  // must never add a second conversion when both events are present.
  return lead.history ? !!(lead.history.uc || lead.history.closed) : isClosing(stageClass(lead.stage));
}
export function rawConversionPercent(converted:number,leads:number):number|null {
  return leads>0 ? 100*converted/leads : null;
}
