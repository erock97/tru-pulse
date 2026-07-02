-- ═══════════════════════════════════════════════════════════════════════════
-- TRU Rep — curriculum v2: structured lesson cards + 6-question quizzes
-- ═══════════════════════════════════════════════════════════════════════════
-- Run in the TRU-Pulse (HQ backbone) SQL Editor. Replaces the v1 lesson bodies
-- with typed cards (text / stat / drill / callout) and reseeds each module with
-- 6 quiz questions (24 total). Safe to re-run: updates + delete-then-insert.

alter table rep_modules add column if not exists cards jsonb;

-- ── Module 1: Speed to Lead ──────────────────────────────────────────────────
update rep_modules set
  summary = 'Why the first five minutes decide the deal.',
  body    = 'The first five minutes decide the deal — 21x more likely to qualify, 100x more likely to connect.',
  cards   = '[
    {"t":"text","k":"The mindset","body":"A paid lead is not a to-do item — it’s a stopwatch that’s already running. Someone is on Zillow or Realtor.com right now, motivated enough to hand over their phone number. That intent is the most expensive, most perishable thing your team buys."},
    {"t":"stat","big":"21x","label":"more likely to QUALIFY a lead when you call within 5 minutes instead of 30.","src":"MIT / InsideSales.com Lead Response study"},
    {"t":"stat","big":"100x","label":"more likely to actually CONNECT at minute 5 than at minute 30. After that the odds fall off a cliff.","src":"Same study — response decay curve"},
    {"t":"stat","big":"78%","label":"of buyers end up working with whoever responds FIRST. Second place gets a voicemail log.","src":"Lead response industry research"},
    {"t":"text","k":"Zillow live-connects","body":"When a live-connect rings, you answer — and you stay on. That call may never log in the CRM, so the connection itself is your proof of work. If you’re breathing, you pick up."},
    {"t":"text","k":"What the first touch is","body":"Be human. Be fast. Set the next step. That’s the whole job. It is NOT a mortgage interview, a listing pitch, or “do you already have an agent?”"},
    {"t":"drill","prompt":"It’s 7:42pm and you’re mid-dinner. A Zillow live-connect rings. What do you do?","choices":["Let it ring — call back within the hour","Answer it — step away and take the call","Text them tomorrow morning","Screenshot it and ask your team lead"],"answer":1,"explain":"A live-connect is a buyer standing in the doorway. At minute 30 you’re 100x less likely to ever reach them — dinner can wait five minutes."},
    {"t":"drill","prompt":"A Realtor.com lead landed 3 minutes ago while you’re prepping a listing packet. First move?","choices":["Finish the packet, then call tonight","Add them to tomorrow’s call block","Send a quick email so a touch is logged","Call right now — the prep can pause"],"answer":3,"explain":"Three minutes in, you’re still inside the 21x window. And an email isn’t a touch — it’s a receipt."},
    {"t":"callout","body":"Your team PAID for this lead. Realtor.com money is already spent; Zillow takes its cut at close. Every silent minute is you paying full price for a colder lead."}
  ]'::jsonb
where id = 'a1111111-1111-1111-1111-111111111111';

