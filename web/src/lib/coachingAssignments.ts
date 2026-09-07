import {isDemo,workerFetch} from './api';
import {assignmentInput,type CoachingAssignment} from '../../../shared/coachingAssignments';
import {WINNING_FIRST_CONVERSATION_ID,WINNING_FIRST_CONVERSATION_TITLE} from './winningFirstConversation';
export type {CoachingAssignment};
export {assignmentClosed,assignmentStatus} from '../../../shared/coachingAssignments';
const demoKey='tru-coaching-assignments-demo-v1';
function demoRows():CoachingAssignment[]{
 const saved=localStorage.getItem(demoKey);if(saved)return JSON.parse(saved);
 const due=new Date();due.setDate(due.getDate()+7);
 return [{id:'11111111-1111-4111-8111-111111111111',agentId:'demo',orgId:'demo',createdBy:'demo-coach',createdAt:new Date().toISOString(),commitment:'Practice the opening of a first call with your coach. Invite the buyer to an appointment early, then ask permission to learn more about what they need.',moduleId:WINNING_FIRST_CONVERSATION_ID,moduleTitle:WINNING_FIRST_CONVERSATION_TITLE,dueDate:due.toLocaleDateString('en-CA'),practiceAt:null,reflection:'',reviewedAt:null,reviewNote:'',outcome:null,passedAt:null,trainingPassed:false}];
}
export async function loadAssignments(agentId:string):Promise<{assignments:CoachingAssignment[];canAssign:boolean}>{
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
   assignment={id:String(input.id),agentId:'demo',orgId:'demo',createdBy:'demo-coach',createdAt:new Date().toISOString(),...clean,moduleTitle:typeof input.moduleTitle==='string'?input.moduleTitle:null,practiceAt:null,reflection:'',reviewedAt:null,reviewNote:'',outcome:null,passedAt:null,trainingPassed:false};
   if(!rows.some(r=>r.id===assignment!.id))rows.push(assignment);
  }else{
   const row=rows.find(r=>r.id===input.id);if(!row)throw Error('Assignment not found.');
   patch=input.action==='practice'?{practiceAt:new Date().toISOString(),reflection:String(input.reflection)}:{...(input.outcome==='continue'?{dueDate:assignmentInput({commitment:row.commitment,dueDate:input.dueDate}).dueDate}:{}),reviewedAt:new Date().toISOString(),reviewNote:String(input.reviewNote),outcome:input.outcome as CoachingAssignment['outcome']};
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
