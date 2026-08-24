/**
 * The roster, as data.
 *
 * Pulled out of the page so two layouts can be compared side by side on
 * genuinely identical numbers. If a comparison is running on two different
 * loaders it is not a comparison.
 *
 * Rules this holds to, because breaking them is what made the old overview
 * untrustworthy:
 *   - Every number is measured. Nothing is a placeholder and nothing is
 *     derived from an assumption without saying so.
 *   - An agent it cannot resolve is shown, not dropped.
 */

import { useEffect, useMemo, useState } from 'react';

import { loadDashboard, loadRep, type RepData } from './api';
import { loadRoster, type RosterAgent } from './coachData';
import { isClosing, isOfferPlus, stageClass, isStuckStage } from '../../../shared/flags';

/* ── the line ──────────────────────────────────────────────────────────────
   Leads-per-contract worse than this is "past the line". Wants a per-team
   settings field; the fallback is Eric's stated standard of one in thirty.

   NOTE: org_settings.close_rate is a percentage, not a ratio. Reading it here
   produced "your line is 1 : 2". Do not reach for it. */
export const DEFAULT_LINE = 30;

export type Health = 'past-line' | 'behind' | 'holding' | 'no-volume';

export interface Row {
  agentId: string | null;
  name: string;
  leads: number;
  /** `leads` broken out by lead source. A bare total was being read as one
   *  source's number — 42 leads meant 36 Zillow and 6 Realtor.com MVIP, and
   *  nothing on the page said so. */
  srcs: Map<string, number>;
  worked: number;
  workedPct: number;
  stuck: number;
  offers: number;
  contracts: number;
  perContract: number | null;
  lastDays: number | null;
  arch: string | null;
  archName: string | null;
  health: Health;
  /* Certification, from the Rep board. `null` means this name has no Rep
     record at all, which is different from having one and passing nothing. */
  cert: { passed: number; total: number; invited: boolean } | null;
}

export interface Priority {
  row: Row;
  reason: string;
  action: string;
  approach: string | null;
  severity: 'high' | 'medium';
}

export interface Totals {
  leads: number; worked: number; contracts: number; offers: number; stuck: number;
  workedPct: number; perContract: number | null; pastLine: number; stale: number;
}

/* ── the window ────────────────────────────────────────────────────────────
   Real filtering, on the lead's own created date. `null` days means every
   lead the team has. */
export interface Window { key: string; label: string; days: number | null }
export const WINDOWS: readonly Window[] = [
  { key: '7d', label: '7d', days: 7 },
  { key: '30d', label: '30d', days: 30 },
  { key: '90d', label: '90d', days: 90 },
  { key: 'all', label: '12mo', days: 365 },
];

