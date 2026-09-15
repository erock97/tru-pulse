import fs from 'node:fs';
// Eric's September 12 doctrine and interviews. Zillow visuals are credited originals.
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const p=t=>`<p class="lesson-explanation">${t}</p>`;
const q=t=>`<blockquote class="lesson-example">${t}</blockquote>`;
const d=turns=>`<div class="alms-dialogue alms-call-turns">${turns.map(([who,text])=>`<p><b>${who}</b><span>${text}</span></p>`).join('')}</div>`;
const list=items=>`<ol class="lesson-agenda">${items.map(t=>`<li>${t}</li>`).join('')}</ol>`;
const visual=(images,text,url,label)=>`<div class="lesson-visual"><div class="lesson-phones">${images.map(([file,alt])=>`<img src="/workshops/zillow/${file}" alt="${esc(alt)}">`).join('')}</div><div>${text}</div></div><p class="lesson-source">Source: <a href="${url}" target="_blank" rel="noreferrer">${label}</a>. Zillow’s published demonstration; screens vary by app version.</p>`;
const slides=[];
const discussionChoices={
  "lead-discussion": [
    [
      "both",
      "Begin your introduction immediately; answering Zillow’s call has already connected you to the buyer."
    ],
    [
      "distinct",
      "Review the buyer’s inquiry, then select Connect to speak with the buyer.",
      true
    ],
    [
      "wait",
      "Call the buyer’s number separately instead of using Connect."
    ]
  ],
  "channel-check": [
    [
      "call-now",
      "Call now because the new-lead standard is five minutes."
    ],
    [
      "acknowledge",
      "Text your introduction now, acknowledge the request, and call at 5.",
      true
    ],
    [
      "automation",
      "Let the automated introduction handle the acknowledgment and wait for another reply."
    ]
  ],
  "next-question": [
    [
      "bedrooms",
      "“How many bedrooms do you need?”"
    ],
    [
      "reason",
      "“What is feeling too tight in your current home?”",
      true
    ],
    [
      "expand",
      "“Would you consider a different neighborhood to get more space?”"
    ]
  ],
  "changed-plan": [
    [
      "research",
      "“It is under contract. What area works for your commute? I can check viewing options and research other homes there.”",
      true
    ],
    [
      "send",
      "“It is under contract. Send me another listing when you find one you like.”"
    ],
    [
      "promise",
      "“It is under contract, but I have other homes nearby that will work for your commute.”"
    ]
  ],
  "summary-practice": [
    [
      "tour",
      "“Let’s get a tour scheduled this week so you can decide before you move.”"
    ],
    [
      "vague",
      "“I’ll send some listings. Let me know if anything catches your eye.”"
    ],
    [
      "agreed",
      "“You’re moving in two months and need a home office. I’ll email three homes, and we’ll talk Tuesday at 6.”",
      true
    ]
  ]
};
function add(id,chapter,title,lead,body,time,teach,handoff,refs='INT-016'){
 const s={id:`day2-${id}`,chapter,title,lead,body,time,theme:'tru alms lesson',notes:`${teach}\nHandoff: ${handoff}\nSources: TRU September 12 teaching, ${refs}. Examples are fictional unless credited to Zillow. Use true names, brokerage, availability and property facts.`,cue:handoff};slides.push(s);return s;
}
function act(id,chapter,title,prompt,time,fields,model,explanation,teach,handoff,choices=null,kind='written',body=''){
 if(kind !== 'roleplay') {
  choices=choices || discussionChoices[id]; kind='choice';
  fields=[[fields[0]?.[0] || 'reason','Explain your choice. What would it communicate to the buyer or help you learn?']];
  if (!prompt.includes('then explain')) prompt += ' Choose an answer, then explain why.';
  teach='Ask for a choice and a reason. People without HQ access can answer aloud; select an option on your presenter slide to discuss it. Learners with access submit their own choice and explanation. '+teach;
 }
 const s=add(id,chapter,title,prompt,body,time,teach,handoff);s.theme+=' alms-exercise';
 s.activity={id:s.id,kind,prompt,fields:fields.map(([id,label])=>({id,label})),model,explanation};
 if(choices){s.activity.choices=choices.map(([id,text])=>({id,text}));s.activity.correctChoiceId=choices.find(c=>c[2])?.[0];}return s;
}
add('welcome','Welcome','Handling your first Zillow lead','Day 2 · A 90-minute live workshop',
 '<div class="alms-cover-line">Know what you received.<br>Know how to begin.</div><p class="alms-cover-detail">Learn how to respond to the lead, lead the first conversation, and agree on a useful next step with the buyer.</p>',1,
 'Introduce yourself. Day 1 covered the record; today teaches the conversation and the actions that belong in that record. Ask participants to open their learner session for submissions.',
 'Before we practice what to say, we need to recognize what Zillow is sending us.').theme+=' alms-cover';
