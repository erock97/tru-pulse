import { describe, it, expect } from 'vitest';
import indexHtml from '../../index.html?raw';
import redirects from '../../public/_redirects?raw';
import faviconSvg from '../../public/favicon.svg?raw';
import faviconIco from '../../public/favicon.ico?raw';

describe('marketing icons on disk', () => {
  it('ships a real favicon.ico (ICO header), not an HTML fallback', () => {
    // ICONDIR: reserved 0, type 1 (icon)
    expect([faviconIco.charCodeAt(0), faviconIco.charCodeAt(1), faviconIco.charCodeAt(2), faviconIco.charCodeAt(3)]).toEqual([0, 0, 1, 0]);
    expect(faviconIco.length).toBeGreaterThan(64);
    expect(faviconIco).not.toMatch(/<!doctype html>/i);
  });

  it('ships a real favicon.svg that reuses the TRU PNG, not a new mark', () => {
    expect(faviconSvg).toMatch(/<svg\b/);
    expect(faviconSvg).toMatch(/image\/png/);
    expect(faviconSvg).not.toMatch(/<!doctype html>/i);
  });
});

describe('index.html icon and share tags', () => {
  it('declares favicon, svg, and apple-touch links so the tab is not the default', () => {
    expect(indexHtml).toMatch(/<link[^>]+rel="icon"[^>]+href="\/favicon\.ico"/);
    expect(indexHtml).toMatch(/<link[^>]+rel="icon"[^>]+href="\/favicon\.svg"/);
    expect(indexHtml).toMatch(/<link[^>]+rel="apple-touch-icon"[^>]+href="\/apple-touch-icon\.png"/);
  });

  it('declares og:image and twitter:image at the existing 512 icon', () => {
    expect(indexHtml).toMatch(/property="og:image"[^>]+content="https:\/\/truhq\.co\/icon-512\.png"/);
    expect(indexHtml).toMatch(/name="twitter:image"[^>]+content="https:\/\/truhq\.co\/icon-512\.png"/);
    expect(indexHtml).toMatch(/name="twitter:card"[^>]+content="summary_large_image"/);
  });
});

describe('SPA fallback does not swallow icon URLs', () => {
  it('names the static icon paths so the catch-all is not the only rule', () => {
    // Cloudflare Pages serves a real file in public/ before applying _redirects.
    // The splat must stay last; the icon paths are listed above it so a reviewer
    // can see they are not meant to become index.html.
    expect(redirects).toMatch(/\/favicon\.ico/);
    expect(redirects).toMatch(/\/favicon\.svg/);
    expect(redirects).toMatch(/\/apple-touch-icon\.png/);
    expect(redirects).toMatch(/\/icon-512\.png/);
    const splatAt = redirects.lastIndexOf('/*');
    const icoAt = redirects.indexOf('/favicon.ico');
    expect(icoAt).toBeGreaterThanOrEqual(0);
    expect(splatAt).toBeGreaterThan(icoAt);
  });
});
