// Renders Eric's Day 1 deck natively, one slide per lesson step.
//
// Why not just iframe the exported deck? Because we did, and it showed an empty
// black box. The export is a React bundle that boots its chunks from blob: URLs
// and pulls React off unpkg, and the app's Content-Security-Policy allows
// neither — nor does it allow us to be framed at all. Loosening that policy for
// a slide deck is a bad trade, so the slides are extracted instead: the
// <section> markup, the deck's CSS variables, and its images as real files under
// /decks/zillow-day1/. See db/build-deck.py for the extraction.
//
// The HTML comes from a static file we author and review in git — never from the
// database — so a leader authoring a custom module can never inject markup here.
import { useEffect, useRef, useState } from 'react';

export type DeckSlide = { n: number; label: string; notes: string; html: string };
export type DeckData = { width: number; height: number; vars: string; slides: DeckSlide[] };

const cache = new Map<string, Promise<DeckData>>();

export function loadDeck(name: string): Promise<DeckData> {
  let p = cache.get(name);
  if (!p) {
    p = fetch(`/decks/${name}.json`).then((r) => {
      if (!r.ok) throw new Error('deck not found');
      return r.json() as Promise<DeckData>;
    });
    cache.set(name, p);
  }
  return p;
}

/**
 * One slide, scaled from its 1920×1080 design size to whatever width it is given.
 * Scaling (rather than reflowing) is deliberate: the deck's layout is absolutely
 * positioned at that size, so anything else would break it.
 */
export function SlideView({ deck, n }: { deck: string; n: number }) {
  const [data, setData] = useState<DeckData | null>(null);
  const [err, setErr] = useState('');
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    let alive = true;
    loadDeck(deck)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setErr('Could not load the slides.'); });
    return () => { alive = false; };
  }, [deck]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || !data) return;
    const fit = () => setScale(el.clientWidth / data.width);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [data]);

  const slide = data?.slides.find((s) => s.n === n) ?? null;

  return (
    <div className="deck-slide fu">
      <div className="deck-box" ref={boxRef} style={{ height: data && scale ? data.height * scale : undefined }}>
        {err && <div className="err">{err}</div>}
        {slide && scale > 0 && (
          <div
            className="deck-scale"
            style={{
              width: data!.width,
              height: data!.height,
              transform: `scale(${scale})`,
              // The deck's own design tokens, lifted verbatim from the export.
              ...(Object.fromEntries(
                data!.vars.split(';').map((d) => d.split(':')).filter((p) => p.length === 2)
                  .map(([k, v]) => [k.trim(), v.trim()]),
              ) as Record<string, string>),
            }}
            // Static, in-repo markup — see the note at the top of this file.
            dangerouslySetInnerHTML={{ __html: slide.html }}
          />
        )}
      </div>
    </div>
  );
}
