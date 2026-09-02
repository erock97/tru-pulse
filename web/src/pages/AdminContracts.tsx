/**
 * Admin — the contracts console. Only a platform owner ever sees this (gated
 * the same way as every other /admin/* screen).
 *
 * This is TRU OS's Contracts sector rebuilt on TRU HQ's own worker
 * (/admin/contracts/*), restyled into this app's register. The rules it
 * inherited were each earned there:
 *
 *   - Never render fake data. Until TruSign's read credential lands, the page
 *     says exactly which credential is missing — in the worker's own words —
 *     instead of showing an empty table that reads as "no contracts exist".
 *   - Reading and mutating are separate credentials. The list can be live
 *     while send/void are honestly disabled, each with the worker's sentence
 *     for why.
 *   - Send and void are approve-gated: a review panel re-reads the live
 *     envelope and scopes the approval to its exact version. No row button
 *     mutates anything directly.
 *   - Signing happens in the email TruSign sent, never here — the signing
 *     link carries a one-time token that only exists in that email. The
 *     "waiting on you" strip therefore links to TruSign; it does not pretend
 *     to sign.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { HqShell } from '../components/hqShell';
import { DraftWizard } from '../components/contracts/DraftWizard';
import { SendReviewPanel } from '../components/contracts/SendReviewPanel';
import {
  contractsOverview, signOutClean,
  type ContractEnvelope, type ContractsOverview,
} from '../lib/api';
import { shortDate } from '../lib/moneyFormat';

// The live TruSign app (the trusign.co custom domain doesn't resolve). One
// link for every envelope: the app root is where its inbox lives, and that is
// all TRU OS linked to as well.
const TRUSIGN_URL = 'https://trusign.pages.dev';

/** Which chip tone a status wears. Colors mean the same thing they mean
 *  everywhere else in the admin consoles: sea is done, amber is in flight
 *  and waiting on someone, terracotta is dead. */
function statusTone(status: string): string {
  if (status === 'signed' || status === 'completed') return 'ok';
  if (status === 'sent') return 'warn';
  if (status === 'draft') return 'ctr-draft';
  if (status === 'voided' || status === 'declined' || status === 'expired') return 'dead';
  return 'moved';
}

/** The one-line story under a title: who sent it, who it waits on, when. */
function envelopeMeta(e: ContractEnvelope): string {
  const parts: string[] = [];
  if (e.senderName) parts.push(e.senderName);
  if (e.status === 'sent' && e.waitingOn.length) {
    parts.push(e.waitingOnYou
      ? 'waiting on you'
      : `waiting on ${e.waitingOn.map((r) => r.name || r.email).join(', ')}`);
  }
  if (e.status === 'sent' && e.sentAt) parts.push(`sent ${shortDate(e.sentAt)}`);
  else if ((e.status === 'signed' || e.status === 'completed') && e.completedAt) parts.push(`signed ${shortDate(e.completedAt)}`);
  else if (e.createdAt) parts.push(`created ${shortDate(e.createdAt)}`);
  if (e.expiresAt) parts.push(`expires ${shortDate(e.expiresAt)}`);
  return parts.join(' · ') || e.status;
}

