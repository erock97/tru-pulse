// The morning brief: what a team lead reads on their phone before the day starts.
//
// Pure. It takes rows that have already been fetched and returns text, so the
// exact message can be previewed, diffed and unit-tested without sending
// anything or standing up a Worker.
//
// Three things shape every decision in here.
//
// 1. It is an SMS, so it is 160 characters a segment — but only while every
//    character is in the GSM-7 set. One em-dash, one curly quote, one emoji and
//    the whole message silently becomes UCS-2 at 70 characters a segment, which
//    roughly doubles what it costs to send. The existing weekly email brief
//    renders em-dashes and middots freely, so none of its copy can be reused
//    here verbatim. There is a test that pins this, because it is the kind of
//    regression a well-meaning copy edit reintroduces.
//
// 2. A lead's name never appears. That is a client's customer's identity
//    crossing a carrier for no reason — counts and first-name-last-initial for
//    their own agents do the job, and the deep link carries the detail.
//
// 3. Silence when there is nothing to say is wrong, but so is a daily "nothing
//    to report". The first makes people wonder if it broke; the second trains
//    them to ignore it. So a quiet day gets one short line and still arrives.

/** The GSM-7 basic set plus the extension characters, which cost 2 units each. */
const GSM7 =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà' +
  '^{}\\[~]|€';

export function isGsm7(s: string): boolean {
  for (const ch of s) if (!GSM7.includes(ch)) return false;
  return true;
}

/** Segments this message would cost. 160 alone, 153 each once concatenated. */
export function segments(s: string): number {
  if (!isGsm7(s)) return s.length <= 70 ? 1 : Math.ceil(s.length / 67);
  return s.length <= 160 ? 1 : Math.ceil(s.length / 153);
}

/** Four segments. Past that nobody is reading it on a lock screen anyway. */
export const SMS_HARD_CAP = 612;

export interface BriefAgent {
  /** Already reduced to first name + last initial by the caller. */
  name: string;
  newLeads: number;
  /** Leads of theirs with no call and no real text. */
  untouched: number;
  /** Leads of theirs sitting in an early stage past the team's window. */
  stalled: number;
}

export interface BriefInput {
  teamName: string;
  /** The local date where the team is, already formatted e.g. 'Mon Aug 25'. */
  dateLabel: string;
  agents: BriefAgent[];
  /** Unassigned arrivals. Real, but nobody's fault yet, so counted separately. */
  pondLeads: number;
  /** How stale the underlying sync is, in hours. Null means we have never synced. */
  syncAgeHours: number | null;
  /**
   * The team leader this is going to. They are left OUT of the brief entirely —
   * not in the roster, and no line about their own leads.
   *
   * A team leader works leads themselves, often a lot of them, and that is not
   * the thing this message is for. The brief answers "who do I need to chase
   * this morning", and the answer is never yourself. Scott Moore holds more
   * untouched leads than his whole team put together; a brief that led with that
   * every morning would be telling him something he already knows, in place of
   * the thing he opened it for.
   *
   * Their leads still count in the day's total, because that number is the
   * team's intake and stays true.
   */
  recipientName?: string;
  appUrl?: string;
}

export interface BriefResult {
  body: string;
  segments: number;
  /** Null when there is something to send. Otherwise why we are not sending. */
  skipReason: 'stale_sync' | null;
}

/** Over this, the numbers would be a lie rather than merely late. */
const STALE_SUPPRESS_HOURS = 12;
/** Over this, they still go, but with the age said out loud. */
const STALE_WARN_HOURS = 3;

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/**
 * Strip anything outside GSM-7 rather than letting it double the cost of the
 * message. Applied to names, which is where it actually bites: an agent called
 * "Renée" or a team with a curly apostrophe in its name would otherwise silently
 * halve the room available to everyone else in the same text.
 */
export function toGsm7(s: string): string {
  const map: Record<string, string> = {
    '’': "'", '‘': "'", '“': '"', '”': '"',
    '–': '-', '—': '-', '…': '...', '·': '-', ' ': ' ',
  };
  let out = '';
  for (const ch of s.normalize('NFKD')) {
    const swapped = map[ch] ?? ch;
    if (isGsm7(swapped)) out += swapped;
    else if (!/\p{Mark}/u.test(swapped)) out += '';
  }
  return out.replace(/\s+/g, ' ').trim();
}

