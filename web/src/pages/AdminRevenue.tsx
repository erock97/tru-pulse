/**
 * Admin — retainer + per-deal payout, per team.
 *
 * Only a platform owner ever sees this (gated the same way as every other
 * /admin/* screen). The numbers themselves aren't tracked here at all — they
 * come live from TRU Operating System's own database, where Eric already
 * runs this for Terrason Consulting (retainer amounts, rate cards, and the
 * fee-per-closing math). This page is a read-only mirror of that, not a
 * second place to enter or edit any of it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { HqShell } from '../components/hqShell';
import { adminRevenue, signOutClean, type RevenueDeal, type RevenueResult, type RevenueTeam } from '../lib/api';

function formatCents(dollars: number): string {
  return `$${Math.round(dollars).toLocaleString()}`;
}

function DealRow({ deal }: { deal: RevenueDeal }) {
  const paid = deal.earned_fee > 0;
  return (
    <article className="dk-fr adm-row">
      <span className="rs-av h-holding">{(deal.source ?? '??').slice(0, 2).toUpperCase()}</span>
      <span className="dk-fr-name">{deal.address || 'No address on file'}</span>
      <span className="dk-fr-why">
        {[deal.agent_name, deal.source, deal.close_date].filter(Boolean).join(' · ') || '—'}
      </span>
      <span className="dk-fr-do">
        {paid ? formatCents(deal.earned_fee) : (deal.under_threshold ? 'Free (under threshold)' : '$0')}
      </span>
    </article>
  );
}

function TeamPanel({ team }: { team: RevenueTeam }) {
  const totalEarned = useMemo(
    () => team.deals.reduce((sum, d) => sum + d.earned_fee, 0),
    [team.deals],
  );
  return (
    <div className="dk-sec" style={{ marginTop: 34 }}>
      <h2>{team.team_name}</h2>
      <p>
        {formatCents(team.retainer)}/mo retainer · {formatCents(totalEarned)} in per-deal payouts
        across {team.deals.length} {team.deals.length === 1 ? 'deal' : 'deals'}
      </p>
      {team.deals.length === 0 ? (
        <div className="rs-plate dk-table" style={{ padding: 28, marginTop: 12 }}>
          <p style={{ margin: 0, color: 'var(--text-60)' }}>No closings recorded for this team yet.</p>
        </div>
      ) : (
        <div className="dk-focus" style={{ marginTop: 12 }}>
          {team.deals.map((d) => <DealRow key={d.id} deal={d} />)}
        </div>
      )}
    </div>
  );
}

export default function AdminRevenue({
  onOpenPulse, onOpenCoach, onOpenRep,
}: {
  onOpenPulse: () => void;
  onOpenCoach: () => void;
  onOpenRep: () => void;
}) {
  const [result, setResult] = useState<RevenueResult | undefined>(undefined);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => setResult(await adminRevenue()), []);
  useEffect(() => { void load(); }, [load]);

  const teams = result?.status === 'ok' ? result.teams : [];
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return teams;
    return teams.filter((t) => t.team_name.toLowerCase().includes(needle));
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
        onOpenTeamData={() => { window.location.hash = '/admin/targets'; }}
        onOpenRevenue={() => { window.location.hash = '/admin/revenue'; }}
        hideTopbar
      >
        <div className="dk-main">
          <header className="dk-mast">
            <div>
              <span className="dk-eyebrow"><i />Platform owner</span>
              <h1>Team <em>revenue</em>.</h1>
              <p className="dk-sub">
                Retainer and per-deal payout, per team — mirrored live from TRU Operating System.
                {result?.status === 'ok' && <>{' '}{teams.length} {teams.length === 1 ? 'team' : 'teams'} tracked.</>}
              </p>
            </div>
          </header>

          {result === undefined ? (
            <div className="center-wrap"><div className="spinner" /></div>
          ) : result.status === 'not_configured' ? (
            <div className="rs-plate dk-table" style={{ padding: 28 }}>
              <p style={{ margin: 0, color: 'var(--text-60)' }}>
                Not wired up yet — this page needs a key for TRU Operating System's database,
                which hasn't been set on the server.
              </p>
            </div>
          ) : result.status === 'unavailable' ? (
            <div className="rs-plate dk-table" style={{ padding: 28 }}>
              <p style={{ margin: 0, color: 'var(--text-60)' }}>Couldn't load revenue data.</p>
            </div>
          ) : (
            <>
              <div className="dk-sec">
                <h2>Teams</h2>
                <p>{shown.length === teams.length ? 'all of them' : `${shown.length} matching`}</p>
                <span className="dk-key">
                  <input
                    className="ad-input adm-search"
                    placeholder="Search team…"
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
                        <span className="dk-fr-why">{formatCents(t.retainer)}/mo retainer</span>
                        <span className="dk-fr-do">
                          {t.deals.length} {t.deals.length === 1 ? 'deal' : 'deals'}
                        </span>
                      </article>
                    ))}
                  </div>

                  {active && <TeamPanel team={active} />}
                </>
              )}
            </>
          )}
        </div>
      </HqShell>
    </div>
  );
}