add('agenda','Welcome','What we will learn and practice','We will work through the job in the order you do it.',
 list(['<strong>Receive the lead.</strong> Recognize Zillow’s screens and decide how to make contact.','<strong>Start the call.</strong> Introduce yourself and help arrange the appointment.','<strong>Understand the buyer.</strong> Ask useful questions and practice listening with a partner.','<strong>Agree on the next step.</strong> Handle questions, summarize the plan, and practice the full call.']),1,
 'Explain demonstrations, individual answers and discussion, then pairs and trios. On question slides learners answer and press Submit; you receive their answers. They do not select a separate activity.',
 'First, here is what an incoming live connection actually looks like.');
add('live-connection','Receive the lead','A live connection puts a buyer on the phone','Zillow calls you first. You review the inquiry, then connect to the waiting buyer.',
 visual([['live-screen-0.png','Zillow’s incoming Premier Agent call with Decline and Accept buttons'],['live-screen-1.png','Zillow’s pre-connection screen with the buyer inquiry and Connect button']],
 p('<strong>Answer the incoming call.</strong> Zillow provides information about the buyer and the home before you speak to the buyer.')+p('<strong>Read the inquiry, then connect.</strong> In this example, the buyer asks about a property’s HOA fee. Begin by introducing yourself and acknowledging that question.'),
 'https://www.zillowstatic.com/bedrock/app/uploads/sites/33/2023/05/Zillow-Premier-Agent-Conversion-Playbook_Oct2023.pdf','Zillow Conversion Playbook, page 7'),3,
 'Point to Accept on the first screen and Connect on the second. These are Zillow’s own simulated training screens. Read the inquiry. The names and address belong to Zillow’s illustration, not our later practice case. The current In-App Connections FAQ confirms answer/review/connect. Do not read every property field.',
 'A Real-Time Touring notification can also ring your phone, but the next step is different: you review a tour request rather than join a buyer on a live call.',
 'INT-012; Zillow Conversion Playbook Oct 2023 p7; Zillow In-App Connections FAQ Oct 2025');
add('real-time-touring','Receive the lead','Real-Time Touring asks you to accept a tour','The phone alert identifies Real-Time Touring. The app then shows the buyer’s requested times.',
 visual([['rtt-ringing.png','Real-Time Touring incoming call in Zillow’s official demonstration'],['rtt-request.png','Tour request showing buyer-selected times and commitment choices']],
 p('<strong>Review the request in the app.</strong> Zillow gives you five minutes to accept a time you can attend or pass on the request.')+p('<strong>This is not a live buyer transfer.</strong> After accepting, review the booking details and contact the buyer about the appointment.'),
 'https://www.zillow.com/premier-agent/real-time-touring/','Zillow Real-Time Touring demonstration'),4,
 'Read the Real-Time Touring label and buyer-selected times. Distinguish Zillow’s five-minute acceptance window from the five-minute first-contact standard taught here. Dates and property are sample data. Eric’s “not a live call” means no live buyer conversation; do not teach that the phone never rings. Booking uses ShowingTime availability. Follow actual status and notifications.',
 'You may also receive a standard tour request. That buyer still wants to see a home, but the request does not use this same real-time booking process.',
 'INT-012; Zillow Real-Time Touring page and linked Oct 2025 demonstration');
add('standard-tour','Receive the lead','A standard tour request tells you what the buyer wants','The buyer has asked to see a particular home. They may have supplied a preferred day and time.',
 p('Read the request before you contact them. Use the property and preferred time in your opening so the buyer does not have to start over.')+
 q('“I see you requested a tour Saturday afternoon. Would that still work for you? I’ll check the showing arrangements and confirm the details.”')+
 p('A standard tour request may arrive as a live connection or an alert in Follow Up Boss. If the buyer is not already on the phone, your next job is to contact them.'),2,
 'Explain Follow Up Boss in full before abbreviating it to FUB. Show how the request gives you an opening. Distinguish preferred timing from booking status without making that obvious distinction into a quiz.',
 'We have now seen the two phone experiences and a standard request. Let’s make sure the difference is clear before we move into your response.','INT-012');
