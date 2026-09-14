import fs from 'node:fs';

// Source: Eric's TRU Sales Proccess memory bank (2026-09-12), R008–R016,
// R019–R021 and INT-009–INT-016, INT-021–INT-023, INT-027–INT-039.
// September 14 direction: onboarding first, ALMS, instruction before practice.
const esc = s => s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const rows = entries => `<div class="alms-rows">${entries.map(([a,b])=>`<div><h3>${a}</h3><p>${b}</p></div>`).join('')}</div>`;
const quote = (text,label='Example wording · fictional buyer') => `<figure class="alms-quote"><blockquote>${text}</blockquote><figcaption>${label}</figcaption></figure>`;
const note = text => `<p class="alms-note">${text}</p>`;
const steps = items => `<ol class="alms-steps">${items.map(([a,b])=>`<li><h3>${a}</h3><p>${b}</p></li>`).join('')}</ol>`;
const slides=[];
function add(id,chapter,title,lead,body,source,time=1,theme='') {
  const s={id:`day2-${id}`,chapter,title,lead,body,time,theme:`tru alms ${theme}`.trim(),notes:`Teach the point and its reason, then read the example naturally. Examples use fictional buyers; adapt names, facts, brokerage and availability. Source: ${source}.`,cue:'What would this change in your next buyer conversation?'};
  slides.push(s); return s;
}
function activity(id,chapter,title,prompt,kind,fields,model,explanation,choices) {
  const s=add(id,chapter,title,prompt,'','TRU Sales Proccess; application of the preceding instruction',kind==='roleplay'?8:2,'alms-exercise');
  const a={id:s.id,kind,prompt,fields:fields.map(([id,label])=>({id,label})),model,explanation};
  if(choices){a.choices=choices.map(([id,text])=>({id,text}));a.correctChoiceId=choices[0][0];}
  s.activity=a;
  s.notes='Let agents answer before revealing the explanation. Discuss their reasoning without treating a short answer as proof of live-call skill. In self-paced study, use the reveal to compare your answer and revisit the preceding lesson. '+s.notes;
  s.cue='What led you to that answer?';
  s.body=(choices?`<div class="choices" data-quiz="${id}">${a.choices.map(c=>`<button data-option-id="${c.id}" data-correct="${c.id===a.correctChoiceId}" data-feedback="${esc(explanation)}">${c.text}</button>`).join('')}</div><p class="feedback" aria-live="polite"></p>`:'')+a.fields.map(f=>`<label class="field">${f.label}<textarea data-save="${f.id}" placeholder="Use fictional practice details."></textarea></label>`).join('')+`<details class="reveal"><summary>Compare with the teaching example</summary><div><p>${model}</p><p>${explanation}</p></div></details>`;
  return s;
}

add('welcome','Welcome','The first conversation','Day 2 · Handling a Zillow Preferred lead with confidence',
  `<div class="alms-cover-line">From the first hello<br>to a useful next step.</div><p class="alms-cover-detail">Learn the lead routes. Choose the right response. Guide the call with ALMS.</p>`,'Eric’s September 14 Day 2 objective',1,'alms-cover');
add('agenda','Welcome','What we’ll cover','Learn a piece, see an example, then try it.',steps([
 ['Recognize the lead','What the buyer requested, how it arrived, and what needs confirming.'],
 ['Start the conversation','Live connections, outbound calls, texts, and requested callbacks.'],
 ['Use ALMS','Appointment, Location, Motivation, and Summarize—with questions that follow the buyer’s answers.'],
 ['Put it together','Handle common turns, complete the call, and follow through.']]),'September 14 objective',1);
add('purpose','Welcome','Help them take the next step','A request to see a home is interest in seeing it—not a promise to buy it.',rows([
 ['Make meeting easy','Introduce yourself, help with the request, and offer a useful appointment early.'],
 ['Understand the person','Learn what drew them to the home and why those details matter.'],
 ['Earn the next conversation','Give helpful answers and a clear plan. Success can include a buyer choosing to wait.']]),'R001–R002, R013, R024');

