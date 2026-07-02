-- ═══════════════════════════════════════════════════════════════════════════
-- TRU Rep — curriculum v3: professional depth (scripts, dialogues, do/don't,
-- Zillow Flex program standards) + NEW Module 5. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

alter table rep_modules add column if not exists cards jsonb;

-- ── Module 1: Speed to Lead ──────────────────────────────────────────────────
update rep_modules set
  summary = 'Why the first five minutes decide the deal.',
  body    = 'The first five minutes decide the deal — and the team’s Zillow answer rate rides on every ring.',
  cards   = '[
    {"t":"text","k":"The mindset","body":"A paid lead is not a to-do item — it’s a stopwatch that’s already running. Somewhere out there, a real person just spent twenty minutes on Zillow looking at kitchens, imagined their kids in the backyard, and then did something most people never do: they handed a stranger their phone number and asked to talk.\n\nThat moment of intent is the most expensive, most perishable thing your team buys. It doesn’t age like wine. It ages like milk — and the clock started before you even saw the notification."},
    {"t":"stat","big":"21x","label":"more likely to QUALIFY a lead when you call within 5 minutes instead of 30.","src":"MIT / InsideSales.com Lead Response study"},
    {"t":"stat","big":"100x","label":"more likely to actually CONNECT at minute 5 than at minute 30. After that the odds fall off a cliff.","src":"Same study — response decay curve"},
    {"t":"stat","big":"78%","label":"of buyers end up working with whoever responds FIRST. Second place gets a voicemail log.","src":"Lead response industry research"},
    {"t":"text","k":"Your team is measured on this","body":"This isn’t just a habit your leader wants to see. Zillow formally scores the team’s Answer Rate — the percentage of connection attempts that actually reach an agent — and the program bar is 60% or greater, measured over a rolling three months.\n\nEvery ring you let go to voicemail doesn’t just cost you a buyer. It drags a number the whole team is judged on. Teams that hold the standard keep getting connections; teams that slip get fewer — or get removed.","src":"Zillow Flex Performance Standards"},
    {"t":"dialogue","title":"The first 30 seconds — a live-connect done right","turns":[
      {"who":"agent","say":"Hi, this is Jordan with the Costigan Group — I see you were just looking at the house on Sycamore. Great pick. What caught your eye?"},
      {"who":"lead","say":"Oh — that was fast. Yeah, we liked the backyard, honestly. We’ve been renting and just started looking."},
      {"who":"agent","say":"Then you’re looking at the right time. I can get you into Sycamore this week — would Thursday at 5 work, or is Saturday morning better?"}
    ]},
    {"t":"text","k":"What the first touch is","body":"Notice what the agent above did NOT do. No “are you pre-approved?” No “do you already have an agent?” No résumé. The first touch has exactly three jobs: be human, be fast, and set the next step.\n\nEverything else — financing, timelines, the whole qualification checklist — comes later, after they’ve decided they like you. Lead with the interview and you never get the second call."},
    {"t":"script","title":"If they don’t pick up — say and send this","lines":[
      "“Hi, this is Jordan with the Costigan Group — you were just asking about the home on Sycamore. I’m around all evening, call or text me back at this number and I’ll get you in to see it this week.”",
      "Then text, immediately: “Hi, it’s Jordan — just left you a voicemail about the Sycamore house. Want me to line up a time to see it Thursday or Saturday?”"
    ]},
    {"t":"drill","prompt":"It’s 7:42pm and you’re mid-dinner. A Zillow live-connect rings. What do you do?","choices":["Let it ring — call back within the hour","Answer it — step away and take the call","Text them tomorrow morning","Screenshot it and ask your team lead"],"answer":1,"explain":"A live-connect is a buyer standing in the doorway. At minute 30 you’re 100x less likely to ever reach them — and the missed ring hits the team’s 60% answer rate. Dinner can wait five minutes."},
    {"t":"drill","prompt":"A Realtor.com lead landed 3 minutes ago while you’re prepping a listing packet. First move?","choices":["Finish the packet, then call tonight","Add them to tomorrow’s call block","Send a quick email so a touch is logged","Call right now — the prep can pause"],"answer":3,"explain":"Three minutes in, you’re still inside the 21x window. And an email isn’t a touch — it’s a receipt."},
    {"t":"callout","body":"Your team PAID for this lead. Realtor.com money is already spent; Zillow takes its cut at close. Every silent minute is you paying full price for a colder lead."}
  ]'::jsonb
