import { it, expect, vi, beforeEach } from 'vitest';
import type { Db } from './db';
import { syncAgents } from './sync';
import { pullUsers } from './fub';
vi.mock('./fub', () => ({ pullUsers: vi.fn() }));
const team = { id: 'team-a', org_id: 'org-a', fub_subdomain: null };
const agent = { id: 'rachel', name: 'Rachel Ortez', email: 'rachel4410@icloud.com', phone: '3474614198', fub_user_id: null };
function database(rows: unknown[] = [agent]) {
  return { select: vi.fn(async () => rows), insert: vi.fn(async (_table, row) => ({ id: 'new', ...row })), update: vi.fn(async () => {}) } as unknown as Db;
}
beforeEach(() => vi.mocked(pullUsers).mockResolvedValue([{ id: 100, name: 'Rachel Ortiz', email: ' RACHEL4410@ICLOUD.COM ' }]));
it('links changed spelling by case-insensitive email within this team', async () => {
  const db = database(); await syncAgents(db, team, 'key');
  expect(db.select).toHaveBeenCalledWith('agents', expect.stringContaining('team_id=eq.team-a'));
  expect(db.update).toHaveBeenCalledWith('agents', 'id=eq.rachel', { fub_user_id: 100 });
  expect(db.insert).not.toHaveBeenCalled();
});
it('never links on a shared name with a different email', async () => {
  const db = database([{ ...agent, name: 'Rachel Ortiz', email: 'someone@example.com' }]);
  await syncAgents(db, team, 'key');
  expect(db.update).not.toHaveBeenCalled(); expect(db.insert).toHaveBeenCalledOnce();
});
it('keeps established FUB identity when email changes and never writes display names', async () => {
  const db = database([{ ...agent, fub_user_id: 100, email: 'old@example.com' }]);
  await syncAgents(db, team, 'key');
  expect(db.update).not.toHaveBeenCalled(); expect(db.insert).not.toHaveBeenCalled();
});
it('does not steal an email already attached to another FUB identity', async () => {
  const db = database([{ ...agent, fub_user_id: 999 }]); await syncAgents(db, team, 'key');
  expect(db.update).not.toHaveBeenCalled(); expect(db.insert).not.toHaveBeenCalled();
});
it('does not choose between duplicate existing emails', async () => {
  const db = database([agent, { ...agent, id: 'duplicate' }]); await syncAgents(db, team, 'key');
  expect(db.update).not.toHaveBeenCalled(); expect(db.insert).not.toHaveBeenCalled();
});
it('does not link duplicate incoming emails or blank emails by name', async () => {
  vi.mocked(pullUsers).mockResolvedValue([{ id: 100, name: 'Rachel Ortiz', email: agent.email }, { id: 101, name: 'Rachel Other', email: agent.email }]);
  const db = database(); await syncAgents(db, team, 'key');
  expect(db.update).not.toHaveBeenCalled(); expect(db.insert).not.toHaveBeenCalled();
  vi.mocked(pullUsers).mockResolvedValue([{ id: 102, name: agent.name, email: '' }]);
  await syncAgents(db, team, 'key'); expect(db.update).not.toHaveBeenCalled(); expect(db.insert).toHaveBeenCalledOnce();
});
