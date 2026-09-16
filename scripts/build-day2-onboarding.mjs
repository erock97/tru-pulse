import fs from 'node:fs';
import { reviseTraining } from './training-quadrants.mjs';
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
    ["five", "Within 5 minutes", true],
    ["ten", "Within 10 minutes"],
    ["fifteen", "Within 15 minutes"],
    ["twenty", "Within 20 minutes"]
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
 'We have seen what can arrive. Before we talk about what to say, take a guess at how much the timing of your response matters.','INT-012');
act('lead-discussion','Before you make contact','Give your best guess: how quickly should you call?','A 2007 study of web leads found 100 times higher odds of making contact when the first call happened within ___ rather than 30 minutes. Which timeframe fills the blank?',3,
 [['lead-response','Why do you think the response time changes the chance of a conversation?']],
 'Within 5 minutes. The study compared calls at five minutes with calls at 30 minutes and reported 100 times higher odds of contact. It studied web leads across six companies, not Zillow buyers specifically. The practical point: respond while the request is fresh.',
 'This is a prediction to start the discussion, not a test of a rule you have already learned. Ask what may change for a buyer while they wait. The research measured time from the web inquiry; our training standard starts when the agent receives the lead.',
 'Say: “Give me your best guess. Then tell me why you think timing would matter.” Hear a few answers before revealing five minutes. Attribute the statistic to the 2007 InsideSales.com and James Oldroyd study, not Zillow. Do not describe higher odds as a guaranteed result for an individual buyer.',
 'Five minutes is sooner than many people expect. Here is how to apply that when a new lead reaches you during business hours.',null,'discussion',
 '<p class="lesson-source">Source: <a href="https://cdn2.hubspot.net/hub/25649/file-13535879-pdf/docs/mit_study.pdf" target="_blank" rel="noreferrer">InsideSales.com / James Oldroyd, 2007 Lead Response Management Study</a>. Historical web-lead research.</p>');
slides.at(-1).activity.fields[0].label='Why do you think the response time changes the chance of a conversation?';
add('channel','Make contact','Call promptly when the buyer has asked to hear from you','For a new lead received during normal business hours, 8 a.m.–8 p.m., call within five minutes unless the buyer gave a different contact instruction.',
 p('The buyer just asked for help with a home. A call lets you hear their tone, answer questions as they arise, and begin a conversation about what they need.')+
 p('Follow Up Boss may already have sent an automated introduction. That does not replace your own call. If the buyer requested a later callback or asked for text, respect that instruction.'),2,
 'Explain Eric’s reason: the buyer just expressed interest, rather than being a random person being interrupted. Hearing and responding in real time matters. Do not repeat unverified response-rate statistics. The clock starts at agent receipt; do not invent after-hours rules.',
 'Calling promptly does not mean the buyer will always answer. Here is what to do when your first call goes unanswered.','INT-009, INT-011–013');
add('no-answer','Make contact','If the call goes unanswered, send a personal text','Example: a buyer requested a tour of 418 Cedar Lane. You just called, but they did not answer. The address is fictional.',
 q('“Hi, this is [your name] with [your brokerage]. I just tried calling about your Zillow request to see 418 Cedar Lane. I’d be happy to help arrange a tour. I’m available for a call at 4 or 6 today. Would either time work for you?”')+
 p('Tell them who called, connect the call to their request, and offer a clear opportunity to talk. Use times you can actually make. You are offering a phone call here, not confirming a tour.'),2,
 'Read the example with your own name and brokerage. Distinguish phone-call availability from tour availability. This personal text follows the missed call. Next, explain how this first attempt fits into the ongoing outreach plan.',
 'If this call and text still get no response, keep making personal attempts. Here is how to plan that follow-up.','INT-011');
