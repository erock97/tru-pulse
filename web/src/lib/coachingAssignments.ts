import {isDemo,workerFetch} from './api';
import {assignmentInput,assignmentClosed,assignmentAwaitingReview,type CoachingAssignment,type CoachingAssignmentEvent} from '../../../shared/coachingAssignments';
import {WINNING_FIRST_CONVERSATION_ID,WINNING_FIRST_CONVERSATION_TITLE} from './winningFirstConversation';
export type {CoachingAssignment};
export {assignmentClosed,assignmentStatus,assignmentAwaitingReview} from '../../../shared/coachingAssignments';
const demoKey='tru-coaching-assignments-demo-v1';
function demoRows():CoachingAssignment[]{
 const saved=localStorage.getItem(demoKey);if(saved)return JSON.parse(saved);
 const due=new Date();due.setDate(due.getDate()+7);
 return [{id:'11111111-1111-4111-8111-111111111111',agentId:'demo',orgId:'demo',createdBy:'demo-coach',createdAt:new Date().toISOString(),commitment:'Practice the opening of a first call with your coach. Invite the buyer to an appointment early, then ask permission to learn more about what they need.',moduleId:WINNING_FIRST_CONVERSATION_ID,moduleTitle:WINNING_FIRST_CONVERSATION_TITLE,dueDate:due.toLocaleDateString('en-CA'),practiceAt:null,reflection:'',reviewedAt:null,reviewNote:'',outcome:null,passedAt:null,trainingPassed:false}];
}
export async function loadAssignments(agentId:string):Promise<{assignments:CoachingAssignment[];canAssign:boolean;canReview?:boolean}>{
 if(isDemo)return{assignments:demoRows(),canAssign:true};
 const res=await workerFetch(`/data/coaching-assignments?agentId=${encodeURIComponent(agentId)}`);
 if(!res.ok)throw Error('Your coaching work could not be loaded. Please retry.');
 return res.json();
}
export async function saveAssignment(agentId:string,input:Record<string,unknown>):Promise<{assignment?:CoachingAssignment;patch?:Partial<CoachingAssignment>}>{
 if(isDemo){
  const rows=demoRows();let assignment:CoachingAssignment|undefined;let patch:Partial<CoachingAssignment>|undefined;
  if(input.action==='create'){
   const clean=assignmentInput(input);
   const existing=rows.find(r=>r.id===input.id);
   if(existing){
    if(existing.commitment!==clean.commitment||existing.moduleId!==clean.moduleId||existing.dueDate!==clean.dueDate)throw Error('Assignment already exists');
    return {assignment:existing};
   }
   assignment={id:String(input.id),agentId:'demo',orgId:'demo',createdBy:'demo-coach',createdAt:new Date().toISOString(),...clean,moduleTitle:typeof input.moduleTitle==='string'?input.moduleTitle:null,practiceAt:null,reflection:'',reviewedAt:null,reviewNote:'',outcome:null,passedAt:null,trainingPassed:false};
   rows.push(assignment);
  }else{
   const row=rows.find(r=>r.id===input.id);if(!row)throw Error('Assignment not found.');
   if(input.action==='review'&&row.reviewedAt&&row.outcome===input.outcome&&row.reviewNote===String(input.reviewNote).trim()&&(input.outcome!=='continue'||row.dueDate===input.dueDate)&&!assignmentAwaitingReview(row))return {patch:row};
   if(assignmentClosed(row))throw Error('This assignment has already been closed.');
   let event:CoachingAssignmentEvent;
   if(input.action==='practice'){
    const reflection=typeof input.reflection==='string'?input.reflection.trim():'';
    if(!reflection||reflection.length>1200)throw Error('Describe your practice in up to 1,200 characters');
    if(assignmentAwaitingReview(row)&&reflection===row.reflection)return {patch:row};
    const practiceAt=new Date(Math.max(Date.now(),row.reviewedAt?Date.parse(row.reviewedAt)+1:0,row.practiceAt?Date.parse(row.practiceAt)+1:0)).toISOString();
    patch={practiceAt,reflection};event={kind:'practice',at:practiceAt,reflection};
   }else if(input.action==='review'){
    const reviewNote=typeof input.reviewNote==='string'?input.reviewNote.trim():'';
    if(!['complete','continue','cancelled'].includes(String(input.outcome))||!reviewNote||reviewNote.length>1200)throw Error('Choose an outcome and add a review note');
    const dueDate=input.outcome==='continue'?assignmentInput({commitment:row.commitment,dueDate:input.dueDate}).dueDate:row.dueDate;
    const reviewedAt=new Date(Math.max(Date.now(),row.practiceAt?Date.parse(row.practiceAt):0,row.reviewedAt?Date.parse(row.reviewedAt)+1:0)).toISOString();
    const outcome=input.outcome as 'complete'|'continue'|'cancelled';
    patch={dueDate,reviewedAt,reviewNote,outcome};event={kind:'review',at:reviewedAt,reviewNote,outcome,dueDate,previousDueDate:row.dueDate};
   }else throw Error('Unknown action');
   patch.history=[...(row.history??[]),event];
   patch.historyIncomplete=row.historyIncomplete||(!row.history&&!!(row.practiceAt||row.reviewedAt));
   Object.assign(row,patch);
  }
  localStorage.setItem(demoKey,JSON.stringify(rows));return{assignment,patch};
 }
 const res=await workerFetch(`/data/coaching-assignments?agentId=${encodeURIComponent(agentId)}`,{method:'POST',body:JSON.stringify(input)});
 const data=await res.json() as {error?:string;assignment?:CoachingAssignment;patch?:Partial<CoachingAssignment>};
 if(!res.ok)throw Error(data.error||'This could not be saved. Please retry.');
 if(input.action==='create'?!data.assignment:!data.patch)throw Error('The server did not confirm this save. Please retry.');
 return data;
}