act('lead-discussion','Discuss the screens','You answered Zillow’s call. What happens next?','Zillow calls you with a live connection. You answer and see the buyer’s inquiry and a Connect button. You have not spoken to the buyer yet. What do you do next?',3,
 [['lead-response','Describe the next action for each type. Include anything on the screens you want explained.']],
 'Review the inquiry so you know why the buyer reached out, then select Connect. That connects you to the waiting buyer; now introduce yourself. A Real-Time Touring request is different: review its proposed times, accept a workable request or pass, and contact the buyer after accepting. Accepting that request does not transfer a buyer onto the call.',
 'The distinction changes what you prepare to do when the phone rings. A tour acceptance and a conversation with a waiting buyer are different tasks.',
 'Give a minute to choose and explain. Discuss the selected answers and any screen questions. Return to a screenshot if the next action is unclear. This is an explanation check, not a trick question.',
 'If the buyer is already on the phone, begin the conversation. If you received an alert instead, here is how to make contact.',null,'discussion');
add('channel','Make contact','Call promptly when the buyer has asked to hear from you','For a new lead received during normal business hours, 8 a.m.–8 p.m., call within five minutes unless the buyer gave a different contact instruction.',
 p('The buyer just asked for help with a home. A call lets you hear their tone, answer questions as they arise, and begin a conversation about what they need.')+
 p('Follow Up Boss may already have sent an automated introduction. That does not replace your own call. If the buyer requested a later callback or asked for text, respect that instruction.'),2,
 'Explain Eric’s reason: the buyer just expressed interest, rather than being a random person being interrupted. Hearing and responding in real time matters. Do not repeat unverified response-rate statistics. The clock starts at agent receipt; do not invent after-hours rules.',
 'Calling promptly does not mean the buyer will always answer. Here is what to do when your first call goes unanswered.','INT-009, INT-011–013');
add('no-answer','Make contact','If the call goes unanswered, send a personal text','Example: a buyer requested a tour of 418 Cedar Lane. You just called, but they did not answer. The address is fictional.',
 q('“Hi, this is [your name] with [your brokerage]. I just tried calling about your Zillow request to see 418 Cedar Lane. I’d be happy to help arrange a tour. I’m available for a call at 4 or 6 today. Would either time work for you?”')+
 p('Tell them who called, connect the call to their request, and offer a clear opportunity to talk. Use times you can actually make. You are offering a phone call here, not confirming a tour.'),2,
 'Read the example with your own name and brokerage. Distinguish phone-call availability from tour availability. This personal text follows the missed call. Do not mix weekly quotas into this example; those come after the first-call lesson.',
 'That example had no special contact instruction. Now consider a buyer who has already told you when they can talk.','INT-011');
act('channel-check','Make contact','Respond to a buyer who is at work','A new Zillow inquiry arrives at 2 p.m. The buyer writes: “I’m at work. Please call at 5 about the Cedar Lane home.” What should you do next?',3,
 [['callback-text','Write your text and the planned call time.']],
 '“Hi, I’m [your name] with [your brokerage]. I’ll be the agent calling at 5 about the Cedar Lane home. If you have questions before then, you’re welcome to text me.” Call at 5 as requested.',
 'Acknowledge now so the buyer knows who will call. The requested time governs the call; the default does not justify interrupting them at work.',
 'Before voting, teach Eric’s exception: acknowledge by text now and call at the requested time. Demonstrate “I’ll be the agent calling you at five.” Then let learners choose and explain. Review whether it introduces the agent and preserves the callback. Earlier availability is optional.',
 'Once the buyer answers, the task changes from making contact to leading a useful conversation. LEAD gives you an order for that conversation.');
add('alms','Begin the conversation','Use LEAD to guide the conversation','LEAD gives you four steps: Lead with who you are, Extend the invitation, Ask and listen, and Deliver the summary.',
 list(['<strong>L — Lead with who you are:</strong> Name, brokerage, Zillow connection, and why you’re calling.','<strong>E — Extend the invitation:</strong> Offer the visit early, with two workable options.','<strong>A — Ask and listen:</strong> Ask permission, then learn where they want to live and what is prompting the move.','<strong>D — Deliver the summary:</strong> Repeat what matters and agree on the next step.'])+p('You may also know Zillow’s ALMS: Appointment, Location, Motivation, Summarize. LEAD includes your introduction and groups location and motivation under Ask and listen.'),2,
 'The buyer asked for help, so make that help tangible early. Then ask permission to learn more. Location and motivation can occur in either order. Do not delay the invitation until after qualification.',
 'Let’s hear the opening with a complete example. I’ll introduce the buyer and the situation before we read the call.','INT-016, INT-021');
