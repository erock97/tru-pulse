/** Public hash route for a native slide: `#/deck/<name>/<n>`. */

export type DeckRoute = { deck: string; n: number };

export function parseDeckRoute(route: string): DeckRoute | null {
  const path = (route.split('?')[0] || '').replace(/^#/, '');
  const m = path.match(/^\/deck\/([a-z0-9-]+)(?:\/(\d+))?$/i);
  if (!m) return null;
  const n = m[2] ? Number(m[2]) : 1;
  if (!Number.isInteger(n) || n < 1) return null;
  return { deck: m[1], n };
}

export function deckHash(deck: string, n: number): string {
  return `/deck/${deck}/${n}`;
}
