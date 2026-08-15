// TRU Rep — "Welcome to Zillow Preferred: Official Training" (Day 1) as ONE module.
// Usage: node rep_zillow_day1.mjs <path-to-secrets.json>
//
// Source of truth for the content: the 36-slide facilitator script at
// ~/Documents/Codex/2026-08-08/zillow-preferred-day-one-framework/work/production/day1-slide-script.md
// This file is that script converted to self-paced learner voice. The two graded
// record exercises (Priya, slide 34; Elena, the pre-Day-2 homework, slide 36) are
// CARDS INSIDE this module — they are not separate activities and must not be
// lifted back out into standalone cards on the course home.
//
// Production controls carried over from the script and deliberately honoured here:
//   - no target numbers for any performance category (the applicable standard is
//     not confirmed, so publishing one would be inventing it);
//   - only three verified stage labels: Lead, Spoke with customer, Appointment set;
//   - an unanswered attempt is UNRESOLVED, never scored;
//   - Smart List membership is observed, never promised to clear;
//   - Day 1 stops at an accurate, usable record. Wording is Day 2, showing Day 3,
//     financing Day 4.
import { readFileSync } from 'node:fs';

const secrets = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const BASE = secrets.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';
const H = {
  apikey: secrets.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: 'Bearer ' + secrets.SUPABASE_SERVICE_ROLE_KEY,
  'Content-Type': 'application/json',
};

export const MODULE_ID = 'a6666666-6666-6666-6666-666666666666';
const T_ZILL = 'b2222222-2222-2222-2222-222222222222';

