import { createElement } from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConversionComparison } from './ConversionComparison';
import { WINDOWS } from '../lib/rosterData';

describe('overall conversion comparison',()=>{
 it('keeps the current overall rate and evidence counts identical across periods',()=>{
  for(const period of [7,14,90,'mtd','6mo'] as const){
   const html=renderToStaticMarkup(createElement(ConversionComparison,{current:{leads:120,contracts:5,perContract:24},period,through:'2026-09-05'}));
   expect(html).toContain('1 in 24');
   expect(html).toContain('1 in 24');
   expect(html).toContain('Latest overall');
   expect(html).not.toContain('through 2026-09-05');
   expect(html).toContain('Historical comparison unavailable');
  }
 });
 it('preserves zero-contract counts without inventing a prior result',()=>{
  const html=renderToStaticMarkup(createElement(ConversionComparison,{current:{leads:20,contracts:0,perContract:null},period:14}));
  expect(html).toContain('0 for 20');
  expect(html).not.toContain('Was 1 in');
  expect(WINDOWS.find(w=>w.key==='14d')?.days).toBe(14);
 });
});
