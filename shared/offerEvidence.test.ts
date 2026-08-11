import { expect, test } from 'vitest';
import { explainOfferEvidence } from './offerEvidence';

// Every string this produces is read by a team leader mid-coaching-conversation.
// It must say WHY a number is assumed, in plain English — never just "assumed".

test('all watched happen → measured, no caution', () => {
  const x = explainOfferEvidence({ observedLive: 10, observedBaseline: 0, inferredFromClosing: 0 });
  expect(x.confidence).toBe('measured');
  expect(x.total).toBe(10);
  expect(x.caution).toBeNull();
  expect(x.lines).toHaveLength(1);
  expect(x.lines[0].plain).toMatch(/watched/i);
});

test('all inferred → mostly-assumed, and the caution explains the undercount', () => {
  const x = explainOfferEvidence({ observedLive: 0, observedBaseline: 0, inferredFromClosing: 41 });
  expect(x.confidence).toBe('mostly-assumed');
  // The reason must name the cause: the agent never used the stage.
  expect(x.lines[0].plain).toMatch(/never moved|didn't move|did not move/i);
  // And must explain the consequence: lost offers are invisible, so this reads low.
  expect(x.caution).toMatch(/lost|fell through|didn't work out/i);
  expect(x.caution).toMatch(/higher/i);
});

test('a lead cannot be counted twice across buckets', () => {
  const x = explainOfferEvidence({ observedLive: 3, observedBaseline: 2, inferredFromClosing: 5 });
  expect(x.total).toBe(10);
  expect(x.lines.reduce((s, l) => s + l.count, 0)).toBe(10);
});

test('mixed evidence lands in the middle', () => {
  const x = explainOfferEvidence({ observedLive: 6, observedBaseline: 0, inferredFromClosing: 4 });
  expect(x.confidence).toBe('mixed');
  expect(x.caution).not.toBeNull();
});

test('a mostly-measured rate is not flagged just because one lead was assumed', () => {
  const x = explainOfferEvidence({ observedLive: 19, observedBaseline: 0, inferredFromClosing: 1 });
  expect(x.confidence).toBe('measured');
  expect(x.caution).toBeNull();
});

test('baseline offers explain that the date is approximate, not that the offer is doubtful', () => {
  const x = explainOfferEvidence({ observedLive: 0, observedBaseline: 7, inferredFromClosing: 0 });
  const line = x.lines.find((l) => l.count === 7)!;
  expect(line.plain).toMatch(/set up|first|baseline/i);
  expect(line.plain).toMatch(/when|date/i);
  // A real offer, just imprecisely dated — must not be described as assumed.
  expect(line.plain).not.toMatch(/assume/i);
});

test('nothing counted yet reads as no data, not as a bad rate', () => {
  const x = explainOfferEvidence({ observedLive: 0, observedBaseline: 0, inferredFromClosing: 0 });
  expect(x.total).toBe(0);
  expect(x.confidence).toBe('no-data');
  expect(x.lines).toEqual([]);
  expect(x.headline).toMatch(/no offers/i);
});

test('the headline states the split without jargon', () => {
  const x = explainOfferEvidence({ observedLive: 1, observedBaseline: 0, inferredFromClosing: 41 });
  expect(x.headline).toContain('42');
  expect(x.headline).toMatch(/1/);
  expect(x.headline).toMatch(/41/);
  // No internal vocabulary anywhere in leader-facing copy.
  const all = [x.headline, x.caution ?? '', ...x.lines.map((l) => l.plain)].join(' ');
  expect(all).not.toMatch(/date_source|stage_class|person_stage_log|seed|backfill|isOfferPlus/);
});

// ── The DISPLAYED offer rate (current-stage baseline, Eric 2026-07-07) ───────
import { currentStageOfferEvidence, explainCurrentStageOffers } from './offerEvidence';

const L = (id: number, stage: string) => ({ fub_person_id: id, stage });

test('current stage: a lead sitting at the offer stage is visible, not assumed', () => {
  const e = currentStageOfferEvidence([L(1, 'Submitting Offers')], new Map());
  expect(e).toEqual({ visibleAtOfferStage: 1, assumedFromAdvance: 0, knownButNotCounted: 0, fellBackFromContract: 0 });
});

test('current stage: a closed or under-contract lead is assumed from the advance', () => {
  const e = currentStageOfferEvidence([L(1, 'Closed'), L(2, 'Under Contract')], new Map());
  expect(e).toEqual({ visibleAtOfferStage: 0, assumedFromAdvance: 2, knownButNotCounted: 0, fellBackFromContract: 0 });
});

test('current stage: a recorded offer that fell back is counted as known-but-missing', () => {
  // We watched this lead make an offer; it is now parked in Nurture, so the
  // current-stage rule drops it from the rate entirely.
  const e = currentStageOfferEvidence([L(1, 'Nurture')], new Map([[1, 'offer' as const]]));
  expect(e).toEqual({ visibleAtOfferStage: 0, assumedFromAdvance: 0, knownButNotCounted: 1, fellBackFromContract: 0 });
});

test('current stage: a recorded offer that went on to close is not double-counted', () => {
  const e = currentStageOfferEvidence([L(1, 'Closed')], new Map([[1, 'offer' as const]]));
  expect(e.assumedFromAdvance + e.visibleAtOfferStage).toBe(1);
  expect(e.knownButNotCounted).toBe(0);
});

test('current stage: leads that never reached an offer are ignored entirely', () => {
  const e = currentStageOfferEvidence([L(1, 'Lead'), L(2, 'Attempted Contact')], new Map());
  expect(e).toEqual({ visibleAtOfferStage: 0, assumedFromAdvance: 0, knownButNotCounted: 0, fellBackFromContract: 0 });
});

test('Costigan shape: 1 visible, 79 assumed — flagged and explained', () => {
  const leads = [
    L(1, 'Submitting Offers'),
    ...Array.from({ length: 69 }, (_, i) => L(i + 2, 'Closed')),
    ...Array.from({ length: 10 }, (_, i) => L(i + 200, 'Under Contract')),
  ];
  const e = currentStageOfferEvidence(leads, new Map());
  expect(e).toEqual({ visibleAtOfferStage: 1, assumedFromAdvance: 79, knownButNotCounted: 0, fellBackFromContract: 0 });

  const x = explainCurrentStageOffers(e);
  expect(x.confidence).toBe('mostly-assumed');
  expect(x.headline).toContain('80');
  // Must name the cause and the consequence, in plain words.
  expect(x.lines.some((l) => /never moved|did not move/i.test(l.plain))).toBe(true);
  expect(x.caution).toMatch(/higher/i);
});

test('Signature shape: known-but-missing offers are called out with their own line', () => {
  const leads = [
    ...Array.from({ length: 118 }, (_, i) => L(i + 1, 'Submitting offers')),
    ...Array.from({ length: 201 }, (_, i) => L(i + 500, 'Closed')),
    ...Array.from({ length: 8 }, (_, i) => L(i + 900, 'Nurture')),
  ];
  const recorded = new Map(Array.from({ length: 8 }, (_, i) => [i + 900, 'offer' as const]));
  const e = currentStageOfferEvidence(leads, recorded);
  expect(e.visibleAtOfferStage).toBe(118);
  expect(e.assumedFromAdvance).toBe(201);
  expect(e.knownButNotCounted).toBe(8);

  const x = explainCurrentStageOffers(e);
  const line = x.lines.find((l) => l.count === 8);
  expect(line).toBeDefined();
  expect(line!.plain).toMatch(/not counted|isn't counted|excluded|left out/i);
});

test('displayed-offer copy carries no internal vocabulary', () => {
  const x = explainCurrentStageOffers({ visibleAtOfferStage: 2, assumedFromAdvance: 9, knownButNotCounted: 3 });
  const all = [x.headline, x.caution ?? '', ...x.lines.map((l) => l.plain)].join(' ');
  expect(all).not.toMatch(/stage_class|date_source|person_stage_log|isOfferPlus|carry-forward/);
});

// ── Anything that moved BACKWARD from offer-or-beyond must be flagged ────────
// Not just offer → nurture. A lead that reached under contract and then died
// certainly had an offer, and the current-stage rule drops it just the same.
import { recordedOfferPersons } from './offerEvidence';

test('recorded set includes contract and closed, not just the offer stage', () => {
  const m = recordedOfferPersons([
    { fub_person_id: 1, stage_class: 'offer' },
    { fub_person_id: 2, stage_class: 'uc' },
    { fub_person_id: 3, stage_class: 'closed' },
    { fub_person_id: 4, stage_class: 'other' },
  ]);
  expect(m.get(1)).toBe('offer');
  expect(m.get(2)).toBe('contract');
  expect(m.get(3)).toBe('contract');
  expect(m.has(4)).toBe(false);
});

test('reaching contract outranks an earlier offer for the same lead', () => {
  const m = recordedOfferPersons([
    { fub_person_id: 1, stage_class: 'offer' },
    { fub_person_id: 1, stage_class: 'uc' },
  ]);
  expect(m.get(1)).toBe('contract');
});

test('a deal that reached contract then fell back is flagged, and called out separately', () => {
  const e = currentStageOfferEvidence(
    [L(1, 'Nurture'), L(2, 'Nurture')],
    recordedOfferPersons([
      { fub_person_id: 1, stage_class: 'uc' },     // deal fell apart
      { fub_person_id: 2, stage_class: 'offer' },  // offer lost
    ]),
  );
  expect(e.knownButNotCounted).toBe(2);
  expect(e.fellBackFromContract).toBe(1);
});

test('Signature shape: 17 fell back, 10 of them from contract — both stated', () => {
  const leads = [
    ...Array.from({ length: 118 }, (_, i) => L(i + 1, 'Submitting offers')),
    ...Array.from({ length: 201 }, (_, i) => L(i + 500, 'Closed')),
    ...Array.from({ length: 17 }, (_, i) => L(i + 900, 'Nurture')),
  ];
  const rows = [
    ...Array.from({ length: 10 }, (_, i) => ({ fub_person_id: i + 900, stage_class: 'uc' })),
    ...Array.from({ length: 7 }, (_, i) => ({ fub_person_id: i + 910, stage_class: 'offer' })),
  ];
  const e = currentStageOfferEvidence(leads, recordedOfferPersons(rows));
  expect(e.knownButNotCounted).toBe(17);
  expect(e.fellBackFromContract).toBe(10);

  const x = explainCurrentStageOffers(e);
  const line = x.lines.find((l) => l.count === 17)!;
  expect(line.plain).toMatch(/17/);
  // The stronger fact — a deal that fell apart — must be said, not buried.
  expect(line.plain).toMatch(/10/);
  expect(line.plain).toMatch(/contract/i);
});

test('a lead still sitting at contract is not treated as having fallen back', () => {
  const e = currentStageOfferEvidence(
    [L(1, 'Under contract')],
    recordedOfferPersons([{ fub_person_id: 1, stage_class: 'uc' }]),
  );
  expect(e.knownButNotCounted).toBe(0);
  expect(e.fellBackFromContract).toBe(0);
  expect(e.assumedFromAdvance).toBe(1);
});
