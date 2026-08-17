import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/truHqDark.css'), 'utf8');
const darkBlock = css.slice(css.indexOf('.tru-dark {'), css.indexOf('html[data-theme="warm"]'));

describe('truHqDark hierarchy tokens', () => {
  it('keeps near-black + cream + brass, with neutralized surfaces', () => {
    expect(darkBlock).toMatch(/--base:\s*#0C0A08;/);
    expect(darkBlock).toMatch(/--panel:\s*#151310;/);
    expect(darkBlock).toMatch(/--card:\s*#1C1915;/);
    expect(darkBlock).toMatch(/--card-flat:\s*#171410;/);
    expect(darkBlock).toMatch(/--border:\s*rgba\(243,\s*236,\s*224,\s*0\.18\);/);
    expect(darkBlock).toMatch(/--border-soft:\s*rgba\(243,\s*236,\s*224,\s*0\.10\);/);
    expect(darkBlock).toMatch(/--text-60:\s*#BDB3A6;/);
    expect(darkBlock).toMatch(/--text-50:\s*#9D9285;/);
    expect(darkBlock).toMatch(/--text-40:\s*#7C7165;/);
    expect(darkBlock).toMatch(/--accent:\s*#E9A23B;/);
    expect(darkBlock).toMatch(/--accent-hi:\s*#F2C079;/);
  });

  it('cuts hero brown fog without flattening the radial + linear stack', () => {
    expect(darkBlock).toMatch(/--hero-grad:\s*radial-gradient\([^)]*#2a1e0e[^)]*#21190f[^)]*transparent 44%/);
    expect(darkBlock).toMatch(/--hero-grad-alt:\s*radial-gradient\([^)]*#2a1e0e[^)]*#21190f[^)]*transparent 44%/);
    expect(darkBlock).toMatch(/--hero-grad:[^;]*linear-gradient\(150deg, #17110a 0%, #0d0a06 72%\)/);
  });

  it('uses warm-neutral empty gauge tracks and keeps brass progress tokens', () => {
    expect(darkBlock).toMatch(/--track-fill:\s*#2B2824;/);
    expect(darkBlock).toMatch(/--track-fill-2:\s*#24211E;/);
    expect(darkBlock).toMatch(/--accent:\s*#E9A23B;/);
  });

  it('quiets Rep ambient, hero bloom, and decorative waves', () => {
    expect(css).toMatch(/\.tru-dark \.rp-ambient \{[\s\S]*?radial-gradient\([^)]*rgba\(233, 162, 59, 0\.08\)/);
    expect(css).not.toMatch(/\.tru-dark \.rp-ambient \{[\s\S]*?--sea-soft/);
    expect(css).toMatch(/\.tru-dark \.rp-hero-glow \{[\s\S]*?rgba\(233, 162, 59, 0\.08\)/);
    expect(css).not.toMatch(/\.tru-dark \.rp-hero-glow \{[\s\S]*?rgba\(201, 150, 47/);
    expect(css).toMatch(/\.tru-dark \.rp-hero-sub \{[\s\S]*?rgba\(248, 242, 232, 0\.76\)/);
    expect(css).toMatch(/\.tru-dark \.rp-canvas \.ps-divider \{[\s\S]*?opacity:\s*0\.4;/);
  });

  it('does not ship the Dark/Warm toggle styles', () => {
    expect(css).not.toMatch(/\.theme-toggle/);
    expect(css).not.toMatch(/\.theme-knob/);
  });
});
