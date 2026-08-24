// The deep personality readout — RECOVERED content.
//
// When the TRU framework was ported into this repo (2026-07-06), the richest
// blocks of the original `truFramework.js` (Behavioral Coaching App) were left
// behind: the per-type character portraits with evidenced strengths and blind
// spots (the 16personalities-style depth that made agents say "that read me to
// a T"), the prose that interprets a personal↔professional divergence, and the
// per-archetype channel prescriptions with their reasoning. This file restores
// them from the original at its content high-water mark (commit 9dc27df,
// 2026-06-27). The trait evidence is verbatim; the portrait paragraphs were
// re-voiced 2026-08-23 at Eric's direction — concrete, observable behavior in
// plain words, never lyrical characterization ("a warm force who chases..."). Codes are the same `Energy-Approach-Deal-Decision`
// scheme the app already uses. Content edits belong in BOTH places or, better,
// only here going forward.
import type { Axis, Pole } from './assessmentData';

export interface DeepTrait { t: string; d: string }
export interface DeepRead { desc: string; best: DeepTrait[]; worst: DeepTrait[] }

/** Keyed by the agent's PERSONAL (baseline/life) code. */
export const PERSONAL_DEEP: Record<string, DeepRead> = {
  'P-Pro-R-D': { desc: "Keeps a short list of people who matter and gives them everything. Sets a target, drives straight at it, and pulls those people along — protective in a fight, practical with the numbers, impatient with anything slow.",
    best: [{ t: 'Loyal', d: 'Treats a handful of clients like family; the referral pipeline runs on that devotion for years.' }, { t: 'Decisive', d: "Reads a deal and commits — clients never feel them waffle when it's time to move." }, { t: 'Driven', d: 'Sets a target and bulldozes toward it; needs a goal, not a pep talk.' }, { t: 'Protective', d: 'Goes to the mat for their people in a negotiation, so clients feel genuinely defended.' }, { t: 'Grounded', d: 'Leads with feeling but checks it against the numbers before acting.' }],
    worst: [{ t: 'Overextends', d: 'Pours so much into the few that they burn out and let everything else slide.' }, { t: 'Tunnel vision', d: 'Locks onto a goal and stops seeing the relationships fraying around it.' }, { t: 'Takes it personally', d: 'When a protected client goes cold, it lands hard and clouds their judgment.' }, { t: 'Impatient', d: 'Pushes at their own pace and can steamroll a client who needs to go slow.' }] },
  'P-Pro-R-I': { desc: "Leads with feeling and holds nothing back for the people they love. Gets others moving on pure belief and energy, reads a room instantly, runs all-in or empty — and takes it hard when someone close lets them down.",
    best: [{ t: 'Inspiring', d: 'Gets a hesitant client off the fence on belief and energy alone.' }, { t: 'Devoted', d: 'The few in their circle get everything; loyalty so visible it refers itself.' }, { t: 'Contagious', d: 'Their enthusiasm fills a room — open houses and listing pitches come alive.' }, { t: 'Intuitive', d: 'Reads the emotional temperature of a deal and adjusts before a word is said.' }, { t: 'Present', d: 'Makes a client feel like the only one that matters, because in that moment they are.' }],
    worst: [{ t: 'Thin-skinned', d: 'When someone close lets them down, it lands personal and throws them off for days.' }, { t: 'Runs hot and cold', d: 'Energy is all-in or depleted; the steady middle is hard to hold.' }, { t: 'Heart over head', d: 'Moves on feeling and can skip the diligence the numbers were begging for.' }, { t: 'Over-invests', d: 'Gives so much to a few that the wider pipeline starves.' }] },
  'P-Pro-V-D': { desc: "Knows everyone, works every room, and never stops adding names. Spots an opportunity early, decides fast, and moves the same day — more likely to chase the next contact than to sit long with the last one.",
    best: [{ t: 'Networker', d: 'Turns every room into pipeline; knows someone for every need.' }, { t: 'Opportunistic', d: 'Spots the deal others miss and moves on it the same day.' }, { t: 'Decisive', d: 'Acts fast and clean, so clients trust the momentum.' }, { t: 'Tireless', d: 'Outworks the field; raw volume is rarely the problem.' }, { t: 'Pragmatic', d: 'Cuts through emotion to the number that actually closes it.' }],
    worst: [{ t: 'Spreads thin', d: 'Chases the next connection and lets current clients feel under-tended.' }, { t: 'Transactional', d: 'Can treat people as pipeline and miss the relationship that would have referred for life.' }, { t: 'Restless', d: 'Bored by the slow, careful parts of a deal, so details slip.' }, { t: 'Short follow-through', d: 'So many leads in motion that the ones needing a second touch go cold.' }] },
  'P-Pro-V-I': { desc: "Turns strangers into friends in one conversation and moves on gut without looking back. Fast, warm, and everywhere at once — brilliant when the energy is up, invisible when it isn't.",
    best: [{ t: 'Magnetic', d: 'Draws people in everywhere they go; lead-gen is half done by personality.' }, { t: 'Fast', d: 'Reads the moment and moves before the window closes.' }, { t: 'Warm at scale', d: 'Makes a big network feel personal, one genuine connection at a time.' }, { t: 'Instinctive', d: 'Trusts a gut read on a client and is usually right.' }, { t: 'Energizing', d: 'Brings the momentum a stalling deal needs.' }],
    worst: [{ t: 'Scattered', d: 'So many people and so much motion that follow-through slips through the cracks.' }, { t: 'All instinct', d: "Skips the prep and the numbers, riding charm until it isn't enough." }, { t: 'Inconsistent', d: 'Brilliant week, invisible week — the system depends on their mood.' }, { t: 'Avoids the grind', d: 'Loves the open, hates the paperwork; deals stall in the unglamorous middle.' }] },
  'P-Rec-R-D': { desc: "The steady one people bring their problems to. Doesn't push and doesn't panic — listens, weighs it, gives level advice, and keeps a small circle that stays for years. Waits more than they should.",
    best: [{ t: 'Trustworthy', d: 'Clients hand them the hard decisions because the advice is sound and unhurried.' }, { t: 'Level-headed', d: 'Stays calm when a deal wobbles; the steadying voice in the room.' }, { t: 'Judicious', d: 'Reads a situation clearly before acting; rarely the source of a misstep.' }, { t: 'Loyal', d: 'A small book that stays for years and refers without being asked.' }, { t: 'Approachable', d: 'Easy to talk to, so clients open up early and problems surface sooner.' }],
    worst: [{ t: 'Passive', d: 'Waits so patiently they miss leads worth reaching for.' }, { t: 'Conflict-averse', d: 'Softens a hard truth a client needed to hear straight.' }, { t: 'Under-ambitious', d: 'Comfortable with a steady few; rarely pushes for the next level.' }, { t: 'Reactive', d: 'Lets the day come to them instead of driving it.' }] },
  'P-Rec-R-I': { desc: "Gives their whole attention to whoever is in front of them, and means it. Feels what people need before it's said and pours into a few — while their own follow-up, and their own limits, quietly slide.",
    best: [{ t: 'Empathetic', d: 'Senses what a client needs before they say it, and meets them there.' }, { t: 'Present', d: 'Fully with the person in front of them; no one feels rushed or processed.' }, { t: 'Loyal', d: 'The handful they serve become lifelong clients and a referral engine.' }, { t: 'Reassuring', d: 'Calms an anxious buyer better than any spreadsheet could.' }, { t: 'Genuine', d: 'Cares for real, and clients can tell, so trust comes fast.' }],
    worst: [{ t: 'Self-neglecting', d: 'Gives so freely they forget to protect their own time and energy.' }, { t: 'Inconsistent follow-up', d: 'Runs on feeling, so the system slips when they are stretched thin.' }, { t: 'Avoids hard talks', d: "Softens a 'no' until the message is lost." }, { t: 'Over-attached', d: 'Takes a lost client or a hard deal too personally.' }] },
  'P-Rec-V-D': { desc: "Easy with everyone, rattled by nothing. Keeps a wide circle warm without seeming to work at it and finds the sensible next step while others spin — but coasts in moments that needed a push.",
    best: [{ t: 'Approachable', d: 'A wide, warm network that generates leads without forcing anything.' }, { t: 'Unflappable', d: 'Nothing fazes them, so clients relax because they do.' }, { t: 'Practical', d: 'Cuts the drama and finds the sensible next step.' }, { t: 'Easy to work with', d: 'Other agents and coordinators love them, so deals go smoother.' }, { t: 'Steady', d: 'The same calm person on a good day and a falling-apart one.' }],
    worst: [{ t: 'Too passive', d: 'Easygoing tips into not pushing when a deal needs urgency.' }, { t: 'Coasts', d: 'Wide network, low intensity — rarely converts the volume they could.' }, { t: 'Avoids pressure', d: 'Backs off the hard ask that would have closed it.' }, { t: 'Low follow-up drive', d: 'Lets warm leads cool because chasing feels like work.' }] },
  'P-Rec-V-I': { desc: "Open, unhurried, and liked everywhere they go. Takes things as they come, follows what feels right, rolls with surprises — and drifts off their own targets when nobody's watching.",
    best: [{ t: 'Open', d: 'Connects easily and widely; people are drawn to the warmth.' }, { t: 'Adaptable', d: "Rolls with a deal's curveballs without losing the client's trust." }, { t: 'Warm', d: 'Makes everyone feel welcome; referrals come from being genuinely liked.' }, { t: 'Intuitive', d: 'Feels the right move with a client more than calculates it.' }, { t: 'Refreshing', d: 'Present and unpushy in an industry full of pressure.' }],
    worst: [{ t: 'Drifts', d: 'Goes with the flow and loses sight of their own targets.' }, { t: 'Disorganized', d: 'Heart-led and loose; the CRM and the follow-up suffer.' }, { t: 'Avoids structure', d: 'Resists the systems that would turn warmth into volume.' }, { t: 'Inconsistent', d: 'Production swings with their mood and the season.' }] },
  'T-Pro-R-D': { desc: "Quiet, prepared, and three steps ahead. Does the homework, works a long-fuse lead for months without pressure, keeps secrets like a vault — and goes silent instead of asking for help.",
    best: [{ t: 'Strategic', d: 'Plans the whole deal backward from the close — rarely caught flat-footed by a contingency.' }, { t: 'Self-directed', d: "Doesn't need hand-holding; give them the target and they build their own path to it." }, { t: 'Patient', d: 'Works a long-fuse lead for months without pressure, and is there the day it finally turns.' }, { t: 'Discreet', d: 'Clients hand them the real story — money, doubts, timing — because nothing leaves the room.' }, { t: 'Prepared', d: 'Walks into every appointment having done the homework; their presentations have no gaps.' }],
    worst: [{ t: 'Withholding', d: "Goes silent when overloaded — even their lead can't tell they're drowning until a deal slips." }, { t: 'Over-analytical', d: "Plans a follow-up so thoroughly they miss the window the call should've gone out in." }, { t: 'Hard to read', d: "Comes across cold to warmer clients who need to feel liked before they'll commit." }, { t: 'Slow to ask', d: 'Carries problems solo until they grow into bigger ones; rarely raises a hand early.' }] },
  'T-Pro-R-I': { desc: "Shows up the same every day and builds slowly, for keeps. All-in on the people and commitments they choose, trusts their own read over anyone's advice — carries too much silently, and never promotes themselves.",
    best: [{ t: 'Consistent', d: 'Shows up the same every day; the slow, compounding kind of producer.' }, { t: 'Committed', d: 'Once they take a client, they are all the way in for the long haul.' }, { t: 'Reads people', d: 'Trusts a gut sense for who is real and who is wasting time, and is usually right.' }, { t: 'Calm', d: 'Steady on the surface when a deal gets tense; clients lean on it.' }, { t: 'Loyal', d: 'A small, deeply-served book that refers for years.' }],
    worst: [{ t: 'Bottles it up', d: 'Carries a lot silently before they ever ask for help.' }, { t: 'Slow to pivot', d: 'Commits so deeply they stay with an approach past the point it works.' }, { t: 'Quietly stubborn', d: 'Trusts their instinct so much that good outside input bounces off.' }, { t: 'Under-visible', d: 'Does great work no one sees; will not promote themselves.' }] },
  'T-Pro-V-D': { desc: "Builds the system, then lets the system work. Tracks their own numbers, cuts wasted motion, runs on data and autonomy — and can treat people like inputs when the machine matters more than the moment.",
    best: [{ t: 'Systematic', d: 'Builds a repeatable machine — lead flow, follow-up, and transactions all dialed in.' }, { t: 'Independent', d: 'Self-runs; give them autonomy and the results come.' }, { t: 'Analytical', d: 'Decisions are data-backed, so they hold up under pressure.' }, { t: 'Efficient', d: 'Cuts wasted motion; gets more done with less drama.' }, { t: 'Self-improving', d: 'Tracks their own numbers and tunes the system without being told.' }],
    worst: [{ t: 'Cold on people', d: 'Out-plans the relationship; clients can feel like inputs to a system.' }, { t: 'Over-engineers', d: 'Builds complexity where a phone call would have done it.' }, { t: 'Low warmth', d: 'Logic-first delivery leaves feeling-driven clients unconvinced.' }, { t: 'Resists collaboration', d: 'Would rather do it alone than coordinate, so misses team leverage.' }] },
  'T-Pro-V-I': { desc: "Self-directed to the bone — no permission asked, no audience needed, no playbook followed. Runs on instinct and figures it out alone; results swing because there's no system underneath, and advice mostly bounces off.",
    best: [{ t: 'Self-reliant', d: 'Does not wait to be managed; finds their own way to the goal.' }, { t: 'Instinctive', d: 'A gut feel for people and timing that usually pays off.' }, { t: 'Quietly driven', d: 'Works hard without needing an audience for it.' }, { t: 'Resourceful', d: 'Figures out a path when the playbook does not fit.' }, { t: 'Authentic', d: 'Clients trust them because nothing about them is an act.' }],
    worst: [{ t: 'Goes solo too long', d: 'Acts on instinct and skips the input that would have helped.' }, { t: 'No system', d: 'Wings it; the follow-up and CRM are an afterthought.' }, { t: 'Hard to coach', d: 'Resists the structure that would scale them.' }, { t: 'Unpredictable', d: 'Output swings because there is no system underneath the instinct.' }] },
  'T-Rec-R-D': { desc: "Thinks it all the way through before saying a word. Precise, honest, discreet — catches what everyone else missed, promises little and delivers all of it. Deliberates past the window more often than they'd admit.",
    best: [{ t: 'Clear-eyed', d: 'Gives clients the honest read no one else will, and it is usually right.' }, { t: 'Thorough', d: 'Catches the contract detail or inspection flag others skim past.' }, { t: 'Discreet', d: 'A vault; clients share the sensitive stuff freely.' }, { t: 'Dependable', d: 'Slow to promise, but what they promise gets done.' }, { t: 'Loyal', d: 'A small book that stays for life because the counsel is trusted.' }],
    worst: [{ t: 'Over-deliberates', d: 'Thinks so long that action arrives after the window closed.' }, { t: 'Passive', d: 'Waits for the deal to come instead of going to get it.' }, { t: 'Risk-averse', d: 'Talks themselves out of a play that needed boldness.' }, { t: 'Hard to reach', d: 'Precision over warmth can leave a client feeling handled, not helped.' }] },
  'T-Rec-R-I': { desc: "The calm one in the room, and the one people actually tell the truth to. Hears what's underneath the words and invests deep in very few — then goes quiet under stress, right when they need someone.",
    best: [{ t: 'Steady', d: "The reassuring constant when a client's deal is falling apart." }, { t: 'Deep listener', d: 'Hears what a client actually means, not just what they say.' }, { t: 'Trusted', d: 'People feel safe with them, so the truth comes out early.' }, { t: 'Loyal', d: 'A small, devoted book that refers on relationship alone.' }, { t: 'Perceptive', d: "Senses a client's real hesitation before it's spoken." }],
    worst: [{ t: 'Goes quiet under stress', d: 'Withdraws when overwhelmed; others cannot tell they need help.' }, { t: 'Net too small', d: 'Three deep conversations, but too few of them, so volume suffers.' }, { t: 'Conflict-shy', d: 'Lets a hard conversation drift rather than have it.' }, { t: 'Under-promotes', d: 'Will not put themselves out there, so the pipeline stays thin.' }] },
  'T-Rec-V-D': { desc: "Watches first, speaks last, and is usually right. Calm in a heated negotiation, sparing with words, keeps a wide circle warm on low effort — but engages so late the moment sometimes passes.",
    best: [{ t: 'Perceptive', d: 'Reads a room and a deal accurately; little gets past them.' }, { t: 'Objective', d: 'Strips the emotion and names what is actually happening.' }, { t: 'Calm', d: 'Unshakable when a negotiation heats up.' }, { t: 'Economical', d: 'Does not waste words; when they weigh in, people listen.' }, { t: 'Low-maintenance', d: 'Keeps wide connections warm without high effort.' }],
    worst: [{ t: 'Distant', d: 'Observing from the edge reads as cold to clients who want closeness.' }, { t: 'Slow to engage', d: 'Watches so long the moment to act passes.' }, { t: 'Under-connected', d: 'Wide but shallow — few relationships deep enough to refer.' }, { t: 'Withholds', d: 'Sees the issue but does not speak up until it is late.' }] },
  'T-Rec-V-I': { desc: "Soft-spoken and settling to be around. No pressure and no act — moves with whatever the day brings, connects easily with every kind of person, and needs outside structure or the follow-up drifts.",
    best: [{ t: 'Calming', d: 'A peace about them that settles anxious buyers and sellers.' }, { t: 'Attuned', d: "Feels a client's emotional state and meets it gently." }, { t: 'Open', d: 'Easy, judgment-free connection with a wide range of people.' }, { t: 'Flexible', d: "Goes with a deal's flow without forcing or panicking." }, { t: 'Genuine', d: 'No pressure and no act, so clients relax into it.' }],
    worst: [{ t: 'Drifts', d: 'Goes with the current and loses sight of their own goals.' }, { t: 'Unstructured', d: 'Soft and loose; systems, CRM, and follow-up all slip.' }, { t: 'Avoids the ask', d: 'Will not push for the close or the referral.' }, { t: 'Inconsistent', d: 'Production wanders with their mood and the season.' }] },
};

