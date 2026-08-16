import { describe, expect, it } from 'vitest';
import bookScript from '../../public/book/book.js?raw';
import sql from '../../../db/meeting_types_public_read.sql?raw';

const PUBLIC_SLUG = 'client-consultation-call';
const INTERNAL_SLUGS = [
  '1-1-with-eric',
  'intro',
  'leadership-sync',
  'deep-dive',
];

describe('meeting_types public RLS migration (repo only — not applied live)', () => {
  it('adds is_public that defaults false for current and future rows', () => {
    expect(sql).toMatch(
      /add column if not exists is_public\s+boolean\s+not null\s+default false/i,
    );
    expect(sql).not.toMatch(/is_public\s+boolean\s+not null\s+default true/i);
  });

  it('marks only the public consult as is_public', () => {
    expect(sql).toMatch(
      new RegExp(`is_public\\s*=\\s*\\(slug\\s*=\\s*'${PUBLIC_SLUG}'\\)`, 'i'),
    );
    expect(sql).not.toMatch(/set\s+is_public\s*=\s*true/i);
    for (const slug of INTERNAL_SLUGS) {
      expect(sql).not.toContain(`'${slug}'`);
    }
  });

  it('tightens meeting_types_public_read so anon needs published and is_public', () => {
    expect(sql).toMatch(/drop policy if exists meeting_types_public_read on meeting_types/i);
    expect(sql).toMatch(/create policy meeting_types_public_read on meeting_types/i);
    expect(sql).toMatch(/for select/i);
    expect(sql).toMatch(/to anon,\s*authenticated/i);
    expect(sql).toMatch(
      /using\s*\(\s*published\s*=\s*true\s+and\s+is_public\s*=\s*true\s*\)/i,
    );
    expect(sql).not.toMatch(
      /create policy meeting_types_public_read[\s\S]*using\s*\(\s*published\s*=\s*true\s*\)/i,
    );
  });

  it('keeps an authenticated owner read so Eric still sees his own internal types', () => {
    expect(sql).toMatch(/create policy meeting_types_owner_read on meeting_types/i);
    expect(sql).toMatch(/to authenticated/i);
    expect(sql).toMatch(/user_id\s*=\s*\(select auth\.uid\(\)\)/i);
  });

  it('keeps the client allowlist as defense in depth and does not query is_public yet', () => {
    const match = bookScript.match(/var PUBLIC_SLUGS = (\[[^\]]*\])/);
    expect(match).toBeTruthy();
    const slugs = JSON.parse(match![1].replace(/'/g, '"')) as string[];
    expect(slugs).toEqual([PUBLIC_SLUG]);
    expect(bookScript).not.toMatch(/is_public=eq/);
  });
});
