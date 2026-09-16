// Eric's language review: concrete instructions and natural spoken examples.
export function refineDay3(slides) {
 const rows = items => `<div class="rows">${items.map(([h,p])=>`<div class="row"><h3>${h}</h3><p>${p}</p></div>`).join('')}</div>`;
 const edits = {
  'buyer-packet': {lead:'Print a buyer copy for each home. Keep your research notes with you so you can answer questions during the tour.',body:rows([
   ['Documents for the buyer','Use the customer-facing report from your MLS. Check the address, current status, price and report date. Include relevant comparable sales and identify the source and date of any neighborhood information.'],
   ['Notes for you','Highlight features the buyer asked for. List unanswered questions, who you have asked, and when you will follow up. Keep agent-only remarks and access instructions out of the buyer’s packet.'],
   ['Before leaving','Confirm every appointment, check showing instructions, and send the buyer the meeting address and time. Bring the printed packet and your notes.']])},
  'drop-the-rope': {lead:'Tell buyers at the start that honest feedback helps you choose homes for them.',body:'<blockquote class="lesson-example">“Take your time looking around. Tell me what you like and what doesn’t work for you—you won’t hurt my feelings. That helps me narrow down what we look at next.”</blockquote>'},
  'during-the-visit': {lead:'Let buyers look around and talk to each other before you ask for their reaction.',body:rows([
   ['Give them room','Stay nearby so they can ask questions. Let them finish looking through a room before you speak; a quiet moment does not need to be filled.'],
   ['Follow what they say','If they say the office feels small, ask: “What would you need to fit in here?” Listen before suggesting another use for the room.'],
   ['Say when you do not know','“I don’t have the roof replacement date. I’ll ask the listing agent for documentation and update you by five.” Record the question and send the update even if the answer is still pending.']])},
  'after-the-tour': {title:'Take five minutes to review the tour and ask about an offer',lead:'Before everyone leaves the last home, ask the buyers to stay for a short conversation.',body:'<div class="conversation-sequence"><div class="conversation-turn"><span>Invite the conversation</span><blockquote>“We’ve looked at several houses today. Before we wrap up, I like to take five minutes with my clients to talk through what we saw. Do you have a few minutes now?”</blockquote><p>If you toured one home, say “this house.” If they need to leave, agree on a specific time to talk.</p></div><div class="conversation-turn"><span>Ask the first question</span><blockquote>“Did we see any homes we want to write an offer on?”</blockquote><p>Pause and let them answer. Give each buyer time to speak before you recommend a next step.</p></div></div><p class="conversation-close">Use their answer to choose your next question: which home, what did not work, or what they still need to know.</p>',theme:'tru alms lesson training-depth conversation-example'},
  'offer-answer': {lead:'Ask the follow-up that matches their answer. You do not need to ask every question on this slide.',body:rows([
   ['Yes: identify the home and questions','“Which home would you like to make an offer on? Is there anything you need answered before we talk through the offer?” Write down those questions and arrange the offer conversation.'],
   ['No: find out what to change','“Which home came closest? What was missing?” If comparing homes is difficult, ask for a one-to-ten rating and what would raise it. Confirm which search criteria to change.'],
   ['Unsure: name what is holding them back','“What are you still thinking through?” Listen first. Then ask what information would help them decide and agree who will get it and when you will talk again.']])},
  'concern-framework': {lead:'Ask what the buyer means before suggesting a lender call, another tour or a different timeline.',body:rows([
   ['Repeat the concern in their words','If they say they want to wait six months: “Okay, you’re thinking about six months from now.” Avoid telling them you understand a reason they have not explained.'],
   ['Ask about the reason','“What’s happening in six months?” Let them answer. A lease ending, a work move and saving for a down payment call for different plans.'],
   ['Offer one step that addresses the answer','For a payment question, offer a lender conversation. For a home they must sell first, offer to discuss the sale timeline. Ask whether that would help, then agree on an action and a follow-up time.']])},
  'plan-demo': {body:'<blockquote class="lesson-example">“Your lease ends in six months, and you want to know what the monthly payment would be before you decide. Would you like me to introduce you to a lender to go through the numbers? Or do you already have someone you’d like to call?”</blockquote><div class="rows"><div class="row"><h3>If they want the introduction</h3><p>Confirm how and when they want to connect. After the lender call is scheduled, ask: “When would be a good time for us to talk through what you learned?” Save that follow-up.</p></div><div class="row"><h3>If they decline</h3><p>“Okay. What would you like to do from here?” Listen and agree on whether and when they want you to contact them again.</p></div></div>'},
  'plan-check': {title:'Confirm the action and the next contact before you leave',lead:'Summarize the agreement out loud, then ask whether it works for the buyer.',body:rows([
   ['Say what you will do','“I’ll ask the listing agent for the roof documentation.” Name the action instead of saying you will look into things.'],
   ['Confirm what the buyer agreed to do','Only include actions they accepted. If they agreed to contact their lender, confirm what they want to ask and when they expect to have the conversation.'],
   ['Set the next contact','“I’ll call you by five today, even if I’m still waiting for the document. Does that work for you?” Save a task for the time you agreed on.']])},
  'record-the-plan': {lead:'Before your next appointment, save the conversation and follow-up in Follow Up Boss.',body:rows([
   ['Write the note','Record the homes discussed, what the buyer liked or ruled out, and why. Add unanswered questions, promised actions and the agreed contact time. Do not record an assumption as a buyer decision.'],
   ['Update the stage','Use Met with customer after the first appointment; Showing homes after the second.'],
   ['Create the task','Assign yourself the promised action with a due date and time. A note alone will not remind you to call. Send the update on time even if you are still waiting for someone else.']])},
  'wrap': {lead:'Use these steps on your next tour, then save the agreement in Follow Up Boss.',body:rows([
   ['Before the tour','Research the selected homes, list unanswered questions and confirm access, timing and your buyer packet.'],
   ['During the tour','Let buyers look around. Listen to their reactions and ask a follow-up about what matters to them.'],
   ['Before leaving','Ask about an offer. Follow their answer, agree on who will do what and when, then save the note and follow-up task.']])},
 };
 for (const slide of slides) {
  const edit=edits[slide.id.slice(5)];
  if(edit){Object.assign(slide,edit);slide.notes='Teach from the visible steps and sample wording. Adapt the words to the actual conversation; do not present sample dialogue as a real client transcript. Ask the agent to name the action, who will do it, and when. Source: Eric’s Day Three language and consolidation feedback.';}
 }
 return slides;
}