add('introduction','Begin the conversation','Demonstration: introduce yourself and offer the visit','Practice buyer George requested a tour of 418 Cedar Lane through Zillow. No time was selected. You can meet Saturday morning or afternoon; property access still needs checking.',
 d([['Agent','“Hi George, I’m [your name] with [your brokerage], a featured partner with Zillow. I’m calling about your request to see 418 Cedar Lane.”'],['Agent','“I can meet Saturday morning or afternoon. Which would work better for you? I’ll check access for that time.”'],['George','“Saturday morning would be good.”']]),3,
 'Introduce George as a fictional buyer adapted from Eric’s demonstration. Read both sides. Identify name, brokerage, Zillow connection and purpose. On a live transfer, say “Zillow connected us about…” Use true affiliation and availability.',
 'Both the words and their order matter. Compare two openings for that same tour request and explain which one you would use.','INT-016');
act('opening-decision','Practice the opening','Which opening serves the buyer’s request?','A buyer requested a Zillow tour but selected no time. Both agents introduce themselves. Choose the continuation you would use, then explain what the other version could communicate to the buyer.',3,
 [['opening-invitation','Explain your choice in terms of the buyer’s experience.']],
 'The appointment-first opening helps with the request immediately. Asking about readiness before offering the visit can make the buyer feel they must qualify for help. Discovery still belongs in the call, after the early invitation and permission.',
 'An early invitation belongs here because the buyer asked to see the home. This is about order and purpose, not banning useful questions.',
 'Allow a minute to respond. Ask what the interview-first agent hoped to learn, then show where discovery belongs after the invitation. Do not shame a choice. Demonstrate a revised opening.',
 'Offering the visit gives the call a direction. Next, ask permission to learn enough about the buyer to make that visit worthwhile.',
 [['interview','“Before we schedule, tell me about your buying timeline and what you’re looking for.”'],['introduction-invitation','“I can meet Saturday morning or afternoon. Which works better? I’ll check the showing arrangements.”',true]],'choice');
add('permission','Understand the buyer','Ask permission before asking about their search','In our practice call, George has chosen Saturday morning for the Cedar Lane tour. You have not yet learned what he needs from a home.',
 d([['Agent','“Do you have a few minutes? I’d like to learn a little about your search so I can make our time together useful.”'],['George','“Sure.”'],['Agent','“Are you moving from nearby, or coming from somewhere else?”'],['George','“We’re renting an apartment here in town.”']]),2,
 'Read the exchange. Permission respects time and explains why you ask. If the buyer has only a minute, handle essentials and agree when to continue. Do not force every question.',
 'George has told us he rents locally. That is a starting point for a conversation, not a completed discovery section.','INT-016, INT-021, INT-023');
add('location','Understand the buyer','Learn why an area works for them','Our practice buyer George rents locally and wants to see the Cedar Lane home. Ask how that location fits his life.',
 d([['Agent','“What attracted you to this part of town?”'],['George','“It would make my commute much shorter.”'],['Agent','“Are you focused on this area, or are there other places that would work for that commute?”'],['George','“This area and the neighborhood just east of it would both work.”']])+
 p('Now you know why the location matters and where a useful comparison home might be. The buyer defined the area; you did not assume it.'),3,
 'The follow-up comes from the commute answer. Location means more than a ZIP code. Keep criteria buyer-defined. Ask the room what new information the follow-up provided.',
 'We know where George wants to be. Now let’s find out what he wants the home itself to do for him.','INT-016, INT-021');
add('motivation','Understand the buyer','Ask what the feature will let them do','Our practice buyer George says the Cedar Lane home caught his eye because it has a larger yard.',
 d([['Agent','“What would you like to be able to do with that extra outdoor space?”'],['George','“I want to grow vegetables. We can’t do that at the apartment.”'],['Agent','“What would you need from the yard for that?”'],['George','“Sun and room for a few raised beds.”']])+
 p('“A bigger yard” is a feature. Space for a vegetable garden explains why it matters. That reason will help you choose better comparisons.'),3,
 'Read the answers before each follow-up. Do not turn gardening into a required script or invent a matching personal anecdote. Ask what a large but shaded yard might fail to provide.',
 'Now you will choose a follow-up for a different buyer. The situation is on the next slide; there is no hidden backstory.','INT-016, INT-021');
