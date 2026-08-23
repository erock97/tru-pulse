import { useEffect, useRef } from 'react';
import { BUSINESS } from '../../config/business';

/* ============================================================================
   THE ARRIVAL
   ----------------------------------------------------------------------------
   The wordmark, set bold and very large, and nothing else. As you scroll it
   travels and shrinks along one path until it is sitting exactly where the
   header's own wordmark sits, at exactly its size, and the two swap. The words
   rise into the middle behind it and the veil over the page's room lifts, so
   the site is assembling itself while the mark is still moving rather than
   appearing once it has finished.

   IT IS THE SAME OBJECT ALL THE WAY DOWN. That is the whole idea and every
   version that failed, failed by breaking it:

   1. A VIDEO OF MOLTEN LETTERS cooling into the page. A crossfade has no
      object in common on either side of it, so there is nothing to follow and
      the opening reads as an intro bolted to the front of the site.

   2. NEON GREEN LIGHTNING. Not the palette — the site is deep green, bone and
      one amber — and scaled off viewport WIDTH alone, so on any laptop it ran
      off the top and bottom of the screen. It also asked for three full
      screens of scroll before the page began.

   3. A RENDERED PLATE OF LIGHT that handed over to live type mid-flight.
      Beautiful, and one object too many: two different serifs cross-fading
      through each other is a double exposure, and the plate had to be sized,
      clamped, alpha-baked and browser-gated to earn its place. The letters do
      not need lighting to be the thing on the screen.

   So there is one element now, and it is type from the first frame to the
   last. The only thing that changes is where it is and how big.

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

export default function Home() {
  const arriveRef = useRef<HTMLElement | null>(null);
  const markRef = useRef<HTMLDivElement | null>(null);

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
         of 1.6, so its line box is 40px tall around 25px of type, and glyphs
         are centred in it. A clone set `line-height: 1` puts its glyphs at the
         top of a 25px box instead, which lands the whole wordmark about eight
         pixels high — close enough to look like a bug and not close enough to
         look like a swap. */
      const cs = getComputedStyle(brand);
      mark.style.left = `${r.left}px`;
      mark.style.top = `${r.top}px`;
      mark.style.fontSize = cs.fontSize;
      mark.style.lineHeight = cs.lineHeight;

      /* And the opening state, as a delta from there.

         CLAMPED ON BOTH AXES. Width alone is what put an earlier version of
         this hero off the screen: a wide short window has plenty of width and
         no height, so a mark sized off width alone overflowed the top and the
         bottom every time. Whichever axis runs out first decides the size, and
         both keep a real margin.

         The height clamp is expressed against CAP HEIGHT — derived from the
         font size, not from the element's box. The box is a 1.6 line height
         around the type, so measuring it clamps against half a screen of empty
         leading and leaves the letters a third smaller than they were asked to
         be. Playfair's capitals come to roughly 0.7em; that is the number. */
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const cap = parseFloat(cs.fontSize) * 0.7;
      const byWidth = (vw * 0.8) / r.width;
      const byHeight = (vh * 0.27) / cap;
      const scale = Math.max(1.6, Math.min(26, Math.min(byWidth, byHeight)));

      /* `transform-origin` is the mark's own left edge, so after scaling by S
         its centre sits at `left + width * S / 2`, not `left + width / 2`.
         Using the unscaled half-width is what put the old opening mark most of
         a screen to the right, hanging off the edge. */
      mark.style.setProperty('--dx', `${vw / 2 - (r.left + (r.width * scale) / 2)}px`);
      mark.style.setProperty('--dy', `${vh * 0.34 - (r.top + r.height / 2)}px`);
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
      /* A short dead band at the top before anything moves. Without it the mark
         starts sliding on the first pixel of scroll, which reads as twitchy —
         a hero should hold its ground for a moment before it gives it up. */
      const travel = Math.max(0, Math.min(1, (v - 0.1) / 0.9));

      arrive.style.setProperty('--p', v.toFixed(4));
      arrive.style.setProperty('--pt', travel.toFixed(4));
      if (mark) {
        mark.style.setProperty('--p', v.toFixed(4));
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

          {/* The mark, printed in the flow. Hidden unless the reader has asked
              for reduced motion, in which case the travelling clone is off and
              this is the opening: the same picture, standing still. */}
          <p className="arrive-still" aria-hidden>T<i>RU</i></p>

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
      <div className="arrive-mark" ref={markRef} aria-hidden>
        <span className="arrive-type">T<i>RU</i></span>
      </div>

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
