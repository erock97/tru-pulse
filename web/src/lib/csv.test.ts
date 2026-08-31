import { describe, it, expect } from 'vitest';
import { parseCSV, normalDate, guessColumn, dealsFromRows } from './csv';

describe('parseCSV', () => {
  it('reads a plain file into headers and rows', () => {
    const p = parseCSV('Client,Address,Close Date\nJane Doe,123 Main St,2026-07-01\n');
    expect(p).not.toBeNull();
    expect(p!.headers).toEqual(['Client', 'Address', 'Close Date']);
    expect(p!.rows).toEqual([['Jane Doe', '123 Main St', '2026-07-01']]);
  });

  it('keeps a comma inside a quoted field, and unescapes doubled quotes', () => {
    // Addresses are the reason the parser is hand-rolled: every brokerage
    // export quotes them, and half of them contain a comma.
    const p = parseCSV('Client,Address\n"Doe, Jane","123 ""B"" Main St, Unit 4"\n');
    expect(p!.rows).toEqual([['Doe, Jane', '123 "B" Main St, Unit 4']]);
  });

  it('strips the Excel BOM so the first header still matches', () => {
    const p = parseCSV('﻿Client,Date\nJane,1/2/26\n');
    expect(p!.headers[0]).toBe('Client');
  });

  it('handles CRLF line endings and skips blank lines', () => {
    const p = parseCSV('Client,Date\r\nJane,1/2/26\r\n\r\n,\r\n');
    expect(p!.rows).toEqual([['Jane', '1/2/26']]);
  });

  it('returns null for a file with nothing in it', () => {
    expect(parseCSV('')).toBeNull();
    expect(parseCSV('\n , \n')).toBeNull();
  });
});

describe('normalDate', () => {
  it('passes ISO dates through, padded', () => {
    expect(normalDate('2026-07-01')).toBe('2026-07-01');
    expect(normalDate('2026-7-1')).toBe('2026-07-01');
  });

  it('reads M/D/YY and M/D/YYYY, with slashes or dashes', () => {
    expect(normalDate('7/1/26')).toBe('2026-07-01');
    expect(normalDate('7/1/2026')).toBe('2026-07-01');
    expect(normalDate('7-1-2026')).toBe('2026-07-01');
  });

  it('assumes the current year when M/D has none', () => {
    const y = new Date().getFullYear();
    expect(normalDate('7/1')).toBe(`${y}-07-01`);
  });

  it('reads written-out months, ordinals included', () => {
    expect(normalDate('July 1, 2026')).toBe('2026-07-01');
    expect(normalDate('Jul 1st 2026')).toBe('2026-07-01');
    expect(normalDate('Mar. 22nd, 2026')).toBe('2026-03-22');
  });

  it('rejects what is not a date', () => {
    expect(normalDate('pending')).toBeNull();
    expect(normalDate('13/40/2026')).toBeNull();
    expect(normalDate('Notamonth 5, 2026')).toBeNull();
    expect(normalDate('')).toBeNull();
    expect(normalDate(undefined)).toBeNull();
  });
});

describe('guessColumn', () => {
  const headers = ['Buyer Name', 'Property Address', 'Closing Date', 'Agent'];

  it('maps the usual export headers', () => {
    expect(guessColumn(headers, 'client')).toBe(0);
    expect(guessColumn(headers, 'address')).toBe(1);
    expect(guessColumn(headers, 'date')).toBe(2);
    expect(guessColumn(headers, 'agent')).toBe(3);
  });

  it('prefers "close date" over any other column with "date" in it', () => {
    // A file with a Created Date first must still pick the closing date —
    // the earlier GUESS pattern wins before the generic /date/ runs.
    expect(guessColumn(['Created Date', 'Close Date'], 'date')).toBe(1);
  });

  it('prefers /client/ over the generic /name/', () => {
    expect(guessColumn(['Agent Name', 'Client'], 'client')).toBe(1);
  });

  it('returns null when nothing matches', () => {
    expect(guessColumn(['Foo', 'Bar'], 'date')).toBeNull();
  });
});

describe('dealsFromRows', () => {
  const mapping = { client: 0, address: 1, date: 2, agent: 3 };

  it('builds deals and carries the optional fields', () => {
    const { deals, problems } = dealsFromRows(
      [['Jane Doe', '123 Main St', '7/1/26', 'Sam Agent']],
      mapping,
    );
    expect(problems).toEqual([]);
    expect(deals).toEqual([
      { client_name: 'Jane Doe', close_date: '2026-07-01', address: '123 Main St', agent_name: 'Sam Agent' },
    ]);
  });

  it('leaves agent_name off when the cell is empty', () => {
    const { deals } = dealsFromRows([['Jane', '', '7/1/26', '']], mapping);
    expect(deals[0].agent_name).toBeUndefined();
    expect(deals[0].address).toBe('');
  });

  it('rejects a row with no client and a row with an unreadable date, and counts both', () => {
    const { deals, problems } = dealsFromRows(
      [
        ['', '1 Elm St', '7/1/26', ''],
        ['Jane', '2 Elm St', 'sometime soon', ''],
        ['Bob', '3 Elm St', '7/2/26', ''],
      ],
      mapping,
    );
    expect(deals).toHaveLength(1);
    expect(problems).toHaveLength(2);
    // Row numbers are spreadsheet rows (header is row 1), so a person can
    // find the bad line in the file they exported.
    expect(problems[0]).toContain('Row 2');
    expect(problems[1]).toContain('Row 3');
  });

  it('treats an unmapped required column as missing for every row', () => {
    const { deals, problems } = dealsFromRows(
      [['Jane', '1 Elm St', '7/1/26', '']],
      { ...mapping, client: null },
    );
    expect(deals).toHaveLength(0);
    expect(problems).toHaveLength(1);
  });
});
