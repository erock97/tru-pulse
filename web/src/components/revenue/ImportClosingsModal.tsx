/**
 * "Import closed deals" — files in bulk, or typed in by hand.
 *
 * One way in at a time: the MODE decides what Save uses, never "whichever
 * pane happens to have data". Two competing paths with a Save that silently
 * picked one was the mess the TRU OS importer shipped with and had to walk
 * back.
 *
 * Files: several at once, each keeping its own team + source (an actual
 * account distinction, not a formatting one). Column mapping is guessed PER
 * HEADER LAYOUT, not once for the batch — the TRU OS importer applied the
 * first file's mapping to every file, and a second file with its columns in
 * a different order quietly wrote addresses into the wrong field or dropped
 * them. Files sharing a layout share one mapping editor; a file with its own
 * layout gets its own. Each file is its own write, run one at a time and
 * stopped on the first failure, so a failure partway leaves an honest,
 * ordered account of what actually saved instead of an interleaved one.
 *
 * Duplicates, the rule (Eric's, verbatim in spirit): the same client on two
 * different addresses is fine, the same address under two names is fine
 * (buyer and seller) — the same client AND the same address is a duplicate.
 * The server enforces it (treating a blank address as "can't tell", which
 * skips rather than double-bills) and reports skips back as "already on the
 * books". The "(repeat)" flag in the preview follows the same rule, so a
 * legitimate buyer/seller pair no longer cries wolf.
 */

import { useMemo, useState, type ChangeEvent } from 'react';

import { importClosingsBatch, type MoneyTeamConfig } from '../../lib/api';
import { dealsFromRows, guessColumn, parseCSV, type ColumnMapping } from '../../lib/csv';
import { KNOWN_SOURCES } from './RateCardEditor';

interface FileEntry {
  name: string;
  headers: string[];
  rows: string[][];
  team: string;
  source: string;
}

const EMPTY_MAPPING: ColumnMapping = { client: null, address: null, date: null, agent: null };
const MAP_FIELDS: Array<{ key: keyof ColumnMapping; label: string }> = [
  { key: 'client', label: 'Client name' },
  { key: 'address', label: 'Address' },
  { key: 'date', label: 'Close date' },
  { key: 'agent', label: 'Agent (optional)' },
];

/* Two files "share a layout" when their headers match, case-insensitively.
 * The signature is what a mapping is keyed by. */
const sigOf = (headers: string[]) => headers.map((h) => h.trim().toLowerCase()).join('');

const guessAll = (headers: string[]): ColumnMapping => ({
  client: guessColumn(headers, 'client'),
  address: guessColumn(headers, 'address'),
  date: guessColumn(headers, 'date'),
  agent: guessColumn(headers, 'agent'),
});

interface TypedRow { address: string; client: string; date: string }
const emptyTyped = (): TypedRow => ({ address: '', client: '', date: '' });

/* Does this team's rate card price this source? Matched the way the ledger
 * matches (trimmed, case-insensitive); a team with a default rate prices
 * everything. Null = can't tell (unknown team), which warns nobody. */
function sourceIsPriced(team: MoneyTeamConfig | undefined, source: string): boolean | null {
  if (!team) return null;
  if (team.defaultRate !== null) return true;
  const want = source.trim().toLowerCase();
  if (!want) return null;
  return team.rates.some((r) => r.source.trim().toLowerCase() === want);
}