export const CARDS = [
  // ── Section 1 — A Zillow lead just arrived ────────────────────────────────
  { t: 'section', n: 'Part 1 of 9', title: 'A Zillow lead just arrived', body: 'A buyer has raised a hand. Before you touch anything, know what you are looking at.' },
  { t: 'text', k: 'A buyer just raised a hand', body: 'A Zillow connection has arrived. If it were yours right now, would you know what to do next?\n\nMost new agents answer that honestly with "not really" — and that is the point of today. The exact alert varies by phone, app version, connection type, and how our team routes leads. What never varies is this: a person asked for help, and a record is arriving that you are now responsible for.\n\nBy the end of this module you will be able to work that record without guessing.' },
  { t: 'drill', prompt: 'A new Zillow connection lands. What do you touch first?', choices: ['Call immediately', 'Open the record and see what is already known', 'Start writing a text'], answer: 1, explain: 'All three are plausible, and this is not a trick. But you open the correct record and read the facts the buyer and the system already gave you BEFORE you choose a channel. Day 2 teaches what to say.' },
  { t: 'steps', title: 'Your Day 1 finish line', steps: ['Find the right person.', 'Read what is already known.', 'Choose an available channel.', 'Select and save a truthful stage.', 'Leave useful context.', 'Create the next action.', 'Return to the right work view.'] },
  { t: 'callout', body: 'This is a doing day. You are not finished because the screen looks familiar. You are finished when another agent can open your record and know what happened and what comes next. Proof lives in the completed record.' },
  { t: 'text', k: 'Zillow is a strong source, not the whole business', body: 'Zillow Preferred connects you with consumers who have asked for real-estate help, and it gives you tools and support. It does not guarantee a closing or income. The program is performance-based, and the record you keep is part of how your work stays visible.\n\nA new agent can feel pressure to sit near the phone and wait. That pressure gets worse when every bill depends on the next connection. Work these opportunities with real care — and keep building relationships everywhere else too.\n\nOne lead source should not carry your financial life.' },
  { t: 'compare', title: 'Handling a name vs. acting like an advisor', bad: ['Skims and assumes', 'Records "talked"', 'Hopes to remember', 'Makes the record about the agent'], good: ['Reads the available facts', 'Leaves useful context', 'Creates the next action', 'Keeps the consumer’s goal visible'] },
  { t: 'text', k: 'What an advisor actually does', body: 'Advisor is not a title we put on a slide and forget. It shows up in small choices: looking before assuming, being honest about what happened, and keeping the next promise visible.\n\nNotice what the consumer asked for. Separate facts from assumptions. Record what happened. Keep the promised next step. Make the record understandable to someone else.\n\nYou do not need years of experience to start doing these. You need a repeatable way to look, decide, record, and follow through.' },
  { t: 'callout', body: 'Look. Decide. Record. Follow through.' },
  { t: 'steps', title: 'Four days, one growing skill set', steps: ['Day 1 — Understand the program and organize the lead.', 'Day 2 — Handle the first conversation.', 'Day 3 — Prepare and show like a professional.', 'Day 4 — Understand financing and Zillow Home Loans.'] },

  // ── Section 2 — How this person reached you ───────────────────────────────
  { t: 'section', n: 'Part 2 of 9', title: 'How this person reached you', body: 'The buyer did something first. What they did is a fact you are entitled to use.' },
  { t: 'text', k: 'The buyer did something first', body: 'Current property-related connections include Contact Agent, Standard Tour, and Real-Time Touring. That list is what exists today, not a promise about every future release.\n\nA person asks about a property or requests a tour. Zillow responds to the inquiry, confirms readiness, and connects the buyer with an agent. The record can carry the type of request, the property, the buyer-selected contact method, and timing.\n\nThose facts matter more than your guesses. Read what is present; do not invent what is not.' },
  { t: 'steps', title: 'From a Zillow action to your FUB record', steps: ['A consumer asks about a property or a tour.', 'Zillow handles the connection step.', 'The connection reaches the agent through our team’s current FUB path.', 'The agent reviews and claims it when required.', 'The FUB lead profile becomes the working record.'] },
  { t: 'text', k: 'Where the habit begins', body: 'Exact routing and screens depend on team settings and connection type — that part is ours, not Zillow’s, and it is worth asking about rather than assuming.\n\nThink of Follow Up Boss as the place where you pick up the work and leave the next teammate — or future you — a truthful record.\n\nThe working habit begins when you open the correct FUB record.' },

  // ── Section 3 — What Zillow pays attention to ─────────────────────────────
  { t: 'section', n: 'Part 3 of 9', title: 'What Zillow pays attention to', body: 'Three performance categories, in plain language. No targets — those have to be confirmed, not guessed.' },
  { t: 'text', k: 'The three categories', body: 'PREDICTED CONVERSION RATE — how the program estimates the likelihood that connections become successful transactions.\n\nZILLOW HOME LOANS PRE-APPROVAL TARGET — a financing-readiness measure used later in the consumer relationship.\n\nPICKUP RATE — responsiveness to incoming Zillow Preferred connection calls, calculated from answered connection calls compared with total connection call attempts.\n\nNo target numbers here on purpose. Applicable standards vary and have to be confirmed against the current authoritative Zillow source or your Growth Advisor. A number invented for a training slide is worse than no number.' },
  { t: 'drill', prompt: 'A brand-new connection arrives. Should that automatically trigger a Zillow Home Loans pitch?', choices: ['Yes — the financing category is measured, so lead with it', 'No — respect the buyer’s stated request and build an accurate record', 'Only if they viewed more than three homes'], answer: 1, explain: 'A metric tells you what the program pays attention to. It does not tell you to force the same conversation at the same moment. Today: know the category exists. Day 4: when and how a financing introduction may be appropriate.' },

  // ── Section 4 — Find the lead before you lose the lead ────────────────────
  { t: 'section', n: 'Part 4 of 9', title: 'Find the lead before you lose the lead', body: 'Open Follow Up Boss and go to People. This is the part where falling behind quietly costs you.' },
  { t: 'steps', title: 'On People, locate only these four things', steps: ['Search', 'Recent leads', 'Smart Lists and assigned collections', 'The contact rows you can access'] },
  { t: 'text', k: 'Your screen may not match mine', body: 'People is the central place to see the contacts available to you. Your permissions and assignments affect what you see, so your screen may not match every row in an example.\n\nToday you only need that small map. Two paths matter: Search and Smart Lists.\n\nSearch answers "Where is this person?" A Smart List answers "Who currently matches these saved conditions?"' },
  { t: 'drill', prompt: 'A Smart List is best described as:', choices: ['A folder you move contacts into', 'A saved search built from current filters', 'An archive of closed leads'], answer: 1, explain: 'Contacts appear because they match the conditions now. Different teams name lists differently, one action does not reliably remove a contact, and not every awareness list is supposed to reach zero. Observe what our lists actually do — do not invent a clearing rule.' },

  // ── Section 5 — What can you know before you act ──────────────────────────
  { t: 'section', n: 'Part 5 of 9', title: 'What can you know before you act?', body: 'Read the profile from the outside in — and say only what the record supports.' },
  { t: 'steps', title: 'Locate these areas on the profile', steps: ['Name and contact details', 'Source and assignment', 'Stage', 'Property or appointment request', 'Last communication and timeline', 'Home Activity', 'Tasks', 'Background and Social Profile'] },
  { t: 'text', k: 'Three questions, not a pixel map', body: 'Section order can be customised, so do not memorise where things sit. Learn the question each area answers.\n\nWho is this? What brought them here? What has happened, or must happen next?\n\nIf a section is missing from a record, say so plainly. A missing panel is a fact too.' },
  { t: 'compare', title: 'What you may say vs. what you may not', good: ['"FUB shows repeated views and a save."', '"The buyer selected phone after 4:30 PM."', '"No home activity is visible on this record."'], bad: ['"She is definitely ready to buy."', '"They obviously prefer the second property."', '"Their job title means they can afford more."'] },
  { t: 'drill', prompt: 'A record shows the buyer saved a home. Which statement is safe?', choices: ['They love that home', 'FUB shows they saved that home', 'They are ready to make an offer'], answer: 1, explain: 'Home Activity is a signal, not certainty. A signal helps you ask a better question. It cannot prove motivation, urgency, or intent. Availability also varies — missing activity does not prove the buyer did nothing.' },
  { t: 'drill', prompt: 'A LinkedIn result appears under Social Profile: "This employer means the buyer can afford more." What is that?', choices: ['A useful observation', 'A respectful question', 'An unsupported assumption to discard'], answer: 2, explain: 'Social Profile uses available name and email information, and results can be missing or wrong. A link is context — not identity verification, and not permission to investigate someone’s private life. A safe alternative asks about housing goals, never inferred income.' },
  { t: 'compare', title: 'Four places, four different jobs', good: ['Note — what happened in a specific interaction', 'Activity / timeline — recorded communications and events'], bad: ['Social Profile — optional info FUB may find, often absent or wrong', 'Background — durable high-level context, not a dumping ground'] },

  // ── Section 6 — Three ways to reach the buyer ─────────────────────────────
  { t: 'section', n: 'Part 6 of 9', title: 'Three ways to reach the buyer', body: 'Choose the channel from the facts and from what the account actually supports. Day 2 owns the words.' },
  { t: 'text', k: 'Zillow Messages and FUB text are not the same thing', body: 'ZILLOW MESSAGES is for eligible Zillow tour and property-inquiry connections. It works only when the team account connection and your agent profile link are both active. The buyer receives the message in Zillow plus a text notification, and replies come back into the Zillow Message thread in FUB. Look for the Zillow icon.\n\nFUB TEXT is a separate channel. The consumer receives an SMS, and sent messages and replies are represented on the profile, timeline, and text inbox.\n\nThe Zillow icon identifies the Zillow Message channel. It is not just a different-looking text button. If our account connection or your profile link is not active, use the FUB practice channel instead and say that you did.' },
  { t: 'drill', prompt: 'Eligible tour connection. Buyer selected Zillow Message + Immediately. The Zillow icon, account connection, and profile link are all confirmed. What do you do?', choices: ['Send a Zillow Message immediately', 'Send a FUB text instead', 'Wait until tomorrow morning'], answer: 0, explain: 'The record told you the channel and the timing, and the account supports it. Honour both.' },
  { t: 'drill', prompt: 'Same buyer selection — but the Zillow icon or your profile link is NOT confirmed. Now what?', choices: ['Send a Zillow Message anyway', 'Check the setup, then use the FUB practice channel you were given', 'Skip the contact'], answer: 1, explain: 'Never reach for an imagined control. Check setup, use the named practice channel, and mark that you changed channel. Substituting the channel does not lower the record standard.' },
  { t: 'steps', title: 'Making the call from FUB', steps: ['Locate the real call control.', 'Confirm the available method: internet, mobile bridge, or ask each time.', 'Confirm the outbound number the consumer will see.', 'End the test call.', 'Find the call record and notes on the profile.'] },
  { t: 'text', k: 'Where the call shows up', body: 'A web-app call can log automatically. A call made outside tracked FUB calling may need the current manual-log path.\n\nToday you are learning where to click and where the record appears — not what to say.\n\nThe attempt has to be represented on the profile, one way or the other. An attempt nobody can see did not happen as far as the team is concerned.' },

  // ── Section 7 — Choose a truthful stage ───────────────────────────────────
  { t: 'section', n: 'Part 7 of 9', title: 'Choose a truthful stage', body: 'Three verified labels. One honest answer of "I need to confirm that."' },
  { t: 'text', k: 'The three verified early stages', body: 'LEAD — a new record with no useful contact outcome yet. Do not treat this label as proof that no attempt was made.\n\nSPOKE WITH CUSTOMER — a real conversation happened, but no appointment date and time are confirmed. Do not use it for a one-way message with no conversation.\n\nAPPOINTMENT SET — a specific appointment date and time are confirmed. Do not use it for "interested" or "maybe this weekend."\n\nThese are the verified early labels, not the confirmed full team list. The stage for an unanswered attempt is still unresolved, and we are not going to invent one.' },
  { t: 'drill', prompt: 'The buyer was reached and shared what they need. No date or time was agreed. Which stage?', choices: ['Lead', 'Spoke with customer', 'Appointment set'], answer: 1, explain: 'A real conversation happened, so it is past Lead. Nothing was scheduled, so it is not Appointment set. The observable fact that moves the stage is the conversation itself.' },
  { t: 'drill', prompt: 'You attempted contact and nobody answered. Which stage?', choices: ['Lead', 'Spoke with customer', 'Not yet confirmed — ask before choosing'], answer: 2, explain: 'This one is here on purpose. Sometimes the correct answer is "I still need to confirm the team rule," not a guess. An outbound attempt is not a conversation, and the unanswered-attempt stage has not been settled.' },

  // ── Section 8 — Work the record ───────────────────────────────────────────
  { t: 'section', n: 'Part 8 of 9', title: 'Work the record', body: 'Everything so far has been reading. This is the part you are actually graded on.' },
  { t: 'text', k: 'What a useful note answers', body: 'Weak note: "Talked. Interested. Follow up later." That sentence helps nobody, including you in three weeks.\n\nA useful note answers three questions. What happened? What does the buyer need? What happens next, and when?\n\nFUB does not enforce this — it is our documentation habit. Keep it concise, professional, factual, and useful to another teammate. Do not bury assumptions in confident language.' },
  { t: 'script', title: 'What "good" looks like', lines: ['9:12 AM — Reached Maya. Buying with partner; wants Tacoma, 3 bedrooms, and a move in 60–90 days.', 'Asked for two options similar to 1842 Cedar Ridge Ave by Thursday afternoon.', 'Next: I will review the two viewed homes and send two relevant options by 3:00 PM Thu 8/13.'] },
  { t: 'text', k: 'A task is not a second copy of the note', body: 'The NOTE is a record of the past: what happened, what the buyer needs, what is next.\n\nThe TASK is an instruction for the future: one specific action with an owner, a date, and a time.\n\nVague: "Follow up sometime."\nSpecific: "Send Maya two Tacoma 3-bedroom options — Thu Aug 13 at 3:00 PM PT."\n\nA notification still depends on settings and on the task actually having a date and time. Selecting is not saving, either — the proof is that the value is still there after you refresh or reopen.' },
  {
    t: 'lab',
    scenario: 'priya-repair',
    title: 'Repair the record that could be lost',
    body: 'Priya’s record looks finished. It is not. First name every risk you can see — editing stays locked until your diagnosis passes. Then repair it: truthful stage, a note a teammate could act on, and a dated next action. Do not invent buyer facts that are not below.',
  },

  // ── Section 9 — Ready for Day 2 ───────────────────────────────────────────
  { t: 'section', n: 'Part 9 of 9', title: 'Ready for Day 2', body: 'One readiness check, then the record you finish on your own.' },
  { t: 'steps', title: 'Can another agent understand this record?', steps: ['Correct person and source?', 'Truthful stage, visibly saved?', 'Buyer context separated from assumptions?', 'Communication represented on the profile?', 'One clear next action with owner, date, and time?', 'Relevant Smart List checked, without assuming how it clears?'] },
  { t: 'callout', body: 'Ready = accurate + saved + understandable + scheduled. A missing account feature can use the practice channel you were given. An invented fact or an unsupported stage cannot.' },
  {
    t: 'lab',
    scenario: 'elena-homework',
    title: 'Your record before Day 2',
    body: 'No click-by-click help this time. Work only from the facts: choose the channel the record supports, save a truthful stage, write a note that stands on its own, and create a dated task. Eight out of ten, with no critical miss.',
  },
  { t: 'text', k: 'What comes next', body: 'Day 1 stops at an accurate, usable record — on purpose. Wording, conversation technique, showings, financing workflow, and transaction administration all come later, and each of them is easier once the record underneath is honest.\n\nDay 2: the conversation. Day 3: showing. Day 4: financing and Zillow Home Loans.' },
];

