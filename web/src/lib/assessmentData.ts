// assessmentData.ts
// TRU — The Real U · the complete behavioral framework, ported for TRU Pulse.
// Property of Eric Matthews. © 2026. Confidential & proprietary.
//
// Ported from the standalone "Behavioral Coaching App" prototype's
// truFramework.js. This module is pure (no side effects, no I/O) so it can be
// unit-tested in isolation and consumed by both the survey UI and the Coach.
//
// Two parallel instruments share one 4-axis spectrum:
//   energy P|T · approach Pro|Rec · deal R|V · decision D|I
// - PERSONAL_QUESTIONS (20, 5/axis): 7-point Likert (-3..3), "you as a person".
// - PRO_QUESTIONS (32, 8/axis): semantic-differential slider (a vs b scenario).
// Both score to a 4-letter code + per-axis percentage via the shared
// scoreAxes() core, so personal and professional results can be compared
// axis-by-axis (see divergence()).

export type Axis = 'energy' | 'approach' | 'deal' | 'decision';
export type Pole = 'P' | 'T' | 'Pro' | 'Rec' | 'R' | 'V' | 'D' | 'I';
export type AxisResult = { code: string; axes: Record<Axis, { letter: Pole; pct: number }> };

const AXIS_ORDER: Axis[] = ['energy', 'approach', 'deal', 'decision'];
const POLES: Record<Axis, [Pole, Pole]> = {
  energy: ['P', 'T'],
  approach: ['Pro', 'Rec'],
  deal: ['R', 'V'],
  decision: ['D', 'I'],
};

// ============================================================
// THE PROFESSIONAL ASSESSMENT — 32 questions, 8 per dimension.
// av/bv = which letter each scenario scores toward.
// ============================================================
export const PRO_QUESTIONS: { dim: Axis; a: string; b: string; av: Pole; bv: Pole }[] = [
  // ENERGY  (People P  /  Task T)
  { dim: 'energy', a: 'Calling a past client or sphere contact to reconnect', b: 'Reviewing your numbers and rebuilding your action plan', av: 'P', bv: 'T' },
  { dim: 'energy', a: 'Back-to-back conversations, appointments, and connections', b: 'A deep-focus block where you execute without interruption', av: 'P', bv: 'T' },
  { dim: 'energy', a: 'The genuine connection you felt with the sellers', b: 'The moment your strategy clicked and they understood the plan', av: 'P', bv: 'T' },
  { dim: 'energy', a: 'A neighborhood event, a client lunch, or a pop-by route', b: 'Building out your CRM, refining systems, or mapping next quarter', av: 'P', bv: 'T' },
  { dim: 'energy', a: 'People genuinely like and trust you — connection is your currency', b: 'Your process is tight and reliable — you never drop the ball', av: 'P', bv: 'T' },
  { dim: 'energy', a: 'Read the room, energize the group, and get everyone aligned', b: 'Present data, outline the plan, and set clear measurable targets', av: 'P', bv: 'T' },
  { dim: 'energy', a: 'They feel a genuine personal connection to you', b: 'Your process consistently delivered exactly what was promised', av: 'P', bv: 'T' },
  { dim: 'energy', a: "Feel alive — this energy is why you got into real estate", b: 'Need a quiet Sunday to reset, plan, and get your head right', av: 'P', bv: 'T' },
  // APPROACH  (Proactive Pro  /  Authority-builder Rec)
  { dim: 'approach', a: 'Drive the route and knock on doors to introduce yourself', b: 'Research each owner, then send personalized letters with custom market data', av: 'Pro', bv: 'Rec' },
  { dim: 'approach', a: "Get on the phone — you'll create the business through direct outreach", b: 'Deepen your value: publish an update, create content, strengthen a relationship', av: 'Pro', bv: 'Rec' },
  { dim: 'approach', a: 'I go get it — consistent outreach is how I generate income', b: 'I build so it comes to me — reputation and expertise do the work', av: 'Pro', bv: 'Rec' },
  { dim: 'approach', a: 'Directly asking for the business at the end of your presentation', b: 'Letting your preparation and expertise make the case — the ask is implied', av: 'Pro', bv: 'Rec' },
  { dim: 'approach', a: 'Working the room — the goal is meeting as many people as possible', b: 'Going deep with 2 or 3 people and having conversations that actually matter', av: 'Pro', bv: 'Rec' },
  { dim: 'approach', a: 'Reach out again — twice if needed. Persistence is a form of service.', b: 'Send something genuinely useful and let them come back when the timing is right', av: 'Pro', bv: 'Rec' },
  { dim: 'approach', a: 'Ramp up outreach activity — more calls, more doors, more conversations', b: 'Strengthen your authority positioning — market reports, content, speaking', av: 'Pro', bv: 'Rec' },
  { dim: 'approach', a: 'Daily contact attempts with a structured outreach cadence — you dial and door-knock', b: 'Consistent high-value content and communications to an audience that knows your name', av: 'Pro', bv: 'Rec' },
  // DEAL STYLE  (Relationship R  /  Volume V)
  { dim: 'deal', a: 'A database of clients who would never use another agent and refer everyone they know', b: 'Hitting your production goals and closing more transactions than last year', av: 'R', bv: 'V' },
  { dim: 'deal', a: 'Love it. These calls are the whole point.', b: "Enjoy it, but you're aware you have 15 other clients in active pipeline", av: 'R', bv: 'V' },
  { dim: 'deal', a: '20 deeply served clients per year who become referral engines for life', b: '40+ transactions a year running through a system built for volume', av: 'R', bv: 'V' },
  { dim: 'deal', a: 'How many of your clients actively refer their friends and family to you', b: 'Your GCI, units closed, and how close you came to hitting your number', av: 'R', bv: 'V' },
  { dim: 'deal', a: "Maintaining a genuine relationship — you remember their anniversary, their kids' names", b: 'A smart drip campaign that keeps you visible at the right intervals without friction', av: 'R', bv: 'V' },
  { dim: 'deal', a: 'Deeper — higher value per client, better experiences, stronger referral relationships', b: 'Wider — more leads, more listings, more transactions, a bigger operation', av: 'R', bv: 'V' },
  { dim: 'deal', a: "They trusted you enough to put their name on you — that's the highest compliment", b: "It's a high-quality, low-cost lead that feeds your pipeline", av: 'R', bv: 'V' },
  { dim: 'deal', a: 'Staying in deep contact with your past and current clients', b: 'Prospecting for and converting new business from outside your existing database', av: 'R', bv: 'V' },
  // DECISIONS  (Data D  /  Intuition I)
  { dim: 'decision', a: 'Running the CMA: comps, adjustments, price-per-foot, days-on-market trends', b: "Walking the property and calibrating against what you've been feeling in the market", av: 'D', bv: 'I' },
  { dim: 'decision', a: 'Pull DOM, list-to-sold ratios, and seller motivation clues — and build the case from data', b: "Read the room: the listing agent's tone, the price reduction history, your gut on motivation", av: 'D', bv: 'I' },
  { dim: 'decision', a: 'Researching cost per lead, conversion rates, and ROI benchmarks from comparable agents', b: "Assessing whether it aligns with how you naturally work and what you've seen produce results", av: 'D', bv: 'I' },
  { dim: 'decision', a: 'Review every data point: timelines, contingency dates, financing milestones, communication log', b: 'Call the listing agent and trust your read of what’s actually happening beneath the surface', av: 'D', bv: 'I' },
  { dim: 'decision', a: "Last year's data — activity levels, conversion rates, income — modeled forward with targets", b: 'A clear vision of where you want to be, with key moves that feel right based on experience', av: 'D', bv: 'I' },
  { dim: 'decision', a: 'Walk them through the data — comp by comp — until they see what the market is telling you', b: 'Share your experience clearly, acknowledge their perspective, and trust your market read', av: 'D', bv: 'I' },
  { dim: 'decision', a: 'Pulling absorption rates, price reduction data, new listing counts — and rebuilding strategy', b: "You felt this shift coming before the data showed it. You've already adjusted.", av: 'D', bv: 'I' },
  { dim: 'decision', a: '“You always have the data to back up what you’re saying.”', b: '“You’ve been in this market so long — you just know.”', av: 'D', bv: 'I' },
];

