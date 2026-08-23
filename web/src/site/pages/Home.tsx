import { useEffect, useRef, useState } from 'react';
import { BUSINESS } from '../../config/business';
import MarkGlow, { GLOW_FRAME, GLOW_ASPECT } from '../MarkGlow';

/* ============================================================================
   THE ARRIVAL — "first light"
   ----------------------------------------------------------------------------
   One object, one path, three quarters of a screen of scroll.

   THE WORDMARK IS ALWAYS LIVE TYPE. Not for purity — because every version of
   this that used a rendered plate of the letters read as a cut-out pasted onto
   the page, and no amount of feathering fixed it. Three of them shipped. The
   last one also turned out to hold no motion at all: the "moving" plate
   measured 0.03 of 255 mean change between frames, a still image in a video
   container. So the letters are the site's own Fraunces from the first frame to
   the last, crisp at 17x because text is not resampled, and there is no
   handover between two surfaces because there is only ever one.

   THE LIGHT IS COMPUTED FROM THE LETTERS. `MarkGlow` builds a distance field
   from these exact glyph outlines and renders bloom, shafts and embers off it
   every frame. The light therefore comes OUT of the letterforms — it is derived
   from their shape — and it genuinely moves, because it is a noise field being
   integrated in real time rather than a clip being replayed.

   AS YOU SCROLL, that lit type travels and shrinks along one path until it is
   sitting exactly where the header's own wordmark sits, at exactly its size,
   and the two swap. The light banks down as it goes, so the mark settles into
   the header rather than arriving there still burning. The words rise into the
   middle behind it and the veil over the page's room lifts, so the site is
   assembling itself while the mark is still moving rather than appearing once
   it has finished.

   Three things the previous version got wrong, worth keeping written down:

   1. THE ART DID NOT BELONG TO THE PALETTE. It was neon green lightning. The
      site is deep green, bone and one amber; electricity is a different world
      and no amount of choreography rescues a foreign object. The plate is now
      generated in the page's own light — warm amber and bone on true black.

   2. IT DID NOT FIT. The opening state was scaled off viewport WIDTH alone,
      so on any laptop the glow ran off the top and bottom of the screen. The
      plate is now clamped on both axes with real margin, which is the only way
      a hero fits a 13-inch laptop and a 27-inch monitor with the same rule.

   3. IT ASKED FOR TOO MUCH. Three full screens of scroll before the page
      began. The whole opening now resolves in 175dvh — you stand in it for one
      screen and it is done three quarters of a screen later.

   The choreography (measure the real target, drive the axes in sequence, ease
   the scrub rather than tracking it) follows the pattern in 21st.dev's
   "Home Hero Landing Scroll Animation" and "Hero Scrub", ported off GSAP so
   this page does not add an animation runtime to the app bundle for one hero.
   ========================================================================== */

const PROOF = [
  {
    figure: '12 → 22',
    what: 'transactions a month',
    scope: '400+ agent brokerage, eight months',
    body: 'Eighty to ninety agents actively taking paid leads, closing twelve a month out of the lead-source programs. We rebuilt how those leads were routed, worked and held to standard.',
  },
  {
    figure: '7',
    what: 'contracts in the first month',
    scope: 'Zillow Preferred launch, no prior experience',
    body: 'We built the onboarding, the lead standards and the follow-up cadence before the first lead ever landed.',
  },
  {
    figure: '3 → 10',
    what: 'agents, at both',
    scope: 'Two Nashville teams',
    body: 'We installed the operating model first, so that hiring multiplied the output instead of the chaos. Both are still adding.',
  },
] as const;

/* Three, not seven. The seven live on /services, where somebody who has decided
   to read the scope goes looking for them. A home page that lists all seven is
   asking a stranger to read a contract. */
const OWN = [
  { name: 'Accountability', body: 'Who followed up, who did not, and the conversation that fixes it. Every week.' },
  { name: 'Conversion', body: 'Zillow Preferred, ZHL and speed to lead, held to a written standard.' },
  { name: 'Rhythm', body: 'Leadership meetings and performance reviews on a cadence, not a quarter.' },
] as const;

const WHO = [
  { k: 'Team owners', body: 'Generating leads, and spending the week managing instead of building.' },
  { k: 'Sales leaders', body: 'You own the number and you want a peer to think with.' },
  { k: 'Agents', body: 'Scripts, call strategy and real feedback. Not another pep talk.' },
] as const;

/* The wordmark, in one place. It is set here, drawn by the live type, and
   turned into the light's distance field — one string, three uses, so they
   cannot fall out of step. */
const MARK = 'TRU';