-- ── Module 2: ALMS ───────────────────────────────────────────────────────────
update rep_modules set
  summary = 'Appointment, Location, Motivation, Summarize — the whole call.',
  body    = 'Four beats. One booked appointment.',
  cards   = '[
    {"t":"text","k":"One framework, four beats","body":"ALMS is the spine of every first call. It’s not a script to recite — it’s an order of operations: Appointment, Location, Motivation, Summarize."},
    {"t":"text","k":"A — Appointment","body":"The single goal of the call. You’re not selling a house tonight — you’re selling the next 20 minutes. “I’d love to put a game plan together — are you free Thursday at 5, or is Saturday morning better?” Either/or. Never “sometime.”"},
    {"t":"text","k":"L — Location","body":"Anchor the search. Where are they looking? Do they own there now — do they need to sell first? You’re mapping the move, not interrogating."},
    {"t":"text","k":"M — Motivation","body":"The real driver. “What’s got you looking now?” New job, new baby, done renting — motivation tells you the speed and the stakes. When they volunteer something personal, give it a genuine beat of empathy before you move on."},
    {"t":"text","k":"S — Summarize","body":"Play it back. “So you’re hoping to be in Maple Grove before the school year, and we’re meeting Thursday at 5 — I’ll have homes ready to show you.” They feel heard; the next step is locked."},
    {"t":"callout","body":"What ALMS is NOT: a financing interview, “do you already have an agent?”, or twenty questions. Warmth plus four beats books the appointment."},
    {"t":"drill","prompt":"Which is the strongest MOTIVATION question?","choices":["“How much do you have for a down payment?”","“What’s got you thinking about a move right now?”","“Do you already have an agent?”","“What’s your credit score?”"],"answer":1,"explain":"Motivation opens their story. The other three slam the door — money and agent questions kill first-call trust."},
    {"t":"drill","prompt":"The lead says: “We just found out we’re having twins.” Best response?","choices":["“OK. What’s your budget?”","“Twins — congratulations! So more space just became the mission.”","“Noted. Which zip codes?”","Skip it and go straight to booking"],"answer":1,"explain":"A beat of real empathy, then bridge it straight into the move. People book with agents who heard them."},
    {"t":"drill","prompt":"Which appointment ask actually gets on the calendar?","choices":["“Call me whenever works”","“Want to meet sometime?”","“Are you free Thursday at 5, or is Saturday morning better?”","“I’ll email you some times eventually”"],"answer":2,"explain":"Either/or with two concrete times. “Sometime” is where appointments go to die."}
  ]'::jsonb
where id = 'a2222222-2222-2222-2222-222222222222';

-- ── Module 3: Working a Paid Lead End to End ─────────────────────────────────
update rep_modules set
  summary = 'From new lead to worked — what the standard actually is.',
  body    = 'Every paid lead gets a real first touch the day it lands.',
  cards   = '[
    {"t":"text","k":"The standard","body":"Every paid lead gets a genuine first touch THE DAY it lands. Not a glance at the notification. Not an email. A real attempt to reach a real person who asked about a home today."},
    {"t":"text","k":"What WORKED means","body":"A lead counts as worked when it gets real effort: one call — either direction — OR two-plus outbound texts, OR a Zillow live-connect. That’s the exact bar the dashboard holds you to. Anything less and the lead is sitting untouched."},
    {"t":"stats","items":[{"big":"Upfront","label":"Realtor.com & Homes.com — the money is already spent. An unworked lead is a straight loss."},{"big":"At close","label":"Zillow & referrals — free until you close. An unworked lead is GCI you handed back."}]},
    {"t":"text","k":"Stuck is a choice","body":"A lead sitting in the “Lead” stage with zero outreach is STUCK — and it’s visible. Your leader sees it on the dashboard, flagged, with your name next to it. Stuck isn’t bad luck; it’s a decision not to act."},
    {"t":"text","k":"Move the stage","body":"The moment you have a real conversation, move the lead out of “Lead.” The stage is the truth the whole system runs on — a worked lead that still LOOKS abandoned reads exactly the same as an abandoned one."},
    {"t":"drill","prompt":"You connected with a Zillow lead on the live call yesterday, but they still sit in the “Lead” stage. What’s wrong?","choices":["Nothing — Zillow leads live in Lead","Wait for the weekly review to sort it","The stage was never moved — it still reads abandoned. Move it now","It’s Zillow’s problem, not yours"],"answer":2,"explain":"You did the work but the system can’t see it. Stage = truth: move it the moment the conversation happens."},
    {"t":"drill","prompt":"You have 40 free minutes: 3 untouched leads from today and 5 aging ones from last month. Where do you start?","choices":["The aging five first — first in, first out","Today’s three — then circle back to the old ones","Whichever has the biggest price point","Batch them all for Friday"],"answer":1,"explain":"Fresh intent decays fastest — today’s leads are still inside the win window. The old five already lost their sprint; they get the remaining time."},
    {"t":"callout","body":"One unworked lead a week is roughly a closing a year handed to whichever competitor answered their phone."}
  ]'::jsonb
