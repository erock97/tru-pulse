// THE PROSPECTING GATE — agent-assist, channel-aware compliance.
// Ported from the Voice ISA repo (src/compliance/prospectGate.ts), verified there
// by test/prospectGate.test.ts. Self-contained (time helpers inlined) and PURE —
// no I/O — so it can be unit-tested and can never regress silently.
//
// AGENT-ASSIST: a human always dials. Verdict is three-way:
//   allow  — cleared; the agent may dial.
//   manual — human-dial-BY-HAND only, with acknowledgment; no power/AI dialer.
//   block  — do not contact.
// Cold channels (circle/expired/fsbo) have NO warm basis — DNC is the gate.
//
// ⚖️  Manual-dialing reduces TCPA autodialer exposure but does NOT cure a DNC
// violation. Litigator numbers are ALWAYS terminal; circle-of-strangers defaults
// to block; 'manual' is an explicit, audited per-channel opt-in.

export type ProspectChannel = 'circle' | 'expired' | 'fsbo' | 'soi' | 'open_house';
export type ProspectVerdict = 'allow' | 'manual' | 'block';
export type DncScope = 'internal' | 'federal' | 'state' | 'litigator';
export type LineType = 'mobile' | 'landline' | 'voip' | 'unknown';
export type ProspectCallBasis =
  | 'unknown' | 'none' | 'inbound_inquiry' | 'express_written' | 'ebr' | 'manual_cold';

export type ProspectBlocker =
  | 'OPTED_OUT' | 'ON_DNC' | 'ON_DNC_LITIGATOR' | 'MISSING_PHONE' | 'MISSING_TIMEZONE'
  | 'NO_CALLING_BASIS' | 'MAX_ATTEMPTS_REACHED' | 'RETRY_BACKOFF' | 'QUIET_HOURS';

export type ProspectRequirement =
  | 'OFFER_OPT_OUT' | 'CAPTURE_RECORDING_CONSENT' | 'MANUAL_DIAL_ONLY' | 'ACK_DNC_MANUAL';

export interface ProspectGateConfig {
  orgId: string;
  quietStartHour: number;
  quietEndHour: number;
  defaultTimezone: string;
  maxAttempts: number;
  dncPolicy: Partial<Record<ProspectChannel, 'block' | 'manual'>>;
  recordingConsentRequired?: boolean;
}

export interface ProspectGateInput {
  personId: string;
  channel: ProspectChannel;
  phoneE164: string | null;
  timezone: string | null;
  optedOut: boolean;
  onDnc: boolean;
  dncScope?: DncScope | null;
  lineType?: LineType;
  attempts: number;
  nextEligibleAt?: string | null;
  callBasis?: ProspectCallBasis;
  priorityHint?: number;
}

export interface ProspectGateDecision {
  verdict: ProspectVerdict;
  channel: ProspectChannel;
  priority: number;
  blockers: ProspectBlocker[];
  requirements: ProspectRequirement[];
  nextEligibleAt: string | null;
  reason: string;
}

// ── local-time helpers (recipient quiet hours), inlined & pure ────────────────
function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
function localHour(date: Date, tz: string): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit' }).format(date),
  );
}
function tzOffsetMs(date: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const f: Record<string, number> = {};
  for (const p of dtf.formatToParts(date)) if (p.type !== 'literal') f[p.type] = Number(p.value);
  const asUtc = Date.UTC(f.year!, f.month! - 1, f.day!, f.hour!, f.minute!, f.second!);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}