add('lead-routes','Know the lead','Three lead routes','Read the lead’s type and actual request before choosing your response.',`<table class="alms-table"><thead><tr><th>Lead type</th><th>Buyer request</th><th>How it reaches you</th></tr></thead><tbody><tr><th>Connection / contact agent</th><td>Contact about a home for sale</td><td>Live phone connection or FUB alert with contact preference</td></tr><tr><th>Real-time touring</th><td>A tour, using availability supplied through ShowingTime</td><td>FUB alert; not a live call in TRU’s documented flow</td></tr><tr><th>Standard property tour</th><td>A tour at a requested time</td><td>Live connection or FUB alert; requested time may still need availability checks</td></tr></tbody></table>`,'INT-012; documented TRU operating flow',2);
add('read-request','Know the lead','Read what they actually sent','A few details tell you how to begin.',rows([
 ['Request + property','Did they ask for information, agent contact, or a tour? Use the actual home and request in your opening.'],
 ['Time + channel','Check the requested tour time, callback time, or “text me first” preference. Those are different instructions.'],
 ['Buyer context','Use the timeframe and any supplied agreement answer. A question on an intake form does not tell you how this buyer answered.']])+note('A requested time, confirmed property access, and a completed showing are three different things.'),'INT-012–INT-013');
add('touring','Know the lead','A tour request still needs your help','Real-time touring supplies a stronger starting point for scheduling.',rows([
 ['Real-time touring','The displayed slots draw on ShowingTime / MLS availability supplied by the seller or listing agent. Read the requested slot and verify the current arrangements.'],
 ['Standard tour request','Where that availability is not integrated, a displayed time can be a buyer request rather than available access. Check before promising it.'],
 ['Your response','Acknowledge the requested time. Tell the buyer what is confirmed and what you are checking. Do not make them start over.']]),'INT-012',2);
activity('lead-route-check','Know the lead','Read the request','A standard tour lead asks for 5 p.m. The property’s availability is not confirmed. What do you do?', 'choice',[],
 'Acknowledge 5 p.m., check access, and tell the buyer when you will confirm. Their request gives you a starting point; it does not prove the seller approved it.',
 'Use the requested time while keeping an unverified arrangement separate from a confirmed appointment.',
 [['check','Acknowledge 5 p.m. and verify property access.'],['promise','Tell them the showing is confirmed because they selected 5 p.m.'],['restart','Ignore 5 p.m. and ask when they want to tour.']]);

add('channel','Make contact','Choose the response that fits','Calls help you hear tone, ask follow-up questions, and build a relationship.',rows([
 ['Already connected live','Begin the conversation. You already have the buyer on the phone; no separate outbound call is needed.'],
 ['New alert, no special preference','Call within five minutes of receiving it in TRU’s normal 8 a.m.–8 p.m. operating window. Automation does not replace your call.'],
 ['A stated preference','Honor text-first and requested callback instructions. An explicit “do not call” request is a boundary to respect.']]),'R008–R010; INT-009–INT-013, INT-054',2);
add('no-answer','Make contact','If the first call is unanswered','Make it easy for the buyer to recognize you and respond.',steps([
 ['Call promptly','Place the call within five minutes of receipt in the normal flow. Leave an opening voicemail when appropriate.'],
 ['Follow with a personal text','Connect to the real inquiry and invite a phone conversation with genuine availability.'],
 ['Keep ownership','Continue useful outreach while unanswered. The automated introduction is separate from your work.']])+quote('Hi Jordan, this is Sam with Northside Realty. I just tried calling about your request to see 1234 Lane. I can talk at 4 or 6 today—does either work for you?'),'R009, R019',2);
add('preferences','Make contact','“Text now” and “call at five”','Acknowledge the buyer now while respecting the plan they requested.',rows([
 ['“Text is better right now.”','“Of course. I can help here. A quick call would also let us talk through the home and your plans—would this evening work?” Text now; do not record a permanent no-call preference.'],
 ['“Call me at five.”','“Hi Maya, I’m Sam with Northside Realty, the agent who’ll call at five about your request. Let me know if you have questions before then.” Keep five unless the buyer agrees to change it.'],
 ['“Please do not call me.”','Honor that request. Give useful help through the agreed channel.']]),'R008, R010; INT-013, INT-043',2);
