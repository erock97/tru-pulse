// Renders a True Rep slide deck natively, one slide per lesson step.
//
// Why not just iframe the exported deck? Because we did, and it showed an empty
// black box. The export is a React bundle that boots its chunks from blob: URLs
// and pulls React off unpkg, and the app's Content-Security-Policy allows
// neither — nor does it allow us to be framed at all. Loosening that policy for
// a slide deck is a bad trade, so the slides are extracted instead: the
// <section> markup, the deck's CSS variables, optional @keyframes (`css`), and
// its images as real files under /decks/<name>/.
//
// The HTML comes from a static file we author and review in git — never from the
// database — so a leader authoring a custom module can never inject markup here.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { deckSlideMarkup, type DeckData, type DeckSlide } from '../lib/deck';

export type { DeckData, DeckSlide };

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

/** Measure the slide at its true design width. Re-run after images load so a
 *  late-arriving screenshot cannot leave the box cropped to the 1080 nominal. */
function measureSlide(el: HTMLElement | null, fallback: number): number {
  if (!el) return fallback;
  const sec = el.querySelector('section') as HTMLElement | null;
  return Math.max(fallback, sec ? Math.ceil(sec.scrollHeight) : 0);
}

function useImageRemeasure(
  secRef: React.RefObject<HTMLDivElement | null>,
  data: DeckData | null,
  extra?: unknown,
): [number, (h: number) => void] {
  const [natural, setNatural] = useState(0);
  useLayoutEffect(() => {
    const el = secRef.current;
    if (!el || !data) return;
    const run = () => setNatural(measureSlide(el, data.height));
    run();
    const imgs = Array.from(el.querySelectorAll('img'));
    imgs.forEach((img) => {
      if (!img.complete) img.addEventListener('load', run);
      img.addEventListener('error', run);
    });
    return () => {
      imgs.forEach((img) => {
        img.removeEventListener('load', run);
        img.removeEventListener('error', run);
      });
    };
  }, [data, extra, secRef]);
  return [natural, setNatural];
}

/**
 * The canvas every slide sits on: loads the deck for its design size and CSS
 * variables, measures the real height (again after images load), scales to fit,
 * and offers full screen.
 *
 * Split out from SlideView so a slide can be REACT rather than static markup.
 * The deals slide needs to be clicked — a learner has to see a deal actually get
 * logged — and the exported deck is inert HTML. Sharing this canvas is what keeps
 * an authored-in-app slide looking like one of Eric's own.
 */
export function SlideCanvas({
  deck, label, children, deps,
}: {
  deck: string;
  label?: string;
  children: React.ReactNode;
  /** Re-measure when the content's own state changes its height. */
  deps?: unknown;
}) {
  const [data, setData] = useState<DeckData | null>(null);
  const [err, setErr] = useState('');
  const boxRef = useRef<HTMLDivElement | null>(null);
  const secRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0);
  const [full, setFull] = useState(false);
  const [natural] = useImageRemeasure(secRef, data, deps);

  useEffect(() => {
    let alive = true;
    loadDeck(deck)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setErr('Could not load the slides.'); });
    return () => { alive = false; };
  }, [deck]);

  const fit = useCallback(() => {
    const el = boxRef.current;
    if (!el || !data || !natural) return;
    const w = el.clientWidth / data.width;
    if (full) {
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
    ? { width: data.width, height: natural || data.height, transform: `scale(${scale || 0})`, visibility: scale ? 'visible' : 'hidden', ...varsOf(data.vars) }
    : undefined;

  const body = (
    <div className="deck-box" ref={boxRef} style={{ height: natural && scale ? natural * scale : undefined }}>
      {err && <div className="err">{err}</div>}
      <div className="deck-scale" ref={secRef} style={style as React.CSSProperties}>
        {data ? children : null}
      </div>
    </div>
  );

  return (
    <div className={`deck-slide fu${full ? ' is-full' : ''}`}>
      {full ? (
        <div className="deck-fullwrap" role="dialog" aria-label={label ?? 'Slide'}>
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

/**
 * One slide, scaled from its 1920-wide design to whatever width it is given.
 * Scaling rather than reflowing is deliberate — the layout is absolutely
 * positioned at that size and anything else breaks it.
 *
 * The height is MEASURED, not assumed. Several slides need more than the
 * nominal 1080 once set in the app's own fonts, and pinning the box to 1080
 * silently cut the bottom off them. Images re-trigger that measure so a
 * late-loading screenshot cannot crop the box back to 1080.
 *
 * When the deck JSON includes `css` (keyframes / animation classes), it is
 * injected as a <style> tag. Day 1 decks omit that field and keep working.
 */
export function SlideView({ deck, n }: { deck: string; n: number }) {
  const [data, setData] = useState<DeckData | null>(null);
  const [err, setErr] = useState('');
  const boxRef = useRef<HTMLDivElement | null>(null);
  const secRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0);
  const [full, setFull] = useState(false);

  useEffect(() => {
    let alive = true;
    loadDeck(deck)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setErr('Could not load the slides.'); });
    return () => { alive = false; };
  }, [deck]);

  const slide = data?.slides.find((s) => s.n === n) ?? null;
  const [natural] = useImageRemeasure(secRef, data, slide);

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
    ? { width: data.width, height: natural || data.height, transform: `scale(${scale || 0})`, visibility: scale ? 'visible' : 'hidden', ...varsOf(data.vars) }
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
          // Optional `css` (keyframes) is prepended; Day 1 decks omit it.
          dangerouslySetInnerHTML={{ __html: deckSlideMarkup(data?.css, slide.html) }}
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
