import { describe, expect, it } from 'vitest';
import bookPage from '../../public/book/index.html?raw';
import bookScript from '../../public/book/book.js?raw';
import headers from '../../public/_headers?raw';

const INTERNAL_SLUGS = [
  '1-1-with-eric',
  'intro',
  'leadership-sync',
  'deep-dive',
];

describe('public book page meeting-type visibility', () => {
  it('loads the bootstrap from a same-origin file, not an inline script', () => {
    expect(bookPage).toMatch(/<script src="book\.js"><\/script>/);
    expect(bookPage).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(bookPage).not.toMatch(/\son\w+\s*=/);
    expect(headers).toMatch(/script-src 'self'/);
    expect(headers).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it('allowlists only the public consult slug', () => {
    const match = bookScript.match(/var PUBLIC_SLUGS = (\[[^\]]*\])/);
    expect(match).toBeTruthy();
    const slugs = JSON.parse(match![1].replace(/'/g, '"')) as string[];
    expect(slugs).toEqual(['client-consultation-call']);
    for (const slug of INTERNAL_SLUGS) {
      expect(slugs).not.toContain(slug);
    }
  });

  it('does not list every published type on bare /book/', () => {
    const showTypes = bookScript.slice(
      bookScript.indexOf('function showTypes()'),
      bookScript.indexOf('function pickType('),
    );
    expect(showTypes).toContain('publicSlugQuery()');
    expect(showTypes).toContain('isPublicSlug(t.slug)');
    expect(showTypes).not.toMatch(
      /published=eq\.true&order=sort_order\.asc/,
    );
  });

  it('refuses unknown or internal ?t= instead of falling back to all published types', () => {
    const entry = bookScript.slice(bookScript.indexOf('/* ---------------- entry ---------------- */'));
    expect(entry).toContain('isPublicSlug(path)');
    expect(entry).toContain('isPublicSlug(row.slug)');
    expect(entry).toContain('slug=eq.');
    expect(entry).not.toMatch(/\.catch\(showTypes\)/);
  });
});
