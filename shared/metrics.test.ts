import { expect, test } from 'vitest';
import {
  computeWindowedMetrics,
  computeAllTimeConversion,
  computeAllTimeConversionBySource,
  computeAllTimeOfferRatio,
  computeRangeMetrics,
  computeAgentTrends,
  windowStartMs,
  type MetricsLead,
  type MetricsStageHit,
} from './metrics';

const NOW = Date.parse('2026-07-07T12:00:00Z');
const days = (n: number) => n * 86400_000;
const iso = (ms: number) => new Date(ms).toISOString();

function lead(over: Partial<MetricsLead> & { fub_person_id: number }): MetricsLead {
  return { source_family: 'Zillow', fub_created: iso(NOW - days(10)), assigned_to: 'Trevor Holland', ...over };
}
function hit(over: Partial<MetricsStageHit> & { fub_person_id: number }): MetricsStageHit {
  return { stage_class: 'offer', changed_at: iso(NOW - days(1)), date_source: 'live', agent_name: 'Trevor Holland', ...over };
}

test('windowStartMs: mtd = start of current month; day windows = now - N days', () => {
  const mtd = windowStartMs('mtd', NOW);
  const d = new Date(NOW);
  expect(mtd).toBe(new Date(d.getFullYear(), d.getMonth(), 1).getTime());
  expect(windowStartMs('7', NOW)).toBe(NOW - days(7));
  expect(windowStartMs('365', NOW)).toBe(NOW - days(365));
});

test('direct-jump-to-UC counts as offer-reached — never 0', () => {
  const leads = [lead({ fub_person_id: 1 })];
  const hits = [hit({ fub_person_id: 1, stage_class: 'uc', changed_at: iso(NOW - days(1)) })];
  const m = computeWindowedMetrics(leads, hits, { window: '90', now: NOW });
  expect(m.offersReached).toBe(1); // offer-or-beyond: a UC hit alone still counts
  expect(m.underContractOrClosed).toBe(1);
});

test('offer then closed for the same person is ONE distinct offer credit, not two', () => {
  const leads = [lead({ fub_person_id: 1 })];
  const hits = [
    hit({ fub_person_id: 1, stage_class: 'offer', changed_at: iso(NOW - days(5)) }),
    hit({ fub_person_id: 1, stage_class: 'closed', changed_at: iso(NOW - days(1)) }),
  ];
  const m = computeWindowedMetrics(leads, hits, { window: '90', now: NOW });
  expect(m.offersReached).toBe(1);
  expect(m.underContractOrClosed).toBe(1);
});

test('THE ASYMMETRY: a lead created outside every window, achieving in-window, counts in the numerator but not the denominator', () => {
  const leads = [lead({ fub_person_id: 1, fub_created: iso(NOW - days(600)) })]; // 600 days old — outside all windows
  const hits = [hit({ fub_person_id: 1, stage_class: 'uc', changed_at: iso(NOW - days(2)) })]; // achieved 2 days ago
  const m = computeWindowedMetrics(leads, hits, { window: '7', now: NOW });
  expect(m.totalLeads).toBe(0); // excluded from the 7d denominator — created far outside the window
  expect(m.offersReached).toBe(1); // still counted — achievement windowed independently
  expect(m.underContractOrClosed).toBe(1);
});

test('a dateless lead (no fub_created) is excluded from totals but still counted as a closing when it achieves', () => {
  const leads = [lead({ fub_person_id: 1, fub_created: null })];
  const hits = [hit({ fub_person_id: 1, stage_class: 'closed', changed_at: iso(NOW - days(1)) })];
  const m = computeWindowedMetrics(leads, hits, { window: '90', now: NOW });
  expect(m.totalLeads).toBe(0);
  expect(m.underContractOrClosed).toBe(1);
  expect(m.offersReached).toBe(1);
});

test('seed rows are excluded from windowed numerators even if changed_at happens to be set', () => {
  const leads = [lead({ fub_person_id: 1 })];
  const hits = [hit({ fub_person_id: 1, stage_class: 'closed', date_source: 'seed', changed_at: iso(NOW - days(1)) })];
  const m = computeWindowedMetrics(leads, hits, { window: '90', now: NOW });
  expect(m.underContractOrClosed).toBe(0);
  expect(m.offersReached).toBe(0);
});