// ── Personal ↔ professional divergence, in words ────────────────────────────
// The app already COMPUTES divergence; this is the prose that makes it mean
// something. Keys per axis: 'aligned', or '<personalPole>><workPole>'.

export const CONTRAST_PROSE: Record<Axis, Record<string, string>> = {
  energy: {
    aligned: 'Your social wiring matches how you work — sustainable.',
    'T>P': 'You recharge in quiet, but your business runs on constant connection — real output, real energy cost. Protect recovery time.',
    'P>T': "You're energized by people, but your work is heads-down — watch for isolation; build connection into your week.",
  },
  approach: {
    aligned: 'Your natural drive flows straight into how you work.',
    'Rec>Pro': 'By nature you let things come, but professionally you push outbound — effective, but it takes discipline to sustain.',
    'Pro>Rec': "You're a natural initiator running an attraction-based business — channel that drive into building, not just waiting.",
  },
  deal: {
    aligned: 'How you bond personally is exactly how you build clients — lean in.',
    'R>V': "You're wired for a deep few, but your model runs on volume — guard against feeling spread thin; systematize the breadth.",
    'V>R': 'You love a wide circle, but your business rewards depth — slow down and go deeper with the few.',
  },
  decision: {
    aligned: 'You decide the same way at home and at work — consistent and clear.',
    'I>D': "You trust your gut personally but operate on data professionally — a real discipline you've built; trust it.",
    'D>I': "You're a head-first thinker working an instinct-led craft — let your read of people catch up to your analysis.",
  },
};