// Human-readable labels for the four dimension letters (professional context).
export const TRAIT_LABELS: Record<Pole, string> = {
  P: 'People-Oriented', T: 'Task-Oriented',
  Pro: 'Proactive', Rec: 'Authority Builder',
  R: 'Relationship-Focused', V: 'Volume-Driven',
  D: 'Data-Driven', I: 'Intuition-Led',
};

// ============================================================
// THE 16 ARCHETYPES (professional)
// Renamed per Global Constraints to de-collide with PERSONAL_TYPES names:
//   T-Pro-R-I  "The Bold Visionary"     -> "The Trailblazer"
//   T-Rec-R-I  "The Creative Navigator" -> "The Problem-Solver"
//   T-Rec-R-D  "The Niche Specialist"   -> "The Cornerstone"
// ============================================================
export const ARCH: Record<string, { name: string; emoji: string; color: string; tagline: string }> = {
  'P-Pro-R-D': { name: 'The Networked Powerhouse', emoji: '🔗', color: '#3B6FE0', tagline: 'Building empires one relationship at a time — with the data to back it up' },
  'P-Pro-R-I': { name: 'The Natural Connector', emoji: '✨', color: '#9B6CE0', tagline: 'Every conversation you have is a door — and you always find the handle' },
  'P-Pro-V-D': { name: 'The Relentless Achiever', emoji: '⚡', color: '#E0524F', tagline: 'More calls. More doors. More closings. Repeat.' },
  'P-Pro-V-I': { name: 'The Energized Hunter', emoji: '🎯', color: '#EE7A3A', tagline: "You don't wait for leads — you manufacture them" },
  'P-Rec-R-D': { name: 'The Trusted Advisor', emoji: '🏛️', color: '#1FA876', tagline: "Clients don't just hire you — they choose you, and they stay for life" },
  'P-Rec-R-I': { name: 'The Warm Nurturer', emoji: '🌱', color: '#E0A340', tagline: "You don't have to sell — people feel taken care of and they never leave" },
  'P-Rec-V-D': { name: 'The Market Authority', emoji: '📊', color: '#1BA6C9', tagline: "You don't chase business — your expertise makes clients come to you" },
  'P-Rec-V-I': { name: 'The Compelling Storyteller', emoji: '🎭', color: '#A972E8', tagline: "You help clients fall in love with their future before they've seen the price" },
  'T-Pro-R-D': { name: 'The Strategic Architect', emoji: '🏗️', color: '#3B6FE0', tagline: "You built a relationship machine — and it runs whether you're watching or not" },
  'T-Pro-R-I': { name: 'The Trailblazer', emoji: '🔮', color: '#9B6CE0', tagline: "You see the market three moves ahead — and you're already in position" },
  'T-Pro-V-D': { name: 'The Performance Analyst', emoji: '📈', color: '#1FA88E', tagline: 'Your metrics tell you exactly what to do — and you do it' },
  'T-Pro-V-I': { name: 'The Instinct Closer', emoji: '⚔️', color: '#E0524F', tagline: 'When the window opens, you feel it — and you never miss it' },
  'T-Rec-R-D': { name: 'The Cornerstone', emoji: '🏆', color: '#3B6FE0', tagline: "You don't compete for everything — you dominate something" },
  'T-Rec-R-I': { name: 'The Problem-Solver', emoji: '🧭', color: '#1BA6C9', tagline: 'You find a path where others see only dead ends' },
  'T-Rec-V-D': { name: 'The Systems Optimizer', emoji: '⚙️', color: '#1FA876', tagline: 'Your operation is the most efficient in the room — by design' },
  'T-Rec-V-I': { name: 'The Efficient Dealmaker', emoji: '💼', color: '#D9923A', tagline: 'Simple. Fast. Done. Every time.' },
};