act('next-question','Practice discovery','Choose the next question you would ask','During a first call, a buyer tells you: “We’re already in town. We need more space, but we don’t want to leave our neighborhood.” Which question would you ask first?',3,
 [['follow-up','Your next question and what its answer would help you understand.']],
 '“What is feeling too tight in your current home?” This could reveal whether they need bedrooms, work space, storage or something else. Then explore why staying in the neighborhood matters.',
 'A useful question follows the buyer’s words and reveals a reason or tradeoff that shapes the search.',
 'Give a minute to choose, then compare two questions. Ask what a possible answer would tell the agent. Different wording is not an error; look for curiosity tied to the situation.',
 'Choosing a question is one part of the skill. In pairs, practice listening to the answer and deciding what to ask next.');
const pair=act('discovery-practice','Partner practice','Practice a short discovery conversation','One person plays a buyer who wants to stay in the neighborhood but needs more space. The other plays the agent, after an appointment has been discussed. Ask permission, then find out what “more space” means.',8,
 [['next-question','What did you learn that “more space” did not tell you?'],['discovery-retry','What feedback did you receive, and what changed on your retry?']],
 'Ask permission, explore the current situation, and follow the answer. Learning that the buyer works at the kitchen table points toward a work-space need, not automatically more bedrooms.',
 'Record what you actually learned and changed. Reflection does not prove a coach observed the call.',
 '1 minute setup. Buyer privately chooses a reason for needing space and reveals it after a relevant question. Each turn is 3 minutes: 2-minute conversation, 30-second feedback, 30-second retry. Switch buyer and agent. Final minute: debrief and reflection. Video rooms are managed in the meeting platform.',
 'Discovery works best when we respond to the person. The same principle applies when a buyer says they only wanted an answer to a property question.',null,'roleplay',
 p('<strong>First turn: 3 minutes.</strong> Talk for two minutes, give one specific suggestion, then retry the sentence it changes.')+p('<strong>Switch buyer and agent: 3 minutes.</strong> Use a different reason for needing space. Everyone practices speaking and listening.')+p('Use one minute to form pairs and one minute to debrief. Submit your reflection when you return.'));
pair.activity.rubric=[{id:'permission',label:'Explains why the questions help and asks permission'},{id:'follow',label:'Follows a buyer answer rather than switching to a checklist'}];
add('questions-only','Respond to buyer questions','When the buyer says, “I only had a question”','Example: a buyer asks how old the roof is and says they are not ready to schedule a showing. You do not yet have a verified answer.',
 q('“Of course. I’ll check the roof information and get you an answer. What is the main concern you’re trying to work out?”')+
 p('Listen to the concern. If seeing the home would help, explain why and offer a visit. If they still prefer an answer first, agree how and when you will return with the information.')+
 q('“I can bring the information when we look, or call you after I verify it. Which would be more useful?”'),3,
 'Teach the whole reasoning: acknowledge, learn context, make a useful invitation. Do not make an answer conditional on a visit. If the buyer declines again, stop pushing. Never guess the roof age or claim completed research.',
 'A financing question also deserves an answer. The important distinction is who raised it and why it is relevant now.','INT-016');
add('financing','Respond to buyer questions','Do not make preapproval the price of a first visit','A buyer who asks to see a home should not have to pass a financial interview before you help arrange it.',
 p('Avoid opening the first call with “Are you preapproved?” The buyer does not know you yet, and a private financial question can make the visit feel conditional.')+
 p('If the buyer raises financing, respond to their concern and offer relevant lender help. The usual later opportunity is the end of the first showing, when the discussion has context.'),2,
 'Explain timing and framing, not a blanket ban on financing. A lender handles specifics. Do not make credit, approval or affordability promises. A long timeline does not automatically mean planning is too early.',
 'Compare the responses to this buyer’s financing concern. Decide which one helps without turning the visit into a condition.','R001–R004; INT-001–004, INT-016');