test('seed rows (dateless, null changed_at) are excluded from windowed numerators but usable in the all-time conversion baseline', () => {
  const leads = [lead({ fub_person_id: 1 }), lead({ fub_person_id: 2 })];
  const hits = [hit({ fub_person_id: 1, stage_class: 'closed', date_source: 'seed', changed_at: null })];
  const windowed = computeWindowedMetrics(leads, hits, { window: '365', now: NOW });
  expect(windowed.underContractOrClosed).toBe(0); // seed excluded from windowed numerator
  const allTime = computeAllTimeConversion(leads, hits);
  expect(allTime.allTimeClosings).toBe(1); // but usable in the unwindowed all-time baseline
  expect(allTime.n).toBe(2); // 2 leads / 1 closing
  expect(allTime.ratioLabel).toBe('1 : 2');
});

test('a lead created before the window but past the window start is included in the denominator (boundary sanity)', () => {
  const leads = [lead({ fub_person_id: 1, fub_created: iso(NOW - days(5)) })];
  const m = computeWindowedMetrics(leads, [], { window: '7', now: NOW });
  expect(m.totalLeads).toBe(1);
});

test('a lead created just outside a 7d window is excluded from the 7d denominator', () => {
  const leads = [lead({ fub_person_id: 1, fub_created: iso(NOW - days(8)) })];
  const m = computeWindowedMetrics(leads, [], { window: '7', now: NOW });
  expect(m.totalLeads).toBe(0);
});

test('conversion ratio math: N = round(leadCount / closingCount), null when 0 closings', () => {
  const leads = Array.from({ length: 21 }, (_, i) => lead({ fub_person_id: i + 1 }));
  const hits = [hit({ fub_person_id: 1, stage_class: 'closed', changed_at: iso(NOW - days(1)) })];
  const r = computeAllTimeConversion(leads, hits);
  expect(r.allTimeLeads).toBe(21);
  expect(r.allTimeClosings).toBe(1);
  expect(r.n).toBe(21); // round(21/1)
  expect(r.ratioLabel).toBe('1 : 21');

  const noClosings = computeAllTimeConversion(leads, []);
  expect(noClosings.n).toBeNull();
  expect(noClosings.ratioLabel).toBe('—');
});

test('untracked sources (no source_family) never count toward leads or closings, anywhere', () => {
  const leads = [lead({ fub_person_id: 1, source_family: null })];
  const hits = [hit({ fub_person_id: 1, stage_class: 'closed', changed_at: iso(NOW - days(1)) })];
  const windowed = computeWindowedMetrics(leads, hits, { window: '90', now: NOW });
  expect(windowed.totalLeads).toBe(0);
  expect(windowed.underContractOrClosed).toBe(0); // the hit's lead is untracked, so it's excluded from the numerator too
  const allTime = computeAllTimeConversion(leads, hits);
  expect(allTime.allTimeLeads).toBe(0);
  expect(allTime.allTimeClosings).toBe(0);
});

test('per-agent attribution: achievement credited to the agent stamped on the log row, not the lead\'s current assignee', () => {
  const leads = [lead({ fub_person_id: 1, assigned_to: 'Dana Cole' })]; // currently assigned to Dana
  const hits = [hit({ fub_person_id: 1, stage_class: 'uc', agent_name: 'Trevor Holland', changed_at: iso(NOW - days(1)) })]; // achieved under Trevor
  const m = computeWindowedMetrics(leads, hits, { window: '90', now: NOW });
  const dana = m.byAgent.find((a) => a.agent === 'Dana Cole');
  const trevor = m.byAgent.find((a) => a.agent === 'Trevor Holland');
  expect(dana?.totalLeads).toBe(1);
  expect(dana?.underContractOrClosed ?? 0).toBe(0);
  expect(trevor?.underContractOrClosed).toBe(1);
  expect(trevor?.totalLeads ?? 0).toBe(0); // Trevor has no leads currently assigned in this fixture
});