// ============================================================
// AGENT-FACING (first person) — strengths, growth edge, watch-for, challenge
// ============================================================
export const AG: Record<string, { sup: string; edge: string; watch: string; challenge: string }> = {
  'P-Pro-R-D': { sup: "You stay top-of-mind through strategic, data-driven follow-up — a master networker.", edge: "Audit your follow-up system for authenticity — do your automations still sound like you?", watch: "You can over-engineer relationships — not every coffee needs a drip campaign.", challenge: "Your systems are your superpower, but clients hire the person, not the platform. Keep the human ahead of the process." },
  'P-Pro-R-I': { sup: "You generate referrals at an exceptional rate through genuine, effortless likability.", edge: "Build a simple pipeline tracker to capture more of what you're already generating.", watch: "Natural success is hard to systematize — scaling what comes easily is the real challenge.", challenge: "You can fill a room. The question is whether you have a system to follow up with everyone in it." },
  'P-Pro-V-D': { sup: "You generate exceptional lead volume through disciplined, daily prospecting.", edge: "Build a sustainability protocol — daily non-negotiables, recovery rituals, hard stop times.", watch: "You may sacrifice relationship depth in pursuit of the next transaction.", challenge: "You know how to earn. The question is whether you're building something that works even when you're not." },
  'P-Pro-V-I': { sup: "You're fearless in outreach — no call is too cold, no door too closed.", edge: "Implement a dead-simple pipeline tracker: 3 columns, 10 minutes a day.", watch: "Weak follow-up leaves revenue on the table — you generate more than you capture.", challenge: "You're exceptional at starting. The compounding happens when you get equally good at following through." },
  'P-Rec-R-D': { sup: "Your past clients are your best marketing team — extraordinary retention and referrals.", edge: "Develop a direct referral-ask process that feels authentic to you.", watch: "Discomfort with aggressive negotiation can quietly cost your clients money.", challenge: "Your trust capital is enormous. The work is monetizing it fully without feeling like you're 'selling.'" },
  'P-Rec-R-I': { sup: "Unmatched emotional intelligence — you sense what clients need before they say it.", edge: "Establish 3 professional boundaries that protect your energy, including response hours.", watch: "You take difficult client situations too personally — boundaries protect your longevity.", challenge: "You give abundantly. Building systems ensures you can sustain that level of care for every client." },
  'P-Rec-V-D': { sup: "Your market expertise attracts serious buyers and sellers who value real analysis.", edge: "Build a 'market brief' format: 3 insights, 1 recommendation, 1 action — for every conversation.", watch: "You tend to over-educate rather than guide — clients need decisions, not just information.", challenge: "You're a rare mix of personality and precision. Make sure your market feeds your business, not just your reputation." },
  'P-Rec-V-I': { sup: "You master emotional marketing — buyers feel the home, not just the specs.", edge: "Build a data anchor into every listing presentation so the story is backed by numbers.", watch: "Story can outpace substance — expectation gaps appear when the narrative exceeds reality.", challenge: "You create desire. The opportunity is pairing it with discipline so the experience matches the promise." },
  'T-Pro-R-D': { sup: "You build scalable relationship architecture that generates referrals on a reliable cadence.", edge: "Audit your system for warmth: add 3 touchpoints that have zero business intent.", watch: "You can appear transactional in moments that call for warmth over process.", challenge: "Your architecture is exceptional. The work is ensuring the people inside it feel seen, not processed." },
  'T-Pro-R-I': { sup: "Your visionary positioning attracts forward-thinking clients and partners.", edge: "Create a 'kill or keep' discipline — test new ideas for 90 days with clear success criteria.", watch: "You tend to abandon proven systems for the next compelling idea.", challenge: "Your vision is a genuine advantage. The work is execution — closing the gap between idea and impact." },
  'T-Pro-V-D': { sup: "Best-in-class pipeline management with measurable conversion at every stage.", edge: "Build a 'human quotient' into your CRM — flag life events and touch them with no business intent.", watch: "Analytical precision can read as cold, especially in emotional client moments.", challenge: "You produce. The question is whether clients remember the experience or just the result." },
  'T-Pro-V-I': { sup: "Elite closing ability in multi-offer, competitive, time-compressed situations.", edge: "Build a post-close client experience — the relationship after the close is where referrals live.", watch: "Aggressive closing can fracture trust when it reads as pressure.", challenge: "You win deals. The work is turning single wins into lifetime client relationships." },
  'T-Rec-R-D': { sup: "Dominant share within your niche — you're the name people think of first.", edge: "Map two adjacent markets where your niche expertise is directly transferable.", watch: "Niche softening can expose overconcentration in one segment.", challenge: "Your depth is a moat. The work is ensuring the moat has enough water to sustain your growth goals." },
  'T-Rec-R-I': { sup: "Exceptional problem-solver in complex, emotionally charged transactions.", edge: "Build a referral network with advisors who send complex situations your way.", watch: "You can overcomplicate transactions that simply need speed and execution.", challenge: "Your ability to navigate complexity is rare. Package it so it attracts your exact client type." },
  'T-Rec-V-D': { sup: "Maximum transaction volume with minimum waste — a model of efficiency.", edge: "Build 5 human touchpoints into your system that feel genuinely personal, not automated.", watch: "Client experience can read as impersonal — especially for relationship-driven clients.", challenge: "You've built the machine. The question is whether the experience inside it feels like a choice, not a conveyor belt." },
  'T-Rec-V-I': { sup: "Fast deal timelines through decisive, confident action at every stage.", edge: "Build a post-close ritual: 3 touches in 90 days with zero business agenda.", watch: "You move too fast for clients who need time to emotionally process big decisions.", challenge: "You're excellent when someone's ready. The opportunity is making more people ready by deepening the relationship." },
};

