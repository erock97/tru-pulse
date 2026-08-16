// Per-route document head. The site is a SPA, so title/description/canonical/OG
// are set imperatively on navigation. Without this every page would inherit the
// bundle's static <title>, which used to read "TRU Pulse" — wrong brand, wrong
// page, on every marketing URL.
import { BUSINESS } from '../config/business';

export type PageMeta = {
  title: string;
  description: string;
  path: string;
  robots?: 'noindex';
};

// Existing brand PNG in public/. Built from the host serving this page so a
// Pages preview unfurl hits that preview's /icon-512.png, not live truhq.co
// (which still serves HTML for that path until this ships).
export const SHARE_IMAGE_PATH = '/icon-512.png';

export function shareImageUrl(origin: string = location.origin): string {
  return `${origin}${SHARE_IMAGE_PATH}`;
}

function upsertMeta(selector: string, attrs: Record<string, string>) {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement('meta');
    document.head.appendChild(el);
  }
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
}

export function applyHead({ title, description, path, robots }: PageMeta): void {
  const url = `${BUSINESS.siteUrl}${path === 'not-found' ? '/' : path}`;
  document.title = title;

  upsertMeta('meta[name="description"]', { name: 'description', content: description });
  if (robots) {
    upsertMeta('meta[name="robots"]', { name: 'robots', content: robots });
  }
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