where id = 'a3333333-3333-3333-3333-333333333333';

-- ── Module 4: Follow-Up Discipline & the CRM ─────────────────────────────────
update rep_modules set
  summary = 'The system only works if the CRM tells the truth.',
  body    = 'If it isn’t logged, it didn’t happen.',
  cards   = '[
    {"t":"text","k":"The rule","body":"If it isn’t logged, it didn’t happen. Your CRM is the single source of truth — for you, for your leader, and for your Hustle Score. Great work that nobody can see counts for exactly nothing."},
    {"t":"text","k":"Call & text THROUGH the CRM","body":"Calls and texts made outside the CRM are invisible work. Run them through the CRM and every touch is captured — countable, coachable, and credited to you."},
    {"t":"stat","big":"8","label":"touches is what it typically takes to convert an online lead. One call and a shrug is not follow-up — it’s a formality.","src":"Sales engagement industry research"},
    {"t":"text","k":"Next task before hangup","body":"Before you end any call, set the next task — send listings Tuesday, call back in two weeks, check on their pre-approval. A lead with no next step is a lead you will forget by Friday."},
    {"t":"text","k":"Your Hustle Score","body":"Worked rate, speed to lead, follow-through — your Hustle Score is computed entirely from what’s in the CRM. Logging isn’t admin work. It’s how your effort becomes visible, and how you get credit for the hustle you’re already putting in."},
    {"t":"drill","prompt":"You made a great call from your cell in the car — outside the CRM. What now?","choices":["Nothing — you made the call, that’s what matters","Mention it at the weekly team meeting","Log it in the CRM the minute you park — with a note and a next task","Text the lead again through the CRM so something logs"],"answer":2,"explain":"The call was real; now make it visible. Log it with a note and set the next step — that’s the difference between hustle and invisible hustle."},
    {"t":"drill","prompt":"Great 20-minute call — the buyer wants to look “in a few weeks.” Before hanging up, you…","choices":["Move on — they said a few weeks","Set a task: send listings + a call two weeks out","Mark them Closed","Archive them until they call back"],"answer":1,"explain":"“A few weeks” is a next step, not a goodbye. Book the follow-up before the call ends or it never happens."},
    {"t":"callout","body":"Discipline here is the whole difference between a pile of paid leads and a predictable pipeline."}
  ]'::jsonb
where id = 'a4444444-4444-4444-4444-444444444444';

-- ── Reseed the quizzes: 6 questions per module ───────────────────────────────
delete from rep_questions where module_id in (
  'a1111111-1111-1111-1111-111111111111','a2222222-2222-2222-2222-222222222222',
  'a3333333-3333-3333-3333-333333333333','a4444444-4444-4444-4444-444444444444');