add('unanswered','Make contact','Keep working a new lead that has not answered','The first missed call and personal text are the beginning of your outreach, not the entire plan.',
 p('<strong>Day one:</strong> Aim for three to four personal touches, with at least two calls and one personal text in the normal unanswered-lead flow.')+
 p('<strong>First week:</strong> Aim for ten total touches, including day one. Make most attempts calls, vary the contact times, and make each text relevant to the inquiry.')+
 p('<strong>Once the buyer responds:</strong> Follow the conversation and the plan you agree together. The unanswered-lead quota no longer applies. Honor stated contact restrictions throughout.'),2,
 'These are the newer September 12 standards. Automation is not personal effort. Do not invent a compressed late-day schedule or a quota for an engaged buyer. Explain why repeating “just checking in” is not useful persistence.',
 'Those outreach targets apply when there is no response. Now consider a buyer who has already told you when they can talk.','INT-027–029, INT-054; R019');
act('channel-check','Make contact','Respond to a buyer who is at work','A new Zillow inquiry arrives at 2 p.m. The buyer writes: “I’m at work. Please call at 5 about the Cedar Lane home.” What should you do next?',3,
 [['callback-text','Write your text and the planned call time.']],
 '“Hi, I’m [your name] with [your brokerage]. I’ll be the agent calling at 5 about the Cedar Lane home. If you have questions before then, you’re welcome to text me.” Call at 5 as requested.',
 'Acknowledge now so the buyer knows who will call. The requested time governs the call; the default does not justify interrupting them at work.',
 'Before voting, teach Eric’s exception: acknowledge by text now and call at the requested time. Demonstrate “I’ll be the agent calling you at five.” Then let learners choose and explain. Review whether it introduces the agent and preserves the callback. Earlier availability is optional.',
 'Once the buyer answers, the task changes from making contact to leading a useful conversation. LEAD gives you an order for that conversation.');
add('alms','Begin the conversation','Use LEAD to guide the conversation','Introduce yourself. Ask for the appointment. Learn what matters. Confirm the plan.',
 list(['<strong>L — Lead with who you are:</strong> Introduce yourself: your name, brokerage, connection to Zillow, and why you’re calling.','<strong>E — Extend the invitation:</strong> Immediately after your introduction, ask for the appointment. Offer the buyer two concrete times to meet with you.','<strong>A — Ask questions that move the conversation forward:</strong> Ask where they want to live, what prompted their search, and what matters to them. Use their answers to ask the next useful question.','<strong>D — Deliver the summary:</strong> Summarize what matters to the buyer, confirm the next steps, and build momentum toward the appointment.'])+p('You may also know Zillow’s ALMS: Appointment, Location, Motivation, Summarize. LEAD includes your introduction and uses location and motivation to guide your questions.'),2,
 'After introducing yourself, ask for the appointment and offer two concrete times. Then ask questions that move the conversation forward: where they want to live, what prompted their search, and what matters. Use each answer to choose the next useful question. Summarize next steps to build momentum into the appointment.',
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
 'Once you have offered the appointment, good questions help you make it useful. Here are conversation starters you can use in your own words.',
 [['interview','“Before we schedule, tell me about your buying timeline and what you’re looking for.”'],['introduction-invitation','“I can meet Saturday morning or afternoon. Which works better? I’ll check the showing arrangements.”',true]],'choice');
add('conversation-starters','Understand the buyer','Questions you can use to start a conversation','Choose a question that fits what the buyer has already told you. Use the answer to decide what to ask next.',
 '<div class="lesson-question-bank">'+list(['What made you click on this particular home?','Have you had a chance to look at other homes in the market?','What other homes have you been considering?','Where are you moving from?','Which areas are you considering, and what draws you to them?','What would you like your next home to do differently?','What prompted you to start looking?','Is this your first home purchase, or have you bought before?','What timing would work best for you?','What have you liked or disliked about the homes you’ve seen?'])+'</div>'+p('Go deeper: “Tell me more about that.” · “What makes that important to you?” · “What would that change for you?”'),5,
 'Give agents a usable menu, not a list they must finish. Read two or three starters and ask a volunteer to answer one. Demonstrate a follow-up based on the answer. For “more space,” ask what they need room for. For an area, ask what makes it work for them. Check that the buyer has time for the conversation. The full question bank is in the reference.',
 'Now use the same idea with a buyer who has already told you something. Choose the question that would help you understand it.','Eric September 15 refinement; INT-016, INT-021');