// ============================================================
// LEADER COACHING GUIDE — how to coach each archetype
// ============================================================
export const CG: Record<string, { communicate: string; motivate: string; accountable: string; conflict: string; feedforward: string }> = {
  'P-Pro-R-D': { communicate: "Direct, data-first, outcome-led. Skip preamble — lead with the conclusion.", motivate: "Market rank, competitive standing, and visible production metrics. Recognition of results, not effort.", accountable: "Self-designed scorecards with clear targets. Give the what — they own the how.", conflict: "Goes quiet or dismissive. Return to data immediately — emotions escalate, facts de-escalate.", feedforward: "What's one metric you could improve by 10% this week that would have the biggest impact on your income?" },
  'P-Pro-R-I': { communicate: "Warm and story-led. Open with impact on people they care about, then the ask.", motivate: "Referrals received, relationships built, clients who came back. Connection metrics over production numbers.", accountable: "Community accountability — they don't want to let the group down. Pair with a buddy check-in.", conflict: "Absorbs tension personally. Create safety first: 'I'm not questioning your commitment — I want to understand.'", feedforward: "Who is one person in your sphere you haven't reached out to this month — and what would that make possible?" },
  'P-Pro-V-D': { communicate: "Fast, direct, results-first. No small talk. They'll finish your sentences — let them.", motivate: "Rankings, volume milestones, income targets they set. Post the scoreboard — they'll chase it.", accountable: "Daily metrics, real-time leaderboard, weekly sprint targets. Structure they can see is structure they'll hit.", conflict: "Gets loud or goes cold. Match their energy briefly, then redirect: 'I hear you — here's what the numbers show.'", feedforward: "If you could only run three activities for the next 30 days, what would produce the most income?" },
  'P-Pro-V-I': { communicate: "Enthusiastic and forward-looking. Meet their energy first, then anchor to a specific ask.", motivate: "Momentum and visible forward motion. Small wins celebrated loudly keep them going between big ones.", accountable: "Text-based daily check-ins with a single metric. Too complex and they'll stop tracking entirely.", conflict: "Energy crash isn't disengagement. Ask 'what would reset your energy?' before the performance gap.", feedforward: "What's one thing you could do tomorrow that would build on today's momentum instead of starting fresh?" },
  'P-Rec-R-D': { communicate: "Warm but professional. Acknowledge the relationship first, then the business point. Data with empathy.", motivate: "Trust earned, long-term loyalty, referrals from people they served. GCI follows — don't lead with the number.", accountable: "Values-based commitments — 'what does your client deserve this week?' beats 'how many calls did you make?'", conflict: "Internalizes and avoids confrontation. Ask: 'What's your honest read on what happened?' Give them space.", feedforward: "What's one way you could serve a current client this week that they would tell three people about?" },
  'P-Rec-R-I': { communicate: "Gentle and personal. Acknowledge the person before the performance. Never cold-open with a problem.", motivate: "Making a genuine difference in someone's life story. Connect every goal to a specific client they're serving.", accountable: "Private, consistent, warm. Weekly check-in framed as 'how are you doing?' not 'what did you hit?'", conflict: "Shuts down or apologizes excessively. Create safety: 'I'm not disappointed — I want to help you get what you want.'", feedforward: "What would it look like to take care of yourself this week the same way you take care of your clients?" },
  'P-Rec-V-D': { communicate: "Professional and substantive. They respect well-prepared leaders. Bring data and a clear agenda.", motivate: "Being the recognized market expert. Public positioning, thought leadership, being the go-to person.", accountable: "Output-based — market reports published, content created, presentations given. Activity that builds authority.", conflict: "Becomes defensive about expertise. Never challenge their knowledge — ask: 'What would you recommend given the data?'", feedforward: "What's the one piece of market intelligence your sphere most needs right now that only you can provide?" },
  'P-Rec-V-I': { communicate: "Narrative and vision-led. Open with where they're going, not where they are. They respond to future-pull.", motivate: "The story they're telling about who they're becoming. Recognition of their brand and client impact stories.", accountable: "Short-cycle milestones with visible proof of progress. 30-day wins feel more real than 90-day goals.", conflict: "Gets dramatic or withdraws into the story. Ground them: 'Set the story aside — what's one thing you can change this week?'", feedforward: "What's one story about a client you helped that you could tell this week that would open a new door?" },
  'T-Pro-R-D': { communicate: "Intellectual peer-to-peer. Logic before emotion. Present frameworks — they engage with reasoning, not feeling.", motivate: "Mastery, optimization, building something that compounds. Strategic wins matter more than recognition.", accountable: "Data dashboards they design themselves. They'll hold the standard higher than you would — let them own it.", conflict: "Withdraws analytically and questions the strategy. Bring evidence: 'Here's what the pattern shows last quarter.'", feedforward: "What's the highest-leverage activity in your business right now that you're not spending enough time on?" },
  'T-Pro-R-I': { communicate: "Big ideas first, then the specific ask. They disengage from operational detail — connect it to the vision.", motivate: "Novel opportunities, unexplored markets, being early to something. The pioneer position excites them.", accountable: "Minimal oversight with clear outcome checkpoints. Check results, not activity — they'll find their own path.", conflict: "Goes quiet or pivots to a new idea. Name it: 'I notice we're changing subjects — can we stay with this one?'", feedforward: "What's one idea you've had recently that you haven't acted on — and what would it take to test it in 30 days?" },
  'T-Pro-V-D': { communicate: "Data-first, efficient, no redundancy. If it can be in a dashboard, put it there before the conversation.", motivate: "Measurable optimization and hitting performance targets they set. Efficiency as competitive edge.", accountable: "Self-managed KPI tracking with a weekly 10-minute data review. Your role is to elevate the benchmark.", conflict: "Cites data to justify underperformance. Match the framework: 'I agree the data matters — here's what I'm seeing.'", feedforward: "Looking at your numbers, what's the one metric that — improved 10% — would have the biggest income impact?" },
  'T-Pro-V-I': { communicate: "Fast and direct. No softening. Respect their read of the room — they're usually right and they know it.", motivate: "High-stakes wins, competitive situations, income milestones with clear numbers attached.", accountable: "Real-time results tracking. They need to see the score to stay engaged with the game.", conflict: "Gets aggressive or disengages. Slow down: 'I want to understand your read on this before I share mine.'", feedforward: "What's one deal in your pipeline you've been avoiding — and what's the fastest path to a decision?" },
  'T-Rec-R-D': { communicate: "Precise and expertise-respecting. Do your homework first. They know immediately when you haven't.", motivate: "Deepening expertise, owning a niche, being the undisputed authority in their specific market.", accountable: "Commitment-to-outcome tracking — 'you said you'd close X by Y — what happened?' Clear, documented.", conflict: "Becomes territorial. Never challenge their knowledge — challenge the outcome: 'What's limiting the conversion?'", feedforward: "Who in your current niche could you serve more deeply — and what would make you indispensable to them?" },
  'T-Rec-R-I': { communicate: "Conceptual and curious. Ask questions that open thinking rather than directives that close it.", motivate: "Complex problems worth solving, clients with unusual situations, transactions no one else could navigate.", accountable: "Outcome-based with a light touch. 'What did you figure out this week?' beats a metrics review.", conflict: "Retreats into complexity to avoid the issue. Simplify: 'Forget the variables — what's the core problem?'", feedforward: "What's the most complex situation in your business that you're handling in a way no one else would think of?" },
  'T-Rec-V-D': { communicate: "Structured and ROI-focused. Lead with the business case. Show the system-improvement opportunity each time.", motivate: "Efficiency gains, process wins, measurable output from well-designed systems. Operational excellence is its own reward.", accountable: "Process adherence plus output metrics. They care about both — are we doing it right AND getting results?", conflict: "Goes rigid and hides behind process. Bridge it: 'The system is working — is the outcome what we wanted?'", feedforward: "What's one thing in your operation that, if systematized this week, would free up 5 hours next month?" },
  'T-Rec-V-I': { communicate: "Minimal and direct. Say what you mean. One topic, one ask, one next step per conversation — no more.", motivate: "Clean income math, clear path, fast execution. Show the shortest line between activity and income.", accountable: "Three numbers max. Anything more is noise — they'll stop tracking what they can't simplify.", conflict: "Goes transactional and unavailable. 'I'm not asking you to feel it, I'm asking you to acknowledge it.' Move forward.", feedforward: "What's one closed deal from the last 6 months where a follow-up call could open a new opportunity?" },
};

