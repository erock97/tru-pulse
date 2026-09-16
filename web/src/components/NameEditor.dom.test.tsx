// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import NameEditor from './NameEditor';
import { saveDisplayName } from '../lib/api';
vi.mock('../lib/api', () => ({ saveDisplayName: vi.fn() }));
let root: Root, host: HTMLDivElement;
const saved = vi.fn(), dirty = vi.fn();
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks(); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<NameEditor agentId="rachel" name="Rachel Ortez" onSaved={saved} onDirtyChange={dirty} />));
  await act(async () => host.querySelector('button')!.click());
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function input(value: string) {
  await act(async () => {
    const field = host.querySelector('input')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() { await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); }
it('saves a corrected name and updates the parent only after confirmation', async () => {
  await input('Rachel Ortiz'); expect(dirty).toHaveBeenLastCalledWith(true);
  vi.mocked(saveDisplayName).mockResolvedValue('Rachel Ortiz'); await submit();
  expect(saveDisplayName).toHaveBeenCalledWith('rachel', 'Rachel Ortiz');
  expect(saved).toHaveBeenCalledWith('Rachel Ortiz'); expect(host.textContent).toContain('Name saved');
  expect(host.querySelector('input')).toBeNull();
});
it('keeps failed edits available for retry without changing the displayed identity', async () => {
  await input('Rachel Ortiz'); vi.mocked(saveDisplayName).mockRejectedValue(new Error('Unavailable')); await submit();
  expect(host.querySelector('[role=alert]')!.textContent).toBe('Unavailable');
  expect(host.querySelector('input')!.value).toBe('Rachel Ortiz'); expect(saved).not.toHaveBeenCalled();
});
it('cancels without making a request, and rejects blank names', async () => {
  await input('   '); await submit(); expect(saveDisplayName).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>('button[type=button]')!.click());
  expect(host.querySelector('input')).toBeNull(); expect(dirty).toHaveBeenLastCalledWith(false);
});