act('financing-check','Discuss the response','Help the buyer who raises financing','The buyer says: “We want to look at the house, but I’m not sure what we can comfortably afford. Should we speak with a lender?” Which response best helps the buyer?',3,
 [],'Acknowledge the affordability concern and offer lender help while continuing to help with the visit. The buyer introduced financing, so avoiding it would ignore their need.',
 'Respond to the actual concern. Do not require a letter before helping or promise the buyer can afford the home.',
 'Allow a vote, then ask what problem the buyer wants solved. Discuss offering help versus adding a gate. Do not automatically ask every new buyer about financing.',
 'Buyers may also be unsure who Zillow connected them with. A direct answer about your role is usually enough.',
 [['delay','“Let’s see the house first. We can discuss the money afterward.”'],['context','“A lender can help you work through that. I can help arrange an introduction as we plan the visit.”',true],['gate','“Yes. Send me the preapproval letter and then we can schedule.”']],'choice');
add('listing-agent','Respond to buyer questions','Answer the question about your role directly','Example: Zillow connects you with a buyer who asks, “Are you the listing agent?” You are not.',
 q('“I’m not the listing agent. I help buyers, and I can coordinate with the listing side about this home. What would you like to know?”')+
 p('Use your actual role and relationship. If the buyer wants the listing agent, offer to help with that connection. Ask whether a later check-in would be useful, then respect their choice.'),2,
 'A long agency lecture can derail a simple question. Do not invent an existing working relationship or assume the listing agent will fail to respond. Actual relationships and forms govern.',
 'Sometimes the difficult answer is about the home itself. Being helpful means telling the truth and explaining what you can still do.','INT-016–018');
add('under-contract','Respond to buyer questions','If the home is under contract, keep helping','Example: during an initial inquiry, you verify that the requested home is under contract. The buyer says its garden space is what interested them.',
 q('“The home is under contract. I can ask the listing agent whether a viewing is still possible. You mentioned the garden space; I can also look for homes with similar outdoor space. Would comparing those be useful?”')+
 p('Be honest about the status. Use what the buyer told you to propose useful work. Do not promise access or claim you have found alternatives before you have researched them.'),3,
 'Connect to Eric’s problem-solving principle. Bare bad news leaves the buyer to solve the problem. A relevant offer gives them a next step to accept or decline. Keep scope to the initial inquiry.',
 'Try the same principle with a different priority. The next buyer cares about a work commute, not a garden.','INT-014–015 applied to first inquiry');
act('changed-plan','Practice a response','Offer a useful next step after disappointing news','A buyer asks about a home you have verified is under contract. They tell you its location would shorten their commute. You have not researched other homes. Which response would you use?',2,
 [['plan','Write your response as you would say it to the buyer.']],
 '“The home is under contract. I can check whether a viewing is still possible. Since the commute is important, what area would work for you? I can research some other options there if that would help.”',
 'Tell the truth, connect the offer to the commute, and keep unverified possibilities conditional. Do not invent available properties.',
 'Ask for the reason behind the choice. Read one response and ask whether the buyer has an understandable next step. If it ends at bad news, ask for one useful offer grounded in the commute.',
 'Whether the call was straightforward or included a question, finish by saying what you understood and what happens next.');
add('summary','Agree on the next step','Summarize the buyer’s priorities and the plan','Return to practice buyer George: he wants a shorter commute and garden space. He prefers Saturday morning for Cedar Lane and has agreed to compare another home. Access is still pending.',
 q('“You’d like a shorter commute and a sunny space for a vegetable garden. We’re aiming for Saturday morning. I’ll check access to Cedar Lane and research another home to compare. I’ll text you the confirmed details once I have them. Have I understood everything correctly?”')+
 p('Before ending, confirm the communication plan and explain the applicable touring form. Describe its actual terms and what the buyer will receive.'),3,
 'Trace each fact to the case. Comparison consent is supplied here; it is not assumed from interest. The full call shows how to ask. Avoid generic promises about every state or form.',
 'Practice a close with a different plan: the buyer cannot tour this week and has agreed to a later phone conversation.','INT-016, INT-023, INT-035');
act('summary-practice','Practice the close','Close a call when the buyer cannot tour yet','A buyer is relocating in two months. They want room for a home office and cannot visit this week. You agreed to email three possible homes and speak Tuesday at 6 p.m. Which closing reflects that agreement?',3,
 [['summary','Say what matters to the buyer, what you will send, and the agreed next conversation.']],
 '“You’re planning to relocate in two months and need space for a home office. I’ll email three homes for you to look over, and we’ll talk Tuesday at six about what fits. Is there anything else you’d like me to keep in mind?”',
 'A useful next step does not always mean a near-term showing. Reflect the timeline and agreement instead of forcing the tour example onto this buyer.',
 'Allow a minute to choose and explain. Check that answers distinguish the relocation timeline from the next call. Do not invent a showing or say properties were already sent.',
 'You have practiced the pieces. Now listen to one complete call, starting with the buyer’s original request.');
