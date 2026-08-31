/**
 * "Import closed deals" — files in bulk, or typed in by hand.
 *
 * One way in at a time: the MODE decides what Save uses, never "whichever
 * pane happens to have data". Two competing paths with a Save that silently
 * picked one was the mess the TRU OS importer shipped with and had to walk
 * back.
 *
 * Files: several at once, each keeping its own team + source (an actual
 * account distinction, not a formatting one), but ONE column mapping built
 * from the first file's headers — a batch of files is exports of the same
 * report. Each file is its own write, run one at a time and stopped on the
 * first failure, so a failure partway leaves an honest, ordered account of
 * what actually saved instead of an interleaved one.
 *
 * The server refuses a repeated client name per team — two of the same
 * address is fine, two of the same client cannot exist — and reports the
 * skips back rather than erroring, so "already on the books" is a warning
 * line here, not a failure.
 */

import { useMemo, useState, type ChangeEvent } from 'react';

import { importClosingsBatch } from '../../lib/api';
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

interface TypedRow { address: string; client: string; date: string }
const emptyTyped = (): TypedRow => ({ address: '', client: '', date: '' });

export function ImportClosingsModal({
  teams, onClose, onImported,
}: {
  teams: string[];
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
  const [mapping, setMapping] = useState<ColumnMapping>(EMPTY_MAPPING);
  const [typedRows, setTypedRows] = useState<TypedRow[]>([emptyTyped()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<string[] | null>(null);

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
    // Mapping is guessed from the FIRST file and applied to every file.
    setMapping({
      client: guessColumn(good[0].headers, 'client'),
      address: guessColumn(good[0].headers, 'address'),
      date: guessColumn(good[0].headers, 'date'),
      agent: guessColumn(good[0].headers, 'agent'),
    });
    if (bad) setError(`${bad} file${bad === 1 ? ' had' : 's had'} no readable rows and ${bad === 1 ? 'was' : 'were'} skipped.`);
  }

  const perFile = useMemo(
    () => files.map((f) => ({ file: f, ...dealsFromRows(f.rows, mapping) })),
    [files, mapping],
  );

  // Same-batch repeated client names, flagged before anything is saved — the
  // server would skip them anyway, but seeing "(repeat)" here is what catches
  // the same export dropped in twice.
  const previewRows = useMemo(() => {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    const rows: Array<{ file: string; client: string; address: string; date: string; dup: boolean }> = [];
    for (const p of perFile) {
      for (const d of p.deals) {
        const k = d.client_name.toLowerCase();
        if (seen.has(k)) dupes.add(k);
        seen.add(k);
        rows.push({ file: p.file.name, client: d.client_name, address: d.address, date: d.close_date, dup: false });
      }
    }
    for (const r of rows) r.dup = dupes.has(r.client.toLowerCase());
    return { rows, dupeCount: dupes.size };
  }, [perFile]);

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
      if (r.duplicates.length) line += ` Skipped ${r.duplicates.length} — already on the books.`;
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
        previewRows.dupeCount ? `${previewRows.dupeCount} repeated client name${previewRows.dupeCount === 1 ? '' : 's'}` : '',
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
              {teams.map((t) => <option key={t} value={t}>{t}</option>)}
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
                              {teams.map((t) => <option key={t} value={t}>{t}</option>)}
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

                <p className="mny-sub" style={{ margin: '14px 0 6px' }}>
                  Match your columns — shared across every file
                </p>
                <div className="mny-row">
                  {MAP_FIELDS.map(({ key, label }) => (
                    <div className="grow mny-field" key={key}>
                      <label>{label}</label>
                      <select
                        value={mapping[key] === null ? '' : String(mapping[key])}
                        onChange={(e) => setMapping((m) => ({ ...m, [key]: e.target.value === '' ? null : Number(e.target.value) }))}
                      >
                        <option value="">— none —</option>
                        {files[0].headers.map((h, i) => (
                          <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>

                <div className="mny-peek">
                  <table>
                    <thead>
                      <tr><th>File</th><th>Client</th><th>Address</th><th>Date</th></tr>
                    </thead>
                    <tbody>
                      {previewRows.rows.slice(0, 50).map((r, i) => (
                        <tr key={i} className={r.dup ? 'dup' : ''}>
                          <td>{r.file}</td>
                          <td>{r.client}{r.dup ? ' (repeat)' : ''}</td>
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