// ============================================================
// LEADERSHIP LENS — quadrant, early-warning signal, next unlock, Maxwell law, ceiling level
// ============================================================
export const LL: Record<string, { quad: string; signal: string; unlock: string; law: string; max: number }> = {
  'P-Pro-R-D': { quad: 'Achiever', signal: "Cancels 1:1s or stops sharing wins — disengagement is forming.", unlock: "Pick one newer agent and mentor them for 90 days — growing from a top producer into someone who develops others is their next leap.", law: 'Law of Addition', max: 3 },
  'P-Pro-R-I': { quad: 'Achiever', signal: "Stops telling stories about clients — emotional disconnection is starting.", unlock: "Take one thing they win at naturally and write it into a repeatable, step-by-step process — so it works even on an off day.", law: 'Law of Connection', max: 2 },
  'P-Pro-V-D': { quad: 'Achiever', signal: "Starts making excuses for missed numbers rather than problem-solving them.", unlock: "Take one activity off their plate and transfer it to someone they develop.", law: 'Law of Momentum', max: 3 },
  'P-Pro-V-I': { quad: 'Striver', signal: "Energy spikes followed by silence — burning fast and crashing.", unlock: "Implement one non-negotiable daily habit and hold it for 30 days.", law: 'Law of Momentum', max: 2 },
  'P-Rec-R-D': { quad: 'Achiever', signal: "Clients stop referring — their reputation is their metric. Watch it closely.", unlock: "Have them teach their client-care system to one other agent — multiplying their approach through others is the growth edge.", law: 'Law of Legacy', max: 3 },
  'P-Rec-R-I': { quad: 'Striver', signal: "Becomes overly apologetic or starts over-explaining — feeling unsafe.", unlock: "Have one direct, confident client conversation without softening the message.", law: 'Law of Connection', max: 2 },
  'P-Rec-V-D': { quad: 'Achiever', signal: "Stops creating content or sharing market insights — lost sense of purpose as an expert.", unlock: "Develop one other agent using their market-knowledge system.", law: 'Law of Priorities', max: 3 },
  'P-Rec-V-I': { quad: 'Striver', signal: "Stories become about past wins, not future ones — forward energy is draining.", unlock: "Turn one big win into a written case study they can show prospects — proof that backs up the story with results.", law: 'Law of Momentum', max: 2 },
  'T-Pro-R-D': { quad: 'Achiever', signal: "Starts questioning the strategy rather than executing it — lost faith in the plan.", unlock: "Build a scalable system and teach it to one person — teaching reveals the next growth edge.", law: 'Law of Priorities', max: 3 },
  'T-Pro-R-I': { quad: 'Independent', signal: "Stops proposing new ideas — creative energy is being suppressed or ignored.", unlock: "Complete one initiative start to finish without pivoting — proof they can close as well as open.", law: 'Law of Timing', max: 2 },
  'T-Pro-V-D': { quad: 'Achiever', signal: "Starts rationalizing underperformance with data rather than diagnosing it.", unlock: "Build a tracking system for one other agent and teach them to use it.", law: 'Law of Priorities', max: 3 },
  'T-Pro-V-I': { quad: 'Independent', signal: "Slows down, starts missing obvious closes, becomes selective about which leads to pursue.", unlock: "Win one deal through a slow-burn strategy that required sustained relationship investment.", law: 'Law of Timing', max: 3 },
  'T-Rec-R-D': { quad: 'Independent', signal: "Becomes territorial about their niche process or resistant to any outside input.", unlock: "Have them teach one teammate something only they know — the first step from solo expert to someone who lifts the team.", law: 'Law of Addition', max: 2 },
  'T-Rec-R-I': { quad: 'Independent', signal: "Quality of client communication drops — they're running on autopilot.", unlock: "Document one complex transaction navigated successfully — that case study becomes a client-acquisition tool.", law: 'Law of Timing', max: 2 },
  'T-Rec-V-D': { quad: 'Achiever', signal: "Starts optimizing the wrong things — busy on metrics that don't move the needle.", unlock: "Have them package their best system into a version other agents can run — scaling it beyond themselves is the growth edge.", law: 'Law of Priorities', max: 3 },
  'T-Rec-V-I': { quad: 'Independent', signal: "Completes tasks without engaging — tasks-over-outcomes mindset is setting in.", unlock: "Have them call 3 past clients this month purely to reconnect, no agenda — relationships are the muscle their efficiency tends to skip.", law: 'Law of Connection', max: 2 },
};