export function renderMorningBrief(input: BriefInput): BriefResult {
  const app = input.appUrl ?? 'app.truhq.co/#/pulse';
  const head = `TRU Pulse - ${toGsm7(input.teamName)} - ${input.dateLabel}`;

  // Never synced, or so far behind that "0 new leads" would be a lie rather
  // than merely late. A wrong number destroys the brief's credibility
  // permanently; a missing one costs a morning.
  if (input.syncAgeHours === null || input.syncAgeHours > STALE_SUPPRESS_HOURS) {
    return {
      body: `${head}\nNo fresh data from Follow Up Boss, so today's numbers are held back.`,
      segments: 0,
      skipReason: 'stale_sync',
    };
  }

  const lines: string[] = [head];
  if (input.syncAgeHours > STALE_WARN_HOURS) {
    lines.push(`(data is about ${Math.round(input.syncAgeHours)}h old)`);
  }

  const me = input.recipientName ? toGsm7(input.recipientName) : null;
  // Everything below is about OTHER people. The leader is dropped from the
  // roster and from the named breakdown alike.
  const others = input.agents.filter((a) => !me || toGsm7(a.name) !== me);

  // The total still counts everyone, including the leader's own leads. That
  // number is the team's intake for the day and stays true; it is the only
  // place they appear, and they appear as a number rather than a name.
  const totalNew = input.agents.reduce((n, a) => n + a.newLeads, 0) + input.pondLeads;

  lines.push('');
  lines.push(`New leads (24h): ${totalNew}`);
  if (totalNew > 0) {
    const top = others.filter((a) => a.newLeads > 0)
      .sort((a, b) => b.newLeads - a.newLeads || a.name.localeCompare(b.name));
    const shown = top.slice(0, 3).map((a) => `${toGsm7(a.name)} ${a.newLeads}`);
    const rest = top.length - shown.length;
    if (input.pondLeads > 0) shown.push(`Pond ${input.pondLeads}`);
    if (shown.length) lines.push(shown.join(', ') + (rest > 0 ? `, +${rest} more` : ''));
  }

  const needing = others
    .filter((a) => a.untouched > 0 || a.stalled > 0)
    .sort((a, b) => (b.untouched + b.stalled) - (a.untouched + a.stalled) || a.name.localeCompare(b.name));

  if (needing.length) {
    lines.push('');
    lines.push(`Needs outreach: ${needing.length}`);
    for (const a of needing.slice(0, 3)) {
      const bits: string[] = [];
      if (a.untouched > 0) bits.push(`${plural(a.untouched, 'lead')} with no call or text`);
      if (a.stalled > 0) bits.push(`${plural(a.stalled, 'lead')} sitting in Lead stage`);
      lines.push(`${toGsm7(a.name)} - ${bits.join(', ')}`);
    }
    if (needing.length > 3) lines.push(`+${needing.length - 3} more in the app`);
  }

  // A quiet day still arrives. A brief that only shows up on bad days becomes a
  // thing people dread, and then ignore.
  if (totalNew === 0 && !needing.length) {
    return {
      body: `${head}\nNo new leads overnight and nothing needs outreach. All clear.`,
      segments: segments(`${head}\nNo new leads overnight and nothing needs outreach. All clear.`),
      skipReason: null,
    };
  }

  lines.push('');
  lines.push(app);

  let body = lines.join('\n');
  if (body.length > SMS_HARD_CAP) {
    // Trim whole lines from the roster rather than cutting mid-sentence, and
    // keep the link — the link is what makes truncation acceptable at all.
    const keep = lines.slice(0, -2);
    while (keep.length > 4 && [keep.slice(0, -1).join('\n'), '', app].join('\n').length > SMS_HARD_CAP) {
      keep.pop();
    }
    body = [...keep, '+more in the app', '', app].join('\n');
  }

  return { body, segments: segments(body), skipReason: null };
}
