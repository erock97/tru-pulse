/**
 * Admin — the money console. Only a platform owner ever sees this (gated the
 * same way as every other /admin/* screen).
 *
 * Terrason's billing ran inside TRU Operating System; this is that panel
 * rebuilt on TRU HQ's own worker (/admin/money/*). The rules it inherited
 * were each earned in production there:
 *
 *   - The big figures are what brokers have CONFIRMED. The projection — what
 *     the month becomes if every pending deal comes back green — only ever
 *     appears in smaller muted type underneath, never added into the number.
 *     Eric, on the version that mixed them: "the key is that the number
 *     updates so it doesn't show the number that's fake."
 *   - August bills July: the month picked here is the BILLING month, and the
 *     worker applies the one-month shift everywhere.
 *   - A flag's colour names whose move it is: amber is waiting on Eric,
 *     sea/blue is waiting on a broker.
 *   - After a mutation only what changed refreshes. Reloading the whole table
 *     used to slam the drilldown shut mid-confirmation.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { HqShell } from '../components/hqShell';
import { ImportClosingsModal } from '../components/revenue/ImportClosingsModal';
import { InvoicePreviewPanel } from '../components/revenue/InvoicePreviewPanel';
import { RateCardEditor } from '../components/revenue/RateCardEditor';
import { SendVerificationFlow } from '../components/revenue/SendVerificationFlow';
import { TeamDealsPanel } from '../components/revenue/TeamDealsPanel';
import {
  moneyOverview, signOutClean,
  type MoneyInvoice, type MoneyOverview, type MoneyOverviewTeam, type MoneyRound, type MoneyTeamConfig,
} from '../lib/api';
import { MONTH_NAMES, currentYm, money, monthShift, parseYm, shortDate } from '../lib/moneyFormat';

interface OverviewPayload {
  overview: MoneyOverview;
  teams: MoneyTeamConfig[];
  rounds: MoneyRound[];
  invoices: MoneyInvoice[];
}

/** The per-source card in one line: "Zillow Preferred $250 after 8". */
function rateSummary(cfg: MoneyTeamConfig | undefined): JSX.Element {
  if (!cfg) return <span className="mny-sub">—</span>;
  const lines = cfg.rates.map((r) => `${r.source} ${money(r.rate)}${r.threshold ? ` after ${r.threshold}` : ''}`);
  if (cfg.defaultRate !== null) lines.push(`any other source ${money(cfg.defaultRate)}`);
  if (!lines.length) return <span className="mny-flag warn">no rate set</span>;
  return (
    <div className="mny-rates">
      {lines.map((l) => <div key={l}>{l}</div>)}
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
  const [ym, setYm] = useState(currentYm());
  const [data, setData] = useState<OverviewPayload | undefined>(undefined);
  const [loadErr, setLoadErr] = useState('');
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  // Rounds sent from THIS screen since the last overview read, so the flag and
  // button flip the moment a send succeeds instead of waiting on a reload.
  const [sentLocal, setSentLocal] = useState<Record<string, string>>({});
  const [sendFor, setSendFor] = useState<string | null>(null);
  const [invoiceFor, setInvoiceFor] = useState<string | null>(null);
  const [ratesFor, setRatesFor] = useState<MoneyTeamConfig | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const bill = parseYm(ym);

  const load = useCallback(async (quiet: boolean) => {
    const p = parseYm(ym);
    if (!p) return;
    // Quiet refreshes keep the current table on screen — a full loading state
    // after every answered deal is exactly the flicker this page exists to avoid.
    if (!quiet) { setData(undefined); setLoadErr(''); }
    const r = await moneyOverview(p.year, p.month);
    if (r.ok) {
      setData({ overview: r.overview, teams: r.teams, rounds: r.rounds, invoices: r.invoices });
      setLoadErr('');
    } else if (!quiet) {
      setLoadErr(r.error);
    }
  }, [ym]);

  useEffect(() => {
    // A new month is a new page: drilldowns and locally-tracked sends belong
    // to the month they happened in.
    setOpenTeam(null);
    setSentLocal({});
    void load(false);
  }, [load]);

  const refreshQuiet = useCallback(() => { void load(true); }, [load]);

  const teamsByName = useMemo(
    () => new Map((data?.teams ?? []).map((t) => [t.name, t])),
    [data],
  );

  const roundFor = useCallback((team: string): MoneyRound | null => {
    const fromServer = data?.rounds.find((r) => r.team === team);
    if (fromServer) return fromServer;
    const local = sentLocal[team];
    return local ? { team, sentAt: local, closedAt: null } : null;
  }, [data, sentLocal]);

  const close = bill ? monthShift(bill.year, bill.month, -1) : null;
  const overview = data?.overview;

  function actionsCell(t: MoneyOverviewTeam, cfg: MoneyTeamConfig | undefined) {
    const round = roundFor(t.team);
    return (
      <div className="mny-actions" onClick={(e) => e.stopPropagation()}>
        {t.pending > 0 && !round && (
          <button type="button" className="mny-btn" onClick={() => setSendFor(t.team)}>
            Send to broker
          </button>
        )}
        {round && (
          <span className="mny-sent-note">
            Sent ✓ {shortDate(round.sentAt)}{' '}
            <button type="button" className="mny-link" onClick={() => setSendFor(t.team)}>resend</button>
          </span>
        )}
        {t.confirmed > 0 && (
          <button type="button" className="mny-btn yes" onClick={() => setInvoiceFor(t.team)}
            title="Draft and send a Stripe invoice for confirmed, unbilled closings">
            Invoice confirmed
          </button>
        )}
        <button type="button" className="mny-btn" disabled={!cfg}
          onClick={() => { if (cfg) setRatesFor(cfg); }}>
          Edit rates
        </button>
      </div>
    );
  }

  function teamFlag(t: MoneyOverviewTeam) {
    if (!t.configured) return <span className="mny-flag dim">not set up</span>;
    if (t.unpriced > 0) return <span className="mny-flag warn">{t.unpriced} unpriced</span>;
    if (t.pending > 0) {
      const round = roundFor(t.team);
      return round
        ? <span className="mny-flag sent">{t.pending} sent to broker · {shortDate(round.sentAt)}</span>
        : <span className="mny-flag warn">{t.pending} not sent yet</span>;
    }
    return null;
  }

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
                Retainers, closings, broker confirmations and Stripe invoices — one screen.
              </p>
            </div>
          </header>

          <div className="mny-bar">
            <input
              type="month"
              aria-label="Billing month"
              value={ym}
              onChange={(e) => { if (e.target.value) setYm(e.target.value); }}
            />
            <button type="button" className="mny-btn" onClick={() => void load(false)}>Refresh</button>
            <button type="button" className="mny-btn" onClick={() => setImportOpen(true)}>Import closed deals</button>
            {bill && close && (
              <span className="mny-sub">
                {MONTH_NAMES[bill.month]} bills {MONTH_NAMES[close.month]}'s closings — retainer is billed
                every month; closings count only what the broker has confirmed.
              </span>
            )}
          </div>

          {data === undefined && !loadErr ? (
            <div className="center-wrap"><div className="spinner" /></div>
          ) : loadErr ? (
            <div className="rs-plate dk-table" style={{ padding: 28 }}>
              <p style={{ margin: 0, color: 'var(--text-60)' }}>Couldn't load the numbers: {loadErr}</p>
            </div>
          ) : overview && (
            <>
              <div className="mny-tiles">
                <div className="mny-tile">
                  <div className="l">Monthly retainer</div>
                  <div className="v">{money(overview.retainer_total)}</div>
                </div>
                <div className="mny-tile">
                  <div className="l">From closings — confirmed</div>
                  <div className="v">{money(overview.bonus_confirmed_total)}</div>
                  {overview.bonus_total > overview.bonus_confirmed_total && (
                    <div className="mny-proj">{money(overview.bonus_total)} if every pending deal confirms</div>
                  )}
                </div>
                <div className="mny-tile total">
                  <div className="l">Total this month</div>
                  <div className="v">{money(overview.total_confirmed)}</div>
                  {overview.total > overview.total_confirmed && (
                    <div className="mny-proj">{money(overview.total)} if every pending deal confirms</div>
                  )}
                </div>
              </div>

              <div className="rs-plate dk-table">
                <div className="table-wrap">
                  <table className="tru-table mny-table">
                    <thead>
                      <tr>
                        <th>Team</th>
                        <th className="num">Retainer</th>
                        <th>Per closing</th>
                        <th className="num">Closings</th>
                        <th className="num">Total</th>
                        <th className="num">Confirmed</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {overview.teams.map((t) => {
                        const cfg = teamsByName.get(t.team);
                        const isOpen = openTeam === t.team;
                        return [
                          <tr
                            key={t.team}
                            className={`rowlink${isOpen ? ' row-open' : ''}`}
                            onClick={() => setOpenTeam(isOpen ? null : t.team)}
                          >
                            <td>
                              <span className="mny-caret">{isOpen ? '▾' : '▸'}</span>
                              <span className="mny-team">{t.team}</span>
                              {teamFlag(t)}
                            </td>
                            <td className="num">{t.configured ? money(t.retainer) : <span className="mny-sub">—</span>}</td>
                            <td>{rateSummary(cfg)}</td>
                            <td className="num">
                              {money(t.bonus_confirmed)}
                              {t.bonus > t.bonus_confirmed && <div className="mny-proj">{money(t.bonus)} proj.</div>}
                            </td>
                            <td className="num">
                              {money(t.total_confirmed)}
                              {t.total > t.total_confirmed && <div className="mny-proj">{money(t.total)} proj.</div>}
                            </td>
                            <td className="num">{t.confirmed} / {t.confirmed + t.pending}</td>
                            <td className="num">{actionsCell(t, cfg)}</td>
                          </tr>,
                          isOpen && bill ? (
                            <tr className="mny-deals-tr" key={`${t.team}-deals`}>
                              <td colSpan={7}>
                                <TeamDealsPanel
                                  team={t.team}
                                  year={bill.year}
                                  month={bill.month}
                                  roundOut={!!roundFor(t.team)}
                                  onChanged={refreshQuiet}
                                />
                              </td>
                            </tr>
                          ) : null,
                        ];
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <p className="mny-sub" style={{ marginTop: 12 }}>
                Click a team to see every deal uploaded for the month it bills.
                {overview.teams.some((t) => t.pending > 0) && (
                  <> The big figures are what brokers have confirmed — the smaller line under them is
                  what the month becomes if every outstanding deal comes back green.</>
                )}
                {overview.teams.some((t) => t.unpriced > 0) && (
                  <> Some closings have a source with no rate set — they are not counted until that
                  rate exists.</>
                )}
              </p>
            </>
          )}
        </div>

        {sendFor && bill && (
          <SendVerificationFlow
            team={sendFor}
            year={bill.year}
            month={bill.month}
            onClose={() => setSendFor(null)}
            onSent={() => {
              const team = sendFor;
              setSentLocal((s) => ({ ...s, [team]: new Date().toISOString() }));
            }}
          />
        )}
        {invoiceFor && bill && data && (
          <InvoicePreviewPanel
            team={invoiceFor}
            year={bill.year}
            month={bill.month}
            invoices={data.invoices.filter((i) => i.teamName === invoiceFor)}
            onClose={() => setInvoiceFor(null)}
            onChanged={refreshQuiet}
          />
        )}
        {ratesFor && (
          <RateCardEditor
            team={ratesFor}
            onClose={() => setRatesFor(null)}
            onSaved={() => { setRatesFor(null); refreshQuiet(); }}
          />
        )}
        {importOpen && data && (
          <ImportClosingsModal
            teams={data.teams.map((t) => t.name)}
            onClose={() => setImportOpen(false)}
            onImported={refreshQuiet}
          />
        )}
      </HqShell>
    </div>
  );
}