export const norm = (s: string | null | undefined) =>
  (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export function healthOf(perContract: number | null, teamRate: number | null, line: number): Health {
  if (perContract === null) return 'no-volume';
  if (perContract > line) return 'past-line';
  if (teamRate !== null && perContract > teamRate * 1.12) return 'behind';
  return 'holding';
}

/** The personality angle comes from the assessment; without one, say nothing. */
export function approachFor(r: Row): string | null {
  if (!r.arch) return null;
  if (r.arch === 'Striver') return 'A Striver — lead with momentum and a specific next rep, not a target.';
  if (r.arch === 'Achiever') return 'An Achiever — give them the number and the autonomy to hit it.';
  if (r.arch === 'Independent') return 'Independent — agree the outcome, then stay out of the method.';
  return null;
}

/* ── the priority list ─────────────────────────────────────────────────────
   Ranked on signals that are all genuinely measured today. Trend is absent on
   purpose: Follow Up Boss carries no stage history, so it cannot be computed
   without inventing it. It arrives once the weekly Hustle rows accumulate. */
export function prioritise(rows: readonly Row[]): Priority[] {
  const out: Priority[] = [];

  for (const r of rows) {
    if (r.health === 'past-line') {
      out.push({
        row: r,
        severity: 'high',
        reason: r.workedPct >= 95
          ? `Worked ${r.workedPct}% of ${r.leads} leads and closed ${r.contracts}. Nothing is being dropped before the call, so the loss is on it.`
          : `One contract from ${r.leads} leads, and ${100 - r.workedPct}% of them were never worked.`,
        action: r.workedPct >= 95 ? 'Listen to a recent call before the next 1:1.' : 'Start with the untouched leads.',
        approach: approachFor(r),
      });
    } else if (r.stuck > 10) {
      out.push({
        row: r,
        severity: 'high',
        reason: `${r.stuck} of ${r.leads} leads are still sitting in Lead.`,
        action: 'Work the stuck list with them, oldest first.',
        approach: approachFor(r),
      });
    } else if (r.lastDays === null && r.leads >= 5) {
      out.push({
        row: r,
        severity: 'high',
        reason: `No 1:1 on record, and they are carrying ${r.leads} leads.`,
        action: 'Book a first one and set the cadence.',
        approach: approachFor(r),
      });
    } else if (r.lastDays !== null && r.lastDays > 45) {
      out.push({
        row: r,
        severity: 'medium',
        reason: `${r.lastDays} days since their last 1:1.`,
        action: 'Book one this week.',
        approach: approachFor(r),
      });
    } else if (r.health === 'no-volume' && r.leads < 5) {
      out.push({
        row: r,
        severity: 'medium',
        reason: `${r.leads} lead${r.leads === 1 ? '' : 's'} in this window. There is nothing here to coach from.`,
        action: 'Check how leads are being routed before anything else.',
        approach: null,
      });
    }
  }

  const rank = { high: 0, medium: 1 } as const;
  return out
    .sort((a, b) => rank[a.severity] - rank[b.severity]
      || (b.row.perContract ?? 0) - (a.row.perContract ?? 0))
    .slice(0, 4);
}

export function totalsOf(rows: readonly Row[]): Totals {
  const leads = rows.reduce((a, r) => a + r.leads, 0);
  const worked = rows.reduce((a, r) => a + r.worked, 0);
  return {
    leads,
    worked,
    contracts: rows.reduce((a, r) => a + r.contracts, 0),
    offers: rows.reduce((a, r) => a + r.offers, 0),
    stuck: rows.reduce((a, r) => a + r.stuck, 0),
    workedPct: leads ? Math.round((worked / leads) * 100) : 0,
    perContract: rows.reduce((a, r) => a + r.contracts, 0)
      ? leads / rows.reduce((a, r) => a + r.contracts, 0)
      : null,
    pastLine: rows.filter((r) => r.health === 'past-line').length,
    stale: rows.filter((r) => r.lastDays !== null && r.lastDays > 30).length,
  };
}

export interface RosterState {
  rows: Row[] | null;
  err: string;
  /** Leads carrying no created date, so a window could not include them. */
  undated: number;
  /** Agents taken off the team whose leads still count toward the totals. */
  departed: { names: string[]; leads: number };
  /** Computed across EVERYONE, departed agents included — see the note in the
   *  hook. Do not recompute these from `rows`, which is the living roster. */
  totals: Totals | null;
}

export function useRosterData(line: number, windowDays: number | null): RosterState {
  const [raw, setRaw] = useState<{
    leads: Awaited<ReturnType<typeof loadDashboard>>['leads'];
    agents: Awaited<ReturnType<typeof loadDashboard>>['agents'];
    coach: RosterAgent[];
    rep: RepData | null;
  } | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // The coaching roster and the certification board are separate reads
        // and are both allowed to fail: a team with Coach or Rep switched off
        // still gets its pipeline.
        const [data, coach, rep] = await Promise.all([
          loadDashboard(),
          loadRoster().catch((): RosterAgent[] => []),
          loadRep().catch((): RepData | null => null),
        ]);
        if (alive) setRaw({ leads: data.leads, agents: data.agents, coach, rep });
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : 'Could not load the roster.');
      }
    })();
    return () => { alive = false; };
  }, []);

  return useMemo(() => {
    if (!raw) return { rows: null, err, undated: 0, departed: { names: [], leads: 0 }, totals: null };

    // One row per agent per module, so passes are counted per agent rather
    // than summed. Only published modules count toward the total.
    const liveModules = (raw.rep?.modules ?? []).filter((m) => m.status !== 'draft' && m.status !== 'archived');
    const passedBy = new Map<string, Set<string>>();
    for (const p of raw.rep?.progress ?? []) {
      if (p.status !== 'passed') continue;
      if (!liveModules.some((m) => m.id === p.module_id)) continue;
      const set = passedBy.get(p.agent_id) ?? new Set<string>();
      set.add(p.module_id);
      passedBy.set(p.agent_id, set);
    }
    const repByName = new Map((raw.rep?.agents ?? []).map((a) => [norm(a.name), a]));
    const byName = new Map(raw.coach.map((c) => [norm(c.name), c]));

    // A lead with no created date cannot be placed in a window. It is counted
    // and reported rather than silently dropped or silently included.
    const cutoff = windowDays === null ? null : Date.now() - windowDays * 86400000;
    let undated = 0;
    const leads = raw.leads.filter((l) => {
      if (cutoff === null) return true;
      if (!l.fub_created) { undated += 1; return false; }
      const t = Date.parse(l.fub_created);
      return Number.isFinite(t) ? t >= cutoff : (undated += 1, false);
    });

    const bucket = new Map<string, Row>();
    for (const l of leads) {
      const owner = l.assigned_to?.trim();
      if (!owner) continue;
      const key = norm(owner);
      let r = bucket.get(key);
      if (!r) {
        const c = byName.get(key);
        const ra = repByName.get(key);
        r = {
          agentId: c?.id ?? null,
          name: owner,
          leads: 0, srcs: new Map<string, number>(),
          worked: 0, workedPct: 0, stuck: 0, offers: 0, contracts: 0,
          perContract: null,
          lastDays: c && c.lastDays < 99 ? c.lastDays : null,
          arch: c?.quad ?? null,
          archName: c?.archName ?? null,
          health: 'no-volume',
          cert: ra
            ? { passed: passedBy.get(ra.id)?.size ?? 0, total: liveModules.length, invited: ra.invited }
            : null,
        };
        bucket.set(key, r);
      }
      r.leads += 1;
      const sf = l.source_family || 'Other';
      r.srcs.set(sf, (r.srcs.get(sf) ?? 0) + 1);
      const cls = stageClass(l.stage);
      if (isOfferPlus(cls)) r.offers += 1;
      if (isClosing(cls)) r.contracts += 1;
      if (isStuckStage(l.stage)) r.stuck += 1;
      if (l.flag !== 'zero_contact') r.worked += 1;
    }

    const list = [...bucket.values()].map((r) => ({
      ...r,
      workedPct: r.leads ? Math.round((r.worked / r.leads) * 100) : 0,
      perContract: r.contracts ? r.leads / r.contracts : null,
    }));

    const totalLeads = list.reduce((a, r) => a + r.leads, 0);
    const totalContracts = list.reduce((a, r) => a + r.contracts, 0);
    const teamRate = totalContracts ? totalLeads / totalContracts : null;

    // A departed agent's leads and contracts stay in the team's totals above —
    // that business really happened and removing it would silently rewrite
    // months you have already reported. What goes is the person: they are not
    // somebody to coach, rank, or prioritise any more.
    const gone = new Set(
      (raw.agents ?? []).filter((a) => a.excluded).map((a) => norm(a.name)),
    );
    const departedRows = list.filter((r) => gone.has(norm(r.name)));

    const withHealth = list.map((r) => ({ ...r, health: healthOf(r.perContract, teamRate, line) }));

    return {
      rows: withHealth.filter((r) => !gone.has(norm(r.name))),
      // Totals come off the FULL list on purpose. A page that computed them
      // from `rows` would quietly rewrite months you have already reported the
      // moment somebody leaves.
      totals: totalsOf(withHealth),
      err,
      undated,
      departed: {
        names: departedRows.map((r) => r.name),
        leads: departedRows.reduce((a, r) => a + r.leads, 0),
      },
    };
  }, [raw, err, line, windowDays]);
}