where id = 'a1111111-1111-1111-1111-111111111111';

-- ── Module 2: ALMS ───────────────────────────────────────────────────────────
update rep_modules set
  summary = 'Appointment, Location, Motivation, Summarize — the whole call.',
  body    = 'Zillow’s own framework, plus the step that makes it stick. Confirm the appointment and the odds of closing triple.',
  cards   = '[
    {"t":"text","k":"Where this comes from","body":"ALMS isn’t something we invented on a whiteboard. Zillow built the ALM framework — Appointment, Location, Motivation — from listening to thousands of connection calls and measuring which ones turned into closings. We added the S, Summarize, because a call that ends without a playback is a call the buyer forgets by morning.\n\nThis is also a scored behavior: Zillow’s program standard is that 80% or more of your connection calls include a real appointment conversation. This framework is how you clear that bar without ever sounding like you’re reading one."},
    {"t":"stat","big":"3x","label":"more likely to TRANSACT when the buyer and agent confirm an appointment on the very first connection call.","src":"Zillow Premier Agent performance data"},
    {"t":"text","k":"A — Appointment","body":"The single goal of the call. You’re not selling a house tonight — you’re selling the next 20 minutes of their home search. Zillow’s own recommended line is disarmingly simple: “Great — when would you like to see 123 Main Street?”\n\nNotice it assumes the showing is happening; the only question is when. Give an either/or with two concrete times. “Sometime” is where appointments go to die."},
    {"t":"script","title":"The appointment ask — steal this","lines":[
      "“Great — when would you like to see the Sycamore house? I can do Thursday at 5, or Saturday morning if that’s easier.”",
      "If they hesitate: “Tell you what — let’s pencil Saturday at 10. If the week gets away from you, moving it is a ten-second text.”"
    ]},
    {"t":"text","k":"L — Location","body":"Zillow’s line: “In addition to 123 Main Street, what other properties in the area would you like to see?”\n\nThis one question quietly changes what you are to them. You stop being the agent for one listing and become the agent for their whole search — and it fills the showing appointment with more than one home, which Zillow’s data says helps buyers decide with confidence."},
    {"t":"text","k":"M — Motivation","body":"The real driver. “What’s got you looking now?” A first-time buyer, a family relocating for a job, and an investor hunting a duplex will all answer that question completely differently — and each answer tells you the speed and the stakes of their move.\n\nWhen they volunteer something personal — a baby, a divorce, a job they just landed — give it a genuine beat of empathy before you move on. People book with agents who heard them."},
    {"t":"dialogue","title":"Motivation, done right","turns":[
      {"who":"agent","say":"So what’s got you two looking right now?"},
      {"who":"lead","say":"Honestly? We just found out we’re having twins. The apartment’s already too small."},
      {"who":"agent","say":"Twins — congratulations! Okay, so more space just became the mission, and the timeline’s real. Let’s find you a house before you need the second crib."},
      {"who":"lead","say":"Ha — yes. Exactly."}
    ]},
    {"t":"text","k":"S — Summarize","body":"Play the whole call back in one breath: “So you’re hoping to be in Maple Grove before the school year, you’ll want three beds now that the twins are coming, and we’re meeting Thursday at 5 — I’ll have Sycamore plus two more lined up.”\n\nThey feel heard. The plan is locked. And you sound like the only organized person in their whole home search."},
    {"t":"stat","big":"2+","label":"minutes on the first call is where success rates climb. Rushing to hang up is how appointments evaporate.","src":"Zillow Premier Agent call data"},
    {"t":"compare","good":["Answer fast, sound glad they called","Ask what caught their eye about the house","Offer two concrete showing times","Widen to the whole search (“what else would you like to see?”)","Summarize the plan before hanging up"],"bad":["Open with “are you pre-approved?”","Ask “do you already have an agent?”","Interrogate through a 20-question checklist","End with “call me whenever you’re ready”","Hang up without a booked next step"]},
    {"t":"drill","prompt":"Which is the strongest MOTIVATION question?","choices":["“How much do you have for a down payment?”","“What’s got you thinking about a move right now?”","“Do you already have an agent?”","“What’s your credit score?”"],"answer":1,"explain":"Motivation opens their story. The other three slam the door — money and agent questions kill first-call trust."},
    {"t":"drill","prompt":"The lead says: “We just found out we’re having twins.” Best response?","choices":["“OK. What’s your budget?”","“Twins — congratulations! So more space just became the mission.”","“Noted. Which zip codes?”","Skip it and go straight to booking"],"answer":1,"explain":"A beat of real empathy, then bridge it straight into the move. People book with agents who heard them."},
    {"t":"drill","prompt":"Which appointment ask actually gets on the calendar?","choices":["“Call me whenever works”","“Want to meet sometime?”","“Are you free Thursday at 5, or is Saturday morning better?”","“I’ll email you some times eventually”"],"answer":2,"explain":"Either/or with two concrete times — and it assumes the showing is happening. “Sometime” is where appointments go to die."},
    {"t":"callout","body":"Confirm the appointment on the first call and the odds of a closing triple. That’s not a coaching opinion — it’s Zillow’s own transaction data."}
  ]'::jsonb
