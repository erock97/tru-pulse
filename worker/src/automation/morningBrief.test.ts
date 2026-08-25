// The fixtures here use real team names and real agent names from the live
// roster, because the encoding and truncation rules only bite on real data.
import { describe, it, expect } from 'vitest';
import {
  isGsm7, renderMorningBrief, segments, toGsm7, SMS_HARD_CAP, type BriefInput,
} from './morningBrief.js';

const base: BriefInput = {
  teamName: 'Costigan',
  dateLabel: 'Mon Aug 25',
  agents: [],
  pondLeads: 0,
  syncAgeHours: 0.5,
};

describe('the message stays cheap to send', () => {
  // One em-dash and every segment goes from 160 characters to 70, roughly
  // doubling what the message costs. This is the regression a well-meaning
  // copy edit reintroduces, so it is pinned rather than trusted.
  it('never emits a character that would double the cost', () => {
    const r = renderMorningBrief({
      ...base,
      agents: [
        { name: 'Ana W.', newLeads: 3, untouched: 2, stalled: 0 },
        { name: 'Marcus R.', newLeads: 2, untouched: 0, stalled: 1 },
        { name: 'Dana C.', newLeads: 1, untouched: 1, stalled: 0 },
      ],
      pondLeads: 1,
    });
    expect(isGsm7(r.body), `not GSM-7: ${JSON.stringify(r.body)}`).toBe(true);
  });

  it('scrubs an accented or curly-quoted name instead of paying for it', () => {
    // A single agent called Renée would otherwise halve the room available to
    // everyone else in the same text.
    expect(toGsm7('Renée O’Brien')).toBe("Renee O'Brien");
    expect(toGsm7('Costigan — Group')).toBe('Costigan - Group');
    const r = renderMorningBrief({
      ...base, teamName: 'Costigan’s',
      agents: [{ name: 'Renée O’Brien', newLeads: 2, untouched: 1, stalled: 0 }],
    });
    expect(isGsm7(r.body)).toBe(true);
    expect(r.body).toContain("Renee O'Brien");
  });

  it('counts segments the way a carrier does', () => {
    expect(segments('a'.repeat(160))).toBe(1);
    expect(segments('a'.repeat(161))).toBe(2);
    expect(segments('a'.repeat(306))).toBe(2);
    // An em-dash is not in GSM-7, and one of them drops the whole message to 70
    // characters a segment. Note that é IS in GSM-7 and costs nothing extra —
    // the expensive characters are the typographic ones a writer reaches for,
    // not the accented ones.
    expect(isGsm7('é')).toBe(true);
    expect(isGsm7('—')).toBe(false);
    expect(segments('—'.repeat(70))).toBe(1);
    expect(segments('—'.repeat(71))).toBe(2);
    expect(segments('a'.repeat(159) + '—')).toBe(3);
  });

  it('never exceeds four segments, even for a very large team', () => {
    const agents = Array.from({ length: 40 }, (_, i) => ({
      name: `Agent ${String.fromCharCode(65 + (i % 26))}${i}.`,
      newLeads: (i % 4) + 1, untouched: (i % 3), stalled: (i % 2),
    }));
    const r = renderMorningBrief({ ...base, teamName: 'Signature Realty', agents });
    expect(r.body.length).toBeLessThanOrEqual(SMS_HARD_CAP);
    expect(r.segments).toBeLessThanOrEqual(4);
    // Truncation is only acceptable because the way to the rest survives it.
    expect(r.body).toContain('app.truhq.co/#/pulse');
  });
});

describe('no client’s customer is named over a carrier', () => {
  it('reports counts and the team’s own agents, never a lead', () => {
    const r = renderMorningBrief({
      ...base,
      agents: [{ name: 'Ana W.', newLeads: 3, untouched: 2, stalled: 0 }],
    });
    expect(r.body).toContain('Ana W.');
    expect(r.body).toContain('New leads (24h): 3');
    // Nothing in the renderer can emit a lead name: it is never passed one.
    expect(Object.keys(base)).not.toContain('leads');
  });
});

