import { describe, expect, it } from 'vitest';
import { prioritise, type Row } from './rosterData';
import { calendarDay } from '../components/CalendarAgenda';

const row: Row = { agentId: 'test', name: 'Test Agent', leads: 120, srcs: new Map(), worked: 120, workedPct: 100, stuck: 0, offers: 6, contracts: 3, perContract: 40, lastDays: 2, arch: null, archName: null, health: 'past-line', cert: null };
describe('Broker interpretation boundaries', () => {
  it('reports contracts without asserting that high activity proves poor call quality', () => {
    const [priority] = prioritise([row]);
    expect(priority.reason).toContain('3 contracts from 120 leads');
    expect(priority.reason).not.toMatch(/closed|loss is on|nothing is being dropped/i);
    expect(priority.action).toMatch(/review/i);
  });
  it('preserves multiple contracts when contact coverage is low', () => {
    expect(prioritise([{ ...row, workedPct: 75 }])[0].reason).toContain('3 contracts from 120 leads; 25%');
  });
});
describe('Calendar account timezone', () => {
  it('groups UTC bookings under the local calendar day', () => {
    expect(calendarDay('2026-09-06T01:00:00Z', 'America/Los_Angeles')).toBe('2026-09-05');
    expect(calendarDay('2026-09-06T01:00:00Z', 'America/New_York')).toBe('2026-09-05');
  });
  it('handles daylight saving boundaries', () => {
    expect(calendarDay('2026-11-01T07:30:00Z', 'America/Los_Angeles')).toBe('2026-11-01');
    expect(calendarDay('2026-11-01T06:30:00Z', 'America/Los_Angeles')).toBe('2026-10-31');
  });
});
