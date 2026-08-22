/**
 * WHERE THEY'LL WIN BUSINESS — channel fit, derived from the assessment.
 *
 * A leader opens an agent's sheet asking a practical question: what should this
 * person actually DO to generate business? The sheet could tell them how to run
 * a 1:1 and where the agent slips, but not that.
 *
 * This is not a new opinion about anybody. Every channel below is scored
 * against the four axes the professional assessment already measures:
 *
 *   energy    People-Oriented (P)      vs  Task-Oriented (T)
 *   approach  Proactive (Pro)          vs  Authority Builder (Rec)
 *   deal      Relationship-Focused (R) vs  Volume-Driven (V)
 *   decision  Data-Driven (D)          vs  Intuition-Led (I)
 *
 * A channel names the traits it rewards, an agent either has them or does not,
 * and the score is that overlap. Nothing is asserted about a person that their
 * own answers did not already say — and because the matched traits are shown
 * next to the reason, a leader can see the working rather than trust a number.
 *
 * The reasons are about the CHANNEL, not the person: why cold outbound rewards
 * volume and thick skin, why farming rewards patience and data. That is a claim
 * about how this business works, and it is the same for everyone.
 */

import type { Pole } from './assessmentData';

export interface Channel {
  key: string;
  name: string;
  /** The traits this channel actually rewards. */
  fit: Pole[];
  /** Why the channel rewards them. A fact about the work, not about the agent. */
  because: string;
  /** The honest cost of the channel, shown when it is a poor match. */
  cost: string;
}

export const CHANNELS: Channel[] = [
  {
    key: 'open-houses',
    name: 'Open houses',
    fit: ['P', 'I', 'V'],
    because: 'A room full of strangers and no script. It pays people who can read a stranger in ten seconds and follow the room rather than the plan.',
    cost: 'Long dead stretches between real conversations, and most of the day is spent waiting.',
  },
  {
    key: 'sphere',
    name: 'Sphere and past clients',
    fit: ['P', 'Rec', 'R'],
    because: 'The cheapest business there is, and it compounds. It pays people who stay in touch without an agenda and are remembered years later.',
    cost: 'It pays nothing for months before it pays anything, so it rewards patience over activity.',
  },
  {
    key: 'expireds',
    name: 'Expired listings',
    fit: ['Pro', 'V', 'D'],
    because: 'A seller who already wants to move and already has a reason to distrust agents. It pays volume, a thick skin, and a number-led case for why this time is different.',
    cost: 'Rejection is the default outcome and the call list never gets warmer.',
  },
  {
    key: 'fsbo',
    name: 'For sale by owner',
    fit: ['Pro', 'V', 'P'],
    because: 'They have already decided they do not need you, so the work is patience and repeated contact until the market changes their mind.',
    cost: 'Nearly all of the effort lands on people who never convert.',
  },
  {
    key: 'portals',
    name: 'Online lead platforms',
    fit: ['Pro', 'V', 'T'],
    because: 'Won almost entirely on speed to first contact and relentless follow-up. It pays whoever works the queue hardest, not whoever is most charming.',
    cost: 'Expensive, low-intent, and it punishes anyone who lets a lead sit an hour.',
  },
  {
    key: 'social',
    name: 'Social and video content',
    fit: ['P', 'I', 'Rec'],
    because: 'An audience that arrives already believing you. It pays personality and a willingness to be on camera without a script.',
    cost: 'Months of publishing to almost nobody before the first real lead arrives.',
  },
  {
    key: 'farming',
    name: 'Geographic farming',
    fit: ['T', 'Rec', 'D'],
    because: 'Own one neighbourhood until you are the obvious call. It pays consistency and knowing the numbers on every street.',
    cost: 'A long, expensive runway, and it only works if you never stop.',
  },
  {
    key: 'community',
    name: 'Community and local events',
    fit: ['P', 'Rec', 'R'],
    because: 'Business as a by-product of being genuinely known locally. It pays people who show up for years without pitching.',
    cost: 'Almost impossible to attribute, so it feels like it is not working long after it is.',
  },
  {
    key: 'investors',
    name: 'Investors and analytical buyers',
    fit: ['T', 'D', 'R'],
    because: 'Clients who buy on arithmetic, transact repeatedly, and do not need their hand held. It pays whoever can run the numbers faster than they can.',
    cost: 'Unsentimental, price-driven, and they will leave over a fraction of a point.',
  },
  {
    key: 'newbuild',
    name: 'Builders and new construction',
    fit: ['T', 'D', 'Rec'],
    because: 'One relationship can supply years of inventory. It pays process, reliability, and being easy for a builder to work with.',
    cost: 'Slow to break into, and the timelines are somebody else’s to control.',
  },
  {
    key: 'partners',
    name: 'Referral partners',
    fit: ['P', 'Pro', 'R'],
    because: 'Lenders, attorneys and relocation desks each sit on a stream of people who already need an agent. It pays whoever keeps the relationship warm and sends business back.',
    cost: 'You are one of several agents they know, so it has to be earned repeatedly.',
  },
  {
    key: 'database',
    name: 'Database reactivation',
    fit: ['T', 'Pro', 'D'],
    because: 'The business already in the file. It pays whoever will actually work a list nobody else wants to touch.',
    cost: 'Tedious, unglamorous, and it lives or dies on the quality of the records.',
  },
];

export interface ChannelScore {
  channel: Channel;
  /** 0..1 — the share of the channel's rewarded traits this agent has. */
  score: number;
  /** Which of their traits matched, for showing the working. */
  matched: Pole[];
}

/**
 * Score every channel against one agent's four poles.
 *
 * Deliberately a plain overlap, not a weighting anyone tuned. A weighted model
 * would imply a precision this assessment does not have, and nobody could check
 * it. Overlap is explainable in one line: they have three of the four traits
 * this channel rewards.
 */
export function fitFor(code: string | null | undefined): ChannelScore[] {
  if (!code) return [];
  const poles = code.split('-') as Pole[];
  if (poles.length !== 4) return [];
  const have = new Set(poles);
  return CHANNELS
    .map((channel) => {
      const matched = channel.fit.filter((p) => have.has(p));
      return { channel, score: matched.length / channel.fit.length, matched };
    })
    // Stable: best fit first, then the channel's own order, so the list never
    // reshuffles between renders for two channels that tie.
    .sort((a, b) => b.score - a.score
      || CHANNELS.indexOf(a.channel) - CHANNELS.indexOf(b.channel));
}
