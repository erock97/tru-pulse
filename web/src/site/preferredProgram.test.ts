import { describe, expect, it } from 'vitest';
import aboutPage from './pages/About.tsx?raw';
import homePage from './pages/Home.tsx?raw';
import servicesPage from './pages/Services.tsx?raw';
import publicSite from './PublicSite.tsx?raw';

const FLEX_AS_PROGRAM = /Zillow\s*\/\s*Flex|Zillow Flex conversion|investing in Zillow, Flex/i;

describe('Preferred is the current program name on public marketing pages', () => {
  it('homepage sells Preferred conversion, not Flex', () => {
    // The rule is the program NAME, not any particular sentence. Pinning three
    // exact phrases from one draft made every rewrite of the homepage fail
    // even when it sold Preferred correctly, which teaches the next person to
    // delete the test rather than to keep the rule.
    expect(homePage).toMatch(/Zillow Preferred/);
    expect(homePage).not.toMatch(FLEX_AS_PROGRAM);
    expect(homePage).not.toMatch(/\bFlex\b/);
  });

  it('services sells Preferred conversion, not Flex', () => {
    expect(servicesPage).toMatch(/Zillow Preferred lead conversion/);
    expect(servicesPage).toMatch(/Zillow Preferred conversion/);
    expect(servicesPage).not.toMatch(/Zillow\s*\/\s*Flex/);
    expect(servicesPage).not.toMatch(/Zillow Flex conversion/);
  });

  it('keeps Flex on services only as a lead-source label', () => {
    expect(servicesPage).toMatch(
      /Zillow Premier Agent,\s*Zillow Flex,\s*Zillow Home Loans,\s*Follow Up Boss, or other online lead sources/,
    );
    const flexHits = servicesPage.match(/\bFlex\b/g) ?? [];
    expect(flexHits).toHaveLength(1);
  });

  it('home and services meta describe Preferred, not Flex', () => {
    expect(publicSite).toMatch(/Zillow Preferred conversion/);
    expect(publicSite).not.toMatch(/Zillow Flex conversion/);
  });

  it('does not revert About off Preferred', () => {
    expect(aboutPage).toMatch(/Zillow Preferred/);
    expect(aboutPage).not.toMatch(/\bFlex\b/);
  });
});
