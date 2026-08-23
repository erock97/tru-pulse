import { describe, expect, it } from 'vitest';
import publicSite from './PublicSite.tsx?raw';
import notFound from './pages/NotFound.tsx?raw';
import mainSrc from '../main.tsx?raw';
import redirects from '../../public/_redirects?raw';

describe('unknown marketing paths render a real not-found page', () => {
  it('wires not-found to its own view, not Home', () => {
    expect(publicSite).toMatch(/route === 'not-found'/);
    expect(publicSite).toMatch(/<NotFound\s*\/>/);
    expect(publicSite).not.toMatch(/route === 'not-found'[\s\S]{0,40}<Home/);
  });

  it('says page not found and links home, without homepage offer copy', () => {
    expect(notFound).toMatch(/Page not found/i);
    expect(notFound).toMatch(/href="\/"/);
    expect(notFound).not.toMatch(/Apply to work with us/);
    expect(notFound).not.toMatch(/Zillow Preferred/);
    expect(notFound).not.toMatch(/Fractional sales management/);
    expect(notFound).not.toMatch(/Book a call/);
  });

  it('main mounts PublicSite for a not-found match instead of sending it to App', () => {
    // `resolveView` wraps matchPublicRoute and adds the host split. The rule
    // being locked is unchanged: a not-found match mounts PublicSite rather
    // than falling through to App, which signed-out would show the homepage.
    expect(mainSrc).toMatch(/resolveView/);
    expect(mainSrc).toMatch(/publicRoute === 'not-found'|publicRoute \? <PublicSite/);
  });
});

describe('Pages fallback does not disguise unknown paths as a 200 homepage', () => {
  it('sends no-slash marketing paths to the trailing-slash URL, not to /', () => {
    // `/services /index.html 200` is rewritten to the root document, and
    // Pages pretty-URLs then 308 that to `/`. 308 to `/services/` is fine.
    expect(redirects).toMatch(/^\s*\/services\s+\/services\/\s+308\s*$/m);
    expect(redirects).toMatch(/^\s*\/about\s+\/about\/\s+308\s*$/m);
    expect(redirects).toMatch(/^\s*\/apply\s+\/apply\/\s+308\s*$/m);
    expect(redirects).not.toMatch(/^\s*\/services\s+\/index\.html\b/m);
    expect(redirects).not.toMatch(/^\s*\/about\s+\/index\.html\b/m);
    expect(redirects).not.toMatch(/^\s*\/apply\s+\/index\.html\b/m);
    expect(redirects).not.toMatch(/^\s*\/(?:services|about|apply)\s+\/\s+/m);
  });

  it('keeps trailing-slash marketing routes on a 200 SPA shell', () => {
    expect(redirects).toMatch(/^\s*\/services\/\s+\/index\.html\s+200\s*$/m);
    expect(redirects).toMatch(/^\s*\/about\/\s+\/index\.html\s+200\s*$/m);
    expect(redirects).toMatch(/^\s*\/apply\/\s+\/index\.html\s+200\s*$/m);
  });

  it('serves the SPA shell as 404 for anything that is not a real file or route', () => {
    expect(redirects).not.toMatch(/^\s*\/\*\s+\/index\.html\s+200\s*$/m);
    expect(redirects).toMatch(/^\s*\/\*\s+\/index\.html\s+404\s*$/m);
  });
});
