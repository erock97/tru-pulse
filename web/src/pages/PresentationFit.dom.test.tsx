// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { PresentationFit } from './PresentationFit';
it('fits a tall slide and refits when images or window size change', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let notify = () => {}; const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { notify = callback; } observe() {} disconnect = disconnect; });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<PresentationFit><p>Whole slide content</p></PresentationFit>));
    const frame = host.querySelector('.live-presentation-canvas')!;
    const slide = host.querySelector('.live-fit-content') as HTMLElement;
    Object.defineProperty(frame, 'clientWidth', { value: 1200, configurable: true });
    Object.defineProperty(frame, 'clientHeight', { value: 600, configurable: true });
    Object.defineProperty(slide, 'scrollHeight', { value: 1000, configurable: true });
    await act(async () => notify());
    expect(slide.style.transform).toBe('scale(0.6)');
    expect((host.querySelector('.live-fit-bounds') as HTMLElement).style.height).toBe('600px');
    Object.defineProperty(frame, 'clientHeight', { value: 400 });
    await act(async () => notify()); expect(slide.style.transform).toBe('scale(0.4)');
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
  expect(disconnect).toHaveBeenCalledOnce();
});
