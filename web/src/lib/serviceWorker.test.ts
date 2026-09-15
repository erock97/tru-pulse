import workerSource from '../../public/sw.js?raw';
import { expect, it, vi } from 'vitest';

it('leaves hashed module and stylesheet requests to the browser instead of replaying cached response modes', () => {
  const handlers = new Map<string, (event: any) => void>();
  const match = vi.fn(() => { throw new Error('Cached response may have an incompatible request mode'); });
  new Function('self', 'caches', workerSource)(
    { location: { origin: 'https://app.truhq.co' }, addEventListener: (name: string, handler: any) => handlers.set(name, handler) },
    { match },
  );
  for (const [file, mode] of [['index.js', 'cors'], ['index.css', 'no-cors']]) {
    const respondWith = vi.fn();
    handlers.get('fetch')!({ request: { method: 'GET', url: `https://app.truhq.co/assets/${file}`, mode }, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
  }
  expect(match).not.toHaveBeenCalled();
});