add('whole-call-one','Full-call demonstration','Listen to the call from the beginning','Fictional case: George requested a tour of 418 Cedar Lane with no time selected. The agent can meet Saturday morning or afternoon and still needs to check property access.',
 d([['Agent','“Hi George, I’m [your name] with [your brokerage], a featured partner with Zillow. I’m calling about your Cedar Lane tour request. Would Saturday morning or afternoon work better?”'],['George','“Morning would be good.”'],['Agent','“I’ll check access. Do you have a few minutes so I can learn about your search?”'],['George','“Sure. We rent in town, but we’d like a shorter commute and space for a garden.”']]),2,
 'Read without explaining between turns. A volunteer can voice George. The full situation is stated here so someone need not reconstruct previous slides. Continue the demonstration on the next slide.',
 'George has just told us about the commute and garden. Continue by learning what those mean, then agree on the plan.','INT-016, INT-021');
add('whole-call-two','Full-call demonstration','Continue from what the buyer just told you','In the same practice call, George rents locally and wants a shorter commute and garden space. He prefers Saturday morning for the tour.',
 d([['Agent','“Which areas would work for your commute, and what would you want to grow?”'],['George','“Near Cedar Lane works. I’d like sun and room for raised vegetable beds.”'],['Agent','“Would you like me to find another home with that kind of space so we can compare while we’re out?”'],['George','“Yes, that would help.”'],['Agent','“So, a shorter commute and sun for a garden. I’ll check access, find a comparison and text the details for Saturday morning. Is text best for you?”'],['George','“Yes.”']]),2,
 'Read continuously. Then model a brief explanation of the applicable touring form using actual terms. Debrief invitation, permission, priorities, comparison consent and next action. The two questions follow the two priorities just raised; agents can ask them separately.',
 'Now everyone will lead a complete call. You will rotate through agent, buyer and observer, with a short retry after feedback.','INT-015–016, INT-021');
const full=act('full-call-practice','Group practice','Run a first call and retry one part','Work in trios. The buyer uses an assigned fictional case; the agent responds to what the buyer says. The observer listens for an early invitation, useful follow-up questions and an accurate closing.',12,
 [['first-attempt','What did you learn about your buyer?'],['correction','What specific feedback did the observer give?'],['retry','What changed when you tried that part again?']],
 'Introduce yourself, help with the request, ask permission, learn location and motivation, and summarize the actual plan. Adapt to the buyer’s question or time constraint. Report the conversation you practiced.',
 'Everyone needs a speaking turn and a chance to improve a specific sentence. Peer feedback and reflection are not coach sign-off.',
 '1 minute setup: assign trios and open meeting-platform rooms. Three rounds of 3 minutes: 2-minute call, 30-second observer feedback, 30-second targeted retry. Rotate all roles. Reserve 2 minutes for debrief and submissions. Buyer uses the assigned case; do not give the agent hidden buyer reasons before the call.',
 'The call is not finished work until you follow through. We’ll end by showing what to put in FUB and what to do when a lead never answers.',null,'roleplay',
 p('<strong>Three rounds, three minutes each.</strong> Two minutes for the call, 30 seconds for feedback, then a 30-second retry.')+p('<strong>Rotate all three roles.</strong> Everyone takes a turn as agent, buyer and observer. Use one minute to set up and two minutes to debrief and submit.'));
full.activity.useCases=true;
full.activity.rubric=[['introduction','Identifies agent, brokerage, Zillow connection and purpose'],['appointment','Helps with the appointment early while respecting the request'],['discovery','Asks permission and follows an answer'],['summary','Restates priorities and the agreed next action'],['adaptation','Responds usefully to the buyer’s question or time constraint']].map(([id,label])=>({id,label}));
add('follow-through','After the call','Save the details that make your next contact useful','Example: after the practice call, George wants a shorter commute and a sunny garden. Saturday morning is preferred; access and a comparison home still need checking.',
 `<div class="lesson-record"><p><strong>FUB note:</strong> Rents locally. Wants a shorter commute near Cedar Lane and sun for raised vegetable beds. Open to another home for comparison. Prefers Saturday morning. Text is the agreed channel. Tour access is not yet confirmed.</p><p><strong>Next task:</strong> Check access, research a relevant comparison, and text George the details. Set the task for the follow-up time you agreed.</p></div>`,2,
 'Connect to Day 1. Separate facts learned from actions owed. Ask what would be lost if the note only said “wants to tour.” Do not mark an appointment confirmed without supporting arrangements.',
 'That was a connected buyer. For a lead that never answers, the work is different: continue personal outreach instead of waiting on the automation.','R020–R021; INT-035–039');