describe('stale data is held back rather than sent wrong', () => {
  it('sends nothing when the sync is far behind', () => {
    const r = renderMorningBrief({ ...base, syncAgeHours: 14 });
    expect(r.skipReason).toBe('stale_sync');
    expect(r.body).toContain('held back');
  });

  it('sends nothing when there has never been a sync at all', () => {
    // A team whose sync has never stamped is a team whose sync is failing, by
    // design - so "0 new leads" would be a lie rather than merely late.
    const r = renderMorningBrief({ ...base, syncAgeHours: null });
    expect(r.skipReason).toBe('stale_sync');
  });

  it('still sends when moderately behind, but says the age out loud', () => {
    const r = renderMorningBrief({
      ...base, syncAgeHours: 5,
      agents: [{ name: 'Ana W.', newLeads: 1, untouched: 0, stalled: 0 }],
    });
    expect(r.skipReason).toBeNull();
    expect(r.body).toContain('5h old');
  });

  it('says nothing about age when the data is fresh', () => {
    const r = renderMorningBrief({
      ...base, syncAgeHours: 0.4,
      agents: [{ name: 'Ana W.', newLeads: 1, untouched: 0, stalled: 0 }],
    });
    expect(r.body).not.toContain('old)');
  });
});

describe('a quiet day still arrives', () => {
  it('sends one short line rather than silence', () => {
    // Silence makes people wonder if it broke. This is 90 characters and it is
    // good news.
    const r = renderMorningBrief(base);
    expect(r.skipReason).toBeNull();
    expect(r.body).toContain('All clear');
    expect(r.segments).toBe(1);
  });

  it('is not "all clear" when nothing arrived but someone is behind', () => {
    const r = renderMorningBrief({
      ...base, agents: [{ name: 'Skip S.', newLeads: 0, untouched: 2, stalled: 0 }],
    });
    expect(r.body).not.toContain('All clear');
    expect(r.body).toContain('Needs outreach: 1');
  });
});

describe('the team leader is left out of their own brief', () => {
  // A team leader works leads themselves, often a lot of them, and that is not
  // what this message is for. It answers "who do I need to chase this morning",
  // and the answer is never yourself. Scott Moore holds more untouched leads
  // than his whole team put together.
  const agents = [
    { name: 'Scott M.', newLeads: 13, untouched: 10, stalled: 0 },
    { name: 'Angelica F.', newLeads: 2, untouched: 0, stalled: 0 },
    { name: 'Anthony T.', newLeads: 1, untouched: 0, stalled: 0 },
    { name: 'Cherelle P.', newLeads: 1, untouched: 0, stalled: 0 },
  ];
  const brief = () => renderMorningBrief({
    ...base, teamName: 'Scott Moore Group', agents, recipientName: 'Scott M.',
  });

  it('never names them, in the roster or anywhere else', () => {
    expect(brief().body).not.toContain('Scott M.');
  });

  it('says nothing about their own untouched leads', () => {
    expect(brief().body).not.toContain('Yours');
    expect(brief().body).not.toContain('10 leads');
  });

  it('still counts their leads in the day’s intake', () => {
    // The total is the team's intake and stays true. It is the one place they
    // appear, as a number rather than a name.
    expect(brief().body).toContain('New leads (24h): 17');
  });

  it('leaves the brief quiet when only the leader had anything to report', () => {
    const r = renderMorningBrief({
      ...base,
      agents: [{ name: 'Scott M.', newLeads: 0, untouched: 10, stalled: 4 }],
      recipientName: 'Scott M.',
    });
    expect(r.body).toContain('All clear');
    expect(r.skipReason).toBeNull();
  });

  it('still lists everyone else who needs chasing', () => {
    const r = renderMorningBrief({
      ...base,
      agents: [
        { name: 'Scott M.', newLeads: 0, untouched: 10, stalled: 0 },
        { name: 'Theresa M.', newLeads: 0, untouched: 1, stalled: 0 },
      ],
      recipientName: 'Scott M.',
    });
    expect(r.body).toContain('Needs outreach: 1');
    expect(r.body).toContain('Theresa M.');
    expect(r.body).not.toContain('Scott M.');
  });
});

describe('what a real morning actually looks like', () => {
  it('reads like something a person wrote', () => {
    const r = renderMorningBrief({
      teamName: 'Costigan',
      dateLabel: 'Mon Aug 25',
      pondLeads: 1,
      syncAgeHours: 0.3,
      agents: [
        { name: 'Ana W.', newLeads: 3, untouched: 0, stalled: 0 },
        { name: 'Marcus R.', newLeads: 2, untouched: 2, stalled: 0 },
        { name: 'Dana C.', newLeads: 1, untouched: 0, stalled: 1 },
      ],
    });
    expect(r.body).toBe(
      'TRU Pulse - Costigan - Mon Aug 25\n' +
      '\n' +
      'New leads (24h): 7\n' +
      'Ana W. 3, Marcus R. 2, Dana C. 1, Pond 1\n' +
      '\n' +
      'Needs outreach: 2\n' +
      'Marcus R. - 2 leads with no call or text\n' +
      'Dana C. - 1 lead sitting in Lead stage\n' +
      '\n' +
      'app.truhq.co/#/pulse',
    );
    expect(r.segments).toBe(2);
  });
});