activity('channel-check','Make contact','Choose your next message','Maya’s alert arrives at 2 p.m. and asks for a 5 p.m. call. Write your acknowledgment.', 'written',[['callback-text','What would you text Maya now?']],
 'Hi Maya, I’m Sam with Northside Realty. I’ll be calling at five about your inquiry. If you have a question before then, let me know. I’m also free earlier if that would help.',
 'Introduce yourself promptly, keep the requested call time, and offer earlier availability only if it is real. Do not call immediately just to satisfy the normal five-minute default.');

add('alms','Guide the call','ALMS is your call framework','Start with a clear introduction. Then help with the appointment before discovery.',`<div class="alms-sequence">${[['A','Appointment','Make it easy to meet.'],['L','Location','Understand where and what fits.'],['M','Motivation','Learn why it matters.'],['S','Summarize','Confirm what happens next.']].map(([a,b,c])=>`<div><strong>${a}</strong><h3>${b}</h3><p>${c}</p></div>`).join('')}</div>`+note('Location and motivation can flow in either order. Listen to the person; do not recite a checklist.'),'R012–R013; INT-015–INT-016',2);
add('introduction','Guide the call','Take the first turn','Orient the buyer: your name, brokerage, Zillow connection, and reason for the conversation.',quote('Hi Jordan, I’m Sam with Northside Realty, a featured partner with Zillow. I’m reaching out about your request to see 1234 Lane.')+rows([
 ['Live connection','“Zillow connected us about your request…” fits a buyer already on the line. Begin warmly instead of waiting in silence.'],
 ['Outbound call','“I’m calling about your request…” connects an unfamiliar number to something the buyer recognizes.']])+note('Use your real brokerage and role. Do not borrow claims about expertise or relationships that are not yours.'),'R013; INT-016');
add('appointment','Guide the call','A · Appointment','Help with the reason they reached out before asking them to complete your process.',quote('I saw you requested Saturday morning. Let me check that time with the property. If we need another option, would Saturday afternoon work?')+rows([
 ['When no time is requested','Offer two genuine options: “Would this afternoon or tomorrow morning work better?” Check property access before confirming.'],
 ['Why it comes early','The buyer asked for help. An early invitation makes that help tangible; a long qualification interview can make the meeting feel conditional.']]),'R001, R013; INT-016',2);
activity('opening-decision','Guide the call','Now try the opening','Jordan asked to see 1234 Lane and has not requested a time. How would you begin?', 'choice',[['opening-invitation','Write your introduction and early appointment invitation.']],
 'Hi Jordan, I’m Sam with Northside Realty, a featured partner with Zillow. I’m calling about your request to see 1234 Lane. Would Saturday morning or afternoon work better? I’ll verify access for the time we choose.',
 'Orient the buyer and offer useful times before discovery. Use actual availability. The invitation is a strong default, not a reason to ignore a buyer’s stated circumstances.',
 [['introduction-invitation','Introduce yourself and offer workable showing times.'],['budget','Start by asking for preapproval and budget.'],['process','Explain the entire buying process first.']]);
add('permission','Ask and listen','Ask for a few minutes','Explain why the questions will help the buyer.',quote('Do you have a few minutes so I can learn what you’re looking for and make our time together useful?')+rows([
 ['If they have time','Ask one question, listen, and use the answer to choose the next question.'],
 ['If they are rushed','“Absolutely—let’s keep this quick.” Handle the appointment and essentials. Do not force the buyer through every question.']]),'R013; INT-016, INT-023');
