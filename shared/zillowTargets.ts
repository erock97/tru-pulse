// The Zillow target/pacing push — the contract between fub-weekly-reports
// (an external sender, via the Worker's POST /zillow/targets) and the
// admin-only targets dashboard.
//
// Pure validation only. No imports, no I/O, so the Worker (ingest) and the
// web app (rendering) can never drift, same reasoning as shared/coachBrief.ts.

export type ZillowMetricKey = 'six_month' | 'zhl';

export interface ZillowMetricValue {
  metric: ZillowMetricKey;
  targetValue: number;
  actualValue: number;
  unit: string;               // 'count' | 'currency' | 'pct'
  periodLabel?: string;
  periodStart?: string;       // YYYY-MM-DD
  periodEnd?: string;         // YYYY-MM-DD
}

export interface ZillowTargetsPush {
  teamSlug: string;
  capturedAt: string;         // ISO timestamp, when the scrape ran
  sourceRefreshDate?: string; // YYYY-MM-DD, the date Zillow's own report says it last refreshed
  metrics: ZillowMetricValue[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const METRIC_KEYS: ReadonlySet<string> = new Set(['six_month', 'zhl']);
const UNITS: ReadonlySet<string> = new Set(['count', 'currency', 'pct']);
const MAX_METRICS = 8; // room for a metric or two more later without a schema fight

type Raw = Record<string, unknown>;

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
function asFiniteNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export type ZillowTargetsValidation =
  | { ok: true; push: ZillowTargetsPush }
  | { ok: false; errors: string[] };

export function validateZillowTargets(raw: unknown): ZillowTargetsValidation {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['payload must be a JSON object'] };
  }
  const o = raw as Raw;

  const teamSlug = asString(o.teamSlug);
  if (!teamSlug || !SLUG_RE.test(teamSlug)) {
    errors.push('teamSlug is required and must be a simple slug (letters, digits, dashes)');
  }
  const capturedAt = asString(o.capturedAt);
  if (!capturedAt || Number.isNaN(Date.parse(capturedAt))) {
    errors.push('capturedAt is required and must be a valid timestamp');
  }
  const sourceRefreshDate = asString(o.sourceRefreshDate);
  if (sourceRefreshDate && !DATE_RE.test(sourceRefreshDate)) {
    errors.push('sourceRefreshDate must be YYYY-MM-DD');
  }

  const metricsRaw = Array.isArray(o.metrics) ? o.metrics : null;
  if (!metricsRaw || metricsRaw.length === 0) errors.push('metrics[] is required and must not be empty');
  if (metricsRaw && metricsRaw.length > MAX_METRICS) errors.push(`metrics[] exceeds ${MAX_METRICS}`);

  const seen = new Set<string>();
  const metrics: ZillowMetricValue[] = (metricsRaw ?? []).flatMap((m, i) => {
    if (!m || typeof m !== 'object') {
      errors.push(`metrics[${i}] must be an object`);
      return [];
    }
    const mo = m as Raw;
    const metric = asString(mo.metric);
    if (!metric || !METRIC_KEYS.has(metric)) {
      errors.push(`metrics[${i}].metric must be one of: ${[...METRIC_KEYS].join(', ')}`);
      return [];
    }
    if (seen.has(metric)) {
      errors.push(`metrics[${i}].metric "${metric}" is duplicated`);
      return [];
    }
    const targetValue = asFiniteNumber(mo.targetValue);
    if (targetValue === undefined) errors.push(`metrics[${i}].targetValue must be a finite number`);
    const actualValue = asFiniteNumber(mo.actualValue);
    if (actualValue === undefined) errors.push(`metrics[${i}].actualValue must be a finite number`);
    const unit = asString(mo.unit) ?? 'count';
    if (!UNITS.has(unit)) errors.push(`metrics[${i}].unit must be one of: ${[...UNITS].join(', ')}`);
    const periodStart = asString(mo.periodStart);
    if (periodStart && !DATE_RE.test(periodStart)) errors.push(`metrics[${i}].periodStart must be YYYY-MM-DD`);
    const periodEnd = asString(mo.periodEnd);
    if (periodEnd && !DATE_RE.test(periodEnd)) errors.push(`metrics[${i}].periodEnd must be YYYY-MM-DD`);
    if (targetValue === undefined || actualValue === undefined || !UNITS.has(unit)) return [];

    seen.add(metric);
    const value: ZillowMetricValue = { metric: metric as ZillowMetricKey, targetValue, actualValue, unit };
    const periodLabel = asString(mo.periodLabel);
    if (periodLabel) value.periodLabel = periodLabel;
    if (periodStart) value.periodStart = periodStart;
    if (periodEnd) value.periodEnd = periodEnd;
    return [value];
  });

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    push: {
      teamSlug: teamSlug as string,
      capturedAt: capturedAt as string,
      sourceRefreshDate,
      metrics,
    },
  };
}

/** Percent complete for a progress bar, clamped to [0, 100]. A zero or
 *  negative target has no meaningful percentage — callers should treat that
 *  as "no data" rather than divide by zero. */
export function percentToTarget(actual: number, target: number): number | null {
  if (!(target > 0)) return null;
  return Math.max(0, Math.min(100, (actual / target) * 100));
}

export const METRIC_LABELS: Record<ZillowMetricKey, string> = {
  six_month: '6-Month Target',
  zhl: 'ZHL Target',
};
