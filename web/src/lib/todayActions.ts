export function coachingDue<T extends {lastDays:number;hasRecordedCheckin?:boolean}>(people:T[],cadence:number):T[] {
  return people.filter(a=>a.hasRecordedCheckin === true && a.lastDays>=cadence).sort((a,b)=>b.lastDays-a.lastDays);
}