add('location','Ask and listen','L · Location','Learn where the buyer wants to be—and what makes it work for them.',rows([
 ['Start with their search','“What attracted you to this area?” or “Are there other areas you’re considering?”'],
 ['Understand the connection','“What would make this location convenient for you?” Let the buyer explain the priorities.'],
 ['Use what you already know','If they said they are moving from nearby, ask what is changing where they live now rather than repeating the intake form.']])+note('Location includes more than a ZIP code. Let the buyer define the places, routines, and tradeoffs that matter.'),'R013; INT-016, INT-021');
add('motivation','Ask and listen','M · Motivation','Move from the feature to the reason behind it.',`<div class="alms-dialogue"><p><b>Buyer</b> “We really want a bigger yard.”</p><p><b>Agent</b> “What would you like to be able to do with that space?”</p><p><b>Buyer</b> “I want room for a vegetable garden.”</p><p><b>Agent</b> “That helps. What would the garden need from the space?”</p></div>`+note('“Big yard” is a feature. Gardening gives it meaning. Do not assume dogs, children, entertaining, or any other reason.'),'R013; INT-016, INT-021',2);
add('follow-answer','Ask and listen','Stay with the answer','A conversation learns something. An interrogation just collects fields.',rows([
 ['Acknowledge','Respond to what they said: “That makes sense—you want space you can actually use.”'],
 ['Ask a relevant follow-up','“What is missing in your current place?” or “What would make the move worthwhile?”'],
 ['Use the answer','Choose the next question or property comparison from that information. Warmth comes from attention, not a memorized joke.']]),'R013; INT-021');
activity('discovery-practice','Ask and listen','Ask the next question','The buyer says, “We’re already in town. We just need more space.”', 'written',[['next-question','What would you ask next, and what would that help you understand?']],
 '“What is feeling too tight in your current place?” Their answer could reveal the purpose of the space. Follow that answer rather than assuming a larger bedroom count solves it.',
 'Choose a question connected to the buyer’s words. There is no required question count, personal anecdote, or fixed order for location and motivation.');
add('comparison-plan','Build the plan','Make the outing useful','Propose two or three homes so the buyer can compare and you can learn their preferences.',quote('Since we’ll be out together, would it help to see a couple of other options? Now that I know the garden space matters, I can look for useful comparisons.')+rows([
 ['Explain the value','Comparisons help the buyer clarify what fits. They also give you options if one property becomes unavailable.'],
 ['Respect the answer','Do not make extra homes a condition for seeing the original one. Be honest when an option differs from their criteria.']]),'R012, R021; INT-015, INT-037–INT-039');
add('summary','Build the plan','S · Summarize','Give the buyer back their priorities and the agreed next step.',quote('You’re looking in this area because it works for your commute, and usable garden space matters most. We’re aiming for Saturday morning. I’ll confirm access to 1234 Lane and send the details. You’re open to two nearby comparisons. Have I understood that correctly?')+note('Name what is agreed, what still needs checking, and who will do it. Invite the buyer to correct you.'),'R013; INT-016',2);
add('closing','Build the plan','Before you hang up','A good close removes uncertainty.',rows([
 ['Appointment details','Restate the day, time, property or meeting location, and any access check still outstanding.'],
 ['What they will receive','Explain the applicable touring form briefly and accurately. Confirm what you will send and when you will follow up.'],
 ['What you will do','Research promised answers and comparisons. Save the buyer’s priorities and agreed next action in FUB.']])+note('If a form or existing agreement raises a question you cannot resolve, call your team lead. Use the actual form’s terms.'),'R013, R015–R016, R021');
activity('summary-practice','Build the plan','Close this call','Jordan wants garden space, prefers Saturday morning, and is open to another home. Access is still unconfirmed.', 'written',[['summary','Write the summary and next step you would say aloud.']],
 '“The garden space is important, and Saturday morning is your preference. I’ll check access and find another useful comparison. I’ll send the confirmed details after I hear back. Is there anything I missed?”',
 'Do not upgrade a requested time into a confirmed showing. Reflect the actual priorities and your promised action.');