export default function Home() {
  const arriveRef = useRef<HTMLElement | null>(null);
  const markRef = useRef<HTMLDivElement | null>(null);
  /* How lit the mark is, written by the scroll rig and read by the light on its
     own frame. A ref rather than state on purpose: this changes sixty times a
     second, and re-rendering the page that often to dim a glow is how a smooth
     idea ships as a stutter. */
  const glowRef = useRef(1);
  /* Reduced motion changes WHERE the mark lives, not just how it behaves, so it
     has to be a render decision rather than a stylesheet one. The travelling
     mark is a sibling AFTER the hero section — it has to be, because it outlives
     the pinned stage and finishes its trip in the header. Restyling that same
     element to sit still therefore drops it into normal flow below the whole
     hero, under the fold, after the buttons. Rendering a static one inside the
     stage instead puts it where a reader expects it, and only one of the two
     ever exists, so there is still exactly one WebGL context. */
  const [still, setStill] = useState(
    () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const q = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setStill(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);

  const wordmark = (
    <>
      <MarkGlow text={MARK} fadeRef={glowRef} />
      <span className="arrive-type">{MARK[0]}<i>{MARK.slice(1)}</i></span>
    </>
  );

  /* Lay the travelling mark exactly over the header's, then tell it how far out
     and how much bigger its opening state is.

     Measured from the real element rather than assumed, because the header mark
     is set in rem and moves with the viewport, and a shared-element landing
     that is two pixels out stops reading as one object. Re-measured on resize
     and after the webfont settles, since a fallback face is a different width
     and the mark would otherwise land beside its target rather than on it. */
  useEffect(() => {
    const mark = markRef.current;
    if (!mark) return;

    const measure = () => {
      const brand = document.querySelector<HTMLElement>('.truland .nav .brand');
      if (!brand) return;
      const r = brand.getBoundingClientRect();
      if (!r.width) return;

      /* Sit on it: same box, same face, same size — and the SAME LINE HEIGHT.

         That last one is not a detail. The header mark inherits a line height
         of 1.6, so its line box is 40px tall around 25px of type and the glyphs
         are centred in it. A clone set `line-height: 1` puts its glyphs at the
         top of a 25px box instead, which lands the whole wordmark about eight
         pixels high — close enough to look like a bug, not close enough to look
         like a swap. */
      const cs = getComputedStyle(brand);
      mark.style.left = `${r.left}px`;
      mark.style.top = `${r.top}px`;
      mark.style.fontSize = cs.fontSize;
      mark.style.lineHeight = cs.lineHeight;

      /* And the opening state, as a delta from there.

         THE PLATE IS CLAMPED ON BOTH AXES. Width alone is what put the old hero
         off the screen: a wide short window has plenty of width and no height,
         and a plate sized off width overflowed the top and bottom every time.
         Whichever axis runs out first decides the size, and both keep a margin.

         The scale then has to be derived from the plate rather than from the
         viewport, so the live type is exactly as wide as the lit letters and
         the handover between them does not change size. */
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      /* Sized off the LIGHT, not off the letters. The glow canvas is GLOW_FRAME
         times the wordmark's width and half that in height, and it is the thing
         that reaches the edge of the screen first — size to the letters alone
         and the shafts get guillotined by the viewport, which is the one way
         this effect can still read as a rectangle. Both axes are clamped,
         because a wide short window has width to spare and no height. */
      /* The light is allowed to run off the sides — its outer edge is the
         faintest part of it, and holding the whole canvas inside the viewport
         is what was keeping the wordmark small. It is NOT allowed to run off
         the top and bottom, because that is where the headline and the header
         are. Hence the two different multipliers. */
      const glowW = Math.min(vw * 1.22, vh * 0.72 * GLOW_ASPECT);
      const scale = Math.max(1.6, Math.min(26, glowW / GLOW_FRAME / r.width));

      /* `transform-origin` is the mark's own left edge, so after scaling by S
         its centre sits at `left + width * S / 2`, not `left + width / 2`.
         Using the unscaled half-width is what put the old opening mark most of
         a screen to the right, hanging off the edge. */
      mark.style.setProperty('--dx', `${vw / 2 - (r.left + (r.width * scale) / 2)}px`);
      /* Higher than the old plate sat, because this one is half again as big:
         at 34dvh its beams were raking across the headline. */
      mark.style.setProperty('--dy', `${vh * 0.31 - (r.top + r.height / 2)}px`);
      mark.style.setProperty('--s', String(scale));
    };

    measure();
    window.addEventListener('resize', measure, { passive: true });
    window.addEventListener('orientationchange', measure, { passive: true });
    if (document.fonts?.ready) void document.fonts.ready.then(measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, []);

  /* One value drives the whole thing: how far through the arrival you are. The
     two beats are cut out of it here rather than in the stylesheet, because a
     number computed in JS cannot silently fail to parse, and a chain of CSS
     clamps on an unregistered custom property can — which reads as "the hero
     does not move" with nothing in the console.

     rAF-throttled, and never through React state: re-rendering the page sixty
     times a second to move a wordmark is how a smooth idea ships as a stutter. */
  useEffect(() => {
    const arrive = arriveRef.current;
    const mark = markRef.current;
    if (!arrive) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.querySelector('.truland')?.classList.remove('arrive-live');
      return;
    }

    let frame = 0;
    let cur = 0;
    let target = 0;
    const shell = document.querySelector('.truland');

    const apply = (v: number) => {
      /* Beat two starts first and beat one finishes inside it, on purpose.

         THE HANDOVER HAPPENS LATE, and that is the whole tuning of this thing.
         Swapping the plate for live type while the mark is still enormous put
         Playfair at 800 weight on the screen ten times its design size, next to
         a fine high-contrast Didone — the same three letters, visibly fatter,
         which is a downgrade you cannot un-see. Held until the mark is roughly
         half way home, the type is small enough that its weight reads as it was
         drawn to, and the light travels with the mark instead of leaving it. */
      /* The light holds while the mark is big and banks down over the second
         half of the trip, so it SETTLES into the header instead of arriving
         there still burning. It is not a handover any more — there is nothing
         to hand over to, the type has been the type the whole way — so this
         curve is free to be about the feel of landing rather than about hiding
         a seam. */
      const travel = Math.max(0, Math.min(1, (v - 0.14) / 0.86));
      const light = 1 - Math.max(0, Math.min(1, (travel - 0.35) / 0.5));

      arrive.style.setProperty('--p', v.toFixed(4));
      arrive.style.setProperty('--pt', travel.toFixed(4));
      if (mark) {
        mark.style.setProperty('--p', v.toFixed(4));
        mark.style.setProperty('--pl', light.toFixed(4));
        glowRef.current = light;
        // The light's loop parks itself when it has nothing left to draw, so it
        // has to be woken when scrolling back up relights the mark.
        if (light > 0.001) {
          const c = mark.querySelector<HTMLCanvasElement & { __wake?: () => void }>('.arrive-glow');
          c?.__wake?.();
        }
        mark.style.setProperty('--pt', travel.toFixed(4));
        /* A class, not an inline opacity. An inline style beats the entry
           animation's own opacity, and writing one on the first frame is what
           would silently delete the mark's fade-in. */
        mark.classList.toggle('landed', travel >= 0.995);
      }
      // Hand the header its own mark back only once the travelling one has
      // landed on it. Both visible at once, even for two frames, and the
      // illusion is over.
      shell?.classList.toggle('arrive-live', travel < 0.995);
    };

    /* The value EASES toward the scroll position rather than tracking it one to
       one. Raw tracking is what makes a scroll-driven move feel mechanical: the
       mark stops the instant the wheel stops. A lerp of 0.12 a frame is roughly
       the 0.4s scrub a production scroll rig uses, and it is the difference
       between an object being dragged and an object with mass.

       The loop only runs while there is distance left to close, so a page at
       rest costs nothing. */
    const tick = () => {
      cur += (target - cur) * 0.12;
      if (Math.abs(target - cur) < 0.0006) cur = target;
      apply(cur);
      frame = cur === target ? 0 : requestAnimationFrame(tick);
    };

    const measureTarget = () => {
      const travel = arrive.offsetHeight - window.innerHeight;
      if (travel <= 0) return;
      target = Math.max(0, Math.min(1, (window.scrollY - arrive.offsetTop) / travel));
      if (!frame) frame = requestAnimationFrame(tick);
    };

    // Land on the true value on first paint rather than easing up from zero on
    // a reload halfway down the page.
    const travel0 = arrive.offsetHeight - window.innerHeight;
    cur = travel0 > 0 ? Math.max(0, Math.min(1, (window.scrollY - arrive.offsetTop) / travel0)) : 0;
    target = cur;
    apply(cur);

    window.addEventListener('scroll', measureTarget, { passive: true });
    window.addEventListener('resize', measureTarget, { passive: true });
    return () => {
      window.removeEventListener('scroll', measureTarget);
      window.removeEventListener('resize', measureTarget);
      cancelAnimationFrame(frame);
      shell?.classList.remove('arrive-live');
    };
  }, []);

  const arrow = (
    <span className="pea"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
  );

  return (
    <div className="fh">
      <section className="arrive" id="top" ref={arriveRef}>
        <div className="arrive-stage">
          {/* Holds the site's own room back while the mark is the only lit
              thing on the screen, and lifts as the mark leaves. The room never
              changes — it is the same fixed plate every page of this site is
              already standing on. Nothing crossfades to somewhere else. */}
          <div className="arrive-veil" aria-hidden />

          {/* Reduced motion only. The same wordmark under the same light,
              standing still and in the flow of the hero instead of travelling
              into the header. */}
          {still && <div className="arrive-still" aria-hidden>{wordmark}</div>}

          <div className="arrive-copy">
            <h1>
              Somebody has to run the sales floor.{' '}
              <em>It should not be you.</em>
            </h1>
            <p className="arrive-sub">
              Fractional sales management for real estate teams. We own accountability,
              pipeline, and Zillow Preferred conversion.
            </p>
            <div className="hcta">
              <a href={BUSINESS.bookingUrl} className="cta" target="_blank" rel="noopener noreferrer">
                Book a call{arrow}
              </a>
              <a href="/apply" className="cta ghost">Apply to work with us{arrow}</a>
            </div>
          </div>

          {/* Somewhere to go. A hero whose whole first beat is scroll-driven
              owes the reader a reason to scroll. */}
          <a className="arrive-cue" href="#proof" aria-label="Skip to the numbers">
            <span className="arrive-cue-rule" aria-hidden />
          </a>
        </div>
      </section>

      {/* The travelling mark. Fixed, and outside the pinned stage, because it
          has to outlive it: it is still moving when the stage has released and
          it finishes its trip sitting in the header. aria-hidden because the
          header's own mark is the one in the document. */}
      {!still && (
        <div className="arrive-mark" ref={markRef} aria-hidden>
          {wordmark}
        </div>
      )}

      <section className="panel band fh-proof" id="proof"><div className="wrap">
        <h2 className="h2 reveal">
          Every team we have worked with has improved its <em>transaction count</em>.
        </h2>

        <ol className="fh-figs">
          {PROOF.map((p, i) => (
            <li className={`fh-fig reveal d${i + 1}`} key={p.figure}>
              <b>{p.figure}</b>
              <span className="fh-what">{p.what}</span>
              <span className="fh-scope">{p.scope}</span>
              <p>{p.body}</p>
            </li>
          ))}
        </ol>

        <p className="disclaimer reveal d2">
          Client examples describe work performed for real engagements. They are illustrative,
          not a prediction or guarantee of results. Outcomes depend on your market, your team,
          your lead spend, and your execution.
        </p>
      </div></section>

      <section className="panel band fh-own" id="what"><div className="wrap">
        <h2 className="h2 reveal">What we take <em>off your plate</em>.</h2>
        <dl className="fh-list">
          {OWN.map((o, i) => (
            <div className={`fh-row reveal d${i + 1}`} key={o.name}>
              <dt>{o.name}</dt>
              <dd>{o.body}</dd>
            </div>
          ))}
        </dl>
        <a href="/services" className="fh-more reveal d2">
          All seven, and how an engagement starts{arrow}
        </a>
      </div></section>

      <section className="panel band fh-soft" id="software"><div className="wrap">
        <h2 className="h2 reveal">And the software we <em>built to do it</em>.</h2>
        <p className="sub reveal d1">
          It comes with the engagement. There is nothing extra to buy.
        </p>

        <div className="fh-shots">
          <figure className="fh-shot reveal d1">
            <img src="/shot-pulse.webp" width="1240" height="649" loading="lazy" decoding="async"
                 alt="TRU Pulse showing a team roster ranked by leads per contract, with the agents who need a conversation flagged above the table." />
            <figcaption><b>Pulse.</b> Who got no contact, what is stuck, and who is quietly slipping.</figcaption>
          </figure>
          <figure className="fh-shot reveal d2">
            <img src="/shot-coach.webp" width="1240" height="649" loading="lazy" decoding="async"
                 alt="TRU Coach showing a cohort ranked by coaching health, with the four agents who need a one to one listed above it." />
            <figcaption><b>Coach.</b> The exact move for this person, this week.</figcaption>
          </figure>
        </div>
        <p className="fh-third reveal d2">
          <b>Rep.</b> Every agent certified on your program through real drills, not skimmed video.
        </p>
      </div></section>

      <section className="panel band fh-who" id="who"><div className="wrap">
        <h2 className="h2 reveal">Who we <em>work with</em>.</h2>
        <dl className="fh-list">
          {WHO.map((w, i) => (
            <div className={`fh-row reveal d${i + 1}`} key={w.k}>
              <dt>{w.k}</dt>
              <dd>{w.body}</dd>
            </div>
          ))}
        </dl>
      </div></section>

      <section className="panel ctaband" id="cta"><div className="wrap">
        <h2 className="reveal">Think your team is <em>next</em>?</h2>
        <p className="sub reveal d1">
          60 minutes on your real numbers, and the next move. No pitch.
        </p>
        <div className="hcta reveal d2">
          <a href={BUSINESS.bookingUrl} className="cta" target="_blank" rel="noopener noreferrer">
            Book a call{arrow}
          </a>
          <a href="/apply" className="cta ghost">Apply to work with us{arrow}</a>
        </div>
      </div></section>
    </div>
  );
}
