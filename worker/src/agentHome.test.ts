import { describe, it, expect } from 'vitest';
import { shapeAgentHome } from './agentHome.js';

describe('shapeAgentHome', () => {
  it('reports that this agent has met with their lead', () => {
    const out = shapeAgentHome({
      agent: { id: 'a1', name: 'Maya Chen' },
      assessment: { code: 'PR-DI', personal_code: 'CALM', taken_at: '2026-08-01T00:00:00Z' },
      welcome_seen_at: null, gated: true,
      commitments: [
        { id: 'c1', body: 'Hold 4 appointments', agent_done: true, status: null, created_at: '2026-08-10T00:00:00Z' },
        { id: 'c2', body: 'Two agreements signed', agent_done: false, status: null, created_at: '2026-08-10T00:00:00Z' },
      ],
      latest_checkin: '2026-08-10T00:00:00Z',
    });
    expect(out.commitments).toHaveLength(2);
    expect(out.hasEverMet).toBe(true);
  });

  it('survives an agent with no 1:1 yet', () => {
    const out = shapeAgentHome({
      agent: { id: 'a1', name: 'Maya Chen' },
      assessment: null, welcome_seen_at: null, gated: true,
      commitments: [], latest_checkin: null,
    });
    expect(out.commitments).toEqual([]);
    expect(out.hasEverMet).toBe(false);
  });

  it('tolerates a null commitments array rather than throwing at the browser', () => {
    const out = shapeAgentHome({
      agent: { id: 'a1', name: 'Maya Chen' },
      assessment: null, welcome_seen_at: null, gated: false,
      commitments: null as never, latest_checkin: null,
    });
    expect(out.commitments).toEqual([]);
  });

  it('answers null for SMS when the migration has not been run', () => {
    // The older agent_home() returns no `sms` key. Null is what makes every screen
    // hide the feature; an object here would march agents into a consent form whose
    // save RPC does not exist yet.
    const out = shapeAgentHome({
      agent: { id: 'a1', name: 'Maya Chen' },
      assessment: null, welcome_seen_at: null, gated: true,
      commitments: [], latest_checkin: null,
    });
    expect(out.sms).toBeNull();
  });

  it('passes the SMS block through untouched when it is there', () => {
    const sms = {
      last_four: '0123', has_phone: true, consent_at: '2026-08-24T00:00:00Z',
      opt_out_at: null, prompted_at: '2026-08-24T00:00:00Z', reachable: true,
    };
    const out = shapeAgentHome({
      agent: { id: 'a1', name: 'Maya Chen' },
      assessment: null, welcome_seen_at: null, gated: true, sms,
      commitments: [], latest_checkin: null,
    });
    // Never recomputed here — `reachable` is the database's verdict and this layer
    // has no business having an opinion about it.
    expect(out.sms).toEqual(sms);
  });
});