const AXIS_ORDER: Axis[] = ['energy', 'approach', 'deal', 'decision'];

// ── Plain-speech building blocks for the narrative profile ──────────────────
// Eric's rule: no axis taxonomy, no framework vocabulary in user-facing copy.
// The page says what a pole MEANS, in a sentence, third person.

/** How each personal pole reads in the opening "day to day" sentence. */
export const AXIS_PHRASES: Record<Axis, Partial<Record<Pole, string>>> = {
  energy: { P: 'comes alive around people', T: 'needs quiet to recharge' },
  approach: { Pro: "doesn't wait for things to happen — goes and gets them", Rec: 'takes things as they come' },
  deal: { R: 'keeps a small circle and goes deep', V: 'keeps a big circle and keeps it easy' },
  decision: { D: 'runs decisions through their head', I: 'runs decisions through their gut' },
};

/** The recovered divergence insights, recast in third person for the leader's
 *  page (the originals speak to the agent as "you"). Keyed '<life>><work>'. */
export const CONTRAST_THIRD: Record<Axis, Record<string, string>> = {
  energy: {
    'T>P': 'they recharge in quiet, yet the business runs on constant connection — the output is real and so is the energy bill, so protect their recovery time',
    'P>T': 'they are energized by people, yet the work is heads-down — watch for isolation, and build connection into their week',
  },
  approach: {
    'Rec>Pro': 'by nature they let things come, yet professionally they push outbound — effective, and it takes discipline to sustain',
    'Pro>Rec': 'they are a natural initiator running an attraction-based business — that drive belongs in building, not waiting',
  },
  deal: {
    'R>V': 'they are wired for a deep few, yet the model runs on volume — feeling spread thin is the risk, so systematize the breadth',
    'V>R': 'they love a wide circle, yet the business rewards depth — the move is slower and deeper with fewer',
  },
  decision: {
    'I>D': 'they trust their gut personally but operate on data at work — a discipline they built, worth trusting',
    'D>I': 'they think head-first in an instinct-led craft — help their read of people catch up to their analysis',
  },
};