// ============================================================
// BASELINE PERSONALITY ("Part 1 — You as a person")
// Same four axes as the professional test, asked about personal life, on a
// 7-point scale. Personal code uses the SAME letters/format (e.g. "T-Rec-R-I")
// so it compares to the professional code position-by-position.
// ============================================================

// 20 statements (5 per axis). keys = the pole each statement loads toward;
// direction is mixed within an axis so people can't straight-line a column.
export const PERSONAL_QUESTIONS: { axis: Axis; keys: Pole; text: string }[] = [
  { axis: 'energy', keys: 'P', text: 'I feel recharged after spending time around people.' },
  { axis: 'energy', keys: 'T', text: 'I need quiet time alone to refill my tank.' },
  { axis: 'energy', keys: 'P', text: 'In a lively group, my energy builds as the night goes on.' },
  { axis: 'energy', keys: 'T', text: 'Too much socializing leaves me drained.' },
  { axis: 'energy', keys: 'P', text: 'I think best out loud, talking things through with someone.' },
  { axis: 'approach', keys: 'Pro', text: 'When I want something, I go after it directly.' },
  { axis: 'approach', keys: 'Rec', text: "I'd rather let good things come to me than chase them." },
  { axis: 'approach', keys: 'Pro', text: "I'm usually the one who makes the plans happen." },
  { axis: 'approach', keys: 'Rec', text: 'I wait for clarity before making a big move.' },
  { axis: 'approach', keys: 'Pro', text: 'People would call me driven and self-starting.' },
  { axis: 'deal', keys: 'R', text: "I'd rather have a few deep friendships than a wide circle." },
  { axis: 'deal', keys: 'V', text: 'I love being part of a big, varied social network.' },
  { axis: 'deal', keys: 'R', text: 'I invest most of myself in a small inner circle.' },
  { axis: 'deal', keys: 'V', text: 'I feel at home among lots of different people.' },
  { axis: 'deal', keys: 'R', text: 'Depth matters to me more than breadth in relationships.' },
  { axis: 'decision', keys: 'D', text: 'I trust logic and facts on big decisions.' },
  { axis: 'decision', keys: 'I', text: 'I go with my gut when something feels right.' },
  { axis: 'decision', keys: 'D', text: 'I weigh the practical pros and cons before deciding.' },
  { axis: 'decision', keys: 'I', text: 'My feelings are a reliable guide for important choices.' },
  { axis: 'decision', keys: 'D', text: 'I lead with reasoning more than emotion.' },
];

