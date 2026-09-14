// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LiveSlideNavigation } from './LiveSlideNavigation';
import type { LiveSessionState } from '../../../shared/liveWorkshops';
const command = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('../lib/liveSessions', () => ({ sessionCommand: command }));
let root: Root, host: HTMLDivElement;
const refresh = vi.fn();
const state = (slide = 'one', canPresent = true, status = 'active') => ({
  canPresent, session: { id: 'session', currentSlideId: slide, status },
  definition: { slides: [{ id: 'one' }, { id: 'two' }, { id: 'three' }] },
}) as LiveSessionState;
async function render(value = state()) { await act(async () => root.render(<LiveSlideNavigation state={value} refresh={refresh} keyboard />)); }
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.includes(text))!;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); command.mockReset().mockResolvedValue({}); refresh.mockReset(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });
it('advances the room and tracks externally updated slides in both directions', async () => {
  await render(); expect(button('Previous').disabled).toBe(true);
  await act(async () => button('Next').click());
  expect(command).toHaveBeenLastCalledWith('session', { action: 'slide', slideId: 'two' }); expect(refresh).toHaveBeenCalledOnce();
  await render(state('two')); expect(host.textContent).toContain('Slide 2 of 3');
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })));
  expect(command).toHaveBeenLastCalledWith('session', { action: 'slide', slideId: 'one' });
  await render(state('three')); expect(button('Next').disabled).toBe(true);
});
it('does not change slides while editing a practice record inside a shadow root', async () => {
  await render(); const shadowHost = document.createElement('div'); document.body.append(shadowHost);
  const shadow = shadowHost.attachShadow({ mode: 'open' }); const input = document.createElement('textarea'); shadow.append(input);
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true })));
  expect(command).not.toHaveBeenCalled();
});
it('keeps attendees read-only and ended sessions disabled', async () => {
  await render(state('one', false)); expect(host.querySelector('button')).toBeNull(); expect(host.textContent).toContain('Following the presenter');
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })));
  expect(command).not.toHaveBeenCalled();
  await render(state('two', true, 'ended')); expect(button('Next').disabled).toBe(true); expect(button('Previous').disabled).toBe(true);
});
it('shows a failed command without pretending the room advanced', async () => {
  command.mockRejectedValueOnce(new Error('Connection lost')); await render();
  await act(async () => button('Next').click());
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('Connection lost'); expect(host.textContent).toContain('Slide 1 of 3'); expect(refresh).not.toHaveBeenCalled();
});