function localTimeToUtc(date: Date, tz: string, targetHour: number, dayOffset = 0): Date {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const f: Record<string, number> = {};
  for (const p of dtf.formatToParts(date)) if (p.type !== 'literal') f[p.type] = Number(p.value);
  const naiveUtc = Date.UTC(f.year!, f.month! - 1, f.day! + dayOffset, targetHour, 0, 0);
  return new Date(naiveUtc - tzOffsetMs(date, tz));
}
function quietHoursCheck(now: Date, tz: string, startHour: number, endHour: number): { allowed: boolean; nextEligibleAt: Date | null } {
  const hour = localHour(now, tz);
  if (hour >= startHour && hour < endHour) return { allowed: true, nextEligibleAt: null };
  const dayOffset = hour < startHour ? 0 : 1;
  return { allowed: false, nextEligibleAt: localTimeToUtc(now, tz, startHour, dayOffset) };
}

const WARM_CHANNELS: ProspectChannel[] = ['soi', 'open_house'];
const DEFAULT_PRIORITY: Record<ProspectChannel, number> = {
  soi: 10, open_house: 15, expired: 40, fsbo: 45, circle: 50,
};

function hasWarmBasis(basis: ProspectCallBasis | undefined): boolean {
  return basis === 'inbound_inquiry' || basis === 'express_written' || basis === 'ebr';
}
function laterIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

export function evaluateProspectGate(
  input: ProspectGateInput,
  config: ProspectGateConfig,
  now: Date,
): ProspectGateDecision {
  const { channel } = input;
  const isWarm = WARM_CHANNELS.includes(channel);
  const priority = input.priorityHint ?? DEFAULT_PRIORITY[channel];
  const blockers: ProspectBlocker[] = [];
  let nextEligibleAt: string | null = null;
  let routeManual = false;

  if (input.optedOut) blockers.push('OPTED_OUT');
  if (input.onDnc && input.dncScope === 'litigator') blockers.push('ON_DNC_LITIGATOR');
  if (!input.phoneE164) blockers.push('MISSING_PHONE');
  if (isWarm && !hasWarmBasis(input.callBasis)) blockers.push('NO_CALLING_BASIS');

  if (input.attempts >= config.maxAttempts) blockers.push('MAX_ATTEMPTS_REACHED');
  if (input.nextEligibleAt) {
    const eligible = new Date(input.nextEligibleAt);
    if (eligible.getTime() > now.getTime()) {
      blockers.push('RETRY_BACKOFF');
      nextEligibleAt = eligible.toISOString();
    }
  }

  const tz = input.timezone ?? config.defaultTimezone;
  if (!tz || !isValidTimeZone(tz)) {
    blockers.push('MISSING_TIMEZONE');
  } else {
    const qh = quietHoursCheck(now, tz, config.quietStartHour, config.quietEndHour);
    if (!qh.allowed) {
      blockers.push('QUIET_HOURS');
      nextEligibleAt = laterIso(nextEligibleAt, qh.nextEligibleAt?.toISOString() ?? null);
    }
  }

  if (input.onDnc && input.dncScope !== 'litigator') {
    const carveOut = isWarm && hasWarmBasis(input.callBasis);
    if (!carveOut) {
      const policy = config.dncPolicy[channel] ?? 'block';
      if (policy === 'manual') routeManual = true;
      else blockers.push('ON_DNC');
    }
  }

  let verdict: ProspectVerdict;
  if (blockers.length > 0) verdict = 'block';
  else if (routeManual) verdict = 'manual';
  else verdict = 'allow';

  const requirements: ProspectRequirement[] = [];
  if (verdict !== 'block') {
    requirements.push('OFFER_OPT_OUT');
    if (config.recordingConsentRequired) requirements.push('CAPTURE_RECORDING_CONSENT');
    if (verdict === 'manual') requirements.push('MANUAL_DIAL_ONLY', 'ACK_DNC_MANUAL');
  }

  return {
    verdict, channel, priority, blockers, requirements, nextEligibleAt,
    reason:
      verdict === 'allow' ? `Cleared to dial (${channel}).`
        : verdict === 'manual' ? `Manual-dial-only (${channel}): DNC-listed, team policy permits hand-dialing with acknowledgment.`
          : `Blocked: ${blockers.join(', ')}.`,
  };
}