add('questions-only','When the call changes','“I just have questions.”','Help with the question; earn another invitation through useful service.',steps([
 ['Acknowledge and capture','“Of course—what would you like to know?” Answer accurately; say what you need to check.'],
 ['Learn the context','With permission, understand what drew them to the home and how the answer affects their search.'],
 ['Offer a useful next step','Explain how seeing the home could help. If they still decline, stop pushing and agree how you’ll bring back the answers.']])+note('Answers are not a reward for agreeing to a showing. Never guess or hide a known answer.'),'R014; INT-016',2);
add('financing','When the call changes','Keep the first meeting easy','Do not open with a demand for preapproval, budget, or proof they are ready to buy.',rows([
 ['Why timing matters','They asked to see a home. A private financial interview from someone they do not know can turn that request into a barrier.'],
 ['If the buyer asks','Answer their question. Learn enough context to make guidance useful; involve a lender for financing specifics.'],
 ['The usual later opening','The end of the first showing offers context for a relevant financing conversation. A long buying timeline does not automatically rule out planning help.']]),'R001–R004; INT-001–INT-005, INT-016',2);
activity('financing-check','When the call changes','Respond to their question','The buyer asks, “Should I talk to a lender before we look?” What is the best response?', 'choice',[],
 '“Happy to help. What timing do you have in mind for a move?” Use the context to explain a useful next step and offer lender help where it fits.',
 'Buyer-initiated financing questions deserve an answer. Avoid both a blanket refusal to discuss money and a blanket requirement to obtain preapproval before receiving help.',
 [['context','Understand their timing and concern, then offer relevant guidance.'],['refuse','Say financing can never be discussed on the first call.'],['gate','Require a preapproval letter before continuing.']]);
add('listing-agent','When the call changes','“Are you the listing agent?”','Answer the role question clearly, then return to how you can help.',quote('I’m not the listing agent. I help buyers, and I can coordinate with the listing side about this home. What would you like to know?')+rows([
 ['If they prefer the listing agent','Offer to help with that connection and ask whether a service check-in would be useful. Respect their decision.'],
 ['Keep it accurate','Use your real role. Do not imply you represent the seller, invent a relationship, or launch into a full agency lecture.']]),'R015; INT-016–INT-018');
add('under-contract','When the call changes','“Is this home still available?”','If the home is under contract, give the truth and a useful next step.',steps([
 ['Prepare from their priorities','Use what they told you to identify relevant alternatives.'],
 ['Explain what changed','Say the home is under contract. Offer to check whether viewing or another option is still possible; do not promise it.'],
 ['Keep the next step useful','Learn what drew them to this home and offer a relevant option to explore together. Let the buyer decide.']])+note('Do not end the conversation with a bare “It’s under contract. Want something else?” Ask what mattered and explain what you can check.'),'R011–R012 applied to the initial availability question',2);
activity('changed-plan','When the call changes','Keep helping with the inquiry','On the first call, Jordan asks about a home that is under contract. You learn garden space matters. What do you say?', 'written',[['plan','Write your response and a useful next step.']],
 '“The home is under contract. I can check whether a viewing is still possible. Since garden space matters, I can also research some options to compare. Would that be useful?” Keep access and unresearched alternatives conditional.',
 'Tell the truth, use known priorities, keep possibilities conditional, and offer a next step. Do not merely hand the search back with “Want something else?”');
add('adapt','When the call changes','Adapt to the person in front of you','The framework supports judgment.',rows([
 ['“I have one minute.”','Keep it quick. Handle the appointment, explain the essential next steps, and respect the time constraint.'],
 ['“I can’t visit soon.”','Learn the purchase drivers, criteria, and timing. Agree on useful updates and a communication plan instead of forcing a near-term showing.'],
 ['“I’m not sure buying is right.”','Acknowledge the concern. Ask what is behind it, offer relevant education, and help them decide—even if the decision is to wait.']]),'R013, R020, R024; INT-023, INT-035–INT-036, INT-045–INT-050',2);