act('next-question','Practice discovery','Choose the next question you would ask','During a first call, a buyer tells you: “We’re already in town. We need more space, but we don’t want to leave our neighborhood.” Which question would you ask first?',3,
 [['follow-up','Your next question and what its answer would help you understand.']],
 '“What is feeling too tight in your current home?” This could reveal whether they need bedrooms, work space, storage or something else. Then explore why staying in the neighborhood matters.',
 'A useful question follows the buyer’s words and reveals a reason or tradeoff that shapes the search.',
 'Give a minute to choose, then compare two questions. Ask what a possible answer would tell the agent. Different wording is not an error; look for curiosity tied to the situation.',
 'Choosing a question is one part of the skill. In pairs, practice listening to the answer and deciding what to ask next.');
const pair=act('discovery-practice','Partner practice','Practice a short discovery conversation','One person plays a buyer who wants to stay in the neighborhood but needs more space. The other plays the agent, after an appointment has been discussed. Choose a conversation starter, then find out what “more space” means.',11,
 [['next-question','What did you learn that “more space” did not tell you?'],['discovery-retry','What feedback did you receive, and what changed on your retry?']],
 'Choose a relevant starter, explore the current situation, and follow the answer. Learning that the buyer works at the kitchen table points toward a work-space need, not automatically more bedrooms.',
 'Record what you actually learned and changed. Reflection does not prove a coach observed the call.',
 '1 minute setup. Buyer privately chooses a reason for needing space and reveals it after a relevant question. Each turn is 4 minutes: 2-minute conversation, 1-minute feedback, 1-minute retry. Switch buyer and agent. Final 2 minutes: debrief and reflection. Video rooms are managed in the meeting platform.',
 'Those follow-up questions also help when a buyer raises a concern. Let’s learn a simple approach you can use whenever a buyer raises a concern.',null,'roleplay',
 p('<strong>First turn: 4 minutes.</strong> Talk for two minutes, give one minute of specific feedback, then use one minute to retry.')+p('<strong>Switch buyer and agent: 4 minutes.</strong> Use a different reason for needing space. Everyone practices speaking and listening.')+p('Use one minute to form pairs and two minutes to debrief. Submit your reflection when you return.'));
pair.activity.rubric=[{id:'starter',label:'Uses a relevant conversation starter'},{id:'follow',label:'Follows a buyer answer rather than switching to a checklist'}];
add('objection-framework','Handle buyer concerns','Acknowledge. Ask. Offer a solution.','Help the buyer work through the concern. Do not rush past it to get back to your script.',
 list(['<strong>Acknowledge the concern:</strong> Recognize what feels difficult or uncertain. “I hear you—this is a big decision.”','<strong>Ask questions to understand:</strong> Find out what is underneath it. “What part is worrying you most?” Then follow their answer.','<strong>Offer a solution:</strong> Propose a specific next step that addresses what you learned. Explain how it helps, then ask, “Would that be useful?”'])+p('An objection is not resolved just because you delivered a response. Listen to whether the proposed next step actually helps.'),4,
 'Model empathy without assuming you know the problem. Ask before prescribing. A question about the roof may be about repair costs or a previous bad experience. A market concern may be about timing, payment, or making the wrong choice. The solution should follow the answer. If the buyer declines, respect that and agree on an appropriate next step.',
 'Now look at the concerns you may hear. For each one, think about what you would need to understand before offering a solution.','Eric September 15 objection framework');