export interface ContrastLine { axis: Axis; line: string }

/** Every diverging axis as a third-person sentence fragment, in axis order. */
export function contrastLines(personalCode: string, workCode: string): ContrastLine[] {
  const pp = personalCode.split('-');
  const pr = workCode.split('-');
  const out: ContrastLine[] = [];
  AXIS_ORDER.forEach((axis, i) => {
    if (pp[i] && pr[i] && pp[i] !== pr[i]) {
      const line = CONTRAST_THIRD[axis][`${pp[i]}>${pr[i]}`];
      if (line) out.push({ axis, line });
    }
  });
  return out;
}

/** The "day to day" wiring sentence for the opening paragraph. */
export function wiringSentence(firstName: string, personalCode: string): string {
  const letters = personalCode.split('-');
  const parts = AXIS_ORDER
    .map((axis, i) => AXIS_PHRASES[axis][letters[i] as Pole])
    .filter((p): p is string => Boolean(p));
  if (parts.length < 4) return '';
  return `Day to day, ${firstName} ${parts[0]}; ${parts[1]}; ${parts[2]}; and ${parts[3]}.`;
}

/** The divergence prose for one axis given both codes ('P-Pro-R-D' strings). */
export function contrastProse(axis: Axis, personalCode: string, workCode: string): string {
  const i = AXIS_ORDER.indexOf(axis);
  const me = personalCode.split('-')[i] as Pole | undefined;
  const work = workCode.split('-')[i] as Pole | undefined;
  if (!me || !work) return '';
  if (me === work) return CONTRAST_PROSE[axis].aligned;
  return CONTRAST_PROSE[axis][`${me}>${work}`] ?? '';
}

