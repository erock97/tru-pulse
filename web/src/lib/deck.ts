// Shared types for native slide decks under /public/decks/<name>.json.
// Day 1 decks have no `css` field. Day 3 (and later) may include one so
// @keyframes from the original bundle actually run. Do not put @keyframes
// into `vars` — that object is only CSS custom properties.

export type DeckSlide = { n: number; label: string; notes: string; html: string };

export type DeckData = {
  width: number;
  height: number;
  vars: string;
  css?: string;
  slides: DeckSlide[];
};

/** Stylesheet to inject for @keyframes / animation classes. Absent on Day 1. */
export function deckInjectedCss(data: Pick<DeckData, 'css'>): string | null {
  return data.css ? data.css : null;
}

/** Slide markup plus optional keyframes. Day 1 decks pass no css and stay plain HTML. */
export function deckSlideMarkup(css: string | undefined, html: string): string {
  return (css ? `<style>${css}</style>` : '') + html;
}