add('buyer-concerns','Handle buyer concerns','Common objections you may hear','Different words can hide very different concerns. Start by understanding what is behind the buyer’s hesitation.',
 '<div class="lesson-question-bank">'+list(['“I only had a question about the home.”','“I’m not ready to buy yet.”','“I’m uncertain about the market.”','“I’m worried about the monthly payment.”','“We need to sell our home first.”','“The home I wanted is already under contract.”','“I only want to speak with the listing agent.”','“I don’t want to commit to an agent yet.”'])+'</div>'+p('Which have you heard? What did the buyer actually need help understanding?'),3,
 'Invite two people to name a concern they have heard. Do not diagnose it from the label alone: “not ready” could mean timing, money, uncertainty, or simply wanting information first. You do not need a separate memorized speech for each item.',
 'Let’s apply those three steps to one of these concerns: uncertainty about the market.','Eric September 15 objection framework; INT-016–018');
add('market-concern','Demonstrate the approach','“I’m uncertain about the market right now.”','Example: the buyer is interested in the home but hesitates when you offer an appointment. Find out what is behind the concern before offering a solution.',
 d([['Acknowledge','“I hear you. It’s a big decision, and you want to feel comfortable with it.”'],['Ask','“What is worrying you most about buying right now?”'],['Buyer','“I’m worried we’ll rush and choose the wrong home.”'],['Offer a solution','“We can use a visit to learn what works for you and compare it with other options. You don’t have to decide to buy today. Would seeing it with that purpose help?”']]),4,
 'Read the buyer’s concern before the response. Emphasize that this buyer is worried about choosing the wrong home; we learned that by asking. Do not use the same solution automatically if the concern is affordability or a need to sell first. Do not predict rates or prices. Explain actual touring agreements accurately if asked; do not promise there are no forms or obligations.',
 'Now apply the same three steps to a different concern. Focus on understanding the person before deciding what help to offer.','Eric September 15 objection framework');
act('objection-practice','Practice the approach','A property question may have a concern behind it','A buyer says, “I only wanted to know about the roof. Our last house had an expensive leak, and I’m not ready to schedule anything.” You have not verified the roof information. Which response best acknowledges, explores, and offers relevant help?',4,
 [['objection-reason','Why does your choice help this buyer? What would you ask next?']],
 '“After that experience, I understand why the roof matters. What would you want to know before feeling comfortable taking another look? I can verify that information and we can decide on the next step from there.” Then listen. The buyer may need repair records, an answer about age, or help understanding what remains unknown. Do not guess the facts or make the answer conditional on a visit.',
 'The response recognizes the experience, asks what information would help, and offers to verify it. An invitation can follow when it helps with the concern; it should not skip over the concern.',
 'Take a choice and a reason, then ask two volunteers to say their own version using acknowledge, ask, and offer. Compare what each response assumes. Acknowledge does not mean pretending to know how the buyer feels. A useful solution follows the buyer’s answer.',
 'Once you have worked through the concern and agreed on a useful next step, summarize the plan so the buyer knows what happens next.',
 [['visit','“I understand why you’re cautious. Let’s tour it first so you can see how much you like it.”'],['facts','“That sounds frustrating. I’ll send you the roof age when I find it, and you can call me when you’re ready.”'],['understand','“After that experience, I understand why the roof matters. What would you need to know to feel comfortable? I can verify that information and we can decide on the next step.”',true]],'choice');
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
 'You have practiced each part of the conversation. Now put them together in a role-play, with a buyer and an observer to help you improve.');