insert into rep_questions (module_id, idx, prompt, choices, answer, explain) values
 -- Module 1 — Speed to Lead
 ('a1111111-1111-1111-1111-111111111111', 1, 'Calling a new lead within 5 minutes instead of 30 makes you how much more likely to QUALIFY them?',
  '["Twice as likely","About the same","About 21x more likely","10% more likely"]'::jsonb, 2, 'The MIT / InsideSales study: about 21x more likely to qualify at 5 minutes vs 30.'),
 ('a1111111-1111-1111-1111-111111111111', 2, 'What share of buyers end up working with whoever responds FIRST?',
  '["Around 10%","Around 78%","Around 40%","Around 25%"]'::jsonb, 1, 'Roughly 78% go with the first responder. Speed IS the sale.'),
 ('a1111111-1111-1111-1111-111111111111', 3, 'Why does answering a Zillow live-connect matter so much?',
  '["It counts as two texts","It skips the appointment","It pays extra commission","It may never log in the CRM — the connect IS your proof of work"]'::jsonb, 3, 'The live call often never logs — connecting is the proof you worked it.'),
 ('a1111111-1111-1111-1111-111111111111', 4, 'The goal of the very first touch is to…',
  '["Fully qualify their finances","Be human, be fast, and set the next step","Pitch three listings","Ask who their agent is"]'::jsonb, 1, 'Human, fast, next step. Qualifying and pitching come later.'),
 ('a1111111-1111-1111-1111-111111111111', 5, 'A new paid lead lands while you’re prepping a listing packet. Best move?',
  '["Finish the packet, call tonight","Add them to tomorrow’s call block","Pause the prep and call right now","Send an email so a touch is logged"]'::jsonb, 2, 'You’re inside the 21x window — the prep can pause. An email is a receipt, not a touch.'),
 ('a1111111-1111-1111-1111-111111111111', 6, 'Between minute 5 and minute 30, your odds of CONNECTING with a new lead…',
  '["Improve as they settle in","Dip slightly","Collapse — roughly a 100x drop","Hold steady until 24 hours"]'::jsonb, 2, 'The decay curve is brutal: around 100x worse by minute 30.'),

 -- Module 2 — ALMS
 ('a2222222-2222-2222-2222-222222222222', 1, 'The “A” in ALMS stands for — and its goal is…',
  '["Application — take a mortgage app","Address — get their home address","Appointment — book the next meeting","Agreement — sign a buyer rep"]'::jsonb, 2, 'A = Appointment. The single aim of the call is the next meeting.'),
 ('a2222222-2222-2222-2222-222222222222', 2, 'Which of these does NOT belong on an ALMS call?',
  '["Asking what’s motivating the move","Asking if they already have an agent","Asking where they’re looking","Summarizing and locking the next step"]'::jsonb, 1, 'Money and agent questions kill first-call trust. Never ask about a current agent.'),
 ('a2222222-2222-2222-2222-222222222222', 3, 'The point of Summarize is to…',
  '["Recap your credentials","List every home in their range","Confirm their credit score","Play it back so they feel heard and the next step is locked"]'::jsonb, 3, 'Summarizing makes them feel heard and cements the appointment.'),
 ('a2222222-2222-2222-2222-222222222222', 4, 'The strongest appointment ask is…',
  '["“Want to meet sometime?”","“Are you free Thursday at 5, or is Saturday morning better?”","“Call me whenever works”","“I’ll email some times”"]'::jsonb, 1, 'Either/or with two concrete times gets on the calendar. “Sometime” never does.'),
 ('a2222222-2222-2222-2222-222222222222', 5, 'Motivation matters because it tells you…',
  '["Their price ceiling","Whether they’ll use your lender","The speed and stakes of the move — why now","Their credit profile"]'::jsonb, 2, 'Why now = how fast and how much it matters. That drives everything after.'),
 ('a2222222-2222-2222-2222-222222222222', 6, 'ALMS is best described as…',
  '["A rigid word-for-word script","A closing technique","A mortgage checklist","An order of operations for the first call"]'::jsonb, 3, 'Four beats in order — with warmth. Not a script to read at someone.'),

 -- Module 3 — Working a Paid Lead
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
 ('a3333333-3333-3333-3333-333333333333', 6, 'The lead calls YOU and you talk for 10 minutes. Does that count as worked?',
  '["No — only outbound counts","Only if you also send two texts","Yes — one call, either direction, counts","Only if they book an appointment"]'::jsonb, 2, 'Either direction. A real conversation is real work — just log it and move the stage.'),

 -- Module 4 — Follow-Up Discipline & the CRM
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
 ('a4444444-4444-4444-4444-444444444444', 6, 'In the TRU system, work that isn’t logged is…',
  '["Still counted from your word","Averaged in monthly","Invisible — it didn’t happen","Estimated by AI"]'::jsonb, 2, 'If it isn’t logged, it didn’t happen — for the score, the flags, and the coaching.');

notify pgrst, 'reload schema';