where id = 'a2222222-2222-2222-2222-222222222222';

-- ── Module 3: Working a Paid Lead End to End ─────────────────────────────────
update rep_modules set
  summary = 'From new lead to worked — what the standard actually is.',
  body    = 'Every paid lead gets a real first touch the day it lands — and the CRM has to show it.',
  cards   = '[
    {"t":"text","k":"The standard","body":"Every paid lead gets a genuine first touch THE DAY it lands. Not a glance at the notification. Not an email. A real attempt to reach a real person who asked about a home today.\n\nThat’s the whole standard, and it’s deliberately simple — because on a team, a standard only works if everyone can say it from memory and nobody can argue about what it means."},
    {"t":"text","k":"What WORKED means","body":"A lead counts as worked when it gets real effort: one call — either direction — OR two-plus outbound texts, OR a Zillow live-connect. That’s the exact bar the dashboard holds you to, computed from the CRM automatically.\n\nAnything less — an email, a view, a good intention — and the lead sits in the untouched column with your name next to it."},
    {"t":"stats","items":[{"big":"Upfront","label":"Realtor.com & Homes.com — the money is already spent. An unworked lead is a straight loss."},{"big":"At close","label":"Zillow & referrals — free until you close. An unworked lead is GCI you handed back."}]},
    {"t":"text","k":"Why Zillow leads feel free — and aren’t","body":"Flex costs the team nothing upfront: Zillow takes its percentage when a deal closes. That’s why an unworked Zillow lead doesn’t show up on any invoice — and why it’s the easiest money in the business to quietly lose.\n\nThe program isn’t charity, though. Zillow watches what the team converts, and connections flow toward teams that perform. Skipping a lead isn’t neutral; it’s a vote to send the next one somewhere else."},
    {"t":"text","k":"Stuck is a choice","body":"A lead sitting in the “Lead” stage with zero outreach is STUCK — and it’s visible. Your leader sees it on the dashboard, flagged, with your name next to it. Stuck isn’t bad luck; it’s a decision not to act."},
    {"t":"text","k":"Move the stage","body":"The moment you have a real conversation, move the lead out of “Lead.” The stage is the truth the whole system runs on — a worked lead that still LOOKS abandoned reads exactly the same as an abandoned one."},
    {"t":"script","title":"Day one — when the calls don’t connect","lines":[
      "Text 1, right after the missed call: “Hi, it’s Jordan with the Costigan Group — you asked about the home on Maple. I can get you in this week. Better for you: weekday evening or Saturday?”",
      "Text 2, that evening: “No rush at all — homes like Maple tend to book showings fast, so I held Thursday 5:30 in case. Want it?”"
    ]},
    {"t":"dialogue","title":"Re-engaging a lead that went quiet","turns":[
      {"who":"agent","say":"Hey, it’s Jordan — you looked at the Maple house a couple weeks back. Two new listings just hit in that same school district. Want me to send them?"},
      {"who":"lead","say":"Oh hey — yeah, sorry, work got crazy. We’re still looking though."},
      {"who":"agent","say":"Totally get it. I’ll send both tonight — and if either one lands, I can do showings Saturday morning."}
    ]},
    {"t":"drill","prompt":"You connected with a Zillow lead on the live call yesterday, but they still sit in the “Lead” stage. What’s wrong?","choices":["Nothing — Zillow leads live in Lead","Wait for the weekly review to sort it","The stage was never moved — it still reads abandoned. Move it now","It’s Zillow’s problem, not yours"],"answer":2,"explain":"You did the work but the system can’t see it. Stage = truth: move it the moment the conversation happens."},
    {"t":"drill","prompt":"You have 40 free minutes: 3 untouched leads from today and 5 aging ones from last month. Where do you start?","choices":["The aging five first — first in, first out","Today’s three — then circle back to the old ones","Whichever has the biggest price point","Batch them all for Friday"],"answer":1,"explain":"Fresh intent decays fastest — today’s leads are still inside the win window. The old five already lost their sprint; they get the remaining time."},
    {"t":"callout","body":"One unworked lead a week is roughly a closing a year handed to whichever competitor answered their phone."}
  ]'::jsonb