// ── Where they'll win business — the original prescriptions ─────────────────
// Keyed by the PROFESSIONAL archetype code. `WHY` is the sentence that sells
// each channel to this person; `note` is the working instruction.

export const CHANNEL_NAMES: Record<string, string> = {
  sphere: 'Sphere of Influence', referrals: 'Referrals', open: 'Open Houses',
  net: 'Networking', social: 'Social Media', farming: 'Geo Farming',
  db: 'Database Nurture', zillow: 'Online / Portal Leads', fsbo: 'FSBO',
  exp: 'Expired Listings', cold: 'Cold Calling', circle: 'Circle Prospecting',
  content: 'Market Content',
};

export const CHANNEL_WHY: Record<string, string> = {
  sphere: "Your relationships are your pipeline — people already trust you, so warm outreach converts where cold channels can't.",
  referrals: 'You earn loyalty, and loyal clients refer. A direct ask turns goodwill into a steady stream of business.',
  open: 'You read and connect with a room in real time — open houses put your best skill in front of ready buyers.',
  net: 'You build genuine connection fast; every room is full of future clients and referral partners.',
  social: 'Your personality carries online — consistent, authentic content keeps you top-of-mind at scale.',
  farming: "You're systematic and patient — owning a geographic area rewards exactly that consistency.",
  db: 'You play the long game well — a nurtured database compounds into predictable, low-cost business.',
  zillow: 'You move fast and work a process — portal leads reward speed-to-lead and disciplined follow-up.',
  fsbo: "You're comfortable with direct, problem-solving conversations — FSBOs need exactly that confidence.",
  exp: "You don't flinch at rejection and you solve problems — expired sellers want a fresh, capable approach.",
  cold: "You're energized by the chase and unfazed by 'no' — volume outreach turns fearlessness into deals.",
  circle: 'You thrive on momentum and repetition — circle prospecting rewards consistent, high-volume reps.',
  content: 'Your authority is your edge — market content positions you as the expert clients seek out.',
};

