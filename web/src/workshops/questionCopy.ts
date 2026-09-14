import type { CourseQuestion } from '../lib/api';

// Wording overlay for known legacy questions only. IDs, order, choice count,
// and correct-choice positions are unchanged, so stored attempts still match.
const replacements: Record<string, {prompt: string; choices?: string[]}> = {
  'LEAD is the whole first call. What do the four letters stand for, in order?': {
    prompt: 'What does ALMS stand for?',
    choices: ['Ask, Listen, Meet, Sell','Appointment, Location, Motivation, Summarize','Appointment, Lending, Money, Signature','Ask, Location, Mortgage, Summary'],
  },
  'When do you ask for the appointment?': {
    prompt: 'When do you normally invite the appointment on a first call?',
    choices: ['After a full qualification interview','Early, after introducing yourself and connecting to the request','Only after preapproval','Only in the closing summary'],
  },
  'How do you extend the invitation?': {
    prompt: 'How do you make a useful appointment invitation?',
    choices: ['Ignore the requested time','Respect the request and offer genuine available options','Wait for the buyer to repeat the request','Promise access before checking'],
  },
  'The voicemail when they do not pick up is:': {
    prompt: 'What should an opening voicemail help the buyer understand?',
    choices: ['Every discovery question','Who you are, the inquiry you are responding to, and how to reconnect','Only an unfamiliar callback number','The whole buying process'],
  },
  'Every one of those follow-up attempts is:': {
    prompt: 'How do you keep follow-through useful?',
    choices: ['Rely entirely on memory','Record the relevant conversation and use tasks to remember agreed next steps','Send the same empty check-in repeatedly','Ignore the buyer’s communication preference'],
  },
  'The fourth of the six moves when they start asking questions is:': {
    prompt: 'A buyer asks a property question you cannot answer yet. What should you do?',
    choices: ['Guess so you can keep the call moving','Say what needs checking, agree to get the answer, and follow up','Ignore it and ask about their timeline','Ask about budget before helping'],
  },
  'When you cannot reach somebody, the first seven days do the work. How many attempts?': {
    prompt: 'What is TRU’s first-week target while a new lead remains unanswered?',
    choices: ['One voicemail, then stop','Aim for ten personal touches including day one; adapt when the buyer responds','Count only automated messages','Keep the same quota after the buyer agrees to a plan'],
  },
  'Advocate, not gatekeeper means you:': {prompt:'How should you use what the buyer tells you on the first call?'},
  'Why show two or three homes, never one?': {
    prompt:'Why prepare two or three relevant homes when suitable options are available?',
    choices:['Zillow requires three showings per lead','Comparisons help buyers explain their preferences','Buyers get tired after a single house','One house is easier to schedule'],
  },
  'Available, not attached means you:': {prompt:'How can you give the buyer space during the showing?'},
  'Say the real thing. Skip the rest. What is worth saying out loud?': {prompt:'Which observation should you raise with the buyer?'},
  'How do you ask what would make it an eight?': {
    prompt:'What would help you understand what the home was missing?',
    choices:['Assume the buyer wants the same features as you','Ask what would need to be different for the home to work for them','Tell them which features should matter','Skip to financing'],
  },
  'Cash under the bed, or a lender — what are you actually finding out?': {prompt:'When you ask about cash or a lender after a showing, what are you learning?'},
};
export function workshopQuestion(q: CourseQuestion, day: number | null): CourseQuestion {
  if(day!==2&&day!==3)return q;
  const patch=replacements[q.prompt];
  return patch?{...q,...patch}:q;
}
