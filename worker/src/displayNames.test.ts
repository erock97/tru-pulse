import { describe, it, expect, vi } from 'vitest';
import { displayNames, handleDisplayName } from './displayNames';
import { validateDisplayName } from '../../shared/displayName';
import type { UserClient } from './asUser';
const id = '00000000-0000-4000-8000-000000000001';
const client = (ok = true) => ({ rpc: vi.fn(async () => ({ ok, data: ok ? 'Rachel Ortiz' : null })), select: vi.fn(async () => [{ agent_id: id, display_name: 'Rachel Ortiz' }]) }) as unknown as UserClient;
const request = (body: unknown) => new Request('https://api.truhq.co/data/display-name', { method: 'POST', body: JSON.stringify(body) });
describe('display names', () => {
  it('uses a normalized presentation name and the authenticated invoker RPC', async () => {
    const db = client();
    const result = await handleDisplayName(request({ agentId: id, name: ' Rachel  Ortiz ', role: 'admin', email: 'ignored@example.com' }), db, {}, true);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ name: 'Rachel Ortiz' });
    expect(db.rpc).toHaveBeenCalledWith('set_agent_display_name', { p_agent_id: id, p_name: 'Rachel Ortiz' });
  });
  it('denies foreign origins before writes and surfaces denied permissions', async () => {
    const db = client(false);
    expect((await handleDisplayName(request({ agentId: id, name: 'Rachel Ortiz' }), db, {}, false)).status).toBe(403);
    expect(db.rpc).not.toHaveBeenCalled();
    expect((await handleDisplayName(request({ agentId: id, name: 'Rachel Ortiz' }), db, {}, true)).status).toBe(403);
  });
  it.each(['', ' '.repeat(4), 'a'.repeat(121), 'Rachel\nOrtiz', 42, null])('rejects invalid names %s', async name => {
    const db = client();
    expect((await handleDisplayName(request({ agentId: id, name }), db, {}, true)).status).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it('accepts international and single-part names', () => {
    expect(validateDisplayName('李')).toBe('李');
    expect(validateDisplayName('María O’Brien-Smith')).toBe('María O’Brien-Smith');
  });
  it('overlays by immutable agent ID without mutating source records', async () => {
    const rows = [{ id, name: 'Rachel Ortez', email: 'rachel4410@icloud.com' }, { id: 'other', name: 'Rachel Ortez' }];
    const result = await displayNames(client(), rows);
    expect(result[0]).toEqual({ ...rows[0], name: 'Rachel Ortiz' });
    expect(result[1].name).toBe('Rachel Ortez');
    expect(rows[0].name).toBe('Rachel Ortez');
  });
});