// Quiz — every answer is recoverable from the cards above, and none of it invents
// a target number or a stage label the script left unresolved.
export const QUESTIONS = [
  { idx: 1, prompt: 'A new Zillow connection arrives. What do you do first?', choices: ['Call immediately', 'Open the record and read what is already known', 'Send a text', 'Wait for the buyer to follow up'], answer: 1, explain: 'Read the facts the buyer and the system already gave you, then choose a channel that fits them.' },
  { idx: 2, prompt: 'Pickup rate measures:', choices: ['How fast you reply to texts', 'Responsiveness to incoming Zillow Preferred connection calls', 'How many homes a buyer viewed', 'Your closing percentage'], answer: 1, explain: 'It compares answered connection calls with total connection call attempts.' },
  { idx: 3, prompt: 'A Smart List is:', choices: ['A folder you move contacts into', 'A saved search built from current filters', 'A list Zillow controls', 'An archive'], answer: 1, explain: 'Contacts appear because they match the conditions now. Membership is decided by the filters, not by you filing them.' },
  { idx: 4, prompt: 'The record shows the buyer viewed a home four times. You may safely write:', choices: ['"She loves this home."', '"FUB shows repeat views of this home."', '"She is ready to make an offer."', '"This is her favourite property."'], answer: 1, explain: 'Home Activity is a signal, not certainty. It helps you ask a better question; it proves nothing about intent.' },
  { idx: 5, prompt: 'A real conversation happened but no date or time was agreed. The stage is:', choices: ['Lead', 'Spoke with customer', 'Appointment set', 'Under contract'], answer: 1, explain: 'Appointment set requires a confirmed date AND time. "Interested" is not an appointment.' },
  { idx: 6, prompt: 'You attempted contact and nobody answered. The correct stage is:', choices: ['Lead', 'Spoke with customer', 'Appointment set', 'Not yet confirmed — ask before choosing'], answer: 3, explain: 'The unanswered-attempt rule is genuinely unresolved. Confirming beats guessing, and an attempt is not a conversation.' },
  { idx: 7, prompt: 'A useful note answers which three things?', choices: ['Who, where, and how much', 'What happened, what the buyer needs, what is next and when', 'The buyer’s job, budget, and timeline', 'Your opinion, your plan, and your schedule'], answer: 1, explain: 'FUB does not enforce it — it is our habit, and it is what lets a teammate take over.' },
  { idx: 8, prompt: 'The buyer selected Zillow Message, but the Zillow icon and your profile link are not confirmed. You should:', choices: ['Send a Zillow Message anyway', 'Check the setup and use the FUB practice channel, and say that you did', 'Skip the buyer', 'Call instead without noting it'], answer: 1, explain: 'Never reach for a control you have not confirmed exists. Substituting the channel is fine; hiding the substitution is not.' },
  { idx: 9, prompt: 'A task differs from a note because it:', choices: ['Repeats the note for safety', 'Is one specific future action with an owner, date, and time', 'Is only for appointments', 'Is optional once the note is good'], answer: 1, explain: 'The note records the past; the task schedules the future. A promise with no date is not a next step.' },
  { idx: 10, prompt: 'Day 1 is finished when:', choices: ['You have called every lead', 'The screen looks familiar', 'Another agent could open your record and know what happened and what comes next', 'The Smart List is empty'], answer: 2, explain: 'Accurate, saved, understandable, scheduled. Smart List membership is never the finish line.' },
];

