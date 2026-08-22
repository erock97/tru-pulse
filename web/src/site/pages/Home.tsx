import { useEffect, useRef } from 'react';
import { BUSINESS } from '../../config/business';

/* ============================================================================
   THE FORGE
   ----------------------------------------------------------------------------
   The old home page was 5.6 viewports and 735 words, and the reveal at the top
   of it was a curtain: a full-screen overlay that played for seven seconds,
   locked the page so you could not scroll past it, faded, and then deleted
   itself. Whatever came next had no relationship to it. That is why it read as
   an intro rather than as a beginning.

   So it stops being a curtain and becomes the first six inches of the page.
   The letters burn in, and scrolling pushes the camera through them while the
   heat cools out of the picture into the deep green the product lives in. By
   the time the hero is behind you, you are standing in the same room as Pulse.
   The brand cooling into the software is the transition, and it is the only
   piece of motion on the page that carries an idea.

   Two things go with the curtain. The scroll lock goes, so nobody is ever held
   in a video they have already seen. And the once-per-visitor localStorage gate
   goes with it, because the reveal is no longer a toll to be paid: it is the
   top of the page, and it behaves the same on the tenth visit as the first.
   ========================================================================== */

/* Every number here is real work, and none of it is named, which is the client's
   call rather than an omission. The disclaimer under them is carried over
   verbatim from the Work page: it was written carefully and it belongs directly
   beneath the claims it qualifies. */
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
  const forgeRef = useRef<HTMLElement | null>(null);

  /* One value drives the whole hero: how far you are through the forge, 0 to 1.
     It is written straight onto the element as a custom property, so the CSS
     owns every transform and this owns none of them. rAF-throttled, so a burst
     of scroll events costs one write per frame and never touches React state,
     which at sixty frames a second would re-render the page instead of moving
     a video. */
  useEffect(() => {
    const forge = forgeRef.current;
    if (!forge) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      forge.style.setProperty('--p', '0');
      return;
    }

    let frame = 0;
    const paint = () => {
      frame = 0;
      const travel = forge.offsetHeight - window.innerHeight;
      if (travel <= 0) return;
      const p = Math.max(0, Math.min(1, (window.scrollY - forge.offsetTop) / travel));
      forge.style.setProperty('--p', p.toFixed(4));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(paint); };

    paint();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  /* The reveal was cut in two aspect ratios. A phone gets the square one, which
     is the only crop where the whole word fits on screen. */
  useEffect(() => {
    const v = document.getElementById('forgevid') as HTMLVideoElement | null;
    if (!v) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      v.removeAttribute('autoplay');
      v.pause();
      return;
    }
    if (window.matchMedia('(max-width:760px),(max-aspect-ratio:1/1)').matches) {
      v.poster = '/TRU-lockup-square.jpg';
      const src = v.querySelector('source');
      if (src) { src.src = '/TRU-reveal-square.mp4'; v.load(); }
    }
    // Autoplay refusal is not a failure worth handling: the poster is the fully
    // lit lockup, so a blocked video simply shows the finished mark.
    v.play().catch(() => {});
  }, []);

  const arrow = (
    <span className="pea"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
  );

  return (
    <div className="fh">
      <section className="forge" id="top" ref={forgeRef}>
        <div className="forge-stage">
          <video
            id="forgevid"
            className="forge-vid"
            muted
            playsInline
            preload="auto"
            poster="/TRU-lockup.jpg"
            aria-hidden="true"
          >
            <source src="/TRU-reveal.mp4" type="video/mp4" />
          </video>
          {/* Knocks the picture back off the words. See forge.css. */}
          <div className="forge-wash" aria-hidden />
          {/* The heat coming out of the picture. Opacity only, driven by --p. */}
          <div className="forge-cool" aria-hidden />

          <div className="forge-copy">
            <h1>
              Somebody has to run the sales floor.<br />
              <em>It should not be you.</em>
            </h1>
            <p className="forge-sub">
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