// Personal-context labels for each letter (distinct from the professional TRAIT_LABELS).
export const PERSONAL_LABELS: Record<Pole, string> = {
  P: 'Outgoing', T: 'Reserved', Pro: 'Initiator', Rec: 'Responder',
  R: 'Deep bonds', V: 'Wide circle', D: 'Head-led', I: 'Heart-led',
};
// Short "how it shows at work" labels for the contrast rows.
export const WORK_LABELS: Record<Pole, string> = {
  P: 'People', T: 'Heads-down', Pro: 'Proactive', Rec: 'Attraction',
  R: 'Relationships', V: 'Volume', D: 'Data', I: 'Instinct',
};

// ── The 16 personal types ──
// Renamed per Global Constraints to de-collide with ARCH names:
//   P-Pro-R-I  "The Heartfelt Catalyst" -> "The Firestarter"
//   T-Pro-V-I  "The Independent Maker"  -> "The Maverick"
//   T-Pro-V-D  "The Architect"          -> "The Systems Mind"
export const PERSONAL_TYPES: Record<string, { name: string; desc: string; strengths: string[]; watch: string }> = {
  'P-Pro-R-D': { name: 'The Devoted Champion', desc: "You bring big energy to a small, fiercely-protected circle. You go after what you want and bring your people with you — and when you commit to someone, you're all in for life. You lead with a clear head, so your loyalty is backed by judgment, not just feeling.", strengths: ['Loyal leadership', 'Decisive drive', 'Turning friends into family'], watch: "You can pour so much into your few that you run yourself down for them." },
  'P-Pro-R-I': { name: 'The Firestarter', desc: "You're a force of warmth — you chase what matters and you do it from the heart. Your circle isn't huge, but the people in it would follow you anywhere, because they feel how much you care. You move on instinct and emotion, and your enthusiasm is contagious.", strengths: ['Inspiring others', 'Deep loyalty', 'Leading with heart'], watch: "When someone close lets you down, it lands hard and personal." },
  'P-Pro-V-D': { name: 'The Rainmaker', desc: "You never stop building. You're energized by people, you go and get what you want, and you do it across a wide, ever-growing network — all guided by a sharp, practical mind. You see opportunities others walk past, and you act on them.", strengths: ['Networking', 'Decisive action', 'Spotting opportunity'], watch: "Chasing the next connection can leave current ones under-tended." },
  'P-Pro-V-I': { name: 'The Spark', desc: "You light up rooms, and you mean it. Magnetic, driven, and led by feel, you draw people in wherever you go and turn strangers into friends fast. You trust your gut and move quickly — life tends to happen around you.", strengths: ['Magnetism', 'Momentum', 'Reading the moment'], watch: "So many people and so much motion that follow-through can slip." },
  'P-Rec-R-D': { name: 'The Trusted Confidant', desc: "You're the warm, level-headed one people come to. Sociable but never pushy, you let life come to you and meet it with a steady, sensible mind. Your circle is small and devoted — they trust your judgment as much as your warmth.", strengths: ['Trustworthiness', 'Sound judgment', 'Steady warmth'], watch: "You wait so patiently you can miss things worth reaching for." },
  'P-Rec-R-I': { name: 'The Warm Heart', desc: "You're all heart. Friendly and present, you don't force anything — you let relationships unfold and pour yourself into the few that matter most. People feel genuinely cared for around you, because they are.", strengths: ['Empathy', 'Presence', 'Loyalty'], watch: "You give so freely you forget to protect your own energy." },
  'P-Rec-V-D': { name: 'The Easygoing Host', desc: "You're friendly with everyone and rattled by no one. You take life as it comes, keep a wide, easy circle, and bring a calm, practical sense to all of it. People are comfortable around you because nothing seems to faze you.", strengths: ['Approachability', 'Level-headedness', 'Social ease'], watch: "Easygoing can tip into passive when something needs you to push." },
  'P-Rec-V-I': { name: 'The Free Spirit', desc: "You move through life open and unhurried, led by what feels right. You know lots of people, you let things come, and you follow your heart wherever it points. You're refreshing to be around — present, warm, and genuinely free.", strengths: ['Openness', 'Adaptability', 'Warmth'], watch: "Going with the flow can mean drifting from what you actually want." },
  'T-Pro-R-D': { name: 'The Quiet Strategist', desc: "You're quietly relentless. You don't need the spotlight, but you go after what you want with patience and a sharp plan — all in service of a close, carefully-chosen few. People underestimate you until they notice how much ground you've quietly covered.", strengths: ['Focus', 'Strategic patience', 'Loyalty to a few'], watch: "You hold so much inside that even those close can't tell when you're struggling." },
  'T-Pro-R-I': { name: 'The Steady Builder', desc: "You build things that last — quietly, deliberately, from the heart. You recharge alone, you go after what matters, and you invest deeply in the people you love, trusting your instincts about them. Calm on the surface, committed all the way down.", strengths: ['Consistency', 'Deep commitment', 'Instinct about people'], watch: "You carry a lot silently before you ever ask for help." },
  'T-Pro-V-D': { name: 'The Systems Mind', desc: "You design your own path and execute it methodically. Independent and analytical, you don't need constant company — you'd rather build the system and let it run. You keep a broad, useful network, but on your own terms.", strengths: ['Independence', 'Structured thinking', 'Self-direction'], watch: "You can out-plan the people side — relationships need more than logic." },
  'T-Pro-V-I': { name: 'The Maverick', desc: "You do it your own way, and you do it from the gut. Self-directed and instinctive, you don't wait for permission and you don't need a crowd — yet you stay loosely connected to many in your own quiet way. You trust your feel for things, and it usually serves you.", strengths: ['Self-reliance', 'Instinct', 'Quiet drive'], watch: "Going solo on instinct can skip the input that would've helped." },
  'T-Rec-R-D': { name: 'The Thoughtful Analyst', desc: "You're private, precise, and deeply loyal. You take your time, let things come, and think them all the way through before you act — and the few you trust, you trust completely. People rely on you for the clear-eyed read no one else offers.", strengths: ['Clarity', 'Discretion', 'Dependable loyalty'], watch: "Analysis and patience can quietly become waiting when action is overdue." },
  'T-Rec-R-I': { name: 'The Quiet Anchor', desc: "You're the calm center your people rely on. You'd rather have three real conversations than thirty surface ones, you trust what you sense before what's on paper, and you refill your tank in quiet, not crowds. People feel safe with you — because you actually listen.", strengths: ['Steadiness', 'Reading people', 'Loyalty'], watch: "You can go so quiet under stress that others don't know you need help." },
  'T-Rec-V-D': { name: 'The Observer', desc: "You watch before you speak, and you see clearly. You're comfortable on your own, you let life come, and you bring a calm, rational eye to a wide but low-maintenance circle. When you finally weigh in, people listen — you don't waste words.", strengths: ['Perceptiveness', 'Objectivity', 'Calm'], watch: "Observing from the edge can read as distance to people who want you closer." },
  'T-Rec-V-I': { name: 'The Gentle Wanderer', desc: "You move through life softly and openly, guided by feeling. You don't need the crowd or the chase — you let things unfold, stay loosely connected to many, and follow your heart at your own pace. There's a quiet peace about you that others find calming.", strengths: ['Openness', 'Calm', 'Emotional attunement'], watch: "Drifting with the current can pull you away from your own goals." },
};