export default function AdminContracts({
  onOpenPulse, onOpenCoach, onOpenRep,
}: {
  onOpenPulse: () => void;
  onOpenCoach: () => void;
  onOpenRep: () => void;
}) {
  const [data, setData] = useState<ContractsOverview | undefined>(undefined);
  const [loadErr, setLoadErr] = useState('');
  const [q, setQ] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [review, setReview] = useState<{ envelopeId: string; mode: 'send' | 'void' } | null>(null);
  // Which prepared drafts have their full text unfolded. Collapsed by default:
  // a page of complete contract bodies buries the list it sits under.
  const [openDrafts, setOpenDrafts] = useState<Record<string, boolean>>({});

  const load = useCallback(async (quiet: boolean) => {
    // Quiet refreshes keep the current list on screen — the full loading state
    // after every send/void is exactly the flicker the money console removed.
    if (!quiet) { setData(undefined); setLoadErr(''); }
    const r = await contractsOverview();
    if (r.ok) {
      const { ok, ...overview } = r; void ok;
      setData(overview);
      setLoadErr('');
    } else if (!quiet) {
      setLoadErr(r.error);
    }
  }, []);

  useEffect(() => { void load(false); }, [load]);
  const refreshQuiet = useCallback(() => { void load(true); }, [load]);

  const envelopes = useMemo(() => data?.envelopes ?? [], [data]);

  // The team filter's options come from the data itself — every distinct team
  // an envelope actually carries. (TRU OS hardcoded a team list and then had
  // to disable the filter because TruSign had no team column; the column
  // exists now, so the filter is real.)
  const teams = useMemo(() => {
    const seen = new Set<string>();
    for (const e of envelopes) if (e.team) seen.add(e.team);
    return [...seen].sort();
  }, [envelopes]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return envelopes
      .filter((e) => !teamFilter || e.team === teamFilter)
      .filter((e) =>
        !needle
        || e.title.toLowerCase().includes(needle)
        || (e.clientName ?? '').toLowerCase().includes(needle));
  }, [envelopes, q, teamFilter]);

  // Status chip counts, completed folded into signed the way TRU OS counted —
  // to the person reading the row, both mean "this one is done".
  const counts = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const e of envelopes) {
      const key = e.status === 'completed' ? 'signed' : e.status;
      acc[key] = (acc[key] || 0) + 1;
    }
    return acc;
  }, [envelopes]);

  const waitingOnYou = envelopes.filter((e) => e.waitingOnYou);
  const canMutate = !!data && data.writeConnected && data.approvalConnected;
  const mutateBlockedWhy = !data ? '' : !data.writeConnected
    ? (data.requiresWrite ?? 'TruSign send/void is not connected.')
    : !data.approvalConnected
      ? (data.requiresApproval ?? 'The approval gate is not available.')
      : '';

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
        onOpenContracts={() => { window.location.hash = '/admin/contracts'; }}
        onOpenCalendar={() => { window.location.hash = '/admin/calendar'; }}
        hideTopbar
      >
        <div className="dk-main">
          <header className="dk-mast">
            <div>
              <span className="dk-eyebrow"><i />Platform owner</span>
              <h1>TruSign <em>contracts</em>.</h1>
              <p className="dk-sub">
                Every envelope — drafts, out for signature, signed — with review-gated send and void.
              </p>
            </div>
          </header>

          {data === undefined && !loadErr ? (
            <div className="center-wrap"><div className="spinner" /></div>
          ) : loadErr ? (
            <div className="rs-plate dk-table" style={{ padding: 28 }}>
              <p style={{ margin: 0, color: 'var(--text-60)' }}>Couldn&apos;t load the contracts: {loadErr}</p>
            </div>
          ) : data && !data.connected ? (
            // Not connected: no fabricated envelopes, and the exact credential
            // that is missing, in the worker's own words.
            <div className="rs-plate dk-table ctr-empty">
              <h2 style={{ marginTop: 0 }}>Connect TruSign</h2>
              <p className="mny-modal-sub" style={{ maxWidth: 640 }}>
                No fabricated envelopes here — real titles, statuses and dates appear the moment
                TruSign&apos;s read credential lands, and send/void arm when its write credential lands too.
              </p>
              {data.requires && (
                <div className="ctr-requires">
                  <span className="k">To read envelopes</span>
                  <span className="v">{data.requires}</span>
                </div>
              )}
              {!data.writeConnected && data.requiresWrite && (
                <div className="ctr-requires">
                  <span className="k">To send or void</span>
                  <span className="v">{data.requiresWrite}</span>
                </div>
              )}
              <p style={{ marginBottom: 0 }}>
                <a className="mny-link" href={TRUSIGN_URL} target="_blank" rel="noreferrer">Open TruSign</a>
              </p>
            </div>
          ) : data && (
            <>
              {!data.writeConnected && (
                <div className="ctr-banner">
                  Reading real envelopes below, but send and void aren&apos;t armed —{' '}
                  {data.requiresWrite ?? 'TruSign’s write credential is missing.'}
                </div>
              )}
              {data.writeConnected && !data.approvalConnected && (
                <div className="ctr-banner">
                  Send and void are locked —{' '}
                  {data.requiresApproval ?? 'your explicit approval cannot be durably verified right now.'}
                </div>
              )}

              <div className="mny-bar">
                <input
                  className="ctr-find"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Find a contract — title or client…"
                  aria-label="Find a contract"
                />
                <select
                  value={teamFilter}
                  onChange={(e) => setTeamFilter(e.target.value)}
                  aria-label="Filter by team"
                  className="ctr-team-filter"
                >
                  <option value="">All teams</option>
                  {teams.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <button
                  type="button"
                  className="mny-btn yes"
                  disabled={!data.writeConnected}
                  title={!data.writeConnected ? (data.requiresWrite ?? 'TruSign send is not connected.') : 'Prepare a draft envelope for review — nothing sends'}
                  onClick={() => setWizardOpen(true)}
                >
                  New contract
                </button>
                <button type="button" className="mny-btn" onClick={refreshQuiet}>Refresh</button>
                <a className="mny-link" href={TRUSIGN_URL} target="_blank" rel="noreferrer">Open TruSign</a>
                <span className="mny-sub">
                  {Object.entries(counts).map(([status, n]) => `${n} ${status}`).join(' · ') || 'No envelopes yet.'}
                </span>
              </div>

              {waitingOnYou.length > 0 && (
                <div className="rs-plate dk-table ctr-panel">
                  <div className="ctr-panel-head">
                    <h3>Waiting on your signature</h3>
                    <span className="mny-chip warn">{waitingOnYou.length}</span>
                  </div>
                  {waitingOnYou.map((e) => (
                    <div className="ctr-row" key={e.id}>
                      <div className="ctr-row-main">
                        <span className="ctr-title">{e.title}</span>
                        <span className="mny-sub">
                          {[e.senderName, e.sentAt ? `sent ${shortDate(e.sentAt)}` : null].filter(Boolean).join(' · ') || 'out for signature'}
                        </span>
                      </div>
                      <div className="ctr-row-actions">
                        <span className="mny-chip warn">waiting on you</span>
                        <a className="mny-btn" href={TRUSIGN_URL} target="_blank" rel="noreferrer">Open in TruSign</a>
                      </div>
                    </div>
                  ))}
                  {/* The signing link itself is emailed and carries a one-time
                      token, so this points at the envelope rather than
                      pretending to sign from here. */}
                  <p className="mny-sub" style={{ marginBottom: 0 }}>
                    Sign from the link TruSign emailed you — the signing link carries a one-time token
                    that only exists in that email, so it can&apos;t be signed from this page.
                  </p>
                </div>
              )}

              {data.drafts.length > 0 && (
                <div className="rs-plate dk-table ctr-panel">
                  <div className="ctr-panel-head">
                    <h3>Prepared drafts</h3>
                    <span className="mny-sub">held for 30 days, then gone</span>
                  </div>
                  {data.drafts.map((d) => (
                    <div className="ctr-row" key={d.id}>
                      <div className="ctr-row-main">
                        <span className="ctr-title">{d.title}</span>
                        <span className="mny-sub">
                          {[d.summary, d.envelopeId ? `TruSign ${d.envelopeId}` : 'envelope not created',
                            d.createdAt ? `created ${shortDate(d.createdAt)}` : null].filter(Boolean).join(' · ')}
                        </span>
                        {openDrafts[d.id] && d.draftText && (
                          <pre className="ctr-drafttext">{d.draftText}</pre>
                        )}
                      </div>
                      <div className="ctr-row-actions">
                        {d.draftText && (
                          <button
                            type="button"
                            className="mny-btn"
                            onClick={() => setOpenDrafts((s) => ({ ...s, [d.id]: !s[d.id] }))}
                          >
                            {openDrafts[d.id] ? 'Hide text' : 'Show text'}
                          </button>
                        )}
                        {d.envelopeId && (
                          <button
                            type="button"
                            className="mny-btn yes"
                            disabled={!canMutate}
                            title={canMutate ? 'Review the live envelope, then approve' : mutateBlockedWhy}
                            onClick={() => setReview({ envelopeId: d.envelopeId as string, mode: 'send' })}
                          >
                            Review &amp; send
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="rs-plate dk-table ctr-panel">
                <div className="ctr-panel-head">
                  <h3>Envelopes</h3>
                  <span className="mny-sub">{rows.length} shown</span>
                </div>
                {rows.map((e) => (
                  <div className="ctr-row" key={e.id}>
                    <div className="ctr-row-main">
                      <span className="ctr-title">
                        {e.title}
                        {(e.clientName || e.team) && (
                          <span className="ctr-client"> — {[e.clientName, e.team].filter(Boolean).join(' · ')}</span>
                        )}
                      </span>
                      <span className="mny-sub">{envelopeMeta(e)}</span>
                    </div>
                    <div className="ctr-row-actions">
                      <span className={`mny-chip ${statusTone(e.status)}`}>{e.status}</span>
                      {e.status === 'draft' && (
                        <button
                          type="button"
                          className="mny-btn yes"
                          disabled={!canMutate}
                          title={canMutate ? 'Review the live envelope, then approve' : mutateBlockedWhy}
                          onClick={() => setReview({ envelopeId: e.id, mode: 'send' })}
                        >
                          Review &amp; send
                        </button>
                      )}
                      {(e.status === 'draft' || e.status === 'sent') && (
                        <button
                          type="button"
                          className="mny-btn no"
                          disabled={!canMutate}
                          title={canMutate ? 'Review the live envelope, then approve the void' : mutateBlockedWhy}
                          onClick={() => setReview({ envelopeId: e.id, mode: 'void' })}
                        >
                          Void
                        </button>
                      )}
                      <a className="mny-btn" href={TRUSIGN_URL} target="_blank" rel="noreferrer">Open in TruSign</a>
                    </div>
                  </div>
                ))}
                {rows.length === 0 && (
                  <p className="mny-note" style={{ marginBottom: 0 }}>
                    {envelopes.length === 0
                      ? 'TruSign is connected and holds no envelopes yet.'
                      : 'No envelopes match — try a different search or team.'}
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        {wizardOpen && (
          <DraftWizard
            teams={teams}
            onClose={() => setWizardOpen(false)}
            onDone={refreshQuiet}
          />
        )}
        {review && (
          <SendReviewPanel
            envelopeId={review.envelopeId}
            mode={review.mode}
            onClose={() => setReview(null)}
            onDone={refreshQuiet}
          />
        )}
      </HqShell>
    </div>
  );
}