test('per-agent: agent_user_id is preferred as the stable identity when present (merges by name when both are given)', () => {
  const leads = [lead({ fub_person_id: 1, assigned_to: 'Priya Nair' })];
  const hits = [hit({ fub_person_id: 1, stage_class: 'offer', agent_user_id: 42, agent_name: 'Priya Nair', changed_at: iso(NOW - days(1)) })];
  const m = computeWindowedMetrics(leads, hits, { window: '90', now: NOW });
  const priya = m.byAgent.find((a) => a.agent === 'Priya Nair');
  expect(priya?.totalLeads).toBe(1);
  expect(priya?.offersReached).toBe(1);
  expect(m.byAgent).toHaveLength(1); // no duplicate row for the same agent
});

test('source-filter (enabledSources) narrows both the denominator and the numerator', () => {
  const leads = [
    lead({ fub_person_id: 1, source_family: 'Zillow' }),
    lead({ fub_person_id: 2, source_family: 'Facebook' }),
  ];
  const hits = [
    hit({ fub_person_id: 1, stage_class: 'closed', changed_at: iso(NOW - days(1)) }),
    hit({ fub_person_id: 2, stage_class: 'closed', changed_at: iso(NOW - days(1)) }),
  ];
  const all = computeWindowedMetrics(leads, hits, { window: '90', now: NOW });
  expect(all.totalLeads).toBe(2);
  expect(all.underContractOrClosed).toBe(2);

  const filtered = computeWindowedMetrics(leads, hits, { window: '90', now: NOW, enabledSources: ['Zillow'] });
  expect(filtered.totalLeads).toBe(1);
  expect(filtered.underContractOrClosed).toBe(1); // person 2's hit is excluded — their lead's source isn't enabled
});

test('per-source all-time conversion uses the same unwindowed baseline, one ratio per tracked source', () => {
  const leads = [
    ...Array.from({ length: 10 }, (_, i) => lead({ fub_person_id: i + 1, source_family: 'Zillow' })),
    ...Array.from({ length: 5 }, (_, i) => lead({ fub_person_id: 100 + i, source_family: 'Facebook' })),
  ];
  const hits = [
    hit({ fub_person_id: 1, stage_class: 'closed', changed_at: iso(NOW - days(1)) }),
    hit({ fub_person_id: 100, stage_class: 'closed', changed_at: iso(NOW - days(1)) }),
  ];
  const bySource = computeAllTimeConversionBySource(leads, hits);
  expect(bySource.Zillow.ratioLabel).toBe('1 : 10');
  expect(bySource.Facebook.ratioLabel).toBe('1 : 5');
});

test('raw stage / raw source fallback: resolves stage_class and source_family via shared/flags when precomputed fields are absent', () => {
  const leads: MetricsLead[] = [{ fub_person_id: 1, source: 'Zillow Flex', fub_created: iso(NOW - days(1)) }];
  const hits: MetricsStageHit[] = [{ fub_person_id: 1, stage: 'Under Contract', changed_at: iso(NOW - days(1)), date_source: 'live' }];
  const m = computeWindowedMetrics(leads, hits, { window: '7', now: NOW });
  expect(m.totalLeads).toBe(1);
  expect(m.underContractOrClosed).toBe(1);
  expect(m.offersReached).toBe(1); // uc is offer-or-beyond
});

// ═══════════════════════════════════════════════════════════════════════════
// §3a — computeAllTimeOfferRatio: stable all-time 1:N, mirrors computeAllTimeConversion
// ═══════════════════════════════════════════════════════════════════════════

test('offer 1:N: direct-to-UC counts toward the offer numerator (never 0 / "1:0")', () => {
  const leads = Array.from({ length: 8 }, (_, i) => lead({ fub_person_id: i + 1 }));
  const hits = [hit({ fub_person_id: 1, stage_class: 'uc', changed_at: iso(NOW - days(1)) })]; // skipped straight to UC
  const r = computeAllTimeOfferRatio(leads, hits);
  expect(r.allTimeLeads).toBe(8);
  expect(r.allTimeClosings).toBe(1); // reused ConversionResult shape: allTimeClosings = the numerator count here
  expect(r.n).toBe(8);
  expect(r.ratioLabel).toBe('1 : 8');
});

