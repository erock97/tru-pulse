// TRU Rep — curriculum v4 push (data-only; the schema already has rep_modules.cards).
// Usage: node rep_curriculum.mjs <path-to-secrets.json>   (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
// This file is also the versioned source of truth for the course content.
import { readFileSync } from 'node:fs';

const secrets = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const BASE = secrets.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';
const H = {
  apikey: secrets.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: 'Bearer ' + secrets.SUPABASE_SERVICE_ROLE_KEY,
  'Content-Type': 'application/json',
};

const M0 = 'a0000000-0000-0000-0000-000000000000';
const M1 = 'a1111111-1111-1111-1111-111111111111';
const M2 = 'a2222222-2222-2222-2222-222222222222';
const M3 = 'a3333333-3333-3333-3333-333333333333';
const M4 = 'a4444444-4444-4444-4444-444444444444';

const MODULES = [
  {
    id: M0,
    insert: { title: 'Welcome to Preferred', pass_pct: 80 },
    idx: 1,
    summary: 'The program standards — and the pipeline that keeps you in it.',
    body: 'Three numbers Zillow holds you to, and the stages that must be used.',
    cards: [
      { t: 'video', title: 'A welcome from your team leader', url: '', body: 'Two minutes from the person who built this team — why you’re here, and what the standard looks like.' },
      { t: 'text', k: 'Welcome to Preferred', body: 'You’ve been handed something most agents grind for years to earn: a seat on a Zillow Preferred team. Buyers come to you — live transfers, warm handoffs, real people actively looking at homes today.\n\nThe seat isn’t free. Zillow holds every agent on this team to three numbers, and the team holds itself to a pipeline discipline that keeps those numbers visible. This module walks you through both — the standards and the stages — so nothing in this program ever surprises you.\n\nRead it slowly. Everything else in this course builds on what’s in here.' },
      { t: 'section', n: 'Part 1 of 2', title: 'The standards', body: 'Three numbers Zillow holds YOU to — from day one.' },
      { t: 'stat', big: '25%', label: 'minimum Pickup Rate — answering the INITIAL connection call and accepting the lead. Yours, not the team’s.', src: 'Zillow Preferred agent standard' },
      { t: 'stat', big: '4%', label: 'minimum PCVR — post-connection conversion rate. The share of your connections that become transactions.', src: 'Zillow Preferred agent standard' },
      { t: 'stat', big: '10%', label: 'minimum pre-approval rate for buyers you move to the Met With stage in Follow Up Boss.', src: 'Zillow Preferred agent standard' },
      { t: 'text', k: 'What these numbers actually ask of you', body: 'Pickup rate is the easiest standard to hold and the first one new agents drop: answer the initial call, say yes to the lead. That’s it. Every screened call is a buyer someone else gets to meet.\n\nPCVR is the long game. At 4%, roughly one connection in twenty-five becomes a transaction — and everything in this course (speed, ALMS, follow-up) exists to push your number past that floor.\n\nThe pre-approval rate is about honesty in the pipeline: Met With has to MEAN something. If you’re sitting down with buyers and one in ten isn’t getting pre-approved, the consults aren’t consults — they’re coffee.' },
      { t: 'section', n: 'Part 2 of 2', title: 'The pipeline', body: 'The stages that MUST be used in Follow Up Boss.' },
      { t: 'text', k: 'Stages are the language', body: 'Zillow and your leader read the funnel straight out of Follow Up Boss. When a stage is wrong or missing, the work becomes invisible — your pickup was real, your consult was real, but the system sees an abandoned lead.\n\nSo the stage ladder below isn’t a suggestion. It’s the shared language the whole program speaks, and every lead you touch should be sitting on the rung that matches reality.' },
      { t: 'steps', title: 'The required stages — in order', steps: ['Spoke With', 'Appointment Set', 'Met With', 'Showing Homes (buyers) / Listing Agreement (sellers)', 'Under Contract', 'Sales Closed'] },
      { t: 'video', title: 'How to log the deal in Follow Up Boss', url: 'https://www.loom.com/share/10e2b74d1e3949a8bdcf96e67b474907', body: 'Every deal must be logged in Follow Up Boss — this walkthrough shows exactly how.' },
      { t: 'drill', prompt: 'You just ended your first real phone conversation with a new connection. Which stage?', choices: ['Appointment Set', 'Spoke With', 'Met With', 'Leave them in Lead'], answer: 1, explain: 'A real conversation = Spoke With, the moment it ends. Appointment Set comes when a time is booked; Met With means you’ve actually sat down together.' },
      { t: 'drill', prompt: 'You toured two homes with the buyer this afternoon. Where do they sit now?', choices: ['Met With', 'Spoke With', 'Showing Homes', 'Under Contract'], answer: 2, explain: 'Touring = Showing Homes. Met With was the consult before it — the ladder moves one honest rung at a time.' },
      { t: 'callout', body: 'These standards aren’t hoops. They’re the exact reason the connections keep coming — to you, and to everyone on this team.' },
    ],
    qs: [
      { idx: 1, prompt: 'Your minimum Pickup Rate as a Preferred agent is…', choices: ['10%', '25% — answer the initial call and accept the lead', '60%', 'There is no individual bar'], answer: 1, explain: 'Pickup = answering the INITIAL call and accepting the lead. The agent bar is 25%.' },
      { idx: 2, prompt: 'The PCVR standard is…', choices: ['1% or higher', '25% or higher', '4% or higher', '50% or higher'], answer: 2, explain: 'PCVR — post-connection conversion rate — must hold at 4% or higher.' },
      { idx: 3, prompt: 'Of the buyers you move to Met With, what share must reach pre-approval?', choices: ['None — pre-approval is the lender’s job', 'At least 10%', 'All of them', '4%'], answer: 1, explain: 'Met With has to mean something: at least 10% of those buyers reach pre-approval.' },
      { idx: 4, prompt: 'You just finished a first real conversation with a connection. The stage becomes…', choices: ['Met With', 'Spoke With', 'Appointment Set', 'Showing Homes'], answer: 1, explain: 'A real conversation = Spoke With, the moment it ends.' },
      { idx: 5, prompt: 'Deals must be logged in…', choices: ['A spreadsheet', 'Zillow’s portal', 'Follow Up Boss', 'Email to your leader'], answer: 2, explain: 'Follow Up Boss is the system of record — the walkthrough video shows exactly how.' },
      { idx: 6, prompt: 'A buyer you’re actively touring homes with sits in…', choices: ['Met With', 'Under Contract', 'Showing Homes', 'Spoke With'], answer: 2, explain: 'Actively touring = Showing Homes. One honest rung at a time.' },
      { idx: 7, prompt: 'A seller just signed with you. Their stage is…', choices: ['Listing Agreement', 'Sales Closed', 'Spoke With', 'Appointment Set'], answer: 0, explain: 'A signed seller sits in Listing Agreement until you go under contract.' },
    ],
  },
  {
    id: M1,
    idx: 2,
    summary: 'Why the first five minutes decide the deal.',
    body: 'The first five minutes decide the deal — and the team’s Zillow answer rate rides on every ring.',
    cards: [
      { t: 'section', n: 'Part 1 of 3', title: 'Why speed wins', body: 'The perishable window — and the research behind it.' },
      { t: 'text', k: 'The mindset', body: 'A paid lead is not a to-do item — it’s a stopwatch that’s already running. Somewhere out there, a real person just spent twenty minutes on Zillow looking at kitchens, imagined their kids in the backyard, and then did something most people never do: they handed a stranger their phone number and asked to talk.\n\nThink about what happened before that form was submitted. They toured nine listings from their couch. They ran a mortgage calculator. They pictured the drive to work. By the time your phone buzzes, they are the most motivated they will ever be — and every minute afterward, ordinary life starts pulling them back. Dinner. A text from a friend. A second thought about the down payment.\n\nThat moment of intent is the most expensive, most perishable thing your team buys. It doesn’t age like wine. It ages like milk — and the clock started before you even saw the notification.' },
      { t: 'text', k: 'What the research actually measured', body: 'The obsession with response time isn’t folklore — it’s one of the most replicated findings in sales research. MIT and InsideSales.com audited millions of lead-response records and timed what happened when companies called back at minute one, minute five, minute thirty, and beyond.\n\nThe results weren’t a gentle slope. They were a cliff. The odds of ever reaching a lead — and of that lead becoming a client — collapse inside the first half hour, and almost all of the value sits inside the first five minutes.\n\nThree numbers from that research are worth taping to your monitor. Here they come.' },
      { t: 'stat', big: '21x', label: 'more likely to QUALIFY a lead when you call within 5 minutes instead of 30.', src: 'MIT / InsideSales.com Lead Response study' },
      { t: 'stat', big: '100x', label: 'more likely to actually CONNECT at minute 5 than at minute 30. After that the odds fall off a cliff.', src: 'Same study — response decay curve' },
      { t: 'stat', big: '78%', label: 'of buyers end up working with whoever responds FIRST. Second place gets a voicemail log.', src: 'Lead response industry research' },
      { t: 'text', k: 'What “fast” means in a real week', body: 'Nobody answers 100% of connection calls. You have showings, closings, a life. The standard isn’t perfection — it’s urgency as a default: when you can answer, you do. When you truly can’t, the lead gets a callback in minutes, not hours.\n\nThis is also why coverage matters. Walking into a listing appointment? Say so in the team chat, so calls route around you. A connection that rings three agents and reaches the fourth still counts as answered — the team’s number doesn’t care who picked up, only that someone did.\n\nTreat speed like a habit, not an event: notifications on, phone face-up, CRM app on the home screen. The agents who win at this aren’t faster humans. They’ve just removed every step between the buzz and the hello.' },
      { t: 'section', n: 'Part 2 of 3', title: 'The live-connect', body: 'Answering the call Zillow literally scores you on.' },
      { t: 'text', k: 'You are measured on this — personally', body: 'This isn’t just a habit your leader wants to see. Zillow scores YOUR Pickup Rate — answering the initial connection call and accepting the lead — and the agent bar is 25%. Miss it consistently and the connections stop routing to you, no matter how good you are once you’re in a conversation.\n\nIt stacks upward too: every agent’s pickups feed the team’s overall answer rate, the number Zillow uses to decide how many connections the whole team deserves. One agent screening calls drags everyone’s pipeline.\n\nOne more detail that surprises every new agent: the live call itself may never write to the CRM. Answering and staying on the line IS the record of your work. If you’re breathing, you pick up.', src: 'Zillow Preferred agent standard — 25% pickup rate' },
      { t: 'dialogue', title: 'The first 30 seconds — a live-connect done right', turns: [
        { who: 'agent', say: 'Hi, this is Jordan with the Costigan Group — I see you were just looking at the house on Sycamore. Great pick. What caught your eye?' },
        { who: 'lead', say: 'Oh — that was fast. Yeah, we liked the backyard, honestly. We’ve been renting and just started looking.' },
        { who: 'agent', say: 'Then you’re looking at the right time. I can get you into Sycamore this week — would Thursday at 5 work, or is Saturday morning better?' },
      ] },
      { t: 'text', k: 'Why that call worked', body: 'Play it back. “I see you were just looking at the house on Sycamore” — no interrogation, just proof he’s paying attention. “Great pick — what caught your eye?” — a compliment plus an easy question. The lead relaxes and starts talking about the backyard, which is motivation surfacing on its own, unprompted.\n\nThen the close: “I can get you into Sycamore this week — Thursday at 5, or Saturday morning?” No pause to qualify. No résumé. No “tell me about your financing.” Thirty seconds in, the buyer has what they wanted — momentum — and the agent has what he wanted: a time on the calendar.\n\nThat’s the whole trick. You don’t win the call by sounding impressive. You win it by making the next step feel easy.' },
      { t: 'drill', prompt: 'It’s 7:42pm and you’re mid-dinner. A Zillow live-connect rings. What do you do?', choices: ['Let it ring — call back within the hour', 'Answer it — step away and take the call', 'Text them tomorrow morning', 'Screenshot it and ask your team lead'], answer: 1, explain: 'A live-connect is a buyer standing in the doorway. At minute 30 you’re 100x less likely to ever reach them — and the missed ring hits YOUR 25% pickup rate. Dinner can wait five minutes.' },
      { t: 'section', n: 'Part 3 of 3', title: 'When they don’t pick up', body: 'Most leads won’t answer. The pros plan for it.' },
      { t: 'text', k: 'Expect the voicemail', body: 'Here’s what nobody tells new agents: most paid leads won’t answer your first call. Everyone screens unknown numbers now. That’s not failure — that’s the game. The difference between a pro and an amateur is that the pro has the next move loaded before the first ring.\n\nThe play is the double-dial: call, and if it rings out, call again immediately. A repeated call signals a real human with something time-sensitive — connect rates jump meaningfully on the second attempt. Then voicemail. Then an immediate text.\n\nAnd understand the voicemail’s real job: it isn’t the callback — it’s getting your text read. A voicemail from “Jordan, about the Sycamore house” turns your text from a stranger’s spam into a message they were expecting.' },
      { t: 'script', title: 'If they don’t pick up — say and send this', lines: [
        '“Hi, this is Jordan with the Costigan Group — you were just asking about the home on Sycamore. I’m around all evening, call or text me back at this number and I’ll get you in to see it this week.”',
        'Then text, immediately: “Hi, it’s Jordan — just left you a voicemail about the Sycamore house. Want me to line up a time to see it Thursday or Saturday?”',
      ] },
      { t: 'drill', prompt: 'A Realtor.com lead landed 3 minutes ago while you’re prepping a listing packet. First move?', choices: ['Finish the packet, then call tonight', 'Add them to tomorrow’s call block', 'Send a quick email so a touch is logged', 'Call right now — the prep can pause'], answer: 3, explain: 'Three minutes in, you’re still inside the 21x window. And an email isn’t a touch — it’s a receipt.' },
      { t: 'drill', prompt: 'You double-dialed at 9am, left a voicemail, texted. It’s 7pm — silence. What’s the move?', choices: ['Nothing — the ball’s in their court', 'One more call or text this evening — day one gets multiple touches', 'Mark the lead dead', 'Wait a week so you don’t seem desperate'], answer: 1, explain: 'Day one IS the window — and evenings are when buyers are back on their phones. One respectful evening touch doubles your shot at a connection without a whiff of desperation.' },
      { t: 'callout', body: 'Your team PAID for this lead. Realtor.com money is already spent; Zillow takes its cut at close. Every silent minute is you paying full price for a colder lead.' },
    ],
    qs: [
      { idx: 1, prompt: 'Calling a new lead within 5 minutes instead of 30 makes you how much more likely to QUALIFY them?', choices: ['Twice as likely', 'About the same', 'About 21x more likely', '10% more likely'], answer: 2, explain: 'The MIT / InsideSales study: about 21x more likely to qualify at 5 minutes vs 30.' },
      { idx: 2, prompt: 'What share of buyers end up working with whoever responds FIRST?', choices: ['Around 10%', 'Around 78%', 'Around 40%', 'Around 25%'], answer: 1, explain: 'Roughly 78% go with the first responder. Speed IS the sale.' },
      { idx: 3, prompt: 'Why does answering a Zillow live-connect matter so much?', choices: ['It counts as two texts', 'It skips the appointment', 'It pays extra commission', 'It may never log in the CRM — the connect IS your proof of work'], answer: 3, explain: 'The live call often never logs — connecting is the proof you worked it.' },
      { idx: 4, prompt: 'Zillow’s Pickup Rate standard for YOU as an agent is…', choices: ['There is no individual bar', '60%', '25% — answer the initial call and accept the lead', '90%'], answer: 2, explain: 'Pickup = answering the INITIAL call and accepting the lead. The agent bar is 25%.' },
      { idx: 5, prompt: 'The goal of the very first touch is to…', choices: ['Fully qualify their finances', 'Be human, be fast, and set the next step', 'Pitch three listings', 'Ask who their agent is'], answer: 1, explain: 'Human, fast, next step. Qualifying and pitching come later.' },
      { idx: 6, prompt: 'A new paid lead lands while you’re prepping a listing packet. Best move?', choices: ['Finish the packet, call tonight', 'Add them to tomorrow’s call block', 'Pause the prep and call right now', 'Send an email so a touch is logged'], answer: 2, explain: 'You’re inside the 21x window — the prep can pause. An email is a receipt, not a touch.' },
      { idx: 7, prompt: 'Between minute 5 and minute 30, your odds of CONNECTING with a new lead…', choices: ['Improve as they settle in', 'Dip slightly', 'Collapse — roughly a 100x drop', 'Hold steady until 24 hours'], answer: 2, explain: 'The decay curve is brutal: around 100x worse by minute 30.' },
      { idx: 8, prompt: 'They don’t answer your first call. The day-one play is…', choices: ['One voicemail is plenty', 'Double-dial, voicemail, then an immediate text with two showing times', 'Try again next week', 'Email and wait'], answer: 1, explain: 'Double-dial to signal a real human, voicemail to earn the text read, text with concrete times.' },
    ],
  },
  {
    id: M2,
    idx: 3,
    summary: 'Appointment, Location, Motivation, Summarize — the whole call.',
    body: 'Zillow’s own framework, plus the step that makes it stick. Confirm the appointment and the odds of closing triple.',
    cards: [
      { t: 'section', n: 'Part 1 of 3', title: 'The framework', body: 'Where ALMS comes from — and why frameworks beat winging it.' },
      { t: 'text', k: 'Where this comes from', body: 'ALMS isn’t something we invented on a whiteboard. Zillow built the ALM framework — Appointment, Location, Motivation — from listening to thousands of connection calls and measuring which ones turned into closings. We added the S, Summarize, because a call that ends without a playback is a call the buyer forgets by morning.\n\nThis is also a scored behavior: Zillow’s program standard is that 80% or more of your connection calls include a real appointment conversation. This framework is how you clear that bar without ever sounding like you’re reading one.\n\nFrameworks matter for one more reason: consistency is coachable. When every agent runs the same four beats, your leader can hear one call, point at one beat, and make you measurably better at it. Freestyle can’t be coached — it can only be admired or cringed at.' },
      { t: 'stat', big: '3x', label: 'more likely to TRANSACT when the buyer and agent confirm an appointment on the very first connection call.', src: 'Zillow Premier Agent performance data' },
      { t: 'text', k: 'Why the appointment is the whole game', body: 'An interested buyer with no appointment is a browser. An appointment converts interest into commitment — a time, a place, a person they’d feel bad canceling on. That’s basic psychology working in your favor: people keep appointments they’d have to break.\n\nIt also changes what you are to them. Without a meeting, you’re a search portal with a pulse — they’ll happily take listings from you and buy with whoever’s standing at the open house. With a meeting on the calendar, you’re their agent.' },
      { t: 'section', n: 'Part 2 of 3', title: 'The four beats', body: 'A, L, M, S — each with the exact words that work.' },
      { t: 'text', k: 'A — Appointment', body: 'The single goal of the call. You’re not selling a house tonight — you’re selling the next 20 minutes of their home search. Zillow’s own recommended line is disarmingly simple: “Great — when would you like to see 123 Main Street?”\n\nNotice it assumes the showing is happening; the only question is when. Give an either/or with two concrete times. “Sometime” is where appointments go to die.' },
      { t: 'script', title: 'The appointment ask — steal this', lines: [
        '“Great — when would you like to see the Sycamore house? I can do Thursday at 5, or Saturday morning if that’s easier.”',
        'If they hesitate: “Tell you what — let’s pencil Saturday at 10. If the week gets away from you, moving it is a ten-second text.”',
      ] },
      { t: 'text', k: 'L — Location', body: 'Zillow’s line: “In addition to 123 Main Street, what other properties in the area would you like to see?”\n\nThis one question quietly changes what you are to them. You stop being the agent for one listing and become the agent for their whole search — and it fills the showing appointment with more than one home, which Zillow’s data says helps buyers decide with confidence.\n\nLocation also surfaces the shape of the move: do they own where they are now? Do they need to sell first? Are they crossing school districts, or crossing the country? Each answer changes the plan you’ll build.' },
      { t: 'text', k: 'M — Motivation', body: 'The real driver. “What’s got you looking now?” A first-time buyer, a family relocating for a job, and an investor hunting a duplex will all answer that question completely differently — and each answer tells you the speed and the stakes of their move.\n\nWhen they volunteer something personal — a baby, a divorce, a job they just landed — give it a genuine beat of empathy before you move on. People book with agents who heard them.' },
      { t: 'dialogue', title: 'Motivation, done right', turns: [
        { who: 'agent', say: 'So what’s got you two looking right now?' },
        { who: 'lead', say: 'Honestly? We just found out we’re having twins. The apartment’s already too small.' },
        { who: 'agent', say: 'Twins — congratulations! Okay, so more space just became the mission, and the timeline’s real. Let’s find you a house before you need the second crib.' },
        { who: 'lead', say: 'Ha — yes. Exactly.' },
      ] },
      { t: 'text', k: 'Reading the motivation types', body: 'First-time buyers need education and reassurance — slow the call down, explain what happens next, treat the milestone like the big deal it is. Relocating families are on a clock — lead with logistics: school calendars, virtual tours, how fast you can line up a weekend of showings. Speed IS the service.\n\nInvestors want numbers, not narratives — rents, cap rates, days on market. Skip the backyard poetry. And downsizers are often leaving a family home of thirty years — the motivation is emotional, the timeline is theirs, and pushing it collapses the trust.\n\nSame four beats every time. Four completely different songs. Motivation tells you which one you’re playing.' },
      { t: 'text', k: 'S — Summarize', body: 'Play the whole call back in one breath: “So you’re hoping to be in Maple Grove before the school year, you’ll want three beds now that the twins are coming, and we’re meeting Thursday at 5 — I’ll have Sycamore plus two more lined up.”\n\nThey feel heard. The plan is locked. And you sound like the only organized person in their whole home search.' },
      { t: 'stat', big: '2+', label: 'minutes on the first call is where success rates climb. Rushing to hang up is how appointments evaporate.', src: 'Zillow Premier Agent call data' },
      { t: 'section', n: 'Part 3 of 3', title: 'Putting it together', body: 'A full call, the do/don’t list, and your reps.' },
      { t: 'dialogue', title: 'A full ALMS call — 90 seconds, condensed', turns: [
        { who: 'agent', say: 'Hi, this is Jordan with the Costigan Group — you asked about 214 Birchwood. What caught your eye?' },
        { who: 'lead', say: 'The garage, honestly. We need the storage. We’re renting over in Riverside right now.' },
        { who: 'agent', say: 'Riverside’s a quick hop. Besides Birchwood, anything else in that area you’ve been watching?' },
        { who: 'lead', say: 'There was one on Kessler we liked too.' },
        { who: 'agent', say: 'I’ll line up both. And what’s got you two making the move now?' },
        { who: 'lead', say: 'Lease is up in October, and we’re done paying rent.' },
        { who: 'agent', say: 'So: the garage matters, Birchwood and Kessler, in the new place before October. Thursday at 5 or Saturday at 10 — which works to see them both?' },
      ] },
      { t: 'compare', good: ['Answer fast, sound glad they called', 'Ask what caught their eye about the house', 'Offer two concrete showing times', 'Widen to the whole search (“what else would you like to see?”)', 'Summarize the plan before hanging up'], bad: ['Open with “are you pre-approved?”', 'Ask “do you already have an agent?”', 'Interrogate through a 20-question checklist', 'End with “call me whenever you’re ready”', 'Hang up without a booked next step'] },
      { t: 'drill', prompt: 'Which is the strongest MOTIVATION question?', choices: ['“How much do you have for a down payment?”', '“What’s got you thinking about a move right now?”', '“Do you already have an agent?”', '“What’s your credit score?”'], answer: 1, explain: 'Motivation opens their story. The other three slam the door — money and agent questions kill first-call trust.' },
      { t: 'drill', prompt: 'The lead says: “We just found out we’re having twins.” Best response?', choices: ['“OK. What’s your budget?”', '“Twins — congratulations! So more space just became the mission.”', '“Noted. Which zip codes?”', 'Skip it and go straight to booking'], answer: 1, explain: 'A beat of real empathy, then bridge it straight into the move. People book with agents who heard them.' },
      { t: 'drill', prompt: 'Which appointment ask actually gets on the calendar?', choices: ['“Call me whenever works”', '“Want to meet sometime?”', '“Are you free Thursday at 5, or is Saturday morning better?”', '“I’ll email you some times eventually”'], answer: 2, explain: 'Either/or with two concrete times — and it assumes the showing is happening. “Sometime” is where appointments go to die.' },
      { t: 'drill', prompt: 'The lead says: “Oh, we’re just looking — super early.” Best response?', choices: ['“Call me back when you’re serious.”', '“Totally fine — most great clients start early. Want a no-pressure look at two homes this weekend, just to calibrate?”', '“I’ll put you on my newsletter.”', '“Zillow said you wanted to talk to an agent.”'], answer: 1, explain: '“Early” is not a no — it’s a buyer without urgency yet. A zero-pressure tour builds the relationship months before the competition even calls back.' },
      { t: 'callout', body: 'Confirm the appointment on the first call and the odds of a closing triple. That’s not a coaching opinion — it’s Zillow’s own transaction data.' },
    ],
    qs: [
      { idx: 1, prompt: 'Confirming an appointment on the very first connection call makes a transaction…', choices: ['3x more likely', 'Slightly more likely', 'Less likely — it’s pushy', 'No different'], answer: 0, explain: 'Zillow’s own data: buyer + agent confirming an appointment on the connection call = 3x more likely to transact.' },
      { idx: 2, prompt: 'Which of these does NOT belong on an ALMS call?', choices: ['Asking what’s motivating the move', 'Asking if they already have an agent', 'Asking where they’re looking', 'Summarizing and locking the next step'], answer: 1, explain: 'Money and agent questions kill first-call trust. Never ask about a current agent.' },
      { idx: 3, prompt: 'Zillow’s recommended LOCATION question does what?', choices: ['Gets their home address', 'Confirms their zip code', 'Checks how far they’ll commute', 'Expands one listing into their whole home search — making you their agent, not the listing’s'], answer: 3, explain: '“In addition to 123 Main, what else would you like to see?” turns one showing into a search.' },
      { idx: 4, prompt: 'The strongest appointment ask is…', choices: ['“Want to meet sometime?”', '“Are you free Thursday at 5, or is Saturday morning better?”', '“Call me whenever works”', '“I’ll email some times”'], answer: 1, explain: 'Either/or with two concrete times gets on the calendar. “Sometime” never does.' },
      { idx: 5, prompt: 'How long should a good first connection call run?', choices: ['Under 30 seconds — respect their time', 'Two minutes or more — that’s where success rates climb', 'At least 20 minutes', 'Length doesn’t matter'], answer: 1, explain: 'Zillow’s data: agents who spend 2+ minutes on the first call see meaningfully better results.' },
      { idx: 6, prompt: 'The point of Summarize is to…', choices: ['Recap your credentials', 'List every home in their range', 'Play it back so they feel heard and the plan is locked', 'Confirm their credit score'], answer: 2, explain: 'The playback makes them feel heard and cements the next step — that’s why we added the S.' },
      { idx: 7, prompt: 'A relocating family differs from a first-time buyer mainly in…', choices: ['Nothing — buyers are buyers', 'The clock — relocators need speed and logistics; first-timers need education and reassurance', 'Credit score', 'Which portal they use'], answer: 1, explain: 'Same four beats, different song. Motivation type sets the tempo and the content.' },
      { idx: 8, prompt: 'The lead says they’re “just looking, super early.” You…', choices: ['Tell them to call back when serious', 'Offer a no-pressure look at two homes to calibrate — early buyers become loyal clients', 'Add them to a newsletter and move on', 'Push for pre-approval first'], answer: 1, explain: '“Early” is a buyer without urgency yet — serve them now and you’re the only agent in the room later.' },
    ],
  },
  {
    id: M3,
    idx: 4,
    summary: 'From new lead to worked — what the standard actually is.',
    body: 'Every paid lead gets a real first touch the day it lands — and the CRM has to show it.',
    cards: [
      { t: 'section', n: 'Part 1 of 3', title: 'The standard', body: 'What “worked” means — and what it costs when it doesn’t happen.' },
      { t: 'text', k: 'The standard', body: 'Every paid lead gets a genuine first touch THE DAY it lands. Not a glance at the notification. Not an email. A real attempt to reach a real person who asked about a home today.\n\nThat’s the whole standard, and it’s deliberately simple — because on a team, a standard only works if everyone can say it from memory and nobody can argue about what it means.\n\nIt’s also the fairest deal on the team: nobody is asking you to close every lead. Only to give every lead the same real shot the team already paid for.' },
      { t: 'text', k: 'What WORKED means', body: 'A lead counts as worked when it gets real effort: one call — either direction — OR two-plus outbound texts, OR a Zillow live-connect. That’s the exact bar the dashboard holds you to, computed from the CRM automatically.\n\nAnything less — an email, a view, a good intention — and the lead sits in the untouched column with your name next to it.' },
      { t: 'stats', items: [{ big: 'Upfront', label: 'Realtor.com & Homes.com — the money is already spent. An unworked lead is a straight loss.' }, { big: 'At close', label: 'Zillow & referrals — free until you close. An unworked lead is GCI you handed back.' }] },
      { t: 'text', k: 'Why Zillow leads feel free — and aren’t', body: 'Flex costs the team nothing upfront: Zillow takes its percentage when a deal closes. That’s why an unworked Zillow lead doesn’t show up on any invoice — and why it’s the easiest money in the business to quietly lose.\n\nThe program isn’t charity, though. Zillow watches what the team converts, and connections flow toward teams that perform. Skipping a lead isn’t neutral; it’s a vote to send the next one somewhere else.' },
      { t: 'section', n: 'Part 2 of 3', title: 'Stuck, stages, and the board', body: 'What your leader sees — and how to never be on it.' },
      { t: 'text', k: 'Stuck is a choice', body: 'A lead sitting in the “Lead” stage with zero outreach is STUCK — and it’s visible. Your leader sees it on the dashboard, flagged, with your name next to it. Stuck isn’t bad luck; it’s a decision not to act.\n\nThe dashboard doesn’t editorialize. Every paid lead with no touch becomes a flag, flags feed the strike ledger, and three strikes in thirty days pauses your lead flow until you and your leader reset. None of that is punishment — it’s the system protecting money the team already spent.' },
      { t: 'text', k: 'Move the stage', body: 'The moment you have a real conversation, move the lead out of “Lead.” The stage is the truth the whole system runs on — a worked lead that still LOOKS abandoned reads exactly the same as an abandoned one.' },
      { t: 'drill', prompt: 'You connected with a Zillow lead on the live call yesterday, but they still sit in the “Lead” stage. What’s wrong?', choices: ['Nothing — Zillow leads live in Lead', 'Wait for the weekly review to sort it', 'The stage was never moved — it still reads abandoned. Move it now', 'It’s Zillow’s problem, not yours'], answer: 2, explain: 'You did the work but the system can’t see it. Stage = truth: move it the moment the conversation happens.' },
      { t: 'section', n: 'Part 3 of 3', title: 'The day-one play', body: 'Scripts and cadence for the first week.' },
      { t: 'script', title: 'Day one — when the calls don’t connect', lines: [
        'Text 1, right after the missed call: “Hi, it’s Jordan with the Costigan Group — you asked about the home on Maple. I can get you in this week. Better for you: weekday evening or Saturday?”',
        'Text 2, that evening: “No rush at all — homes like Maple tend to book showings fast, so I held Thursday 5:30 in case. Want it?”',
      ] },
      { t: 'text', k: 'The first-week cadence', body: 'Day one: double-dial, voicemail, text — and one more evening touch if it’s still quiet. Day two: a text with value, not pressure — a new listing, a price drop on something they viewed.\n\nDay four: call again at a different time of day; people have rhythms. Day seven: a short market note — “two homes just listed in your area, want the links?” That’s five-plus touches in week one, and every single one is useful to the buyer.\n\nThis isn’t harassment — it’s service. A person who filled out that form wants a house. The agent who keeps quietly showing up with useful things is the one standing next to them at the closing table.' },
      { t: 'dialogue', title: 'Re-engaging a lead that went quiet', turns: [
        { who: 'agent', say: 'Hey, it’s Jordan — you looked at the Maple house a couple weeks back. Two new listings just hit in that same school district. Want me to send them?' },
        { who: 'lead', say: 'Oh hey — yeah, sorry, work got crazy. We’re still looking though.' },
        { who: 'agent', say: 'Totally get it. I’ll send both tonight — and if either one lands, I can do showings Saturday morning.' },
      ] },
      { t: 'drill', prompt: 'You have 40 free minutes: 3 untouched leads from today and 5 aging ones from last month. Where do you start?', choices: ['The aging five first — first in, first out', 'Today’s three — then circle back to the old ones', 'Whichever has the biggest price point', 'Batch them all for Friday'], answer: 1, explain: 'Fresh intent decays fastest — today’s leads are still inside the win window. The old five already lost their sprint; they get the remaining time.' },
      { t: 'drill', prompt: 'Day 5. Your lead went quiet after one good text exchange. Which follow-up wins?', choices: ['“Just checking in!”', '“Are you still interested? I need to know.”', 'A price drop on a home like the one they liked, with a one-line note', 'Nothing — silence means no'], answer: 2, explain: '“Checking in” asks THEM to do the work. Value — a price drop, a fresh listing — gives them a reason to reply.' },
      { t: 'callout', body: 'One unworked lead a week is roughly a closing a year handed to whichever competitor answered their phone.' },
    ],
    qs: [
      { idx: 1, prompt: 'A paid lead counts as WORKED when it gets…', choices: ['One email', 'Being assigned to you', 'One call (either direction), 2+ outbound texts, or a Zillow live-connect', 'A week of sitting in Lead'], answer: 2, explain: 'That’s the exact bar the dashboard measures: a call, 2+ outbound texts, or a live connect.' },
      { idx: 2, prompt: 'A paid lead with zero outreach, still in the Lead stage, is…', choices: ['Fine — leads season over time', 'Stuck — money on the table', 'Zillow’s problem', 'Closed'], answer: 1, explain: 'No touch = stuck, and it’s flagged with your name on it.' },
      { idx: 3, prompt: 'Why is an unworked Realtor.com lead worse than it looks?', choices: ['It isn’t — all leads are equal', 'Realtor.com refunds unworked leads', 'That money was paid upfront — no contact is a straight loss', 'It only costs the team at close'], answer: 2, explain: 'Realtor.com is paid-up-front. Zillow’s cut comes at close — but Realtor.com money is already gone.' },
      { idx: 4, prompt: 'When do you move a lead out of the “Lead” stage?', choices: ['At the end of the month', 'The moment you have a real conversation', 'Only after they tour a home', 'Never — the leader does it'], answer: 1, explain: 'Stage = truth. Move it when the conversation happens so it never reads abandoned.' },
      { idx: 5, prompt: '40 free minutes: 3 leads from today, 5 from last month. Start with…', choices: ['The old five — first in, first out', 'The biggest price point', 'Batch everything Friday', 'Today’s three — fresh intent decays fastest'], answer: 3, explain: 'Today’s leads are still in the win window. The aging five get the remaining time.' },
      { idx: 6, prompt: 'The first-week cadence looks like…', choices: ['One call, then wait for them to reply', 'Five-plus useful touches: the day-one sprint, value texts, varied call times, a market note', 'Daily calls until they pick up', 'An automated drip and nothing personal'], answer: 1, explain: 'Useful beats frequent: every touch delivers something — a listing, a price drop, a market note.' },
      { idx: 7, prompt: 'Skipping a Zillow lead is never “free” because…', choices: ['Zillow bills for it monthly', 'Connections flow to teams that perform — every skipped lead votes to send the next one elsewhere', 'The lead complains to the broker', 'It isn’t true — Zillow leads are free'], answer: 1, explain: 'No invoice, but a real cost: performance decides who keeps getting connections.' },
    ],
  },
  {
    id: M4,
    idx: 5,
    summary: 'The system only works if the CRM tells the truth.',
    body: 'If it isn’t logged, it didn’t happen — and the follow-up is where the deal is actually won.',
    cards: [
      { t: 'section', n: 'Part 1 of 2', title: 'The truth machine', body: 'If it isn’t logged, it didn’t happen.' },
      { t: 'text', k: 'The rule', body: 'If it isn’t logged, it didn’t happen. Your CRM is the single source of truth — for you, for your leader, and for your Hustle Score. Great work that nobody can see counts for exactly nothing.\n\nThis isn’t about surveillance. It’s about credit: the system can only reward hustle it can measure.' },
      { t: 'text', k: 'Call & text THROUGH the CRM', body: 'Calls and texts made outside the CRM are invisible work. Run them through the CRM and every touch is captured — countable, coachable, and credited to you.\n\nIt also protects you. When a lead claims nobody ever called, the log is your receipt. And when your leader decides who gets the next round of high-intent leads, the agents whose work is visible are the agents who get fed.' },
      { t: 'section', n: 'Part 2 of 2', title: 'After the call', body: 'The two-hour rule, the eight touches, and the next step.' },
      { t: 'text', k: 'The two-hour rule', body: 'Zillow’s own best practice after a connection call: follow up within two business hours — by text AND email — confirming the date and time of the showing. Send a calendar invite so the appointment exists somewhere besides your memory, and include a tour itinerary if you’re showing more than one home.\n\nIt sounds like admin. It’s actually the moment the buyer decides you’re the organized one — the professional in a sea of agents who never called back.', src: 'Zillow Premier Agent best practices' },
      { t: 'script', title: 'The confirmation text — send it before you forget', lines: [
        '“Great talking with you! Locked in: Thursday 5:00 at 123 Sycamore. Calendar invite headed to your email — I’ll line up two more homes nearby so we make the trip count. See you there!”',
      ] },
      { t: 'stat', big: '8', label: 'touches is what it typically takes to convert an online lead. One call and a shrug is not follow-up — it’s a formality.', src: 'Sales engagement industry research' },
      { t: 'text', k: 'What eight touches actually looks like', body: 'Touches one and two happened on day one — the call and the text. Touch three is the two-hour confirmation. Touch four is the showing itself. Touch five is the same-night follow-up: “What did you think of the kitchen on Sycamore?”\n\nTouch six is the new-listing alert three days later. Touch seven is the check-in call the next week. Touch eight is the market note that finally lands the same week their lease renewal shows up in the mail.\n\nRead that list again — none of it is “just checking in.” Every touch delivers something. That’s why eight touches feels like great service to the buyer, and feels impossible only to the agent who won’t let the CRM schedule them.' },
      { t: 'text', k: 'Next task before hangup', body: 'Before you end any call, set the next task — send listings Tuesday, call back in two weeks, check on their pre-approval. A lead with no next step is a lead you will forget by Friday.' },
      { t: 'text', k: 'Your Hustle Score', body: 'Worked rate, speed to lead, follow-through — your Hustle Score is computed entirely from what’s in the CRM. Logging isn’t admin work. It’s how your effort becomes visible, and how you get credit for the hustle you’re already putting in.' },
      { t: 'compare', good: ['Log every call and text through the CRM', 'Confirm showings within two business hours', 'Send the calendar invite', 'Set the next task before you hang up', 'Move the stage the moment things change'], bad: ['Call from your cell and log nothing', '“I’ll remember to follow up”', 'Confirm nothing, hope they show', 'End calls with no next step', 'Leave worked leads looking abandoned'] },
      { t: 'drill', prompt: 'You made a great call from your cell in the car — outside the CRM. What now?', choices: ['Nothing — you made the call, that’s what matters', 'Mention it at the weekly team meeting', 'Log it in the CRM the minute you park — with a note and a next task', 'Text the lead again through the CRM so something logs'], answer: 2, explain: 'The call was real; now make it visible. Log it with a note and set the next step — that’s the difference between hustle and invisible hustle.' },
      { t: 'drill', prompt: 'Great 20-minute call — the buyer wants to look “in a few weeks.” Before hanging up, you…', choices: ['Move on — they said a few weeks', 'Set a task: send listings + a call two weeks out', 'Mark them Closed', 'Archive them until they call back'], answer: 1, explain: '“A few weeks” is a next step, not a goodbye. Book the follow-up before the call ends or it never happens.' },
      { t: 'drill', prompt: 'Which of these counts as a real TOUCH?', choices: ['Viewing their profile in the CRM', 'A text with two new listings that fit their search', 'Thinking about calling them tomorrow', 'Liking their Instagram post'], answer: 1, explain: 'A touch reaches the buyer with something useful. Views, intentions, and likes don’t move a home search forward.' },
      { t: 'callout', body: 'Discipline here is the whole difference between a pile of paid leads and a predictable pipeline.' },
    ],
    qs: [
      { idx: 1, prompt: 'Why call and text THROUGH the CRM?', choices: ['It’s faster to dial', 'It hides leads from your leader', 'It avoids TCPA', 'So every touch is captured — visible, countable, coachable'], answer: 3, explain: 'Through the CRM = logged. Your work counts and your leader can actually coach it.' },
      { idx: 2, prompt: 'Before ending any call with a lead, you always…', choices: ['Mark them Closed', 'Set the next task', 'Forward them to your leader', 'Delete the ones who aren’t ready'], answer: 1, explain: 'A lead with no next step is a lead you’ll forget by Friday.' },
      { idx: 3, prompt: 'Honest CRM logging directly powers…', choices: ['Your commission split', 'Zillow’s pricing', 'Your Hustle Score and your leader’s ability to coach you', 'The office rent'], answer: 2, explain: 'The Hustle Score is computed entirely from what’s logged. Invisible work earns nothing.' },
      { idx: 4, prompt: 'You made a great call from your cell, outside the CRM. What now?', choices: ['Nothing — the call is what matters', 'Log it in the CRM immediately, with a note and a next task', 'Mention it at the weekly meeting', 'Re-text the lead so something logs'], answer: 1, explain: 'Make the real work visible: log it, note it, set the next step.' },
      { idx: 5, prompt: 'Converting an online lead typically takes about how many touches?', choices: ['One good call', 'Two', 'Around eight', 'Twenty or more'], answer: 2, explain: 'About 8 — and every one should deliver something useful, not “just checking in.”' },
      { idx: 6, prompt: 'After booking a showing on the connection call, Zillow’s best practice is to confirm…', choices: ['Within 24 hours, by phone', 'Within two business hours — by text AND email, with a calendar invite', 'The morning of the showing', 'Only if they ask'], answer: 1, explain: 'The two-hour confirmation (text + email + invite) is Zillow’s own follow-up standard — and it makes you the organized one.' },
      { idx: 7, prompt: 'In the TRU system, work that isn’t logged is…', choices: ['Still counted from your word', 'Averaged in monthly', 'Invisible — it didn’t happen', 'Estimated by AI'], answer: 2, explain: 'If it isn’t logged, it didn’t happen — for the score, the flags, and the coaching.' },
    ],
  },
];