add('whole-call-one','Put it together','One call, from the opening…','Fictional demonstration · use your own words and true availability.',`<div class="alms-dialogue"><p><b>Introduce</b> “Hi Jordan, I’m Sam with Northside Realty, a featured partner with Zillow. I’m calling about 1234 Lane.”</p><p><b>Appointment</b> “Would Saturday morning or afternoon work better? I’ll verify access.”</p><p><b>Permission</b> “Have you got a few minutes so I can make our outing useful?”</p><p><b>Location</b> “What attracted you to this area?”<br><span>Jordan: “It would shorten my commute.”</span></p></div>`,'R013; adapted from INT-016',2);
add('whole-call-two','Put it together','…to a clear next step','The next question comes from what the buyer says.',`<div class="alms-dialogue"><p><b>Motivation</b> “What else caught your eye?”<br><span>Jordan: “The yard. I’d like a vegetable garden.”</span><br>“What would you need from that space?”</p><p><b>Plan</b> “Would you like to compare a couple of other homes while we’re out?”</p><p><b>Summarize</b> “The commute and garden space matter. Saturday morning is your preference. I’ll check access, research the comparisons, and send the details. Is that right?”</p></div>`+note('Then briefly explain the applicable touring form and the follow-up you are actually committing to.'),'R012–R013, R016',2);
const role=activity('full-call-practice','Put it together','Your turn: handle the whole call','Jordan asked for a tour. Practice the call, then replay one part after feedback.', 'roleplay',[['first-attempt','What did you learn about the buyer?'],['correction','What will you improve?'],['retry','What changed when you tried it again?']],
 'Introduce yourself, offer the appointment early, ask permission, explore location and motivation through follow-up questions, and summarize the actual plan. Adapt if Jordan has limited time or a different request.',
 'Use a partner as the buyer. When studying alone, say the agent’s turns aloud and compare with the two demonstration slides. A self-check is practice, not observed coach sign-off.');
role.activity.rubric=[['introduction','Clear name, brokerage, Zillow connection and purpose'],['appointment','Useful early appointment invitation that respects the request'],['discovery','Permission, relevant location/motivation questions and a follow-up'],['summary','Accurate priorities, commitments and unresolved checks'],['adaptation','Responds to the buyer’s actual preference and circumstances']].map(([id,label])=>({id,label}));
role.notes+=' Rotate agent, buyer and observer so everyone speaks. Give one specific correction and a targeted retry. Do not label a peer or self-check as coach sign-off. Buyer chooses a case from the practice cards; do not hand the agent all the buyer answers in advance.';
add('follow-through','After the call','Follow through on what you promised','The next contact should have a reason the buyer recognizes.',rows([
 ['Record the useful details','Save the request, location, motivation, communication preference, and agreed plan in FUB. Distinguish requested from confirmed.'],
 ['Complete the promises','Get the property answer, check access, prepare the comparison, or send the agreed information. Set a task to remember it.'],
 ['Make the next contact relevant','“I checked the garden space you asked about…” is more useful than an empty “Just checking in.” Use the agreed channel and timing.']]),'R020–R021; INT-035–INT-039');
add('unanswered','After the call','If the new lead stays unanswered','Continue useful personal outreach; do not confuse automation with your effort.',rows([
 ['Day one','Aim for three to four personal touches. The stated minimum is two calls and one personal text in the normal unanswered-lead flow.'],
 ['First week','Aim for ten total touches, including day one. Most attempts should be calls; use relevant texts and vary contact times.'],
 ['When they respond','Follow the conversation and agreed plan. Stop applying the unanswered-lead quota. An explicit contact restriction still governs.']])+note('If an engaged buyer later goes quiet, keep making thoughtful attempts. The stopping point is discretionary; there is no fixed new quota.'),'R019; INT-027–INT-031, INT-054',2);
activity('recall','After the call','Check your understanding','Without looking back, explain how you would handle the next lead.', 'written',[['recall-alms','What does ALMS stand for, and why does the appointment come early?'],['recall-channel','What changes when the buyer asks for a later call or text first?'],['recall-discovery','Give one follow-up question that turns a feature into a reason.']],
 'ALMS: Appointment, Location, Motivation, Summarize. Introduce yourself first. Offer useful help early, honor stated contact preferences, and follow the buyer’s answers instead of collecting a checklist.',
 'If one part feels uncertain, return to that chapter and its examples. Ask your coach about the specific moment you want to practice.');
