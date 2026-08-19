import { describe, it, expect } from 'vitest';
import { pace } from './agentPace';
import type { AgentCommitment } from './api';

const c = (id: string, done: boolean): AgentCommitment =>
  ({ id, body: 'x', agent_done: done, status: null, created_at: '2026-08-10T00:00:00Z' });

describe('pace', () => {
  it('is "none" when the lead has never set a commitment', () => {
    expect(pace([])).toEqual({ done: 0, total: 0, pct: 0, state: 'none' });
  });

  it('is "complete" when every commitment is self-reported done', () => {
    expect(pace([c('1', true), c('2', true)]).state).toBe('complete');
  });

  it('is "behind" below half', () => {
    expect(pace([c('1', true), c('2', false), c('3', false)]).state).toBe('behind');
  });

  it('is "onTrack" at or above half but not finished', () => {
    expect(pace([c('1', true), c('2', false)]).state).toBe('onTrack');
  });

  it('rounds the percentage rather than trailing decimals into the UI', () => {
    expect(pace([c('1', true), c('2', false), c('3', false)]).pct).toBe(33);
  });

  it('does not call a single untouched commitment "on track"', () => {
    expect(pace([c('1', false)]).state).toBe('behind');
  });
});