where id = 'a3333333-3333-3333-3333-333333333333';

-- ── Module 4: Follow-Up Discipline & the CRM ─────────────────────────────────
update rep_modules set
  summary = 'The system only works if the CRM tells the truth.',
  body    = 'If it isn’t logged, it didn’t happen — and the follow-up is where the deal is actually won.',
  cards   = '[
    {"t":"text","k":"The rule","body":"If it isn’t logged, it didn’t happen. Your CRM is the single source of truth — for you, for your leader, and for your Hustle Score. Great work that nobody can see counts for exactly nothing.\n\nThis isn’t about surveillance. It’s about credit: the system can only reward hustle it can measure."},
    {"t":"text","k":"Call & text THROUGH the CRM","body":"Calls and texts made outside the CRM are invisible work. Run them through the CRM and every touch is captured — countable, coachable, and credited to you."},
    {"t":"text","k":"The two-hour rule","body":"Zillow’s own best practice after a connection call: follow up within two business hours — by text AND email — confirming the date and time of the showing. Send a calendar invite so the appointment exists somewhere besides your memory, and include a tour itinerary if you’re showing more than one home.\n\nIt sounds like admin. It’s actually the moment the buyer decides you’re the organized one — the professional in a sea of agents who never called back.","src":"Zillow Premier Agent best practices"},
    {"t":"script","title":"The confirmation text — send it before you forget","lines":[
      "“Great talking with you! Locked in: Thursday 5:00 at 123 Sycamore. Calendar invite headed to your email — I’ll line up two more homes nearby so we make the trip count. See you there!”"
    ]},
    {"t":"stat","big":"8","label":"touches is what it typically takes to convert an online lead. One call and a shrug is not follow-up — it’s a formality.","src":"Sales engagement industry research"},
    {"t":"text","k":"Next task before hangup","body":"Before you end any call, set the next task — send listings Tuesday, call back in two weeks, check on their pre-approval. A lead with no next step is a lead you will forget by Friday."},
    {"t":"text","k":"Your Hustle Score","body":"Worked rate, speed to lead, follow-through — your Hustle Score is computed entirely from what’s in the CRM. Logging isn’t admin work. It’s how your effort becomes visible, and how you get credit for the hustle you’re already putting in."},
    {"t":"compare","good":["Log every call and text through the CRM","Confirm showings within two business hours","Send the calendar invite","Set the next task before you hang up","Move the stage the moment things change"],"bad":["Call from your cell and log nothing","“I’ll remember to follow up”","Confirm nothing, hope they show","End calls with no next step","Leave worked leads looking abandoned"]},
    {"t":"drill","prompt":"You made a great call from your cell in the car — outside the CRM. What now?","choices":["Nothing — you made the call, that’s what matters","Mention it at the weekly team meeting","Log it in the CRM the minute you park — with a note and a next task","Text the lead again through the CRM so something logs"],"answer":2,"explain":"The call was real; now make it visible. Log it with a note and set the next step — that’s the difference between hustle and invisible hustle."},
    {"t":"drill","prompt":"Great 20-minute call — the buyer wants to look “in a few weeks.” Before hanging up, you…","choices":["Move on — they said a few weeks","Set a task: send listings + a call two weeks out","Mark them Closed","Archive them until they call back"],"answer":1,"explain":"“A few weeks” is a next step, not a goodbye. Book the follow-up before the call ends or it never happens."},
    {"t":"callout","body":"Discipline here is the whole difference between a pile of paid leads and a predictable pipeline."}
  ]'::jsonb