export function ImportClosingsModal({
  teams, onClose, onImported,
}: {
  teams: MoneyTeamConfig[];
  onClose: () => void;
  /** Quiet overview refresh once anything actually saved. */
  onImported: () => void;
}) {
  const [mode, setMode] = useState<'file' | 'type'>('file');
  // Top-level pickers: the default team/source stamped onto each new file,
  // and the ONE team/source a typed batch belongs to.
  const [topTeam, setTopTeam] = useState('');
  const [topSource, setTopSource] = useState('');
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [mappings, setMappings] = useState<Record<string, ColumnMapping>>({});
  const [typedRows, setTypedRows] = useState<TypedRow[]>([emptyTyped()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<string[] | null>(null);

  const teamNames = teams.map((t) => t.name);
  const teamByName = useMemo(() => new Map(teams.map((t) => [t.name, t])), [teams]);

  const setFile = (i: number, patch: Partial<FileEntry>) =>
    setFiles((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));

  async function readFiles(e: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    if (!picked.length) return;
    setError('');
    setReport(null);
    const parsed = await Promise.all(picked.map(async (f) => {
      const p = parseCSV(await f.text());
      return p && p.rows.length
        ? { name: f.name, headers: p.headers, rows: p.rows, team: topTeam, source: topSource.trim() }
        : null;
    }));
    const good = parsed.filter((p): p is FileEntry => p !== null);
    const bad = parsed.length - good.length;
    if (!good.length) {
      setError(parsed.length === 1 ? "Couldn't find any rows in that file." : "Couldn't find any rows in those files.");
      return;
    }
    setFiles(good);
    // One guessed mapping per distinct header layout.
    const next: Record<string, ColumnMapping> = {};
    for (const f of good) {
      const sig = sigOf(f.headers);
      if (!next[sig]) next[sig] = guessAll(f.headers);
    }
    setMappings(next);
    if (bad) setError(`${bad} file${bad === 1 ? ' had' : 's had'} no readable rows and ${bad === 1 ? 'was' : 'were'} skipped.`);
  }

  const perFile = useMemo(
    () => files.map((f) => ({ file: f, ...dealsFromRows(f.rows, mappings[sigOf(f.headers)] ?? EMPTY_MAPPING) })),
    [files, mappings],
  );

  /* The distinct header layouts in this batch, each with the files it covers —
   * one mapping editor per layout. Almost always exactly one. */
  const layouts = useMemo(() => {
    const out: Array<{ sig: string; headers: string[]; fileNames: string[] }> = [];
    for (const f of files) {
      const sig = sigOf(f.headers);
      const hit = out.find((l) => l.sig === sig);
      if (hit) hit.fileNames.push(f.name);
      else out.push({ sig, headers: f.headers, fileNames: [f.name] });
    }
    return out;
  }, [files]);

  // Same-batch duplicates, flagged before anything is saved, by the REAL
  // rule: same client + same close month + the same address (a blank address
  // on either side can't rule a match out, so it counts as one — mirroring
  // the server, which would rather skip than double-bill).
  const previewRows = useMemo(() => {
    const rows: Array<{ file: string; client: string; address: string; date: string; dup: boolean }> = [];
    for (const p of perFile) {
      for (const d of p.deals) {
        rows.push({ file: p.file.name, client: d.client_name, address: d.address, date: d.close_date, dup: false });
      }
    }
    let dupCount = 0;
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i]; const b = rows[j];
        if (a.client.trim().toLowerCase() !== b.client.trim().toLowerCase()) continue;
        if (a.date.slice(0, 7) !== b.date.slice(0, 7)) continue;
        const aa = a.address.trim().toLowerCase(); const ba = b.address.trim().toLowerCase();
        if (aa && ba && aa !== ba) continue; // same client, different addresses — two real deals
        if (!a.dup) { a.dup = true; dupCount++; }
        if (!b.dup) { b.dup = true; dupCount++; }
      }
    }
    return { rows, dupCount };
  }, [perFile]);

  /* An unpriced source is the quiet way a month under-bills: the deals land,
   * show "no rate set", and earn $0 until someone notices. Said HERE, at
   * import time, instead. */
  const sourceWarnings = useMemo(() => {
    const pairs = mode === 'file'
      ? files.map((f) => ({ team: f.team, source: f.source }))
      : [{ team: topTeam, source: topSource }];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const p of pairs) {
      if (!p.team || !p.source.trim()) continue;
      const k = `${p.team}${p.source.trim().toLowerCase()}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (sourceIsPriced(teamByName.get(p.team), p.source) === false) {
        out.push(
          `${p.team}'s rate card has no rate for "${p.source.trim()}" — these deals will import, show as unpriced, and earn $0 until that source is on the card (Edit rates).`,
        );
      }
    }
    return out;
  }, [mode, files, topTeam, topSource, teamByName]);

  const problemCount = perFile.reduce((s, p) => s + p.problems.length, 0);

  const typedReady = typedRows.filter((r) => r.address.trim() || r.client.trim() || r.date);

  async function saveFiles() {
    const missing = files.filter((f) => !f.team || !f.source.trim());
    if (missing.length) {
      setError(`${missing.length} file${missing.length === 1 ? ' is' : 's are'} missing a team or a source — every file needs both. Nothing was saved.`);
      return;
    }
    setBusy(true);
    setError('');
    const lines: string[] = [];
    let savedAny = false;
    // One write per file, in order, stopped on the first failure — the report
    // then reads top to bottom as "what happened", with nothing interleaved.
    for (const p of perFile) {
      if (!p.deals.length) {
        lines.push(`${p.file.name}: nothing readable to save${p.problems.length ? ` (${p.problems.length} unreadable row${p.problems.length === 1 ? '' : 's'})` : ''}.`);
        continue;
      }
      const r = await importClosingsBatch({ team: p.file.team, source: p.file.source.trim(), deals: p.deals });
      if (!r.ok) {
        lines.push(`${p.file.name}: ${r.error}`);
        lines.push('Stopped there — the files after it were not saved.');
        break;
      }
      savedAny = savedAny || r.imported > 0;
      let line = `${p.file.name}: saved ${r.imported} for ${r.team} (${r.source}).`;
      if (r.duplicates.length) {
        const names = r.duplicates.slice(0, 5).map((d) => d.client_name).join(', ');
        line += ` Skipped ${r.duplicates.length} — already on the books (${names}${r.duplicates.length > 5 ? ', …' : ''}).`;
      }
      if (p.problems.length) line += ` ${p.problems.length} unreadable row${p.problems.length === 1 ? '' : 's'}.`;
      lines.push(line);
    }
    setBusy(false);
    setReport(lines);
    if (savedAny) onImported();
  }

  async function saveTyped() {
    if (!topTeam) { setError('Pick a team first.'); return; }
    if (!topSource.trim()) { setError('Say where these deals came from.'); return; }
    const bad = typedReady.filter((r) => !r.address.trim() || !r.client.trim() || !r.date);
    if (bad.length) {
      setError(`${bad.length} row${bad.length === 1 ? ' is' : 's are'} missing something. Every deal needs an address, a client name and a date. Nothing was saved.`);
      return;
    }
    if (!typedReady.length) { setError('Nothing to save.'); return; }
    setBusy(true);
    setError('');
    const r = await importClosingsBatch({
      team: topTeam,
      source: topSource.trim(),
      deals: typedReady.map((row) => ({
        client_name: row.client.trim(), close_date: row.date, address: row.address.trim(),
      })),
    });
    setBusy(false);
    if (!r.ok) { setError(`Nothing was saved. ${r.error}`); return; }
    const lines = [`Saved ${r.imported} for ${r.team} (${r.source}).`];
    if (r.duplicates.length) lines.push(`Skipped ${r.duplicates.length} — already on the books.`);
    setReport(lines);
    setTypedRows([emptyTyped()]);
    if (r.imported > 0) onImported();
  }

  const countLine = mode === 'file'
    ? (files.length
      ? [
        `${previewRows.rows.length} deal${previewRows.rows.length === 1 ? '' : 's'} ready across ${files.length} file${files.length === 1 ? '' : 's'}`,
        previewRows.dupCount ? `${previewRows.dupCount} duplicate${previewRows.dupCount === 1 ? '' : 's'} (same client + address)` : '',
        problemCount ? `${problemCount} unreadable row${problemCount === 1 ? '' : 's'}` : '',
      ].filter(Boolean).join(' · ')
      : '')
    : (typedReady.length ? `${typedReady.length} deal${typedReady.length === 1 ? '' : 's'} ready` : '');

  return (
    <div className="rp-mgmt-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rp-mgmt-panel" role="dialog" aria-label="Import closed deals">
        <div className="rp-mgmt-head">
          <div>
            <h2 style={{ margin: 0 }}>Add closed deals</h2>
            <p className="mny-modal-sub">
              Drop one file or several — each file keeps its own team and source. Typed entries are one batch, one source.
            </p>
          </div>
          <div className="rp-mgmt-headbtns">
            <button type="button" className="mny-btn" onClick={onClose}>Close</button>
          </div>
        </div>

        <datalist id="imp-sources">
          {KNOWN_SOURCES.map((s) => <option key={s} value={s} />)}
        </datalist>

        <div className="mny-row">
          <div className="grow mny-field">
            <label>Team</label>
            <select value={topTeam} onChange={(e) => setTopTeam(e.target.value)}>
              <option value="">Choose a team…</option>
              {teamNames.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="grow mny-field">
            <label>Where they came from</label>
            <input list="imp-sources" value={topSource} placeholder="Zillow Preferred"
              onChange={(e) => setTopSource(e.target.value)} />
          </div>
        </div>

        <div className="mny-modes">
          <button type="button" className={`mny-mode${mode === 'file' ? ' on' : ''}`}
            onClick={() => { setMode('file'); setError(''); setReport(null); }}>
            Import a file
          </button>
          <button type="button" className={`mny-mode${mode === 'type' ? ' on' : ''}`}
            onClick={() => { setMode('type'); setError(''); setReport(null); }}>
            Type them in
          </button>
        </div>

        {mode === 'file' ? (
          <>
            <div className="mny-field">
              <label>CSV files — from Excel: File → Save As → CSV</label>
              <input type="file" multiple accept=".csv,text/csv" onChange={(e) => void readFiles(e)} />
            </div>

            {files.length > 0 && (
              <>
                <div className="mny-files">
                  <table>
                    <thead>
                      <tr><th>File</th><th>Rows</th><th>Team</th><th>Source</th><th /></tr>
                    </thead>
                    <tbody>
                      {files.map((f, i) => (
                        <tr key={`${f.name}-${i}`}>
                          <td>{f.name}</td>
                          <td>{f.rows.length}</td>
                          <td>
                            <select value={f.team} onChange={(e) => setFile(i, { team: e.target.value })}>
                              <option value="">Choose…</option>
                              {teamNames.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </td>
                          <td>
                            <input list="imp-sources" value={f.source} placeholder="Zillow Preferred"
                              onChange={(e) => setFile(i, { source: e.target.value })} />
                          </td>
                          <td>
                            <button type="button" className="mny-btn" aria-label={`Remove ${f.name}`}
                              onClick={() => setFiles((fs) => fs.filter((_, idx) => idx !== i))}>
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {layouts.map((layout) => (
                  <div key={layout.sig}>
                    <p className="mny-sub" style={{ margin: '14px 0 6px' }}>
                      {layouts.length === 1
                        ? 'Match your columns — shared across every file'
                        : `Match the columns for ${layout.fileNames.join(', ')} (different layout)`}
                    </p>
                    <div className="mny-row">
                      {MAP_FIELDS.map(({ key, label }) => (
                        <div className="grow mny-field" key={key}>
                          <label>{label}</label>
                          <select
                            value={mappings[layout.sig]?.[key] === null || mappings[layout.sig]?.[key] === undefined
                              ? '' : String(mappings[layout.sig][key])}
                            onChange={(e) => setMappings((m) => ({
                              ...m,
                              [layout.sig]: { ...(m[layout.sig] ?? EMPTY_MAPPING), [key]: e.target.value === '' ? null : Number(e.target.value) },
                            }))}
                          >
                            <option value="">— none —</option>
                            {layout.headers.map((h, i) => (
                              <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                <div className="mny-peek">
                  <table>
                    <thead>
                      <tr><th>File</th><th>Client</th><th>Address</th><th>Date</th></tr>
                    </thead>
                    <tbody>
                      {previewRows.rows.slice(0, 50).map((r, i) => (
                        <tr key={i} className={r.dup ? 'dup' : ''}>
                          <td>{r.file}</td>
                          <td>{r.client}{r.dup ? ' (duplicate)' : ''}</td>
                          <td>{r.address}</td>
                          <td>{r.date}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            {typedRows.map((row, i) => (
              <div className="mny-row" key={i}>
                <div className="grow mny-field">
                  <label>Address</label>
                  <input value={row.address} placeholder="123 Main St"
                    onChange={(e) => setTypedRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, address: e.target.value } : r)))} />
                </div>
                <div className="grow mny-field">
                  <label>Client name</label>
                  <input value={row.client} placeholder="Jane Doe"
                    onChange={(e) => setTypedRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, client: e.target.value } : r)))} />
                </div>
                <div className="grow mny-field">
                  <label>Close date</label>
                  <input type="date" value={row.date}
                    onChange={(e) => setTypedRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, date: e.target.value } : r)))} />
                </div>
                <div className="mny-field">
                  <button type="button" className="mny-btn" aria-label="Remove this row"
                    onClick={() => setTypedRows((rs) => rs.filter((_, idx) => idx !== i))}>
                    ×
                  </button>
                </div>
              </div>
            ))}
            <button type="button" className="mny-link" onClick={() => setTypedRows((rs) => [...rs, emptyTyped()])}>
              + add another
            </button>
          </>
        )}

        {sourceWarnings.map((w) => <div className="mny-warn" key={w}>{w}</div>)}
        {error && <div className="mny-err">{error}</div>}
        {report && (
          <div className="mny-report">
            {report.join('\n')}
            {'\n'}They're waiting on the broker's confirmation before they count towards a bill.
          </div>
        )}
        <div className="mny-foot">
          <span className="mny-sub" style={{ marginRight: 'auto', alignSelf: 'center' }}>{countLine}</span>
          <button type="button" className="btn" disabled={busy}
            onClick={() => void (mode === 'file' ? saveFiles() : saveTyped())}>
            {busy ? 'Saving…' : 'Save deals'}
          </button>
        </div>
      </div>
    </div>
  );
}
