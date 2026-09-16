// Eric's approved four-quadrant structure. Apply after the original generators.
// Existing IDs, native FUB exercises, and response contracts remain stable.
const esc = s => String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const rows = items => `<div class="rows">${items.map(([title,text])=>`<div class="row"><h3>${title}</h3><p>${text}</p></div>`).join('')}</div>`;
const para = text => `<p class="lesson-explanation">${text}</p>`;
const quote = text => `<blockquote class="lesson-example">${text}</blockquote>`;
export function reviseTraining(data) {
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
   make('real-mls-example','Use a real MLS sheet to prepare for the showing','Historical example: 2075 SW Sailing Ct, McMinnville, Oregon.',`<figure class="real-mls-sheet"><a href="https://www.yamhillcounty.gov/DocumentCenter/View/19100/BO-25-413-pdf#page=94" target="_blank" rel="noopener"><img src="/workshops/examples/real-mls-sailing-ct.jpg" alt="Original MLS report excerpt for 2075 SW Sailing Ct, marked Sold, with a report date of March 24, 2025. MLS number 23022380." /></a><figcaption>Original report excerpt; source markup retained. <a href="https://www.yamhillcounty.gov/DocumentCenter/View/19100/BO-25-413-pdf#page=94" target="_blank" rel="noopener">Open the full sheet in Yamhill County’s public document · PDF page 94 ↗</a></figcaption></figure><div class="mls-reading-points"><div><h3>Check status and date first</h3><p>This sheet is marked Sold and dated March 24, 2025. Use it to study the format, not as a currently available home.</p></div><div><h3>Connect the facts to the search</h3><p>The sheet lists 2,446 square feet and 0.51 acres. Use the actual fields to compare properties; size alone does not show whether the layout fits the buyer.</p></div><div><h3>Identify what still needs an answer</h3><p>A year built is not a roof-replacement date. Record the buyer’s unanswered property questions and seek supporting information before the tour.</p></div></div>`,3),
   discussion('comparison-discussion','Practice preparing tomorrow’s tour','Use the same buyer: a quiet office, a usable yard and one afternoon to see homes. Before we move to the showing, put the preparation together.',['Choose two to four homes and explain why each belongs on this buyer’s tour.','Name the information you would research and the questions you would ask the listing agents.','Explain what you would confirm with the buyer and bring to the appointment.'],'A complete plan connects each home to the buyer’s needs, identifies missing property information, confirms access and timing, and includes useful documents. Explain any tradeoff before the visit. Adjust the selection when a firm requirement is not met.',4)
  ]);
  group('Conduct the showing','Welcome honest reactions and learn what the home needs to do for the buyer.',[
   discussion('discuss-showing','How would you respond when buyers react differently?','During the first tour, one buyer loves the open living area. Their partner says, “I could never work from home here.”',['What would you say first?','What do you need to understand before suggesting a solution?'],'Invite each buyer to explain how they would use the home. Learn what work calls require before suggesting a room change. Make honest reactions welcome and avoid choosing a priority on their behalf.'),
   ...['drop-the-rope','during-the-visit','question-bank','different-priorities'].map(get)
  ]);
  group('Lead the post-tour conversation','Ask about an offer, then follow the buyer’s answer.',[
   discussion('discuss-post-tour','What would you ask before the buyer leaves?','The tour has finished. The buyer has mentioned things they liked and things that did not work.',['How would you ask for a few minutes?','What would your first question be?','What changes if they say yes, no or unsure?'],'Ask for a few minutes and explain the purpose. Start with “Did we see any homes we want to write an offer on?” Then follow the answer. Do not infer a decision from silence, criticism or a rating.'),
   ...['after-the-tour','feedback-demo'].map(get),
   make('offer-answer','Let the offer answer guide your next question','Start with: “Did we see any homes we want to write an offer on?”',rows([['If they say yes','Clarify which home and what they need to move into the offer conversation. Interest does not resolve unanswered property or financing questions.'],['If they say no','Ask what worked and what did not. “Which home came closest? What was missing?” Use the answer to refine the next search.'],['If they are unsure','Ask what would help them decide. Identify the missing information or concern and agree how to address it. A high rating alone is not permission to write.']]),2)
  ]);
  group('Understand concerns and agree on a plan','Connect useful help to the buyer’s reason and follow through.',[
   get('buyer-concerns'),get('problem-solving-discussion'),get('concern-framework'),get('plan-demo'),get('pending-answer'),get('plan-check'),get('record-the-plan'),get('full-showing-practice'),get('write-the-follow-up-record')
  ]);
  closing=get('wrap');
  const timings={'drop-the-rope':2,'during-the-visit':2,'question-bank':2,'different-priorities':2,'after-the-tour':2,'feedback-demo':2,'buyer-concerns':1,'problem-solving-discussion':3,'concern-framework':2,'plan-demo':2,'pending-answer':2,'plan-check':2,'record-the-plan':1,'write-the-follow-up-record':2};
  for(const g of groups)for(const s of g.slides)if(timings[s.id.slice(5)])s.time=timings[s.id.slice(5)];
  data.title='Prepare for the showing and help the buyer decide';
 } else if(day===4){
  welcome=make('welcome','Help buyers prepare for a lender conversation','Day 4: explain the purpose, respect the buyer’s choice, and complete the handoff.',para('Learn how to connect financing questions to useful lender help. Practice the introduction and the follow-through so the buyer knows who will contact them and what happens next.'),1);
  group('Recognize when lender help would be useful','Understand the buyer’s question before recommending an introduction.',[
   get('opening-decision'),
   make('identify-lender-help','Connect the lender conversation to a specific need','A useful recommendation begins with what the buyer wants to understand.',rows([['Understand the reason','“What would you need to know before deciding whether buying fits your plans?” Listen for the question instead of assuming they want to buy now.'],['Explain the purpose','“A loan officer can help you understand the payment and what would need to happen next. Would that information help you plan?”'],['Respect their relationship','Ask about a lender they already work with. Offer an introduction when useful and accepted. A buyer can choose to keep their current lender.']]),3),
   get('what-zillow-home-loans-offers-your-buyer')
  ]);
  group('Know what to explain and what the lender must confirm','Separate an initial discussion from a confirmed financing outcome.',[
   discussion('discuss-financing','What would you clarify about the buyer’s financing?','A buyer says, “My bank gave me a letter, so I’m ready to offer tonight.”',['What do you know from that statement?','What would you ask the loan officer to confirm?'],'Ask what the lender has reviewed, what is still conditional, whether the property affects the review, and what timing the file can support. Let the loan officer confirm the process for this buyer. Avoid promising approval, credit impact or a closing date.'),
   ...['pre-qualification-pre-approval-and-final-approval','questions-for-the-loan-officer','how-would-you-explain-the-credit-check'].map(get)
  ]);
  group('Offer an introduction and understand concerns','Hear the buyer’s reason, explain useful help, and ask permission.',[
   discussion('discuss-introduction','What would you ask when the buyer already has a lender?','The buyer says, “My bank has handled everything for years. Why would I need another conversation?”',['What would you acknowledge?','What would you ask before suggesting a comparison?','What would you do if they decline?'],'Acknowledge the existing relationship. Ask whether anything remains unclear. Offer a second conversation only if it would help. Identify Zillow Home Loans clearly, ask permission and respect a decline.'),
   get('responding-to-common-concerns'),get('how-to-introduce-your-loan-officer'),
   make('introduction-example','Explain the reason before asking for an introduction','Fictional buyer: Jordan wants to understand payment options before deciding on the next step.',quote('“You said the monthly payment is what you need to understand. Would a conversation with a loan officer at Zillow Home Loans help you compare your options? You choose your lender. If you want the introduction, how would you prefer to connect?”')+para('If Jordan agrees, confirm the contact method and availability. If Jordan declines, respect the answer and agree on any useful next step with their chosen lender.')),
   get('first-introduction-practice')
  ]);
  group('Complete the handoff and follow through','Make sure the introduction reaches someone and the buyer knows the next step.',[
   discussion('discuss-handoff','What would you do after an unanswered introduction?','The buyer agreed to an introduction. You sent it, but neither the buyer nor loan officer has confirmed a call.',['What remains incomplete?','Who would you contact?','What would you record and follow up on?'],'Check that the loan officer received the introduction and confirm a workable contact time with both parties. Tell the buyer what to expect. Record permission, the next owner and the follow-up time. Sending a message alone does not confirm the handoff.'),
   ...['make-the-introduction-and-confirm-the-call','follow-up-on-incomplete-introductions','check-financing-before-writing-an-offer','practice-with-a-buyer-and-an-observer','what-do-you-remember','how-would-you-answer-jordan','plan-your-next-practice'].map(get)
  ]);
  closing=get('what-to-do-after-this-training');
  data.title='Make a useful lender introduction and follow through';
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
   if(key==='real-mls-example'){s.theme+=' real-example-slide';s.notes='Show the original MLS excerpt, then open the linked full sheet if useful. It is a real historical report, not a fictional listing or an available tour option. The red annotation is present in the county source. Read status and report date first; distinguish reported property facts from unanswered questions. Source: Yamhill County B.O. 25-413, PDF page 94, Exhibit A-4 page 13; report dated March 24, 2025. Accessed September 16, 2026.';}
   if(key==='prepare')s.theme+=' tour-comparison';
   if(key==='drop-the-rope')s.theme+=' welcome-quote';
   if(key==='comparison-discussion')s.theme+=' preparation-practice';
   if(key==='question-bank'){
    s.title='Let the buyer’s reaction lead to one useful question';
    s.lead='Give them time to experience the room. When they share a reaction, follow that thought instead of starting a list of questions.';
    s.body='<div class="conversation-sequence"><div class="conversation-turn"><span>Buyer</span><blockquote>“This office could work.”</blockquote><p>Let them look around and finish their thought.</p></div><div class="conversation-turn"><span>Agent</span><blockquote>“What would work better here than in your current setup?”</blockquote><p>Ask one question tied to what they just said. Then listen.</p></div><div class="conversation-turn"><span>Buyer</span><blockquote>“I could close the door during calls.”</blockquote><p>Now you know why the room matters. Check your understanding before changing the search.</p></div></div><p class="conversation-close">“So having a quiet room you can close off is what matters most. Have I understood that?”</p>';
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
 ordered.forEach((s,i)=>{
  if(s.theme.includes('quadrant-cover'))s.body=`<p class="quadrant-number">0${s.quadrant}</p>`+s.body;
  if(s.id==='day2-channel-check')s.notes=s.notes.replace('Before voting, teach Eric’s exception: acknowledge by text now and call at the requested time.','Hear the responses first, then reinforce Eric’s exception: acknowledge by text now and call at the requested time.');
  s.cue=i+1<ordered.length?`Next: ${ordered[i+1].title}. Connect it to the action you just practiced.`:'Return to the relevant quadrant when you need the steps, then practice again.';
  s.notes=s.notes.replace(/Handoff:[^\n]*/g,'').trim()+`\nHandoff: ${s.cue}`;
 });
 data.slides=ordered;
 data.quadrants=groups.map((g,i)=>({number:i+1,title:g.title,purpose:g.purpose}));
 data.version=`2026-09-16-day${day}-quadrants-v${day===3?3:2}`;
 data.duration=ordered.reduce((n,s)=>n+s.time,0);
 if(day!==1)welcome.lead=`Day ${day} · ${data.duration} minutes including discussion and practice`;
 return data;
}