test('offer 1:N: 0 offers renders "—", not a windowed % and not 1:0', () => {
  const leads = Array.from({ length: 5 }, (_, i) => lead({ fub_person_id: i + 1 }));
  const r = computeAllTimeOfferRatio(leads, []);
  expect(r.n).toBeNull();
  expect(r.ratioLabel).toBe('—');
});

test('offer 1:N is ALL-TIME: usable seed (dateless) offer hits still count in the baseline', () => {
  const leads = [lead({ fub_person_id: 1 }), lead({ fub_person_id: 2 })];
  const hits = [hit({ fub_person_id: 1, stage_class: 'offer', date_source: 'seed', changed_at: null })];
  const r = computeAllTimeOfferRatio(leads, hits);
  expect(r.n).toBe(2); // 2 leads / 1 offer — seed hit counted (all-time, not windowed)
  expect(r.ratioLabel).toBe('1 : 2');
});

test('offer 1:N respects the source filter, same as conversion', () => {
  const leads = [
    lead({ fub_person_id: 1, source_family: 'Zillow' }),
    lead({ fub_person_id: 2, source_family: 'Facebook' }),
  ];
  const hits = [
    hit({ fub_person_id: 1, stage_class: 'offer', changed_at: iso(NOW - days(1)) }),
    hit({ fub_person_id: 2, stage_class: 'offer', changed_at: iso(NOW - days(1)) }),
  ];
  const filtered = computeAllTimeOfferRatio(leads, hits, ['Zillow']);
  expect(filtered.allTimeLeads).toBe(1);
  expect(filtered.n).toBe(1);
});

// ═══════════════════════════════════════════════════════════════════════════
// §3b — computeRangeMetrics: an explicit [startMs, endMs) bounded range
// ═══════════════════════════════════════════════════════════════════════════

test('computeRangeMetrics: a hit before the range start is excluded', () => {
  const leads = [lead({ fub_person_id: 1 })];
  const hits = [hit({ fub_person_id: 1, stage_class: 'offer', changed_at: iso(NOW - days(20)) })];
  const r = computeRangeMetrics(leads, hits, { startMs: NOW - days(14), endMs: NOW });
  expect(r.offersReached).toBe(0);
});

test('computeRangeMetrics: a hit at/after the range end is excluded (half-open [start, end))', () => {
  const leads = [lead({ fub_person_id: 1 }), lead({ fub_person_id: 2 })];
  const hits = [
    hit({ fub_person_id: 1, stage_class: 'offer', changed_at: iso(NOW - days(14)) }), // == endMs boundary below → excluded
    hit({ fub_person_id: 2, stage_class: 'offer', changed_at: iso(NOW - days(15)) }), // inside range → included
  ];
  const r = computeRangeMetrics(leads, hits, { startMs: NOW - days(28), endMs: NOW - days(14) });
  expect(r.offersReached).toBe(1);
});

test('computeRangeMetrics: seed hits are excluded even inside the range', () => {
  const leads = [lead({ fub_person_id: 1 })];
  const hits = [hit({ fub_person_id: 1, stage_class: 'closed', date_source: 'seed', changed_at: iso(NOW - days(5)) })];
  const r = computeRangeMetrics(leads, hits, { startMs: NOW - days(14), endMs: NOW });
  expect(r.underContractOrClosed).toBe(0);
});

// ═══════════════════════════════════════════════════════════════════════════
// §3b — computeAgentTrends: ▲/▼ vs the prior equal-length period
// ═══════════════════════════════════════════════════════════════════════════

