import { useEffect, useRef } from 'react';
import { BUSINESS } from '../../config/business';

/* ============================================================================
   THE ARRIVAL
   ----------------------------------------------------------------------------
   The wordmark opens at half the width of the screen and, as you scroll, moves
   and shrinks until it is sitting exactly where the header's own wordmark
   sits, at exactly its size. Then the two swap and the page is there.

   The previous version of this was a video of molten letters that cooled into
   the page. It failed for a reason worth keeping written down: a crossfade has
   no object in common on either side of it, so there is nothing for the eye to
   follow, and the opening reads as a separate thing bolted to the front of the
   site no matter how well the colours are matched. Continuity is not a colour
   problem. One thing has to survive the boundary.

   Everything below serves that: measure the real header mark, hand the CSS the
   delta, and let one custom property drive the trip.
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
  const markRef = useRef<HTMLParagraphElement | null>(null);

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

      // Sit on it: same box, same face, same size.
      mark.style.left = `${r.left}px`;
      mark.style.top = `${r.top}px`;
      mark.style.fontSize = getComputedStyle(brand).fontSize;

      /* And the opening state, as a delta from there.

         The scale has to be inside the centring. `transform-origin` is the
         mark's own left edge, so after scaling by S its centre has moved to
         `left + width * S / 2`, not `left + width / 2`. Using the unscaled
         half-width put the opening mark most of a screen to the right and
         hanging off the edge. */
      const scale = Math.max(2, Math.min(16, (window.innerWidth * 0.44) / r.width));
      mark.style.setProperty('--dx', `${window.innerWidth / 2 - (r.left + (r.width * scale) / 2)}px`);
      mark.style.setProperty('--dy', `${window.innerHeight * 0.42 - (r.top + r.height / 2)}px`);
      mark.style.setProperty('--s', String(scale));
    };

    measure();
    window.addEventListener('resize', measure, { passive: true });
    if (document.fonts?.ready) void document.fonts.ready.then(measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  /* One value drives the whole thing: how far through the arrival you are.
     Written straight onto the element as a custom property, so the stylesheet
     owns every transform and this owns none of them. rAF-throttled, so a burst
     of scroll events costs one write per frame and never touches React state,
     which at sixty frames a second would re-render the page instead of moving
     a wordmark. */
  useEffect(() => {
    const arrive = arriveRef.current;
    const mark = markRef.current;
    if (!arrive) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.querySelector('.truland')?.classList.remove('arrive-live');
      return;
    }

    let frame = 0;
    const paint = () => {
      frame = 0;
      const travel = arrive.offsetHeight - window.innerHeight;
      if (travel <= 0) return;
      const p = Math.max(0, Math.min(1, (window.scrollY - arrive.offsetTop) / travel));
      arrive.style.setProperty('--p', p.toFixed(4));
      if (mark) mark.style.setProperty('--p', p.toFixed(4));
      // Hand the header its own mark back only once the travelling one has
      // landed on it. Both visible at once, even for two frames, and the
      // illusion is over.
      document.querySelector('.truland')?.classList.toggle('arrive-live', p < 0.985);
      if (mark) mark.style.opacity = p < 0.985 ? '1' : '0';
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(paint); };

    paint();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(frame);
      document.querySelector('.truland')?.classList.remove('arrive-live');
    };
  }, []);

  const arrow = (
    <span className="pea"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
  );

  return (
    <div className="fh">
      <section className="arrive" id="top" ref={arriveRef}>
        <div className="arrive-stage">
          {/* The product's own room render. The mark is lit by the same source
              the app is lit by, and it fades into the room the page already
              has underneath, which is the same room. */}
          <div className="arrive-light" aria-hidden />

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
        </div>
      </section>

      {/* The travelling mark. Fixed, outside the pinned stage, because it has to
          outlive it: it is still moving when the stage has released, and it
          finishes its trip sitting in the header. aria-hidden because the
          header's own mark is the one in the document. */}
      <p className="arrive-mark" ref={markRef} aria-hidden>
        <span>T<i className="r">RU</i></span>
      </p>

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
