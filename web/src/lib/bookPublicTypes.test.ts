import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const bookPage = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../public/book/index.html'),
  'utf8',
);

const INTERNAL_SLUGS = [
  '1-1-with-eric',
  'intro',
  'leadership-sync',
  'deep-dive',
];

describe('public book page meeting-type visibility', () => {
  it('allowlists only the public consult slug', () => {
    const match = bookPage.match(/var PUBLIC_SLUGS = (\[[^\]]*\])/);
    expect(match).toBeTruthy();
    const slugs = JSON.parse(match![1].replace(/'/g, '"')) as string[];
    expect(slugs).toEqual(['client-consultation-call']);
    for (const slug of INTERNAL_SLUGS) {
      expect(slugs).not.toContain(slug);
    }
  });

  it('does not list every published type on bare /book/', () => {
    const showTypes = bookPage.slice(
      bookPage.indexOf('function showTypes()'),
      bookPage.indexOf('function pickType('),
    );
    expect(showTypes).toContain('publicSlugQuery()');
    expect(showTypes).toContain('isPublicSlug(t.slug)');
    expect(showTypes).not.toMatch(
      /published=eq\.true&order=sort_order\.asc/,
    );
  });

  it('refuses unknown or internal ?t= instead of falling back to all published types', () => {
    const entry = bookPage.slice(bookPage.indexOf('/* ---------------- entry ---------------- */'));
    expect(entry).toContain('isPublicSlug(path)');
    expect(entry).toContain('isPublicSlug(row.slug)');
    expect(entry).toContain('slug=eq.');
    expect(entry).not.toMatch(/\.catch\(showTypes\)/);
  });
});
