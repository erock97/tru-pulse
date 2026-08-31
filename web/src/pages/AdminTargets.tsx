/**
 * Admin — per-team Zillow target pacing.
 *
 * Only a platform owner ever sees this (gated the same way as every other
 * /admin/* screen: the caller must resolve through GET /admin/targets, which
 * the Worker only answers for an account listed in the `admins` table).
 *
 * Mirrors the look of Zillow's own embedded Tableau report — actual against
 * a goal, as a percentage — but unified across every team in one place. A
 * team with no scrape yet shows an empty state, not an error: absence is the
 * correct rendering of "no data landed yet," matching every other admin screen.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { HqShell } from '../components/hqShell';
import { adminTargets, signOutClean, type ZillowTargetMetric, type ZillowTargetTeam } from '../lib/api';

const METRIC_LABELS: Record<ZillowTargetMetric['metric'], string> = {
  six_month: '6-Month Target',
  zhl: 'ZHL Target',
};

function formatValue(v: number, unit: string): string {
  if (unit === 'currency') return `$${Math.round(v).toLocaleString()}`;
  if (unit === 'pct') return `${v.toFixed(1)}%`;
  return Math.round(v).toLocaleString();
}

function percentToTarget(actual: number, target: number): number | null {
  if (!(target > 0)) return null;
  return Math.max(0, Math.min(100, Math.round((actual / target) * 100)));
}

function TargetPanel({ metric }: { metric: ZillowTargetMetric }) {
  const pct = percentToTarget(metric.actual_value, metric.target_value);
  return (
    <div className="rs-plate dk-table" style={{ padding: 22 }}>
      <h3 style={{ margin: '0 0 4px' }}>{METRIC_LABELS[metric.metric]}</h3>
      {metric.period_label && (
        <p style={{ margin: '0 0 14px', color: 'var(--text-60)' }}>{metric.period_label}</p>
      )}
      <div className="hh-progress" aria-hidden>
        <div className="hh-progress-track">
          <span className="hh-progress-fill" style={{ width: `${pct ?? 0}%` }} />
        </div>
        <span className="hh-progress-cap">{pct === null ? 'no target set' : `${pct}% to goal`}</span>
      </div>
      <p style={{ margin: '10px 0 0' }}>
        {formatValue(metric.actual_value, metric.unit)} of {formatValue(metric.target_value, metric.unit)}
      </p>
      {metric.source_refresh_date && (
        <p style={{ margin: '4px 0 0', color: 'var(--text-60)', fontSize: 12 }}>
          Zillow report as of {metric.source_refresh_date}
        </p>
      )}
    </div>
  );
}

export default function AdminTargets({
  onOpenPulse, onOpenCoach, onOpenRep,
}: {
  onOpenPulse: () => void;
  onOpenCoach: () => void;
  onOpenRep: () => void;
}) {
  const [teams, setTeams] = useState<ZillowTargetTeam[] | null | undefined>(undefined);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => setTeams(await adminTargets()), []);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const all = teams ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return all;
    return all.filter((t) => `${t.team_name} ${t.org_name}`.toLowerCase().includes(needle));
  }, [teams, q]);

  const active = shown.find((t) => t.team_id === selected) ?? shown[0] ?? null;

  return (
    <div className="tru-dark">
      <HqShell
        orgName="TRU HQ"
        role="Platform owner"
        onSignOut={() => signOutClean()}
        nav={{ onOpenPulse, onOpenCoach, onOpenRep }}
        isAdmin
        onOpenAdmin={() => { window.location.hash = '/admin'; }}
        onOpenPartnerReporting={() => { window.location.hash = '/admin/targets'; }}
        hideTopbar
      >
        <div className="dk-main">
          <header className="dk-mast">
            <div>
              <span className="dk-eyebrow"><i />Platform owner</span>
              <h1>Partner <em>reporting</em>.</h1>
              <p className="dk-sub">
                Each team's 6-month and ZHL targets, pulled from their own Zillow report.
                {teams && <>{' '}{teams.length} {teams.length === 1 ? 'team' : 'teams'} tracked.</>}
              </p>
            </div>
          </header>

          {teams === undefined ? (
            <div className="center-wrap"><div className="spinner" /></div>
          ) : (
          <>
          <div className="dk-sec">
            <h2>Teams</h2>
            <p>{shown.length === (teams ?? []).length ? 'all of them' : `${shown.length} matching`}</p>
            <span className="dk-key">
              <input
                className="ad-input adm-search"
                placeholder="Search team or org…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </span>
          </div>

          {shown.length === 0 ? (
            <div className="rs-plate dk-table" style={{ padding: 28 }}>
              <p style={{ margin: 0, color: 'var(--text-60)' }}>No team matches "{q}".</p>
            </div>
          ) : (
            <>
              <div className="dk-focus">
                {shown.map((t) => (
                  <article
                    key={t.team_id}
                    className="dk-fr adm-row"
                    tabIndex={0}
                    onClick={() => setSelected(t.team_id)}
                    onKeyDown={(e) => { if (e.key === 'Enter') setSelected(t.team_id); }}
                  >
                    <span className="rs-av h-holding">{t.team_name.slice(0, 2).toUpperCase()}</span>
                    <span className="dk-fr-name">{t.team_name}</span>
                    <span className="dk-fr-why">{t.org_name}</span>
                    <span className="dk-fr-do">
                      {t.metrics.length === 0 ? 'No data yet' : `${t.metrics.length} metric${t.metrics.length === 1 ? '' : 's'}`}
                    </span>
                  </article>
                ))}
              </div>

              {active && (
                <div className="dk-sec" style={{ marginTop: 34 }}>
                  <h2>{active.team_name}</h2>
                  {active.metrics.length === 0 ? (
                    <div className="rs-plate dk-table" style={{ padding: 28, marginTop: 12 }}>
                      <p style={{ margin: 0, color: 'var(--text-60)' }}>
                        No Zillow scrape has landed for this team yet.
                      </p>
                    </div>
                  ) : (
                    <div className="dk-focus" style={{ marginTop: 12 }}>
                      {active.metrics.map((m) => <TargetPanel key={m.metric} metric={m} />)}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          </>
          )}
        </div>
      </HqShell>
    </div>
  );
}
