/**
 * Admin — Failure Logs.
 *
 * Sanitized pipeline incidents the Hermes laptop reported, grouped by
 * recurring problem (fingerprint). Only a platform owner ever sees this
 * (gated the same way as every other /admin/* screen: the caller must
 * resolve through GET /admin/failure-logs, which the Worker only answers for
 * an account listed in the `admins` table).
 *
 * Plain-language fields lead every card — date, severity, status, team,
 * stage, what happened, impact, next step. Code, fingerprint, incident id and
 * the sanitized technical message sit behind a "Technical details" toggle,
 * so a non-developer can read the card top to bottom and still have
 * something to hand an engineer.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { HqShell } from '../components/hqShell';
import {
  adminFailureLogs, adminUpdateFailureLog, signOutClean,
  type FailureLogProblem, type FailureLogSeverity, type FailureLogStatus,
} from '../lib/api';

const STATUS_LABELS: Record<FailureLogStatus, string> = {
  open: 'Open',
  investigating: 'Investigating',
  fixed: 'Fixed',
  'needs-human': 'Needs a human',
  verified: 'Verified',
};

// What each scope means in plain English — this is the line that tells a
// broker whether one contact was skipped, a whole team was withheld, or the
// batch could not safely continue at all.
const SCOPE_LABELS: Record<string, string> = {
  event: 'One event',
  contact: 'One contact was skipped — the team continued',
  team: 'One team was withheld — other teams continued',
  batch: 'The whole batch stopped — safe continuation was impossible',
  delivery: 'A delivery step',
};

export function failureKind(scope: string, code: string, continued: boolean, fatal: boolean): string {
  if (/AUTH|MFA|LOGIN|CREDENTIAL/i.test(code)) return 'Authentication or MFA issue: human action required';
  if (/DEFECT|BUG|UNSUPPORTED|MESSAGE_DIRECTION_UNKNOWN/i.test(code)) return 'Application defect: eligible for Brian’s bounded repair review; production is not automatically rerun';
  if (fatal && scope === 'batch') return SCOPE_LABELS.batch;
  if (!fatal && continued && (scope === 'contact' || scope === 'team')) return SCOPE_LABELS[scope];
  return scope + (continued ? ': processing continued' : ': processing stopped');
}

export function FailureLogsEmpty() { return <p>No incidents match these filters.</p>; }

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export function ProblemCard({
  problem, onStatusChange,
}: {
  problem: FailureLogProblem;
  onStatusChange: (fingerprint: string, status: FailureLogStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState(problem.resolutionNotes ?? '');
  const [saveError, setSaveError] = useState('');
  const latest = problem.latest;
  const fatal = problem.severity === 'fatal';

  return (
    <article
      className="rs-plate dk-table"
      style={{ padding: 22, borderLeft: `3px solid ${fatal ? '#d1453b' : 'var(--accent-hi, #a9791f)'}` }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <span className="dk-eyebrow" style={fatal ? { color: '#d1453b' } : undefined}>
            <i />{fatal ? 'Fatal' : 'Non-fatal'} · {latest ? failureKind(latest.scope, latest.code, latest.continued, fatal) : problem.stage}
          </span>
          <h3 style={{ margin: '4px 0 2px' }}>{problem.title}</h3>
          <p style={{ margin: 0, color: 'var(--text-60)', fontSize: 13 }}>
            {problem.affectedAccountIds.join(', ') || '—'} · {problem.stage}
          </p>
        </div>
        <div style={{ textAlign: 'right', minWidth: 160 }}>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-60)' }}>Last seen {formatWhen(problem.lastSeen)}</p>
          {(
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--accent-hi, #a9791f)' }}>
              {problem.occurrenceCount}× since {formatWhen(problem.firstSeen)}
            </p>
          )}
        </div>
      </div>

      {latest && (
        <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
          <p style={{ margin: 0 }}><b>What happened:</b> {latest.explanation}</p>
          <p style={{ margin: 0 }}><b>Impact:</b> {latest.impact}</p>
          <p style={{ margin: 0 }}><b>Recommended next step:</b> {latest.nextStep}</p>
          <p style={{ margin: 0, color: 'var(--text-60)', fontSize: 13 }}>
            Processing {latest.continued ? 'continued' : 'did not continue'} · most recent batch{' '}
            {latest.batchId ?? '—'}
          </p>
        </div>
      )}

      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <select
          className="ad-input"
          aria-label="Resolution status"
          value={problem.status}
          disabled={saving}
          onChange={async (e) => {
            const next = e.target.value as FailureLogStatus;
            setSaving(true);
            const ok = await adminUpdateFailureLog(problem.fingerprint, { status: next });
            setSaving(false);
            if (ok) onStatusChange(problem.fingerprint, next);
            setSaveError(ok ? '' : 'Could not save changes. Please retry.');
          }}
        >
          {(Object.keys(STATUS_LABELS) as FailureLogStatus[]).map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
        <button
          className="side-link-btn"
          style={{ padding: '6px 12px' }}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Hide technical details' : 'Technical details'}
        </button>
      </div>

      <label style={{ display: 'grid', gap: 6, marginTop: 14 }}>Resolution notes
        <textarea className="ad-input" maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} />
      </label>
      <button className="side-link-btn" disabled={saving} onClick={async () => {
        setSaving(true);
        const ok = await adminUpdateFailureLog(problem.fingerprint, { notes });
        setSaving(false);
        setSaveError(ok ? 'Notes saved.' : 'Could not save notes. Please retry.');
      }}>Save notes</button>
      {saveError && <p role="status">{saveError}</p>}
      {open && latest && (
        <div
          style={{
            marginTop: 12, padding: 14, borderRadius: 10, background: 'rgba(0,0,0,0.18)',
            fontSize: 12.5, fontFamily: 'ui-monospace, SFMono-Regular, monospace', display: 'grid', gap: 6,
          }}
        >
          <div>fingerprint: {problem.fingerprint}</div>
          <div>latest incidentId: {latest.incidentId}</div>
          <div>code: {latest.code}</div>
          {latest.position != null && latest.total != null && <div>position: {latest.position} / {latest.total}</div>}
          <div>batches: {problem.affectedBatchIds.join(', ')}</div>
          {latest.technical != null && (
            <pre style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{JSON.stringify(latest.technical, null, 2)}</pre>
          )}
        </div>
      )}
    </article>
  );
}

export default function AdminFailureLogs({
  onOpenPulse, onOpenCoach, onOpenRep,
}: {
  onOpenPulse: () => void;
  onOpenCoach: () => void;
  onOpenRep: () => void;
}) {
  const [problems, setProblems] = useState<FailureLogProblem[] | null | undefined>(undefined);
  const [status, setStatus] = useState<FailureLogStatus | ''>('');
  const [severity, setSeverity] = useState<FailureLogSeverity | ''>('');
  const [accountId, setAccountId] = useState('');
  const [stage, setStage] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [recurring, setRecurring] = useState<'' | 'yes' | 'no'>('');

  const load = useCallback(async () => {
    setProblems(await adminFailureLogs({
      status: status || undefined,
      severity: severity || undefined,
      accountId: accountId.trim() || undefined,
      stage: stage.trim() || undefined,
      since: since ? new Date(`${since}T00:00:00Z`).toISOString() : undefined,
      until: until ? new Date(`${until}T23:59:59Z`).toISOString() : undefined,
      recurring: recurring === '' ? undefined : recurring === 'yes',
    }));
  }, [status, severity, accountId, stage, since, until, recurring]);
  useEffect(() => { void load(); }, [load]);

  const handleStatusChange = useCallback((fingerprint: string, next: FailureLogStatus) => {
    setProblems((prev) => prev?.map((p) => (p.fingerprint === fingerprint ? { ...p, status: next } : p)) ?? prev);
  }, []);

  const openFatalCount = useMemo(
    () => (problems ?? []).filter((p) => p.severity === 'fatal' && p.status !== 'fixed' && p.status !== 'verified').length,
    [problems],
  );

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
        onOpenFailureLogs={() => { window.location.hash = '/admin/failure-logs'; }}
        hideTopbar
      >
        <div className="dk-main">
          <header className="dk-mast">
            <div>
              <span className="dk-eyebrow"><i />Platform owner</span>
              <h1>Failure <em>logs</em>.</h1>
              <p className="dk-sub">
                Sanitized pipeline incidents Hermes reported, grouped by recurring problem — no lead names,
                messages, or credentials ever land here.
                {problems && (
                  <>
                    {' '}{problems.length} {problems.length === 1 ? 'issue' : 'issues'} shown
                    {openFatalCount > 0 && <>, {openFatalCount} fatal and unresolved</>}.
                  </>
                )}
              </p>
            </div>
          </header>

          <div className="dk-sec" style={{ flexWrap: 'wrap', gap: 10, rowGap: 10 }}>
            <select className="ad-input" value={status} onChange={(e) => setStatus(e.target.value as FailureLogStatus | '')} aria-label="Status">
              <option value="">Any status</option>
              {(Object.keys(STATUS_LABELS) as FailureLogStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
            <select className="ad-input" value={severity} onChange={(e) => setSeverity(e.target.value as FailureLogSeverity | '')} aria-label="Severity">
              <option value="">Any severity</option>
              <option value="fatal">Fatal</option>
              <option value="nonfatal">Non-fatal</option>
            </select>
            <input
              className="ad-input adm-search"
              placeholder="Team / account…"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              aria-label="Team or account"
            />
            <input
              className="ad-input adm-search"
              placeholder="Stage…"
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              aria-label="Pipeline stage"
            />
            <input className="ad-input" type="date" value={since} onChange={(e) => setSince(e.target.value)} aria-label="Since" />
            <input className="ad-input" type="date" value={until} onChange={(e) => setUntil(e.target.value)} aria-label="Until" />
            <select className="ad-input" value={recurring} onChange={(e) => setRecurring(e.target.value as '' | 'yes' | 'no')} aria-label="Recurring">
              <option value="">Recurring & one-time</option>
              <option value="yes">Recurring only</option>
              <option value="no">One-time only</option>
            </select>
          </div>

          {problems === undefined ? (
            <div className="center-wrap"><div className="spinner" /></div>
          ) : problems === null ? (
            <div className="rs-plate dk-table" style={{ padding: 28 }}>
              <p style={{ margin: 0, color: 'var(--text-60)' }}>Could not load Failure Logs.</p>
            </div>
          ) : problems.length === 0 ? (
            <div className="rs-plate dk-table" style={{ padding: 28 }}>
              <FailureLogsEmpty />
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 14, marginTop: 14 }}>
              {problems.map((p) => (
                <ProblemCard key={p.fingerprint} problem={p} onStatusChange={handleStatusChange} />
              ))}
            </div>
          )}
        </div>
      </HqShell>
    </div>
  );
}
