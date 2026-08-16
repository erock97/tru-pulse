import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyHead, shareImageUrl } from './head';
import { BUSINESS } from '../config/business';

// applyHead talks to document.head. The suite stays on node, so this is a
// small stand-in — same idea as clearLegacyTokens.test.ts.
type FakeEl = {
  tagName: string;
  attrs: Record<string, string>;
  rel: string;
  href: string;
  setAttribute: (k: string, v: string) => void;
};

function installFakeDocument() {
  const nodes: FakeEl[] = [];

  const matches = (el: FakeEl, selector: string): boolean => {
    const m = selector.match(/^(meta|link)\[(\w+)="([^"]+)"\]$/);
    if (!m) return false;
    const [, tag, attr, value] = m;
    if (el.tagName !== tag) return false;
    if (attr === 'rel') return el.rel === value || el.attrs.rel === value;
    return el.attrs[attr] === value;
  };

  const document = {
    title: '',
    head: {
      querySelector(selector: string) {
        return nodes.find((n) => matches(n, selector)) ?? null;
      },
      appendChild(el: FakeEl) {
        nodes.push(el);
        return el;
      },
    },
    createElement(tag: string): FakeEl {
      const el: FakeEl = {
        tagName: tag,
        attrs: {},
        rel: '',
        href: '',
        setAttribute(k: string, v: string) {
          el.attrs[k] = v;
          if (k === 'rel') el.rel = v;
          if (k === 'href') el.href = v;
        },
      };
      return el;
    },
  };

  vi.stubGlobal('document', document);
  return { document, nodes };
}

describe('shareImageUrl', () => {
  it('points at the existing 512 icon on the public site origin', () => {
    expect(shareImageUrl()).toBe('https://truhq.co/icon-512.png');
    expect(shareImageUrl()).toBe(`${BUSINESS.siteUrl}/icon-512.png`);
  });
});

describe('applyHead', () => {
  beforeEach(() => {
    installFakeDocument();
  });

  it('sets og:image and twitter:image to a real PNG, not a marketing path', () => {
    applyHead({
      title: 'About — TRU',
      description: 'Who you’d actually be working with.',
      path: '/about',
    });

    const og = document.head.querySelector('meta[property="og:image"]') as FakeEl | null;
    const tw = document.head.querySelector('meta[name="twitter:image"]') as FakeEl | null;
    const card = document.head.querySelector('meta[name="twitter:card"]') as FakeEl | null;

    expect(og?.attrs.content).toBe('https://truhq.co/icon-512.png');
    expect(tw?.attrs.content).toBe('https://truhq.co/icon-512.png');
    expect(card?.attrs.content).toBe('summary_large_image');
  });
});
