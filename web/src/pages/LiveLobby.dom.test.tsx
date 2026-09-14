// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LiveSessions from './LiveSessions';
const request = vi.hoisted(() => vi.fn());
vi.mock('../lib/liveSessions', async original => ({ ...await original<any>(), liveRequest: request }));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  request.mockReset().mockImplementation(async (path, body) => {
    if (body) return { id: 'created-session' };
    if (path === '/preflight') return { canCreate: true, agents: [{ id: 'agent', userId: 'user', name: 'Test agent', teamId: 'team', teamName: 'Test team' }], coaches: [], viewerId: 'viewer' };
    return { enabled: true, sessions: [] };
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });
it.each([1, 2, 3, 4])('carries Day %s from workshop route into the create request', async day => {
  await act(async () => root.render(<LiveSessions route={`/rep/sessions?day=${day}`} />));
  expect((host.querySelector('select') as HTMLSelectElement).value).toBe(String(day));
  const checkbox = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
  await act(async () => checkbox.click());
  const create = [...host.querySelectorAll('button')].find(b => b.textContent === `Create Day ${day} session`)!;
  expect(create.disabled).toBe(false);
  await act(async () => create.click());
  expect(request).toHaveBeenCalledWith('', expect.objectContaining({ day, participants: [{ agentId: 'agent' }] }));
});
it('updates the selected day when entering from another workshop', async () => {
  await act(async () => root.render(<LiveSessions route="/rep/sessions?day=1" />));
  await act(async () => root.render(<LiveSessions route="/rep/sessions?day=2" />));
  expect((host.querySelector('select') as HTMLSelectElement).value).toBe('2');
  expect(host.textContent).toContain('Start a new Day 2 session');
});
it.each([1, 2, 3, 4])('starts a real Day %s test without agents, even when roster selections exist', async day => {
  await act(async () => root.render(<LiveSessions route={`/rep/sessions?day=${day}`} />));
  const test = [...host.querySelectorAll('button')].find(b => b.textContent === `Test Day ${day} without agents`)!;
  expect(test.disabled).toBe(false);
  await act(async () => (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
  await act(async () => test.click());
  expect(request).toHaveBeenCalledWith('', expect.objectContaining({ day, participants: [], presenterIds: [] }));
  expect(window.location.hash).toContain('/created-session/presenter');
});