async function main() {
  for (const m of MODULES) {
    let res;
    if (m.insert) {
      res = await fetch(`${BASE}/rep_modules?on_conflict=id`, {
        method: 'POST',
        headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([{ id: m.id, org_id: null, idx: m.idx, title: m.insert.title, pass_pct: m.insert.pass_pct, active: true, summary: m.summary, body: m.body, cards: m.cards }]),
      });
    } else {
      res = await fetch(`${BASE}/rep_modules?id=eq.${m.id}`, {
        method: 'PATCH',
        headers: { ...H, Prefer: 'return=minimal' },
        body: JSON.stringify({ idx: m.idx, summary: m.summary, body: m.body, cards: m.cards }),
      });
    }
    if (!res.ok) throw new Error(`module ${m.id}: ${res.status} ${await res.text()}`);
    console.log(`module idx ${m.idx} cards=${m.cards.length} OK`);
  }
  const ids = MODULES.map((m) => m.id).join(',');
  const del = await fetch(`${BASE}/rep_questions?module_id=in.(${ids})`, { method: 'DELETE', headers: H });
  if (!del.ok) throw new Error(`delete questions: ${del.status} ${await del.text()}`);
  const rows = MODULES.flatMap((m) => m.qs.map((q) => ({ module_id: m.id, idx: q.idx, prompt: q.prompt, choices: q.choices, answer: q.answer, explain: q.explain })));
  const ins = await fetch(`${BASE}/rep_questions`, { method: 'POST', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(rows) });
  if (!ins.ok) throw new Error(`insert questions: ${ins.status} ${await ins.text()}`);
  console.log(`questions inserted: ${rows.length}`);
  // verify
  const check = await fetch(`${BASE}/rep_modules?select=idx,title,cards&order=idx`, { headers: H }).then((r) => r.json());
  console.log('verify:', check.map((x) => `M${x.idx} cards=${x.cards.length}`).join(' '));
}
main().catch((e) => { console.error(e); process.exit(1); });