where id = 'a4444444-4444-4444-4444-444444444444';

-- ── Module 5 (NEW): The Flex Standard — how the team wins ────────────────────
insert into rep_modules (id, org_id, idx, title, summary, body, pass_pct) values
 ('a5555555-5555-5555-5555-555555555555', null, 5, 'The Flex Standard: How the Team Wins',
  'The program bars your team is held to — and the flywheel that grows the business.',
  'Zillow scores the team. Perform and connections multiply; slip and they disappear.', 80)
on conflict (id) do nothing;

update rep_modules set
  cards = '[
    {"t":"text","k":"How Flex actually works","body":"Zillow Flex is invitation-only. The team pays nothing upfront for connections — Zillow takes a percentage of the commission when a deal closes. No bill, no per-lead fee, no monthly invoice.\n\nWhat you pay with instead is performance. Zillow measures the team constantly, and the teams that hit the bars keep the pipeline. This module is those bars, in plain numbers — because every one of them is made out of individual agent behavior. Yours."},
    {"t":"stat","big":"60%","label":"minimum Answer Rate — the share of Zillow connection attempts that actually reach an agent on the team, trailing 3 months.","src":"Zillow Flex Performance Standards"},
    {"t":"stat","big":"80%","label":"minimum ALM Appointment Rate — connection calls where the agent actually discusses an appointment.","src":"Zillow Flex Performance Standards"},
    {"t":"stat","big":"3x","label":"more likely to transact when the appointment is confirmed on that first connection call. The standards exist because this works.","src":"Zillow Premier Agent performance data"},
    {"t":"text","k":"The rest of the scoreboard","body":"Zillow also tracks the team’s progress to its logged transaction target — 100% or better over six months — and an engaged transfer rate around 15%. You don’t have to memorize every metric.\n\nYou have to understand what they add up to: Zillow is asking one question, over and over — “when we hand this team a buyer, does the buyer get taken care of?” Every standard is a proxy for that."},
    {"t":"text","k":"Disengagement is real","body":"Teams that consistently miss the standards go through what Zillow politely calls disengagement — they lose the program. No more connections, no more pay-at-close pipeline. For a team built on Flex volume, it’s the single most expensive thing that can happen to the business.\n\nAnd here’s the uncomfortable math: one agent who lets calls ring out can drag a whole team under a bar. The standard is communal; the behavior is individual."},
    {"t":"text","k":"The flywheel","body":"It cuts the other way too. Answer fast, book appointments on the first call, close what you’re handed — and Zillow routes the team MORE connections. Better performance → more opportunity → more closings → more connections.\n\nThat’s the flywheel this whole course feeds. Speed (Module 1) protects the answer rate. ALMS (Module 2) clears the appointment bar. Working every lead (Module 3) and disciplined follow-up (Module 4) turn connections into the transactions Zillow counts. None of it is busywork — it’s all the same machine."},
    {"t":"drill","prompt":"The team’s answer rate slipped to 55% this quarter. What’s the individual move?","choices":["Nothing — that’s the team lead’s problem","Answer every connection call you possibly can, and flag coverage gaps so calls get rerouted","Wait for Zillow to send a warning","Buy leads somewhere else"],"answer":1,"explain":"The bar is 60% and it’s made of individual answered calls. Pick up, and surface the coverage holes — that’s how a team number gets fixed."},
    {"t":"drill","prompt":"Which call clears Zillow’s ALM appointment bar?","choices":["“Sounds good, call us when you’re ready to look.”","“I’ll email you some listings tonight.”","“Would Thursday at 5 or Saturday morning work to see it?”","“Let me know if you have questions!”"],"answer":2,"explain":"The bar is a real appointment conversation — a concrete time offered, not a vague someday. Only one of these is an appointment discussion."},
    {"t":"callout","body":"When you answer one more call or book one more first-call appointment, you’re not just protecting your pipeline — you’re protecting everyone’s."}
  ]'::jsonb
