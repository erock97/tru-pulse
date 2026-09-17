import { reviseDay4 } from './day4-training.mjs';
import { refineDay3 } from './day3-language.mjs';
// Eric's approved four-quadrant structure. Apply after the original generators.
// Existing IDs, native FUB exercises, and response contracts remain stable.
const esc = s => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const rows = items => `<div class="rows">${items.map(([title,text])=>`<div class="row"><h3>${title}</h3><p>${text}</p></div>`).join('')}</div>`;
const para = text => `<p class="lesson-explanation">${text}</p>`;
const quote = text => `<blockquote class="lesson-example">${text}</blockquote>`;
export function reviseTraining(data) {
 if(data.day===4)return reviseDay4(data);
 const day=data.day, original=new Map(data.slides.map(s=>[s.id,s]));
 const get = id => {const s=original.get(`day${day}-${id}`);if(!s)throw Error(`Missing day${day}-${id}`);return structuredClone(s)};
 const make=(id,title,lead,body,time=2)=>({id:`day${day}-${id}`,chapter:'',title,lead,body,time,theme:'tru alms lesson training-depth',notes:'Use the visible explanation as the teaching reference. Ask what the agent would do, hear the reason, then demonstrate the steps. Fictional examples illustrate the existing TRU process.\nSources: existing day curriculum; Eric’s September 16 quadrant and independent-review requirements.\nHandoff: Connect this example to the next action the agent needs to take.',cue:'Use the answer to explain why the next action matters to this buyer.'});
 const discussion=(id,title,lead,questions,model,time=3)=>{
  const s=make(id,title,lead,`<ol class="discussion-questions">${questions.map(q=>`<li>${q}</li>`).join('')}</ol>`,time);
  s.theme+=' lesson-question';
  s.activity={id:s.id,kind:'discussion',prompt:lead,fields:[{id:'thinking',label:'What would you do, and why? What information would change your answer?'}],model};
  s.body+=`<label class="field">${s.activity.fields[0].label}<textarea data-save="thinking"></textarea></label><details class="reveal"><summary>After your answer: review the explanation</summary><div>${esc(model)}</div></details>`;
  s.notes='Present the situation without giving the answer. Allow a quiet first response, then hear two different approaches. Recognize sound reasoning and identify gaps before moving to the teaching slides. This discussion is ungraded.\nHandoff: Now compare your approach with the steps and example that follow.\nSources: Eric’s September 16 teaching format; existing TRU curriculum.';
  return s;
 };
 const groups=[];
 const group=(title,purpose,slides)=>groups.push({title,purpose,slides});
 let welcome,agenda,closing;
 if(day===1){
  welcome=get('how-a-zillow-lead-reaches-you');
  welcome.body=para('Learn where to click, what to save, and how to check the result in Follow Up Boss. Watch each demonstration, then use your own simulated record in TrueHQ.');
  group('Get ready and find your way around','Understand the program, then locate the controls you will use.',[
   ...['preferred-opportunity','preferred-onboarding','preferred-standards','capacity-decision','fub-login-and-navigation','start-in-people','contact-tool-map'].map(get)
  ]);
  group('Update the contact after a conversation','Save the stage and a useful note from what actually happened.',[
   ...['first-message-and-call','check-the-details-panel','set-appointment','smart-actions','smart-actions-review','my-agent','zillow-insights','write-what-the-next-agent-needs','spoke-note'].map(get),
   make('note-example','Write a note another agent can use','Fictional example: Avery agreed to a Saturday visit, but access still needs confirmation.',quote('“Avery wants an enclosed office for daily work calls. Saturday at 11 works for the buyer. Property access is pending. I will confirm access and call Avery by 5 today. If the time is unavailable, we will agree on another option.”')+para('The note separates the buyer’s preference from confirmed access. Create the follow-up task separately so the promise appears in your work queue.'))
  ]);
  group('Organize and complete the follow-up','Use tasks and appointments correctly, then repair an incomplete record.',[
   ...['give-the-follow-up-a-date-and-time','noanswer-task','choose-the-tool','nurture-discussion','repair-averys-record','avery-repair','check-the-record-before-moving-on','inbox-workflow','daily-priorities'].map(get)
  ]);
  group('Record the accepted offer and check your work','Practice the deal entry and leave a record the team can continue from.',[
   ...['practice-adding-a-deal','offer-accepted','transaction-handoff','where-will-you-start-tomorrow','before-your-next-client-conversation','activation-readiness'].map(get)
  ]);
  closing=get('official-references');
  data.title='Work your Zillow leads in Follow Up Boss';
 } else if(day===2){
  welcome=get('welcome');
  group('Recognize the lead and respond','Identify the request before choosing your first action.',[
   discussion('discuss-response','What would you do when this lead arrives?','A Zillow request reaches you at 2 p.m. The buyer writes, “I’m at work. Please call at 5 about Cedar Lane.”',['What would you do now?','What would you save so the callback happens?'],'Acknowledge the request and introduce yourself by text now. Call at five as requested. Save the callback task. The buyer’s explicit contact instruction changes the usual prompt-call approach.'),
   ...['live-connection','real-time-touring','standard-tour','lead-discussion','channel','no-answer','unanswered','channel-check'].map(get)
  ]);
  group('Open the first conversation','Introduce yourself and invite the appointment early.',[
   discussion('discuss-opening','How would you open this call?','George requested a tour of Cedar Lane but did not select a time. You can meet Saturday morning or afternoon. Access still needs checking.',['Say your first two sentences.','Where would you put the appointment invitation?'],'Use your name, brokerage, Zillow connection and reason for calling. Invite the visit early with real availability. Then ask and listen. LEAD gives this order so the buyer’s request stays central.'),
   ...['alms','introduction','opening-decision'].map(get)
  ]);
  group('Understand what the buyer needs','Use each answer to choose a useful follow-up question.',[
   discussion('discuss-discovery','What would you ask about needing more space?','The buyer says, “We need more space, but we don’t want to leave our neighborhood.”',['What does that tell you?','What do you still need to understand?'],'Ask what the extra space would let them do. Follow the answer: a quiet work area is different from storage or a larger gathering space. Confirm your understanding before treating a feature as a requirement.'),
   ...['conversation-starters','next-question'].map(get),
   make('discovery-example','Follow the answer before choosing a feature','Fictional conversation after the appointment invitation.',rows([['Agent asks','“What would the extra space let you do?”'],['Buyer explains','“I take work calls at the kitchen table. Everyone has to stay quiet.”'],['Agent follows up','“Would a separate room solve that, or do you also need distance from the main living area?”'],['Agent checks','“So being able to close a door and take calls matters more than the total square footage. Have I understood that?”']])),
   get('discovery-practice')
  ]);
  group('Work through concerns and agree on the next step','Understand the reason, offer useful help, and summarize the agreement.',[
   get('buyer-concerns'),
   discussion('discuss-concern','What would you ask before offering a solution?','The buyer says they are uncertain about the market and hesitate when you offer a visit.',['What might they mean by “uncertain”?','How would different answers change the help you offer?'],'Ask what part concerns them. A fear of choosing the wrong home calls for different help than uncertainty about payment. Offer an action based on the answer and check whether it would help. Avoid predictions or pressure.'),
   ...['objection-framework','market-concern','objection-practice','summary','summary-practice','full-call-practice','follow-through'].map(get)
  ]);
  closing=get('reference');
  // Protect the speaking turns while making room for discussion inside 90 minutes.
  const timings={'live-connection':2,'real-time-touring':3,'lead-discussion':2,'channel-check':2,'opening-decision':2,'conversation-starters':3,'next-question':2,'objection-framework':2,'buyer-concerns':2,'market-concern':2,'objection-practice':3,'summary-practice':2};
  for(const g of groups)for(const s of g.slides)if(timings[s.id.slice(5)])s.time=timings[s.id.slice(5)];
 } else if(day===3){
  welcome=get('welcome');welcome.title='Prepare for a successful showing';
  group('Prepare before you arrive','Research the homes and build a tour that serves this buyer.',[
   discussion('discuss-preparation','What should be ready before tomorrow’s showing?','You are meeting a buyer tomorrow. They want a quiet office and a usable yard. They have an afternoon available for the tour.',['What would you research about each home?','How many homes would you propose, and why?','What would you ask the listing agent and confirm with the buyer?'],'Prepare two to four relevant homes when the buyer’s time, preferences and access allow. Review available property information and comparisons, call the listing agent, explain tradeoffs, confirm access and bring a useful packet. The number supports a thoughtful tour; it does not override the buyer’s needs.',4),
   make('property-research','Review the property information before the showing','Know what the available records say and which questions remain unanswered.',rows([['Read the available documents','Review the listing and seller disclosures. Identify facts that affect the buyer’s stated needs and flag missing information.'],['Prepare useful comparisons','Review three relevant comparable sales where available. Note the differences that make each comparison useful rather than assuming the prices are directly interchangeable.'],['Check practical details','Review property taxes and school district information. Record the source and any question that needs confirmation. Explain the information without guessing.']]),3),
   make('listing-agent-call','Call the listing agent with specific questions','Use the call to prepare accurate information and confirm the visit.',rows([['Ask about the listing','“Is there an offer deadline or offer activity we should know about?” Ask about seller timing and any rent-back request.'],['Ask about unresolved facts','“The available materials do not state the roof age. Is there documentation you can share?” Keep reported information separate from verified documents.'],['Confirm access','Check appointment approval and showing instructions. A buyer’s preferred time does not establish access. If an answer is pending, record it and plan the update.']]),3),
   make('prepare','Choose two to four homes for a useful comparison','Use the buyer’s priorities, available time and confirmed access to shape the tour.',rows([['Explain why each home belongs','“This home has the enclosed office you wanted. The yard is smaller. Would comparing the layout still be useful?”'],['Respect firm requirements','If the yard is nonnegotiable, revise the options. More homes are useful only when the comparisons help the buyer decide.'],['Confirm the tour plan','Agree on the meeting place, sequence and timing. Review access instructions and the applicable brokerage-approved agreement before the visit.']]),3),
   make('buyer-packet','Bring information the buyer can use during the tour','Prepare the packet before leaving so you can focus on the buyer at the home.',rows([['For each home','Include the MLS sheet and useful comparable sales. Add relevant neighborhood information with its source.'],['For the conversation','Mark the property facts tied to the buyer’s needs and keep unresolved questions visible. Use the packet to support an explanation rather than read every field aloud.'],['Before you leave','Recheck appointment confirmations, showing instructions and the meeting plan. Bring a physical packet as in the preparation example.']]),2),
   discussion('comparison-discussion','Practice preparing tomorrow’s tour','Use the same buyer: a quiet office, a usable yard and one afternoon to see homes. Before we move to the showing, put the preparation together.',['Choose two to four homes and explain why each belongs on this buyer’s tour.','Name the information you would research and the questions you would ask the listing agents.','Explain what you would confirm with the buyer and bring to the appointment.'],'A complete plan connects each home to the buyer’s needs, identifies missing property information, confirms access and timing, and includes useful documents. Explain any tradeoff before the visit. Adjust the selection when a firm requirement is not met.',4)
  ]);
  group('Conduct the showing','Welcome honest reactions and learn what the home needs to do for the buyer.',[
   discussion('discuss-showing','How would you respond when buyers react differently?','During the first tour, one buyer loves the open living area. Their partner says, “I could never work from home here.”',['What would you say first?','What do you need to understand before suggesting a solution?'],'Invite each buyer to explain how they would use the home. Learn what work calls require before suggesting a room change. Make honest reactions welcome and avoid choosing a priority on their behalf.'),
   ...['drop-the-rope','during-the-visit','question-bank','different-priorities'].map(get)
  ]);
  group('Lead the post-tour conversation','Ask about an offer, then follow the buyer’s answer.',[
   discussion('discuss-post-tour','What would you ask before the buyer leaves?','The tour has finished. The buyer has mentioned things they liked and things that did not work.',['How would you ask for a few minutes?','What would your first question be?','What changes if they say yes, no or unsure?'],'Ask for a few minutes and explain the purpose. Start with “Did we see any homes we want to write an offer on?” Then follow the answer. Do not infer a decision from silence, criticism or a rating.'),
   get('after-the-tour'),
   make('offer-answer','Let the offer answer guide your next question','Start with: “Did we see any homes we want to write an offer on?”',rows([['If they say yes','Clarify which home and what they need to move into the offer conversation. Interest does not resolve unanswered property or financing questions.'],['If they say no','Ask what worked and what did not. “Which home came closest? What was missing?” Use the answer to refine the next search.'],['If they are unsure','Ask what would help them decide. Identify the missing information or concern and agree how to address it. A high rating alone is not permission to write.']]),2)
  ]);
  group('Understand concerns and agree on a plan','Connect useful help to the buyer’s reason and follow through.',[
   get('buyer-concerns'),get('problem-solving-discussion'),get('concern-framework'),get('plan-demo'),get('pending-answer'),get('plan-check'),get('record-the-plan'),get('full-showing-practice'),get('write-the-follow-up-record')
  ]);
  closing=get('wrap');
  const timings={'drop-the-rope':2,'during-the-visit':2,'question-bank':2,'different-priorities':2,'after-the-tour':3,'feedback-demo':2,'buyer-concerns':1,'problem-solving-discussion':3,'concern-framework':2,'plan-demo':2,'pending-answer':2,'plan-check':2,'record-the-plan':1,'write-the-follow-up-record':2};
  for(const g of groups)for(const s of g.slides)if(timings[s.id.slice(5)])s.time=timings[s.id.slice(5)];
  data.title='Prepare for the showing and help the buyer decide';
 }
 agenda=make('agenda','What you will learn and practice',day===1?'Watch the demonstration, practice in your own record, then check what saved.':'For each topic, share your thinking first. Then study the explanation and practice the approach.',`<ol class="quadrant-agenda">${groups.map((g,i)=>`<li><span>0${i+1}</span><div><h3>${g.title}</h3><p>${g.purpose}</p></div></li>`).join('')}</ol>`,1);
 welcome.chapter=welcome.chapter||'Welcome';
 agenda.chapter=welcome.chapter;
 welcome.theme='tru alms alms-cover training-depth';
 const ordered=[welcome,agenda];
 groups.forEach((g,i)=>{
  const section=make(`quadrant-${i+1}`,g.title,g.purpose,para(day===1?'You will watch the relevant steps, complete the exercise, and verify what saved.':'Start by explaining what you would do. The teaching and worked examples follow your discussion.'),0);
  section.theme=`tru alms training-depth quadrant-cover section-${i+1}`;
  section.body=`<div class="section-flow">${(day===1?['Watch the demonstration','Practice the steps','Review your work']:['Discuss your approach','Learn the steps','Put it into practice']).map((label,j)=>`<div><span>0${j+1}</span><p>${label}</p></div>`).join('')}</div>`;
  section.chapter=`${i+1}. ${g.title}`; section.quadrant=i+1;
  ordered.push(section);
  for(const s of g.slides){
   s.chapter=section.chapter;s.quadrant=i+1;
   s.theme=[...new Set(`${s.theme} training-depth`.split(/\s+/))].join(' ');
   if(s.activity&&!s.native)s.theme+=' lesson-question';
   ordered.push(s);
  }
 });
 closing.chapter='Review and reference';ordered.push(closing);
 // Explicit review directions travel with the deck, not only the facilitator notes.
 const review=make('independent-review','Use this training after the session','Revisit the explanation, try the exercise, then compare your work.',rows([['Find the topic','Use the four sections to return to the action you need. Read the example and the reason for the next step.'],['Practice again',day===1?'Open the interactive lesson in Rep. Complete each simulated record exercise, save it, and use the check to verify the result. The printable reference cannot perform the record action.':'Answer the scenario before opening its explanation. For a conversation exercise, use the buyer card with a partner, get one specific correction, and retry.'],['Keep a reference','Download the agent reference for the teaching and examples. Keep practice notes separate from real customer records.']]),1);
 review.chapter='Review and reference';ordered.push(review);
 for(const s of ordered){
  if(s.title==='What would you do?')s.title=s.id.includes('different-priorities')?'Ask what each buyer needs from the home':s.id.includes('pending-answer')?'Update the buyer when a property answer is still pending':'Respond when the buyer questions your home selection';
  if(day===3){
   const photos={'property-research':'property','listing-agent-call':'follow-up','prepare':'home','buyer-packet':'questions','drop-the-rope':'arrival','during-the-visit':'conversation'};
   const key=s.id.slice(5);
   if(photos[key])s.theme+=' lesson-photo photo-'+photos[key];
   if(key==='prepare')s.theme+=' tour-comparison';
   if(key==='drop-the-rope')s.theme+=' welcome-quote';
   if(key==='comparison-discussion')s.theme+=' preparation-practice';
   if(key==='question-bank'){
    s.title='Let the buyer’s reaction lead to one useful question';
    s.lead='Give them time to experience the room. When they share a reaction, follow that thought instead of starting a list of questions.';
    s.body='<div class="conversation-sequence"><div class="conversation-turn"><span>Buyer</span><blockquote>“This office could work.”</blockquote><p>Let them look around and finish their thought.</p></div><div class="conversation-turn"><span>Agent</span><blockquote>“What would work better here than in your current setup?”</blockquote><p>Ask one question tied to what they just said. Then listen.</p></div><div class="conversation-turn"><span>Buyer</span><blockquote>“I could close the door during calls.”</blockquote><p>Now you know why the room matters. Check your understanding before changing the search.</p></div></div><p class="conversation-close">“So you need a room where you can close the door for calls. Is that right?”</p>';
    s.theme+=' conversation-example';
   }
  }
  if(s.id==='day2-objection-framework')s.title='Understand the concern before offering help';
  if(s.id==='day4-how-would-you-answer-jordan')s.title='Explain the buyer’s lender choice';
  if(s.id==='day4-how-to-introduce-your-loan-officer')s.notes='Use the visible example to explain each part before the practice. Ask agents which question would help this buyer. Preserve their choice.\nHandoff: Practice the introduction with a buyer who can respond.';
  if(s.id==='day4-first-introduction-practice')s.notes='The framework and example now come before this practice. Give each agent a speaking turn, specific feedback and a targeted retry. Do not label a peer or self-check as coach sign-off. Respect a declined introduction.\nHandoff: Now apply the same approach to confirming and completing the handoff.';
  if(s.id==='day4-pre-qualification-pre-approval-and-final-approval')s.body=rows([['Pre-qualification','Zillow describes this as an estimate using self-reported information and a soft credit check. Ask what the buyer has actually completed.'],['Pre-approval','The lender reviews supporting information and identifies conditions. Ask the loan officer what has been verified and what remains before relying on the letter.'],['Final approval','The lender must resolve the remaining borrower and property requirements. A pre-approval letter does not guarantee funding. Confirm readiness and timing with the loan officer.']])+para('<a href="https://www.zillow.com/homeloans/zillow-home-loans-faqs/">Zillow Home Loans FAQ</a>, reviewed September 16, 2026. Ask the lender to explain credit inquiries for this buyer before they proceed.');
  if(s.id==='day4-questions-for-the-loan-officer')s.body=rows([['Before the buyer proceeds','“What will you review at this step? Will it involve a soft or hard inquiry, and what should the buyer expect afterward?”'],['Before relying on a letter','“What has been verified? What documents or conditions remain? Does this property change the review or payment?”'],['Before committing to timing','“What can you support on this file, and what do you need first?” Give the buyer the confirmed answer rather than a general estimate.']]);
  if(s.id==='day4-how-would-you-answer-jordan')s.lead='Jordan asks, “Do I have to use Zillow Home Loans?” Choose a response, then explain how you would follow their decision.';
  // Every deck uses the existing website palette and consistent question layouts.
  if(!s.native&&!s.theme.includes('alms-cover'))s.theme=[...new Set(`tru alms lesson ${s.theme} training-depth`.split(/\s+/))].join(' ');
 }
 if(day===3)refineDay3(ordered);
 ordered.forEach((s,i)=>{
  if(s.theme.includes('quadrant-cover'))s.body=`<p class="quadrant-number">0${s.quadrant}</p>`+s.body;
  if(s.id==='day2-channel-check')s.notes=s.notes.replace('Before voting, teach Eric’s exception: acknowledge by text now and call at the requested time.','Hear the responses first, then reinforce Eric’s exception: acknowledge by text now and call at the requested time.');
  s.cue=i+1<ordered.length?`Next: ${ordered[i+1].title}. Connect it to the action you just practiced.`:'Return to the relevant quadrant when you need the steps, then practice again.';
  s.notes=s.notes.replace(/Handoff:[^\n]*/g,'').trim()+`\nHandoff: ${s.cue}`;
 });
 data.slides=ordered;
 data.quadrants=groups.map((g,i)=>({number:i+1,title:g.title,purpose:g.purpose}));
 data.version=`2026-09-16-day${day}-quadrants-v${day===3?4:2}`;
 data.duration=ordered.reduce((n,s)=>n+s.time,0);
 if(day!==1)welcome.lead=`Day ${day} · ${data.duration} minutes including discussion and practice`;
 return data;
}