test('computeAgentTrends: an agent doing MORE this period than last gets a positive (▲) delta', () => {
  const leads = [lead({ fub_person_id: 1 }), lead({ fub_person_id: 2 })];
  const hits = [
    // current 14d window: 3 offers for Ana
    hit({ fub_person_id: 1, stage_class: 'offer', agent_name: 'Ana Ruiz', changed_at: iso(NOW - days(1)) }),
    hit({ fub_person_id: 1, stage_class: 'uc', agent_name: 'Ana Ruiz', changed_at: iso(NOW - days(2)) }),
    hit({ fub_person_id: 2, stage_class: 'offer', agent_name: 'Ana Ruiz', changed_at: iso(NOW - days(3)) }),
    // prior 14d window (14-28 days ago): 1 offer for Ana
    hit({ fub_person_id: 1, stage_class: 'offer', agent_name: 'Ana Ruiz', changed_at: iso(NOW - days(20)) }),
  ];
  const trends = computeAgentTrends(leads, hits, { window: '14', now: NOW });
  const ana = trends.find((t) => t.agent === 'Ana Ruiz')!;
  expect(ana.offersReached).toBe(2); // fub_person_id 1 and 2 both reached offer-or-beyond this window
  expect(ana.closings).toBe(1);
  expect(ana.offersDelta).toBeGreaterThan(0); // 2 current vs 1 prior → ▲
});

test('computeAgentTrends: an agent doing LESS this period than last gets a negative (▼) delta', () => {
  const leads = [lead({ fub_person_id: 1 }), lead({ fub_person_id: 2 }), lead({ fub_person_id: 3 })];
  const hits = [
    // current 14d: 1 offer for Ben
    hit({ fub_person_id: 1, stage_class: 'offer', agent_name: 'Ben Cho', changed_at: iso(NOW - days(1)) }),
    // prior 14d: 3 offers for Ben
    hit({ fub_person_id: 1, stage_class: 'offer', agent_name: 'Ben Cho', changed_at: iso(NOW - days(15)) }),
    hit({ fub_person_id: 2, stage_class: 'offer', agent_name: 'Ben Cho', changed_at: iso(NOW - days(16)) }),
    hit({ fub_person_id: 3, stage_class: 'offer', agent_name: 'Ben Cho', changed_at: iso(NOW - days(17)) }),
  ];
  const trends = computeAgentTrends(leads, hits, { window: '14', now: NOW });
  const ben = trends.find((t) => t.agent === 'Ben Cho')!;
  expect(ben.offersReached).toBe(1);
  expect(ben.offersDelta).toBeLessThan(0); // 1 current vs 3 prior → ▼
  expect(ben.offersDelta).toBe(-2);
});

test('computeAgentTrends: equal current vs prior yields a flat (zero) delta', () => {
  const leads = [lead({ fub_person_id: 1 }), lead({ fub_person_id: 2 })];
  const hits = [
    hit({ fub_person_id: 1, stage_class: 'offer', agent_name: 'Cara Diaz', changed_at: iso(NOW - days(1)) }),
    hit({ fub_person_id: 2, stage_class: 'offer', agent_name: 'Cara Diaz', changed_at: iso(NOW - days(2)) }),
    hit({ fub_person_id: 1, stage_class: 'offer', agent_name: 'Cara Diaz', changed_at: iso(NOW - days(15)) }),
    hit({ fub_person_id: 2, stage_class: 'offer', agent_name: 'Cara Diaz', changed_at: iso(NOW - days(16)) }),
  ];
  const trends = computeAgentTrends(leads, hits, { window: '14', now: NOW });
  const cara = trends.find((t) => t.agent === 'Cara Diaz')!;
  expect(cara.offersReached).toBe(2);
  expect(cara.offersDelta).toBe(0); // flat — renders "—" in the UI
});

test('computeAgentTrends: seed hits are excluded from both the current and prior windowed counts', () => {
  const leads = [lead({ fub_person_id: 1 })];
  const hits = [hit({ fub_person_id: 1, stage_class: 'closed', agent_name: 'Dee Park', date_source: 'seed', changed_at: iso(NOW - days(2)) })];
  const trends = computeAgentTrends(leads, hits, { window: '14', now: NOW });
  const dee = trends.find((t) => t.agent === 'Dee Park');
  expect(dee).toBeUndefined(); // no windowed hits at all for Dee — seed is excluded, agent never appears
});
