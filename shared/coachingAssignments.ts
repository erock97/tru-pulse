export type CoachingAssignmentEvent =
 | {kind:'practice';at:string;reflection:string}
 | {kind:'review';at:string;reviewNote:string;outcome:'complete'|'continue'|'cancelled';dueDate:string;previousDueDate:string};
export interface CoachingAssignment {
 id:string; agentId:string; orgId:string; createdBy:string; createdAt:string;
 commitment:string; moduleId:string|null; moduleTitle:string|null; dueDate:string;
 practiceAt:string|null; reflection:string; reviewedAt:string|null; reviewNote:string;
 outcome:'complete'|'continue'|'cancelled'|null; passedAt:string|null; trainingPassed:boolean;
 history?:CoachingAssignmentEvent[]; historyIncomplete?:boolean;
}
export const assignmentClosed=(a:CoachingAssignment)=>a.outcome==='complete'||a.outcome==='cancelled';
// A submission remains reviewable even while its linked training is still open.
export const assignmentAwaitingReview=(a:CoachingAssignment)=>!assignmentClosed(a)&&!!a.practiceAt&&(!a.reviewedAt||a.practiceAt>a.reviewedAt);
export function assignmentStatus(a:CoachingAssignment):string {
 if(a.outcome==='cancelled')return 'Cancelled';
 if(a.outcome==='complete')return 'Reviewed';
 if(a.outcome==='continue'&&!assignmentAwaitingReview(a))return 'Keep practicing';
 if(assignmentAwaitingReview(a))return a.moduleId&&!a.trainingPassed?'Submitted for review · training still open':'Submitted for coaching review';
 if(a.trainingPassed)return 'Training passed · practice next';
 return a.outcome==='continue'?'Keep practicing':'In progress';
}
export function assignmentInput(raw:unknown){
 const b=raw as Record<string,unknown>;
 if(!b||typeof b!=='object')throw Error('Invalid assignment.');
 const commitment=typeof b.commitment==='string'?b.commitment.trim():'';
 if(!commitment||commitment.length>1200)throw Error('Add a commitment of up to 1,200 characters.');
 const dueDate=typeof b.dueDate==='string'?b.dueDate:'';
 if(!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)||!Number.isFinite(Date.parse(dueDate))||new Date(dueDate).toISOString().slice(0,10)!==dueDate)throw Error('Choose a valid follow-up date.');
 const moduleId=b.moduleId==null||b.moduleId===''?null:String(b.moduleId);
 return {commitment,dueDate,moduleId};
}
