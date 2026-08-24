import { describe, it, expect } from 'vitest';
import { agentStage } from './agentStage';

describe('agentStage', () => {
  it('sends a brand-new agent to the welcome first', () => {
    expect(agentStage({ hasAssessment: false, welcomeSeen: false, isNewAccount: true })).toBe('welcome');
  });

  it('gates a new agent on the assessment once the welcome is done', () => {
    expect(agentStage({ hasAssessment: false, welcomeSeen: true, isNewAccount: true })).toBe('assessment');
  });

  it('opens the app once the assessment exists', () => {
    expect(agentStage({ hasAssessment: true, welcomeSeen: true, isNewAccount: true })).toBe('app');
  });

  it('never gates an agent who predates the gate', () => {
    expect(agentStage({ hasAssessment: false, welcomeSeen: false, isNewAccount: false })).toBe('app');
  });

  it('accepts an assessment taken through the old public link', () => {
    expect(agentStage({ hasAssessment: true, welcomeSeen: false, isNewAccount: true })).toBe('app');
  });

  describe('the SMS step', () => {
    const done = { hasAssessment: true, welcomeSeen: true, isNewAccount: true };

    it('is offered once, after the assessment, to someone never asked', () => {
      expect(agentStage({ ...done, smsAsked: false })).toBe('sms');
    });

    it('never appears again once they have been asked', () => {
      // True whichever way they answered. A consent prompt that keeps coming back
      // until you say yes is not consent.
      expect(agentStage({ ...done, smsAsked: true })).toBe('app');
    });

    it('never comes before the assessment', () => {
      expect(agentStage({
        hasAssessment: false, welcomeSeen: true, isNewAccount: true, smsAsked: false,
      })).toBe('assessment');
    });

    it('never ambushes an agent who predates the gate', () => {
      expect(agentStage({
        hasAssessment: true, welcomeSeen: true, isNewAccount: false, smsAsked: false,
      })).toBe('app');
    });

    it('is skipped entirely before the migration has run', () => {
      // agent_home() returns no `sms` block yet; showing the step would mean
      // rendering a form whose save endpoint does not exist.
      expect(agentStage({ ...done, smsAsked: null })).toBe('app');
      expect(agentStage(done)).toBe('app');
    });
  });
});