const full=act('full-call-practice','Group practice','Run a first call and retry one part','Work in trios. The buyer uses an assigned fictional case; the agent responds to what the buyer says. The observer listens for an early invitation, useful follow-up questions and an accurate closing.',16,
 [['first-attempt','What did you learn about your buyer?'],['correction','What specific feedback did the observer give?'],['retry','What changed when you tried that part again?']],
 'Introduce yourself, help with the request, ask permission, learn location and motivation, and summarize the actual plan. Adapt to the buyer’s question or time constraint. Report the conversation you practiced.',
 'Everyone needs a speaking turn and a chance to improve a specific sentence. Peer feedback and reflection are not coach sign-off.',
 '1 minute setup: assign trios and open meeting-platform rooms. Three rounds of 4 minutes: 2-minute call, 1-minute observer feedback, 1-minute targeted retry. Rotate all roles. Reserve 3 minutes for debrief and submissions. Buyer uses the assigned case; do not give the agent hidden buyer reasons before the call.',
 'You have made a plan with the buyer. Now record what you learned and what you owe them, so the next step actually happens.',null,'roleplay',
 p('<strong>Three rounds, four minutes each.</strong> Two minutes for the call, one minute for feedback, then a one-minute retry.')+p('<strong>Rotate all three roles.</strong> Everyone takes a turn as agent, buyer and observer. Use one minute to set up and three minutes to debrief and submit.'));
full.activity.useCases=true;
full.activity.rubric=[['introduction','Identifies agent, brokerage, Zillow connection and purpose'],['appointment','Helps with the appointment early while respecting the request'],['discovery','Asks permission and follows an answer'],['summary','Restates priorities and the agreed next action'],['adaptation','Responds usefully to the buyer’s question or time constraint']].map(([id,label])=>({id,label}));
add('follow-through','After the call','Save the details that make your next contact useful','Example: after the practice call, George wants a shorter commute and a sunny garden. Saturday morning is preferred; access and a comparison home still need checking.',
 `<div class="lesson-record"><p><strong>FUB note:</strong> Rents locally. Wants a shorter commute near Cedar Lane and sun for raised vegetable beds. Open to another home for comparison. Prefers Saturday morning. Text is the agreed channel. Tour access is not yet confirmed.</p><p><strong>Next task:</strong> Check access, research a relevant comparison, and text George the details. Set the task for the follow-up time you agreed.</p></div>`,2,
 'Connect to Day 1. Separate facts learned from actions owed. Ask what would be lost if the note only said “wants to tour.” Do not mark an appointment confirmed without supporting arrangements.',
 'That completes the path from a new lead through the first conversation and follow-through. Let’s close by reviewing what you can take into your next call.','R020–R021; INT-035–039');
add('reference','Day 2 wrap-up','From the next lead to the next step','Today, you practiced the complete first-conversation process. Take these four actions into your next lead.',
 list(['<strong>Recognize the lead.</strong> Know whether you are joining a live buyer or responding to a new request.','<strong>Start the conversation.</strong> Respond promptly, introduce yourself, and offer a useful appointment.','<strong>Understand the buyer.</strong> Follow their answers and work through concerns with empathy, questions, and a solution.','<strong>Agree and follow through.</strong> Summarize the plan, record it in FUB, and do what you promised.'])+
 '<p class="lesson-source"><a href="/workshops/day2-resources.html" target="_blank" rel="noreferrer">Keep your conversation starters and practice reference handy ↗</a></p>',1,
 'Close the training rather than introducing another lesson. Review the four outcomes briefly. Ask each learner which part they want to keep practicing, using their role-play experience. Remind them the reference includes questions they can keep beside them. Practice today is a starting point, not proof of mastery.',
 'Keep your reference available for the next lead, and bring the specific moment you want help with to your coach.');
