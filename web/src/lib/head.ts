// Per-route document head. The site is a SPA, so title/description/canonical/OG
// are set imperatively on navigation. Without this every page would inherit the
// bundle's static <title>, which used to read "TRU Pulse" — wrong brand, wrong
// page, on every marketing URL.
import { BUSINESS } from '../config/business';
import type { PublicRoute } from './routes';

export type PageMeta = { title: string; description: string; path: PublicRoute };

// Existing brand PNG in public/. Absolute so crawlers and twitter:card
// unfurls do not resolve a relative path against the wrong host.
export const SHARE_IMAGE_PATH = '/icon-512.png';

export function shareImageUrl(siteUrl: string = BUSINESS.siteUrl): string {
  return `${siteUrl}${SHARE_IMAGE_PATH}`;
}

function upsertMeta(selector: string, attrs: Record<string, string>) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement('meta');
    document.head.appendChild(el);
  }
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
}

export function applyHead({ title, description, path }: PageMeta): void {
  const url = `${BUSINESS.siteUrl}${path}`;
  document.title = title;

  upsertMeta('meta[name="description"]', { name: 'description', content: description });
  upsertMeta('meta[property="og:title"]', { property: 'og:title', content: title });
  upsertMeta('meta[property="og:description"]', { property: 'og:description', content: description });
  upsertMeta('meta[property="og:url"]', { property: 'og:url', content: url });
  upsertMeta('meta[property="og:type"]', { property: 'og:type', content: 'website' });
  upsertMeta('meta[property="og:site_name"]', { property: 'og:site_name', content: BUSINESS.brandFull });
  upsertMeta('meta[property="og:image"]', { property: 'og:image', content: shareImageUrl() });
  upsertMeta('meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary_large_image' });
  upsertMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: shareImageUrl() });

  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'canonical';
    document.head.appendChild(link);
  }
  link.href = url;
}