add('reference','Your call reference','Keep this beside you','Introduction → Appointment → Location / Motivation → Summarize',rows([
 ['Before contact','Lead type · actual request · property · tour or callback time · contact preference'],
 ['During the call','Orient them · offer the meeting · ask permission · follow an answer · propose useful comparisons'],
 ['Before you finish','Restate priorities · distinguish confirmed from pending · explain the next step · record and follow through']])+`<p class="alms-note"><a href="/workshops/day2-resources.html" target="_blank" rel="noreferrer">Open your Day 2 reference and practice notes</a>. Revisit any chapter whenever you need it.</p>`,'September 14 reference requirement; R008–R016, R019–R021');

// A 90-minute facilitated lesson: teaching, response, discussion, and two rotations.
const get = id => slides.find(s => s.id === `day2-${id}`);
get('channel').body = rows([
 ['Already connected','Introduce yourself and help with the request. You are already on the call.'],
 ['New alert, no preference','Call within five minutes of receipt during TRU’s 8 a.m.–8 p.m. operating window. If unanswered, follow with a personal text.'],
 ['Text first / requested callback','Acknowledge by text now; honor the requested call time or explicit no-call preference.']
]);
get('introduction').body += quote('Would Saturday morning or afternoon work better? I’ll check access with the property.','Then offer an appointment early');
get('permission').title='Ask permission, then learn what fits';
get('permission').body=quote('Do you have a few minutes so I can learn what you’re looking for and make our time together useful?')+rows([['Location','What attracted you to this area? What makes that location work for you?'],['Follow the answer','If they mention a shorter commute, ask what would improve. Do not jump to the next checklist item.']]);
get('listing-agent').title='Answer honestly and keep helping';
get('listing-agent').body=rows([['Your role','“I’m not the listing agent. I help buyers and can coordinate with the listing side. What would you like to know?”'],['Availability','If the home is under contract, say so. Check any uncertain access; do not promise a showing.'],['Useful next step','Ask what attracted them to the home and offer relevant options, with their permission.']]);
get('follow-through').body=rows([['After a conversation','Record their priorities, contact preference, pending access checks, and the exact next action you promised.'],['If unanswered','Day one: aim for three to four personal touches, at least two calls and one text. First week: ten total including day one, mostly calls.'],['Once they reply','Follow the conversation and agreed plan. Stop applying the unanswered-lead quota.']]);
const discovery=get('discovery-practice');
discovery.activity.kind='roleplay';
discovery.activity.rubric=[{id:'permission',label:'Ask permission before discovery'},{id:'follow',label:'Ask a follow-up based on the buyer’s actual answer'}];
discovery.activity.fields.push({id:'discovery-retry',label:'What did your partner suggest, and how did your retry change?'});
discovery.body += '<label class="field">What did your partner suggest, and how did your retry change?<textarea data-save="discovery-retry"></textarea></label>';
discovery.activity.prompt='Pairs: one buyer says “We need more space.” Ask permission, learn what that means, and follow their answer. Switch roles.';
discovery.lead=discovery.activity.prompt;
discovery.notes='8 minutes: 1 minute setup; 3 minutes each direction (2-minute conversation plus 1-minute feedback and retry); 1-minute room debrief. Create rotating pairs in the presenter console, then open the meeting breakout rooms. '+discovery.notes;
role.activity.prompt='Trios: agent, buyer, observer. Run the full first call using the buyer card, give one specific correction, retry, then rotate until everyone has spoken.';
role.lead=role.activity.prompt;
role.notes='15 minutes: 1 minute setup; three 4-minute rotations (3-minute call, 1-minute feedback and targeted retry); 2-minute room debrief. Use Jordan, Maya or Alex buyer cards. Create rotating trios in the presenter console and place the same groups in meeting breakout rooms. '+role.notes;
role.activity.useCases=true;
discovery.body=note('1 minute to set up · 2-minute conversation + 1-minute feedback/retry each way · 1-minute debrief. Switch buyer and agent after the first turn. Your presenter assigns groups; video rooms are in your meeting platform.')+discovery.body;
role.body=note('1 minute to set up · three 4-minute rounds: 3-minute call + 1-minute correction/retry · 2-minute debrief. Rotate agent → observer → buyer so everyone speaks. Submit your reflection after your turn.')+role.body;
get('lead-routes').body+=note('Example: “I requested 4 p.m.” on a standard tour is a requested time. “I’ll check access and confirm with you” keeps the request moving without promising unverified access.');
get('follow-through').body+=note('Set a task for the promised action. Use the buyer’s agreed channel and timing; a reply ends the unanswered-lead quota, not your responsibility to follow through.');
const order=['welcome','agenda','lead-routes','lead-route-check','channel','no-answer','preferences','channel-check','alms','introduction','opening-decision','permission','motivation','discovery-practice','summary','summary-practice','questions-only','financing','financing-check','listing-agent','changed-plan','whole-call-one','whole-call-two','full-call-practice','follow-through','recall','reference'];
const minutes=[1,2,4,3,3,2,2,3,2,3,4,3,3,8,3,4,3,2,3,3,3,2,2,15,3,3,1];
slides.splice(0,slides.length,...order.map(get));
slides.forEach((s,i)=>{s.time=minutes[i];if(s.activity){const mode=s.activity.kind==='choice'?'VOTE':s.activity.kind==='roleplay'?'BREAKOUT':'WRITE & DISCUSS';s.title=mode+' · '+s.title;s.cue=s.activity.kind==='roleplay'?'Give one specific observation, retry, and rotate.':'Answer individually first. Then compare reasoning before the teaching example.';if(s.activity.kind!=='roleplay')s.notes=`${s.time} minutes: individual response first, compare two approaches, then reveal and discuss the example. `+s.notes;}});
get('agenda').body=steps([['Recognize and respond','Read the three lead routes. Choose a call, text, or requested callback. Vote and write your response.'],['Guide the conversation','Introduce yourself, invite early, and use ALMS. Watch the examples, then practice discovery in pairs.'],['Adapt and agree a plan','Handle questions and changed circumstances. Watch a full call, then rotate agent, buyer, and observer in trios.'],['Follow through','Record what matters, keep your promises, and leave with a first-call reference.']])+note('Use your signed-in learner session for votes and short answers. Submit first; then we compare reasoning and reveal the example.');
get('welcome').cue='Which part of the first call feels least comfortable today?';
get('agenda').cue='Open your agent session now. We will pause for responses throughout.';
const data={day:2,title:'Winning the first conversation',version:'2026-09-14-alms-live-v3',duration:slides.reduce((n,s)=>n+s.time,0),slides,hero:'',resources:'day2-resources.html',cases:[{name:'Jordan · a garden',quote:'I’d like to see 1234 Lane Saturday morning. The yard caught my eye.',goal:'Buyer: the reason is a vegetable garden; reveal it after a relevant question. Agent confirms what still needs checking.'},{name:'Maya · text first',quote:'I’m at work. Please text me now; I can talk at five.',goal:'Begin with the text exchange, then fast-forward to the agreed call. Buyer: a shorter commute matters; reveal it when asked. Honor the current preference and agree the later conversation.'},{name:'Alex · questions first',quote:'I only wanted to know about the roof. I’m not ready to book a showing.',goal:'Help with the question, learn context with permission, and respect a declined invitation. Buyer: you want to understand potential maintenance before deciding to tour.'}]};
fs.writeFileSync(new URL('../web/public/workshops/day2.json',import.meta.url),JSON.stringify(data,null,2)+'\n');
console.log(`Day 2: ${slides.length} slides, ${data.duration} minutes, ${slides.filter(s=>s.activity).length} activities.`);
