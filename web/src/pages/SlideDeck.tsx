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
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

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

function varsOf(vars: string): Record<string, string> {
  return Object.fromEntries(
    vars.split(';').map((d) => d.split(':')).filter((p) => p.length === 2)
      .map(([k, v]) => [k.trim(), v.trim()]),
  );
}

/**
 * One slide, scaled from its 1920-wide design to whatever width it is given.
 * Scaling rather than reflowing is deliberate — the layout is absolutely
 * positioned at that size and anything else breaks it.
 *
 * The height is MEASURED, not assumed. Several slides need more than the
 * nominal 1080 once set in the app's own fonts, and pinning the box to 1080
 * silently cut the bottom off them.
 */
export function SlideView({ deck, n }: { deck: string; n: number }) {
  const [data, setData] = useState<DeckData | null>(null);
  const [err, setErr] = useState('');
  const boxRef = useRef<HTMLDivElement | null>(null);
  const secRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0);
  const [full, setFull] = useState(false);
  const [natural, setNatural] = useState(0);

  useEffect(() => {
    let alive = true;
    loadDeck(deck)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setErr('Could not load the slides.'); });
    return () => { alive = false; };
  }, [deck]);

  const slide = data?.slides.find((s) => s.n === n) ?? null;

  // Measure the slide at its true design width, then fit it to the box.
  useLayoutEffect(() => {
    const el = secRef.current;
    if (!el || !data) return;
    const sec = el.querySelector('section') as HTMLElement | null;
    const h = Math.max(data.height, sec ? Math.ceil(sec.scrollHeight) : 0);
    setNatural(h);
  }, [data, slide]);

  const fit = useCallback(() => {
    const el = boxRef.current;
    if (!el || !data || !natural) return;
    const w = el.clientWidth / data.width;
    if (full) {
      // Fit the whole slide on screen, never crop it.
      const h = window.innerHeight / natural;
      setScale(Math.min(w, h));
    } else {
      setScale(w);
    }
  }, [data, natural, full]);

  useEffect(() => {
    fit();
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    window.addEventListener('resize', fit);
    return () => { ro.disconnect(); window.removeEventListener('resize', fit); };
  }, [fit]);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [full]);

  const style = data
    ? { width: data.width, height: natural || data.height, transform: `scale(${scale})`, ...varsOf(data.vars) }
    : undefined;

  const body = (
    <div className="deck-box" ref={boxRef} style={{ height: natural && scale ? natural * scale : undefined }}>
      {err && <div className="err">{err}</div>}
      {slide && (
        <div
          className="deck-scale"
          ref={secRef}
          style={style as React.CSSProperties}
          // Static, in-repo markup — see the note at the top of this file.
          dangerouslySetInnerHTML={{ __html: slide.html }}
        />
      )}
    </div>
  );

  return (
    <div className={`deck-slide fu${full ? ' is-full' : ''}`}>
      {full ? (
        <div className="deck-fullwrap" role="dialog" aria-label={slide?.label ?? 'Slide'}>
          {body}
          <button className="deck-fullbtn is-out" onClick={() => setFull(false)}>Close ✕</button>
        </div>
      ) : (
        <>
          {body}
          <button className="deck-fullbtn" onClick={() => setFull(true)}>Full screen ⤢</button>
        </>
      )}
    </div>
  );
}