where id = 'a5555555-5555-5555-5555-555555555555';

-- ── Reseed the quizzes ───────────────────────────────────────────────────────
delete from rep_questions where module_id in (
  'a1111111-1111-1111-1111-111111111111','a2222222-2222-2222-2222-222222222222',
  'a3333333-3333-3333-3333-333333333333','a4444444-4444-4444-4444-444444444444',
  'a5555555-5555-5555-5555-555555555555');

insert into rep_questions (module_id, idx, prompt, choices, answer, explain) values
 -- Module 1 — Speed to Lead (6)
 ('a1111111-1111-1111-1111-111111111111', 1, 'Calling a new lead within 5 minutes instead of 30 makes you how much more likely to QUALIFY them?',
  '["Twice as likely","About the same","About 21x more likely","10% more likely"]'::jsonb, 2, 'The MIT / InsideSales study: about 21x more likely to qualify at 5 minutes vs 30.'),
 ('a1111111-1111-1111-1111-111111111111', 2, 'What share of buyers end up working with whoever responds FIRST?',
  '["Around 10%","Around 78%","Around 40%","Around 25%"]'::jsonb, 1, 'Roughly 78% go with the first responder. Speed IS the sale.'),
 ('a1111111-1111-1111-1111-111111111111', 3, 'Why does answering a Zillow live-connect matter so much?',
  '["It counts as two texts","It skips the appointment","It pays extra commission","It may never log in the CRM — the connect IS your proof of work"]'::jsonb, 3, 'The live call often never logs — connecting is the proof you worked it.'),
 ('a1111111-1111-1111-1111-111111111111', 4, 'A missed Zillow connection call hurts the team because…',
  '["It doesn’t — leads recycle","Zillow charges for missed calls","It drags the team’s Answer Rate, which Zillow requires at 60% or better","The lead is emailed instead"]'::jsonb, 2, 'Answer Rate is a formal Flex standard: 60%+ of connection attempts must reach an agent.'),
 ('a1111111-1111-1111-1111-111111111111', 5, 'A new paid lead lands while you’re prepping a listing packet. Best move?',
  '["Finish the packet, call tonight","Add them to tomorrow’s call block","Pause the prep and call right now","Send an email so a touch is logged"]'::jsonb, 2, 'You’re inside the 21x window — the prep can pause. An email is a receipt, not a touch.'),
 ('a1111111-1111-1111-1111-111111111111', 6, 'They don’t answer your first call. What’s the play?',
  '["Voicemail + an immediate text offering two showing times","Try again next week","Mark the lead dead","Email only — texting feels pushy"]'::jsonb, 0, 'Voicemail, then text right away with a concrete next step — that’s the day-one standard.'),

 -- Module 2 — ALMS (6)
 ('a2222222-2222-2222-2222-222222222222', 1, 'Confirming an appointment on the very first connection call makes a transaction…',
  '["3x more likely","Slightly more likely","Less likely — it’s pushy","No different"]'::jsonb, 0, 'Zillow’s own data: buyer + agent confirming an appointment on the connection call = 3x more likely to transact.'),
 ('a2222222-2222-2222-2222-222222222222', 2, 'Which of these does NOT belong on an ALMS call?',
  '["Asking what’s motivating the move","Asking if they already have an agent","Asking where they’re looking","Summarizing and locking the next step"]'::jsonb, 1, 'Money and agent questions kill first-call trust. Never ask about a current agent.'),
 ('a2222222-2222-2222-2222-222222222222', 3, 'Zillow’s recommended LOCATION question does what?',
  '["Gets their home address","Confirms their zip code","Checks how far they’ll commute","Expands one listing into their whole home search — making you their agent, not the listing’s"]'::jsonb, 3, '“In addition to 123 Main, what else would you like to see?” turns one showing into a search.'),
 ('a2222222-2222-2222-2222-222222222222', 4, 'The strongest appointment ask is…',
  '["“Want to meet sometime?”","“Are you free Thursday at 5, or is Saturday morning better?”","“Call me whenever works”","“I’ll email some times”"]'::jsonb, 1, 'Either/or with two concrete times gets on the calendar. “Sometime” never does.'),
 ('a2222222-2222-2222-2222-222222222222', 5, 'How long should a good first connection call run?',
  '["Under 30 seconds — respect their time","Two minutes or more — that’s where success rates climb","At least 20 minutes","Length doesn’t matter"]'::jsonb, 1, 'Zillow’s data: agents who spend 2+ minutes on the first call see meaningfully better results.'),
 ('a2222222-2222-2222-2222-222222222222', 6, 'The point of Summarize is to…',
  '["Recap your credentials","List every home in their range","Play it back so they feel heard and the plan is locked","Confirm their credit score"]'::jsonb, 2, 'The playback makes them feel heard and cements the next step — that’s why we added the S.'),

 -- Module 3 — Working a Paid Lead (6)
 ('a3333333-3333-3333-3333-333333333333', 1, 'A paid lead counts as WORKED when it gets…',
  '["One email","Being assigned to you","One call (either direction), 2+ outbound texts, or a Zillow live-connect","A week of sitting in Lead"]'::jsonb, 2, 'That’s the exact bar the dashboard measures: a call, 2+ outbound texts, or a live connect.'),
 ('a3333333-3333-3333-3333-333333333333', 2, 'A paid lead with zero outreach, still in the Lead stage, is…',
  '["Fine — leads season over time","Stuck — money on the table","Zillow’s problem","Closed"]'::jsonb, 1, 'No touch = stuck, and it’s flagged with your name on it.'),
 ('a3333333-3333-3333-3333-333333333333', 3, 'Why is an unworked Realtor.com lead worse than it looks?',
  '["It isn’t — all leads are equal","Realtor.com refunds unworked leads","That money was paid upfront — no contact is a straight loss","It only costs the team at close"]'::jsonb, 2, 'Realtor.com is paid-up-front. Zillow’s cut comes at close — but Realtor.com money is already gone.'),
 ('a3333333-3333-3333-3333-333333333333', 4, 'When do you move a lead out of the “Lead” stage?',
  '["At the end of the month","The moment you have a real conversation","Only after they tour a home","Never — the leader does it"]'::jsonb, 1, 'Stage = truth. Move it when the conversation happens so it never reads abandoned.'),
 ('a3333333-3333-3333-3333-333333333333', 5, '40 free minutes: 3 leads from today, 5 from last month. Start with…',
  '["The old five — first in, first out","The biggest price point","Batch everything Friday","Today’s three — fresh intent decays fastest"]'::jsonb, 3, 'Today’s leads are still in the win window. The aging five get the remaining time.'),
 ('a3333333-3333-3333-3333-333333333333', 6, 'Skipping a Zillow lead is never “free” because…',
  '["Zillow bills for it monthly","Connections flow to teams that perform — every skipped lead votes to send the next one elsewhere","The lead complains to the broker","It isn’t true — Zillow leads are free"]'::jsonb, 1, 'No invoice, but a real cost: performance decides who keeps getting connections.'),

 -- Module 4 — Follow-Up Discipline & the CRM (7)
 ('a4444444-4444-4444-4444-444444444444', 1, 'Why call and text THROUGH the CRM?',
  '["It’s faster to dial","It hides leads from your leader","It avoids TCPA","So every touch is captured — visible, countable, coachable"]'::jsonb, 3, 'Through the CRM = logged. Your work counts and your leader can actually coach it.'),
 ('a4444444-4444-4444-4444-444444444444', 2, 'Before ending any call with a lead, you always…',
  '["Mark them Closed","Set the next task","Forward them to your leader","Delete the ones who aren’t ready"]'::jsonb, 1, 'A lead with no next step is a lead you’ll forget by Friday.'),
 ('a4444444-4444-4444-4444-444444444444', 3, 'Honest CRM logging directly powers…',
  '["Your commission split","Zillow’s pricing","Your Hustle Score and your leader’s ability to coach you","The office rent"]'::jsonb, 2, 'The Hustle Score is computed entirely from what’s logged. Invisible work earns nothing.'),
 ('a4444444-4444-4444-4444-444444444444', 4, 'You made a great call from your cell, outside the CRM. What now?',
  '["Nothing — the call is what matters","Log it in the CRM immediately, with a note and a next task","Mention it at the weekly meeting","Re-text the lead so something logs"]'::jsonb, 1, 'Make the real work visible: log it, note it, set the next step.'),
 ('a4444444-4444-4444-4444-444444444444', 5, 'Converting an online lead typically takes about how many touches?',
  '["One good call","Two","Around eight","Twenty or more"]'::jsonb, 2, 'About 8. One call and a shrug is a formality, not follow-up.'),
 ('a4444444-4444-4444-4444-444444444444', 6, 'After booking a showing on the connection call, Zillow’s best practice is to confirm…',
  '["Within 24 hours, by phone","Within two business hours — by text AND email, with a calendar invite","The morning of the showing","Only if they ask"]'::jsonb, 1, 'The two-hour confirmation (text + email + invite) is Zillow’s own follow-up standard — and it makes you the organized one.'),
 ('a4444444-4444-4444-4444-444444444444', 7, 'In the TRU system, work that isn’t logged is…',
  '["Still counted from your word","Averaged in monthly","Invisible — it didn’t happen","Estimated by AI"]'::jsonb, 2, 'If it isn’t logged, it didn’t happen — for the score, the flags, and the coaching.'),

 -- Module 5 — The Flex Standard (6)
 ('a5555555-5555-5555-5555-555555555555', 1, 'Zillow’s minimum team Answer Rate standard is…',
  '["40%","60% or greater","90%","There is no standard"]'::jsonb, 1, '60%+ of connection attempts must actually reach an agent, trailing 3 months.'),
 ('a5555555-5555-5555-5555-555555555555', 2, 'The ALM Appointment Rate standard requires an appointment discussion on…',
  '["Half of calls","Every fifth call","80% or more of connection calls","Only tour requests"]'::jsonb, 2, '80%+ of connection calls must include a real appointment conversation.'),
 ('a5555555-5555-5555-5555-555555555555', 3, 'How does the team pay for Zillow Flex connections?',
  '["A monthly subscription","Per lead, upfront","A percentage of commission at close — nothing upfront","Per showing booked"]'::jsonb, 2, 'Flex is pay-at-close. The real currency is performance against the standards.'),
 ('a5555555-5555-5555-5555-555555555555', 4, 'Teams that consistently miss the performance standards face…',
  '["A small fee","Nothing — the standards are advisory","A mandatory training course","Disengagement — removal from the program and its pipeline"]'::jsonb, 3, 'Disengagement means the connections stop. For a Flex-built team, that’s the business.'),
 ('a5555555-5555-5555-5555-555555555555', 5, 'Performing above the bars does what?',
  '["Zillow routes the team MORE connections — the flywheel","Zillow raises its percentage","Nothing changes","It only helps the team lead"]'::jsonb, 0, 'Better performance → more connections → more closings. The flywheel is the growth engine.'),
 ('a5555555-5555-5555-5555-555555555555', 6, 'The standards are communal, but they’re made of…',
  '["Zillow’s algorithm","Market conditions","Individual agent behavior — every answered call and booked appointment","Luck"]'::jsonb, 2, 'One agent letting calls ring out can drag the whole team under a bar — and one agent answering can carry it.');

notify pgrst, 'reload schema';