export interface ChannelRx { top: string[]; avoid: string[]; note: string }

export const CHANNEL_RX: Record<string, ChannelRx> = {
  'P-Pro-R-D': { top: ['sphere', 'referrals', 'net', 'farming'], avoid: ['cold', 'circle'], note: 'Anchor sphere outreach in personalized market data — your warmth plus rigor compounds referrals.' },
  'P-Pro-R-I': { top: ['sphere', 'open', 'net', 'social'], avoid: ['cold', 'fsbo'], note: 'Every in-person moment is a database-building opportunity. Capture it and follow up.' },
  'P-Pro-V-D': { top: ['cold', 'fsbo', 'exp', 'circle'], avoid: ['db'], note: "You're built for volume prospecting — just protect a follow-up system you'll actually keep." },
  'P-Pro-V-I': { top: ['open', 'net', 'social', 'cold'], avoid: ['exp', 'db'], note: 'Keep follow-up dead simple — three steps max — so momentum never stalls.' },
  'P-Rec-R-D': { top: ['sphere', 'referrals', 'open'], avoid: ['cold', 'fsbo'], note: 'Systematize the referral ask so it feels like client care, not selling.' },
  'P-Rec-R-I': { top: ['sphere', 'referrals', 'open', 'social'], avoid: ['cold', 'exp'], note: "Frame all prospecting as service first — that's where your warmth converts." },
  'P-Rec-V-D': { top: ['db', 'content', 'net', 'social'], avoid: ['cold'], note: 'Every piece of market content needs a clear capture path back to you.' },
  'P-Rec-V-I': { top: ['social', 'open', 'net'], avoid: ['cold', 'fsbo'], note: 'One story-driven post a week beats a burst then silence.' },
  'T-Pro-R-D': { top: ['exp', 'fsbo', 'farming', 'db'], avoid: ['open'], note: 'Frame prospecting as intelligence-gathering and system-building.' },
  'T-Pro-R-I': { top: ['net', 'sphere', 'social'], avoid: ['cold', 'circle'], note: 'Keep channels fresh — novelty keeps your energy and performance high.' },
  'T-Pro-V-D': { top: ['zillow', 'exp', 'cold', 'circle'], avoid: ['net'], note: "Review ROI by channel monthly — you'll self-optimize when the data is clear." },
  'T-Pro-V-I': { top: ['fsbo', 'exp', 'cold'], avoid: ['db', 'farming'], note: 'Automate follow-up for anything not ready now — your energy belongs in the deal.' },
  'T-Rec-R-D': { top: ['net', 'db', 'referrals'], avoid: ['cold', 'circle'], note: 'Build partnerships with attorneys, CPAs, and advisors who serve your niche.' },
  'T-Rec-R-I': { top: ['referrals', 'sphere', 'net'], avoid: ['cold', 'circle'], note: 'Position as the complex-case specialist — referrals from pros are your best channel.' },
  'T-Rec-V-D': { top: ['farming', 'db', 'zillow'], avoid: ['net'], note: 'Build the tracking system before launching the channel — data first, then execution.' },
  'T-Rec-V-I': { top: ['fsbo', 'exp', 'zillow'], avoid: ['farming', 'net'], note: 'Automate everything except the close — your time is most valuable in the deal.' },
};
