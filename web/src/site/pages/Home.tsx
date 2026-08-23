import { useEffect, useRef, useState } from 'react';
import { BUSINESS } from '../../config/business';

/* ============================================================================
   THE ARRIVAL — "first light"
   ----------------------------------------------------------------------------
   Two beats, one object, three quarters of a screen of scroll.

   BEAT ONE, before you touch anything: the mark is not drawn, it is LIT. A
   rendered plate of dawn light coming through mist, with the letterforms
   standing in the gap the light leaves. It breathes. Then the light contracts
   into the letters and hands over to live type at exactly the same size and
   place, so the surface changes while the object does not.

   BEAT TWO, as you scroll: that live type travels and shrinks along one path
   until it is sitting exactly where the header's own wordmark sits, at exactly
   its size, and the two swap. The words rise into the middle behind it and the
   veil over the page's room lifts, so the site is assembling itself while the
   mark is still moving rather than appearing once it has finished.

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

/* The plate, and the same plate moving.

   Both are generated art with the dark ground removed rather than composited
   with a blend mode. `mix-blend-mode: screen` was tried and measurably DARKENED
   the page here — the mark carries a transform, a transform makes a stacking
   context, and a blend inside one composites against a backdrop that is empty.
   Baking the plate's own luminance into an alpha channel sidesteps the whole
   argument: there is no rectangle in either file, so there is no edge to hide.

   The still is the poster and the honest fallback. The clip is an upgrade that
   is only switched on where it is known to render correctly. */
const ART_STILL = '/tru-firstlight.webp';
const ART_CLIP = '/tru-firstlight.webm';

/* The letters occupy 71.4% of the plate's width, dead centre on both axes —
   measured off the file, not guessed. Sizing the plate at 1/0.714 of the typeset
   mark is what makes the lit letters and the live letters exactly the same
   width, which is the only reason the handover between them is invisible.

   THE PLATE WAS RE-RENDERED BIGGER. The first one gave the letters 55% of its
   width and spent the rest on beams and fog, so a plate that fitted the screen
   put a wordmark on it that did not feel like one. This one is the same scene
   at the same lighting, recomposed so the letters carry the frame. Everything
   downstream is driven off these three numbers, so re-measuring a new plate is
   the whole of swapping one in. */
const ART_LETTER_FRACTION = 0.7143;
const ART_FRAME = `${(100 / ART_LETTER_FRACTION).toFixed(1)}%`;
/* 3108 × 1333, the frame the plate was rendered and centred at. */
const ART_ASPECT = 3108 / 1333;

/* Alpha in WebM is a VP9 side-track. Chromium and Firefox composite it; Safari
   plays the video and ignores the alpha, which would put a black slab over the
   hero — worse than no clip at all. So the clip is opt-in for engines known to
   handle it, and everywhere else the still stands, which is the same picture
   without the drift. */
function clipIsSafeHere(): boolean {
  const v = document.createElement('video');
  if (v.canPlayType('video/webm; codecs="vp9"') !== 'probably') return false;
  const ua = navigator.userAgent;
  const isSafari = /Safari/.test(ua) && !/Chrome|Chromium|Android|Edg/.test(ua);
  return !isSafari;
}

export default function Home() {
  const arriveRef = useRef<HTMLElement | null>(null);
  const markRef = useRef<HTMLDivElement | null>(null);
  const [hasClip, setHasClip] = useState(false);

  useEffect(() => {
    if (!clipIsSafeHere()) return;
    // Probed rather than assumed, so a clip that fails to load degrades to the
    // still instead of leaving a hole where the mark should be.
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadeddata = () => setHasClip(true);
    v.oncanplay = () => setHasClip(true);
    v.src = ART_CLIP;
  }, []);

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
      const artW = Math.min(vw * 0.92, vh * 0.5 * ART_ASPECT);
      const scale = Math.max(1.6, Math.min(26, (artW * ART_LETTER_FRACTION) / r.width));

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
      const light = Math.max(0, Math.min(1, (v - 0.56) / 0.24));
      const travel = Math.max(0, Math.min(1, (v - 0.14) / 0.86));

      arrive.style.setProperty('--p', v.toFixed(4));
      arrive.style.setProperty('--pt', travel.toFixed(4));
      if (mark) {
        mark.style.setProperty('--p', v.toFixed(4));
        mark.style.setProperty('--pl', light.toFixed(4));
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
      <div className={`arrive-mark${hasClip ? ' has-clip' : ''}`} ref={markRef} aria-hidden>
        <span className="arrive-type">T<i>RU</i></span>
        <img
          className="arrive-art"
          src={ART_STILL}
          alt=""
          width="1920"
          height="815"
          decoding="async"
          style={{ width: ART_FRAME }}
        />
        {hasClip && (
          <video
            className="arrive-art arrive-art-clip"
            src={ART_CLIP}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            style={{ width: ART_FRAME }}
          />
        )}
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
