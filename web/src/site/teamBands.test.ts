import { describe, expect, it } from 'vitest';
import applyPage from './pages/Apply.tsx?raw';
import servicesPage from './pages/Services.tsx?raw';
import { packageForAgentCount, TEAM_BANDS, TEAM_SIZE_OPTIONS } from './teamBands';

describe('team bands', () => {
  it('is exactly the four existing packages, no fifth', () => {
    expect(TEAM_BANDS.map((b) => b.name)).toEqual([
      'Essentials',
      'Performance',
      'Performance+',
      'Mega Team',
    ]);
    expect(TEAM_SIZE_OPTIONS).toHaveLength(4);
  });

  it('uses the same exclusive labels the apply form will store', () => {
    expect(TEAM_SIZE_OPTIONS).toEqual([
      'Up to 10 agents',
      '11 to 20 agents',
      '21 to 40 agents',
      '41+ agents',
    ]);
  });

  it('maps a given roster size to one package', () => {
    expect(packageForAgentCount(1)?.name).toBe('Essentials');
    expect(packageForAgentCount(10)?.name).toBe('Essentials');
    expect(packageForAgentCount(11)?.name).toBe('Performance');
    expect(packageForAgentCount(12)?.name).toBe('Performance');
    expect(packageForAgentCount(20)?.name).toBe('Performance');
    expect(packageForAgentCount(21)?.name).toBe('Performance+');
    expect(packageForAgentCount(40)?.name).toBe('Performance+');
    expect(packageForAgentCount(41)?.name).toBe('Mega Team');
    expect(packageForAgentCount(100)?.name).toBe('Mega Team');
  });

  it('has no overlapping inclusive edges', () => {
    for (let n = 1; n <= 80; n++) {
      const hits = TEAM_BANDS.filter((b) => n >= b.minAgents && n <= b.maxAgents);
      expect(hits, `${n} agents matched ${hits.map((h) => h.band).join(', ')}`).toHaveLength(1);
    }
  });

  it('does not invent a package for a non-roster', () => {
    expect(packageForAgentCount(0)).toBeNull();
    expect(packageForAgentCount(-3)).toBeNull();
    expect(packageForAgentCount(Number.NaN)).toBeNull();
  });

  it('fits the worker teamSize cap (40 chars, free string, no enum)', () => {
    for (const band of TEAM_SIZE_OPTIONS) {
      expect(band.length).toBeLessThanOrEqual(40);
    }
  });
});

describe('apply and services stay on the shared bands', () => {
  it('both pages import the shared labels instead of restating them', () => {
    expect(applyPage).toMatch(/from ['"]\.\.\/teamBands['"]/);
    expect(servicesPage).toMatch(/from ['"]\.\.\/teamBands['"]/);
  });

  it('drops the old apply buckets and the overlapping services edges', () => {
    expect(applyPage).not.toMatch(/1 \(just me\)|2–5|6–20|21–50|50\+/);
    expect(servicesPage).not.toMatch(/'10 to 20 agents'|'20 to 40 agents'|'40\+ agents'/);
  });
});