const MODULE = {
  id: MODULE_ID,
  org_id: null,
  idx: 6,
  title: 'Welcome to Zillow Preferred — Official Training',
  summary: 'Day 1, end to end: find the lead, read only what the record supports, choose a channel, save a truthful stage, and leave a record a teammate could take over.',
  body: 'The official Day 1 program, self-paced — including the two record exercises you are graded on.',
  cards: CARDS,
  pass_pct: 80,
  active: true,
  status: 'published',
  source: 'system',
  kind: 'lesson',
  duration_min: 55,
  level: 'core',
  tags: ['zillow', 'day-1', 'fub', 'stages', 'notes', 'official'],
  // core=false on purpose: switching this on changes the certification
  // denominator for every agent already at 100%. That is Eric's call, not a
  // side effect of publishing the content.
  core: false,
};

async function must(res, what) {
  if (!res.ok) throw new Error(`${what} ${res.status}: ${await res.text()}`);
}

const modRes = await fetch(`${BASE}/rep_modules?on_conflict=id`, {
  method: 'POST',
  headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify([MODULE]),
});
await must(modRes, 'module');

await fetch(`${BASE}/rep_questions?module_id=eq.${MODULE_ID}`, { method: 'DELETE', headers: H });
const qRes = await fetch(`${BASE}/rep_questions`, {
  method: 'POST',
  headers: { ...H, Prefer: 'return=minimal' },
  body: JSON.stringify(QUESTIONS.map((q) => ({ ...q, module_id: MODULE_ID }))),
});
await must(qRes, 'questions');

// First on the Zillow Preferred track.
const linkRes = await fetch(`${BASE}/rep_track_modules?on_conflict=track_id,module_id`, {
  method: 'POST',
  headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify([{ track_id: T_ZILL, module_id: MODULE_ID, idx: 1, required: true }]),
});
await must(linkRes, 'track link');

console.log(`module: 1, cards: ${CARDS.length}, questions: ${QUESTIONS.length}`);