add('unanswered','After the call','Keep working a new lead that has not answered','The first missed call and personal text are the beginning of your outreach, not the entire plan.',
 p('<strong>Day one:</strong> Aim for three to four personal touches, with at least two calls and one personal text in the normal unanswered-lead flow.')+
 p('<strong>First week:</strong> Aim for ten total touches, including day one. Make most attempts calls, vary the contact times, and make each text relevant to the inquiry.')+
 p('<strong>Once the buyer responds:</strong> Follow the conversation and the plan you agree together. The unanswered-lead quota no longer applies. Honor stated contact restrictions throughout.'),2,
 'These are the newer September 12 standards. Automation is not personal effort. Do not invent a compressed late-day schedule or a quota for an engaged buyer. Explain why repeating “just checking in” is not useful persistence.',
 'Whether you connect on the first attempt or later, the same job awaits: understand the request, help the buyer and agree what comes next.','INT-027–029, INT-054; R019');
add('reference','Wrap up','Use the request to begin. Use the answers to continue.','You should be able to recognize the lead, start the conversation and leave the buyer knowing what happens next.',
 p('Introduce yourself clearly. Help with the appointment early. Ask permission to learn more, follow the buyer’s answers, and summarize the plan you actually agreed.')+
 p('If a question changes the call, address it. If a fact needs checking, say so and follow through. The framework supports the conversation; the buyer’s situation determines the next sentence.')+
 '<p class="lesson-source"><a href="/workshops/day2-resources.html" target="_blank" rel="noreferrer">Open the Day 2 reference, Zillow sources and practice notes</a></p>',1,
 'Ask each learner which part they want to keep practicing. Refer to submitted work. Completion is not demonstrated competence on every client conversation.',
 'Keep your reference available for the next lead, and bring the specific moment you want help with to your coach.');
for(const s of slides){if(!s.activity)continue;const a=s.activity;
 s.body+=(a.choices?`<div class="choices" data-quiz="${s.id}">${a.choices.map(c=>`<button data-option-id="${c.id}" data-correct="${c.id===a.correctChoiceId}" data-feedback="${esc(a.explanation)}">${esc(c.text)}</button>`).join('')}</div><p class="feedback" aria-live="polite"></p>`:'')+
 a.fields.map(f=>`<label class="field">${esc(f.label)}<textarea data-save="${f.id}" placeholder="Write your practice response."></textarea></label>`).join('')+
 `<details class="reveal"><summary>Compare with the teaching example</summary><div><p>${esc(a.model)}</p><p>${esc(a.explanation)}</p></div></details>`;
}
const data={day:2,title:'Handling your first Zillow lead',version:'2026-09-15-lead-live-v10',duration:slides.reduce((n,s)=>n+s.time,0),slides,hero:'',resources:'day2-resources.html',cases:[
 {name:'Tour request · a home office',quote:'I asked to see the Cedar Lane home. Saturday morning works for me.',goal:'Fictional buyer: you rent locally and work at the kitchen table. You need a separate work space and want to stay near your neighborhood. Reveal the reason after a relevant question. You are open to a comparison home. Access has not been checked.'},
 {name:'Property question · maintenance',quote:'I wanted to know about the roof before deciding whether to tour.',goal:'Fictional buyer: surprise maintenance costs concern you. The agent does not have verified roof information. Explain the concern when asked. Prefer a call with verified information before booking; do not agree merely because the invitation is repeated.'},
 {name:'Relocation · a later visit',quote:'We are relocating in two months. We cannot see homes this week.',goal:'Fictional buyer: you need room for a home office. You can review emailed properties and talk Tuesday at six. Share details after relevant questions. The useful next step is planning, not a forced immediate showing.'}
]};
if(data.duration!==90)throw new Error(`Timing is ${data.duration}, expected 90`);
fs.writeFileSync(new URL('../web/public/workshops/day2.json',import.meta.url),JSON.stringify(data,null,2)+'\n');
console.log(`Day 2: ${slides.length} slides, ${data.duration} minutes, ${slides.filter(s=>s.activity).length} activities.`);
