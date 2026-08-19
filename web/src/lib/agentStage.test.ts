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
});