// Use a deliberate photo sequence; no random rotation during a live session.
for (const [id, theme] of [
 ['alms','lesson-framework'],['objection-framework','lesson-framework lesson-three'],['unanswered','lesson-timeline'],
 ['agenda','lesson-photo photo-arrival'],['standard-tour','lesson-photo photo-home'],
 ['channel','lesson-photo photo-follow-up'],['introduction','lesson-photo photo-coaching'],
 ['discovery-practice','lesson-photo photo-questions'],['market-concern','lesson-photo photo-concern'],
 ['full-call-practice','lesson-photo lesson-practice-photo photo-practice'],
 ['reference','lesson-photo lesson-closing-photo photo-conversation']
]) { slides.find(slide => slide.id === `day2-${id}`).theme += ` ${theme}`; }
for(const s of slides){if(!s.activity)continue;const a=s.activity;
 s.body+=(a.choices?`<div class="choices" data-quiz="${s.id}">${a.choices.map(c=>`<button data-option-id="${c.id}" data-correct="${c.id===a.correctChoiceId}" data-feedback="${esc(a.explanation)}">${esc(c.text)}</button>`).join('')}</div><p class="feedback" aria-live="polite"></p>`:'')+
 a.fields.map(f=>`<label class="field">${esc(f.label)}<textarea data-save="${f.id}" placeholder="Write your practice response."></textarea></label>`).join('')+
 `<details class="reveal"><summary>Compare with the teaching example</summary><div><p>${esc(a.model)}</p><p>${esc(a.explanation)}</p></div></details>`;
}
const data={day:2,title:'Handling your first Zillow lead',version:'2026-09-15-lead-live-v16',duration:slides.reduce((n,s)=>n+s.time,0),slides,hero:'',resources:'day2-resources.html',cases:[
 {name:'Tour request · a home office',quote:'I asked to see the Cedar Lane home. Saturday morning works for me.',goal:'Fictional buyer: you rent locally and work at the kitchen table. You need a separate work space and want to stay near your neighborhood. Reveal the reason after a relevant question. You are open to a comparison home. Access has not been checked.'},
 {name:'Property question · maintenance',quote:'I wanted to know about the roof before deciding whether to tour.',goal:'Fictional buyer: surprise maintenance costs concern you. The agent does not have verified roof information. Explain the concern when asked. Prefer a call with verified information before booking; do not agree merely because the invitation is repeated.'},
 {name:'Relocation · a later visit',quote:'We are relocating in two months. We cannot see homes this week.',goal:'Fictional buyer: you need room for a home office. You can review emailed properties and talk Tuesday at six. Share details after relevant questions. The useful next step is planning, not a forced immediate showing.'}
]};
data.questionBank='<h2>Conversation starters to keep beside you</h2><p>Choose what fits the conversation. You do not need to ask every question. Start with what the buyer already told you and follow their answers.</p>'+[
 ['Open the conversation',['What made you click on this particular home?','Have you had a chance to look at other homes in the market?','What other homes have you been considering?','What have you liked or disliked about the homes you’ve seen?','Is this your first home purchase, or have you bought before?']],
 ['Understand what matters',['Where are you moving from?','Which areas are you considering, and what draws you to them?','What is working well in your current home?','What would you like your next home to do differently?','What prompted you to start looking?','What would that extra space let you do?']],
 ['Explore timing and decisions',['What timing would work best for you?','What needs to happen before you can make a move?','Who else would you like involved in looking at homes or making the decision?']],
 ['Follow an answer',['Tell me more about that.','What makes that important to you?','What would that change for you?','What would help you feel comfortable with the next step?']]
].map(([title,questions])=>'<h3>'+title+'</h3>'+list(questions)).join('')+'<h2>When a buyer raises a concern</h2>'+list(['Acknowledge the concern: recognize the worry or frustration before moving on.','Ask questions to understand: What part concerns you most? What happened before? What would you need to know?','Offer a solution: propose a specific action tied to their answer, then check whether it would help.'])+'<p>Useful next steps may include verifying property information, comparing homes, arranging lender help when the buyer raises financing, or agreeing on a later conversation. Be accurate about your role, property status, and what you can promise. Respect the buyer’s decision.</p>';
if(data.duration!==90)throw new Error(`Timing is ${data.duration}, expected 90`);
fs.writeFileSync(new URL('../web/public/workshops/day2.json',import.meta.url),JSON.stringify(reviseTraining(data),null,2)+'\n');
console.log(`Day 2: ${slides.length} slides, ${data.duration} minutes, ${slides.filter(s=>s.activity).length} activities.`);
