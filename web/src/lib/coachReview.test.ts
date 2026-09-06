import { describe, it, expect } from 'vitest';
import { reviewFindings } from './coachReview';
import type { BriefAgentView, BriefPointView } from './coachBriefData';

const point = (text: string): BriefPointView => ({ text, coach: 'Practise the next step.', evidence: [{ findingIndex: 1, findingId: 'source-1', agentName: 'Agent' }] });
const agent = (overrides: Partial<BriefAgentView>): BriefAgentView => ({ agentName: 'Agent', agentId: 'agent-1', metrics: {}, opportunities: [], objections: [], coachingActions: [], doingRight: [], skillOpportunities: [], ...overrides });
describe('one coaching review across both surfaces', () => {
  it('preserves the selected report findings instead of substituting another action list', () => {
    const observation = point('The buyer asked about a property status change.');
    expect(reviewFindings(agent({ opportunities: [observation], coachingActions: [point('Different advice')] }))).toEqual([observation]);
  });
  it('removes identical observations and does not surface unlinked claims', () => {
    const observation = point('A supported observation.');
    expect(reviewFindings(agent({ opportunities: [observation, point(' A supported observation. '), { ...point('Unsupported'), evidence: [] }] }))).toEqual([observation]);
  });
  it('uses linked coaching actions only when the report has no opportunities', () => {
    const action = point('An evidenced action.');
    expect(reviewFindings(agent({ coachingActions: [action] }))).toEqual([action]);
  });
});
