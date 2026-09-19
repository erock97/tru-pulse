import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import script from '../../public/book/book-v2.js?raw';

async function load(query: string, rows: unknown[], ok = true) {
  const dom = new JSDOM('<h1 id="title">Book a time</h1><p id="sub"></p><main id="view"></main>', {
    url: `https://truhq.co/book/${query}`, runScripts: 'outside-only',
  });
  const fetch = vi.fn(async (url: string) => {
    if (url.includes('/meeting_types?')) return { ok, json: async () => rows };
    if (url.includes('/jarvis-slot-ask')) return { ok: true, json: async () => ({ token: 'test' }) };
    return { ok: true, json: async () => [{ answer_status: 'ok', slots: [{ start: '2026-09-22T17:00:00Z', end: '2026-09-22T17:30:00Z' }] }] };
  });
  dom.window.fetch = fetch as any;
  dom.window.eval(script);
  await new Promise(resolve => setTimeout(resolve, 0));
  return { dom, fetch };
}

describe('booking link behavior', () => {
  it('loads a newly published exact slug and asks for its availability', async () => {
    const { dom, fetch } = await load('?t=assessment', [{ slug: 'assessment', name: 'Assessment', duration_minutes: 30 }]);
    expect(dom.window.document.querySelector('h1')?.textContent).toBe('Assessment');
    expect(fetch.mock.calls[0][0]).toContain('user_id=eq.d6b9504c-f35e-49c9-af99-6a2de2069db8&published=eq.true&slug=eq.assessment&limit=1');
    expect(dom.window.document.querySelectorAll('.slot')).toHaveLength(1);
    dom.window.close();
  });
  it('does not substitute the consultation or ask for slots for a draft/missing link', async () => {
    const { dom, fetch } = await load('?t=assessment', []);
    expect(dom.window.document.body.textContent).toContain('may still be a draft');
    expect(fetch).toHaveBeenCalledTimes(1);
    dom.window.close();
  });
  it('rejects malformed slugs without a request', async () => {
    const { dom, fetch } = await load('?t=bad%26slug', []);
    expect(dom.window.document.body.textContent).toContain('not valid');
    expect(fetch).not.toHaveBeenCalled();
    dom.window.close();
  });
  it('reports a failed lookup without switching meeting types', async () => {
    const { dom, fetch } = await load('?t=assessment', [], false);
    expect(dom.window.document.body.textContent).toContain('Could not load this booking link');
    expect(fetch).toHaveBeenCalledTimes(1);
    dom.window.close();
  });
});