// ============================================================
// SHARED SCORING CORE — spectrum -> percentages, used by both parts.
// items: {axis, primary, weight} — weight is the (positive) magnitude of an
// answer, and `primary` is the pole it counts toward.
// ============================================================
function scoreAxes(items: { axis: Axis; primary: Pole; weight: number }[], maxAbs: number): AxisResult {
  const axes = {} as AxisResult['axes'];
  for (const axis of AXIS_ORDER) {
    const [a, b] = POLES[axis];
    const forAxis = items.filter((it) => it.axis === axis);
    let net = 0;
    for (const it of forAxis) net += it.primary === a ? it.weight : -it.weight;
    const letter = net >= 0 ? a : b;
    // A net imbalance of one full-strength answer (maxAbs) already saturates
    // confidence to 100% — pct scales the net against a single answer's max
    // weight, not against the whole axis's question count.
    const denom = maxAbs || 1;
    const pct = Math.min(100, 50 + Math.round((Math.abs(net) / denom) * 50));
    axes[axis] = { letter, pct };
  }
  const code = AXIS_ORDER.map((ax) => axes[ax].letter).join('-');
  return { code, axes };
}

// Personal: answers -3..3 (7-point Likert, neutral 0), length 20.
// keys = the pole the statement loads toward.
export function scorePersonal(answers: number[]): AxisResult {
  const items = PERSONAL_QUESTIONS.map((q, i) => ({
    axis: q.axis,
    primary: q.keys,
    weight: Number(answers[i]) || 0,
  }));
  return scoreAxes(items, 3);
}

// Pro: slider index 0..5 -> weight -3,-2,-1,+1,+2,+3 (6-point, no neutral).
// 0,1,2 lean toward the 'a'/av scenario; 3,4,5 lean toward the 'b'/bv scenario.
// Clamped so out-of-range values don't crash: negative -> 0, >5 -> 5.
const PRO_WEIGHTS = [-3, -2, -1, 1, 2, 3];
export function scorePro(answers: number[]): AxisResult {
  const items = PRO_QUESTIONS.map((q, i) => {
    const raw = answers[i];
    const idx = typeof raw === 'number' && Number.isFinite(raw)
      ? Math.min(5, Math.max(0, Math.round(raw)))
      : 0;
    const w = PRO_WEIGHTS[idx];
    // negative weight -> toward 'a' side (av); positive -> toward 'b' side (bv)
    return { axis: q.dim, primary: w < 0 ? q.av : q.bv, weight: Math.abs(w) };
  });
  return scoreAxes(items, 3);
}

// Axes where the personal and professional letters differ.
export function divergence(personal: AxisResult, pro: AxisResult): Axis[] {
  return AXIS_ORDER.filter((ax) => personal.axes[ax].letter !== pro.axes[ax].letter);
}
