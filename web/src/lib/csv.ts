/**
 * CSV import for closed deals — the pure functions behind ImportClosingsModal.
 *
 * Ported from TRU Operating System's importer (jarvis-closings.js), where each
 * of these earned its shape in production: the hand-rolled parser exists
 * because brokerage exports quote addresses that contain commas, Excel prepends
 * a BOM that silently breaks the first header's match, and every office types
 * dates its own way. Kept dependency-free and DOM-free so it can be tested
 * without a browser.
 */

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

/** Quoted fields, doubled quotes, CRLF, BOM. Returns null when the file has no
 *  usable rows at all — the caller words that refusal, not this function. */
export function parseCSV(text: string): ParsedCsv | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const clean = rows.filter((r) => r.some((v) => v.trim() !== ''));
  if (!clean.length) return null;
  return { headers: clean[0].map((h) => h.trim()), rows: clean.slice(1) };
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function iso(y: number, mo: number, d: number): string | null {
  // Bounds, not calendar math: "2/30" slips through, but "13/40" and a
  // two-digit year that never got expanded do not. Matches the importer this
  // was ported from, so the same files read the same way in both places.
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2100)) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Whatever the office typed → YYYY-MM-DD, or null if it isn't a date.
 *  Accepts ISO, M/D/YY(YY) with / or -, and "Mon D, YYYY" with ordinals;
 *  a missing year means the current one. */
export function normalDate(v: string | null | undefined): string | null {
  v = (v || '').trim();
  if (!v) return null;
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = v.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (m) {
    let y = m[3] ? +m[3] : new Date().getFullYear();
    if (y < 100) y += 2000;
    return iso(y, +m[1], +m[2]);
  }
  m = v.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?$/);
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()];
    if (!mo) return null;
    return iso(m[3] ? +m[3] : new Date().getFullYear(), mo, +m[2]);
  }
  return null;
}

export type GuessKey = 'client' | 'address' | 'date' | 'agent';

/** Header-name guesses, tried in order — the FIRST pattern with a hit wins,
 *  which is why "close date" outranks the generic /date/ for the date column
 *  and /client/ outranks /name/ for the client one. */
export const GUESS: Record<GuessKey, RegExp[]> = {
  client: [/client/i, /customer/i, /buyer/i, /seller/i, /name/i],
  address: [/address/i, /property/i, /street/i, /listing/i],
  date: [/clos(e|ing)\s*date/i, /date/i, /settled/i],
  agent: [/agent/i, /rep/i, /salesperson/i],
};

/** Which column looks like this field. Same loop the mapping selects prefill
 *  with: earlier patterns beat later ones, and within a pattern the leftmost
 *  matching header wins. Null when nothing matches — the person maps by hand. */
export function guessColumn(headers: string[], key: GuessKey): number | null {
  for (const pattern of GUESS[key]) {
    for (let i = 0; i < headers.length; i++) {
      if (pattern.test(headers[i])) return i;
    }
  }
  return null;
}

export interface ColumnMapping {
  client: number | null;
  address: number | null;
  date: number | null;
  agent: number | null;
}

export interface ImportDeal {
  client_name: string;
  close_date: string;
  address: string;
  agent_name?: string;
}

export interface DealsFromRows {
  deals: ImportDeal[];
  problems: string[];
}

/** Rows → deals under one mapping. A row needs a client name and a readable
 *  date or it is a problem, not a deal — the server would refuse it anyway,
 *  and refusing here names the row number ("+2": one for the header line, one
 *  for zero-indexing) so it can be found in the spreadsheet. Address and agent
 *  are optional. */
export function dealsFromRows(rows: string[][], mapping: ColumnMapping): DealsFromRows {
  const deals: ImportDeal[] = [];
  const problems: string[] = [];
  rows.forEach((r, n) => {
    const client = mapping.client === null ? '' : (r[mapping.client] || '').trim();
    const raw = mapping.date === null ? '' : (r[mapping.date] || '');
    const date = mapping.date === null ? null : normalDate(raw);
    if (!client) { problems.push(`Row ${n + 2}: no client name.`); return; }
    if (!date) { problems.push(`Row ${n + 2}: could not read "${raw.slice(0, 20)}" as a date.`); return; }
    const d: ImportDeal = {
      client_name: client,
      close_date: date,
      address: mapping.address === null ? '' : (r[mapping.address] || '').trim(),
    };
    const agent = mapping.agent === null ? '' : (r[mapping.agent] || '').trim();
    if (agent) d.agent_name = agent;
    deals.push(d);
  });
  return { deals, problems };
}
