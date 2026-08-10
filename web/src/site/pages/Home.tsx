import { useEffect, useRef } from 'react';
import { BUSINESS } from '../../config/business';

// The seven services we own for a client. Verbatim from the old marketing site's
// services page (see the site archive under docs/ § /services), which is also the
// number the pricing flier leads with — "7 core services, included for every team."
const SERVICES = [
  { n: '01', name: 'Sales leadership support',
    body: 'We partner with ownership and leadership to manage performance, identify bottlenecks, and install a consistent operating rhythm across the sales team.' },
  { n: '02', name: 'Agent accountability',
    body: 'We hold agents to following up, working their pipeline, staying engaged with leads, and taking the right actions every single week.' },
  { n: '03', name: 'Pipeline & CRM oversight',
    body: 'Lead flow, pipeline health, speed-to-lead, follow-up quality, appointment setting, nurture opportunities, and Follow Up Boss adoption — reviewed continuously.' },
  { n: '04', name: 'Zillow / Flex lead conversion',
    body: 'Better follow-up systems, agent coaching on Zillow conversations, and performance visibility on every online lead. We protect the lead spend.' },
  { n: '05', name: 'ZHL adoption',
    body: 'Better agent understanding of Zillow Home Loans, cleaner handoffs, stronger talk tracks, and consistent execution throughout the buyer process.' },
  { n: '06', name: 'Training & coaching',
    body: 'Coaching, call strategy, objection handling, scripting, and real-time feedback to help agents convert more buyers and sellers.' },
  { n: '07', name: 'Leadership meetings & performance reviews',
    body: 'Regular meetings with leadership to review team performance, agent execution, conversion trends, ZHL adoption, and what’s next on the operating roadmap.' },
] as const;

const AUDIENCES = [
  { kick: 'Team owners', head: 'Generating leads. Stuck in the weeds.',
    body: 'You’re investing in Zillow, Flex, or Preferred — and the leads are coming in. But you’re spending your week managing the team instead of branding, recruiting, and expanding. We take sales management off your plate so you can focus on the bigger vision.' },
  { kick: 'Sales leaders', head: 'Running point on conversion and ZHL.',
    body: 'You own the sales performance number. We partner with you on accountability, pipeline reviews, ZHL adoption, and the operating rhythm that turns leads into closings — and gives you a peer to think with.' },
  { kick: 'Agents', head: 'Wanting better systems and coaching.',
    body: 'Scripts. Call strategy. Objection handling. Real-time feedback on Zillow conversations. We help individual agents convert more buyers and sellers — and stay accountable to the standard the team needs.' },
] as const;

const PROBLEMS = [
  'Agent accountability — follow-up, pipeline work, lead engagement, the right actions every week.',
  'Zillow / Flex conversion — better follow-up systems, agent coaching, performance visibility on every online lead.',
  'ZHL adoption — cleaner handoffs, stronger talk tracks, consistent execution through the buyer process.',
  'Pipeline & CRM oversight — speed-to-lead, follow-up quality, appointment setting, Follow Up Boss hygiene held to standard.',
  'Leadership meetings + performance reviews — regular cadence to review team performance, agent execution, conversion trends, ZHL adoption, and what’s next.',
] as const;

export default function Home() {
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timers: number[] = [];
    const cleanups: Array<() => void> = [];
    const t = (fn: () => void, ms: number) => {
      const id = window.setTimeout(fn, ms);
      timers.push(id);
      return id;
    };

    /* --- Cinematic brand intro: bold reveal plays, then fades to the site --- */

    // Shown ONCE per visitor. The reveal is worth ~7 seconds of a stranger's
    // attention exactly once; making someone sit through it again every time
    // they come back to reread the packages is a toll, not an impression.
    //
    // Bump the version suffix to replay it for everyone (e.g. after recutting
    // the video). Storage can throw in private mode or with cookies blocked, so
    // every access is guarded — a failure just means the intro plays, which is
    // the safe direction to fail.
    const INTRO_KEY = 'tru:intro-seen:v1';
    const seenIntro = () => {
      try {
        return window.localStorage.getItem(INTRO_KEY) === '1';
      } catch {
        return false;
      }
    };
    const markIntroSeen = () => {
      try {
        window.localStorage.setItem(INTRO_KEY, '1');
      } catch {
        /* storage unavailable — it simply plays again next time */
      }
    };

    (function intro() {
      const el = document.getElementById('intro');
      const vid = document.getElementById('introvid') as HTMLVideoElement | null;
      if (!el) return;
      if (reduce || seenIntro()) {
        if (el.parentNode) el.remove();
        return;
      }
      const doc = document.documentElement;
      let dismissed = false;
      doc.classList.add('intro-lock');
      // markSeen=false is for the playback-failure path only. If the video never
      // ran, the visitor has not actually seen the reveal, and burning the flag
      // would cost them it permanently over one flaky load.
      function dismiss(markSeen = true) {
        if (dismissed) return;
        dismissed = true;
        if (markSeen) markIntroSeen();
        el!.classList.add('done');
        doc.classList.remove('intro-lock');
        t(() => {
          if (el && el.parentNode) el.remove();
        }, 1050);
      }
      // On phones: square reveal (full "TRU" visible) + a blurred copy behind it to fill the screen
      const fill = document.getElementById('introfill') as HTMLVideoElement | null;
      const isPhone = window.matchMedia('(max-width:760px),(max-aspect-ratio:1/1)').matches;
      if (vid && isPhone) {
        vid.poster = '/TRU-lockup-square.jpg';
        const src = vid.querySelector('source');
        if (src) {
          src.src = '/TRU-reveal-square.mp4';
          vid.load();
        }
        if (fill) {
          fill.src = '/TRU-reveal-square.mp4';
          fill.load();
          fill.play().catch(() => {});
        }
      }
      if (vid) {
        const p = vid.play();
        // Playback refused (autoplay policy, decode failure, dead connection).
        // Drop straight to the site, but do NOT record it as seen.
        if (p && p.catch) p.catch(() => dismiss(false));
      }
      const skip = el.querySelector('.skip');
      if (skip) skip.addEventListener('click', () => dismiss(true));
      // Freeze on the fully-lit mark for a beat, THEN fade -> the handoff reads as intentional
      const HOLD_AT = 6.4;
      let held = false;
      function bridge() {
        if (held) return;
        held = true;
        try {
          if (vid) vid.pause();
          if (fill) fill.pause();
        } catch (e) {
          /* noop */
        }
        t(dismiss, 550);
      }
      if (vid) {
        vid.addEventListener('timeupdate', function () {
          if (vid.currentTime >= HOLD_AT) bridge();
        });
      }
      t(bridge, 7000); // fallback if timeupdate never crosses (stall/seek)
      t(dismiss, 11500); // hard safety net
    })();

    // `.ready` and the `.reveal` observer live in PublicSite, so every marketing
    // page gets them — not only this one. The count-up animation that used to
    // live here went with the audit card it drove.

    return () => {
      timers.forEach((id) => clearTimeout(id));
      cleanups.forEach((fn) => fn());
      document.documentElement.classList.remove('intro-lock');
    };
  }, []);

  const arrow = (
    <span className="pea"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
  );

  return (
    <div ref={wrapRef}>
      <div id="intro" aria-hidden="true">
        <video id="introfill" className="intro-fill" muted playsInline preload="auto" aria-hidden="true" />
        <video id="introvid" muted playsInline preload="auto" poster="/TRU-lockup.jpg">
          <source src="/TRU-reveal.mp4" type="video/mp4" />
        </video>
        <button className="skip" type="button">Skip</button>
      </div>
      {/* The background wisp and grain moved to PublicSite so every page has
          them, not just this one. */}

      <header className="hero" id="top"><div className="wrap">
        <div>
          <span className="badge fade g1"><span className="s"></span>Real estate sales operations</span>
          {/* Kept to four short lines. The hero column is narrow, and anything
              much past ~20 characters wraps mid-word — "high-performing" was
              splitting across lines at the hyphen. */}
          <h1>
            <span className="line"><span>The operating</span></span>
            <span className="line"><span>system behind</span></span>
            <span className="line"><span className="thin">high-performing</span></span>
            <span className="line"><span className="say">real estate teams.<svg viewBox="0 0 300 12" preserveAspectRatio="none"><path d="M3 8 C 60 2, 110 11, 160 6 S 250 2, 297 7" /></svg></span></span>
          </h1>
          <p className="hsub fade g2">
            We take sales management &mdash; agent accountability, pipeline oversight, Zillow Flex
            conversion, ZHL adoption, and the daily operating rhythm &mdash; off the owner&rsquo;s
            plate so you can focus on what actually grows the business: branding, recruiting,
            expansion, vision.
          </p>
          <div className="hcta fade g3">
            <a href="/apply" className="cta">Apply to work with us{arrow}</a>
            <a href={BUSINESS.calendly} className="cta ghost" target="_blank" rel="noopener noreferrer">
              Book a call with our team{arrow}
            </a>
          </div>
        </div>
        <div className="scrollcue">Scroll<i></i></div>
      </div></header>

      <section className="panel band" id="problem"><div className="wrap">
        <div className="kick reveal">The problem</div>
        <h2 className="h2 reveal d1">You don&rsquo;t have a lead problem. You have a conversion, accountability, and <em>management</em> problem.</h2>
        <p className="sub reveal d2">
          Leads sit in the CRM unworked. Agents follow up inconsistently. Zillow Flex conversion
          lags. ZHL adoption stalls. Meanwhile the team owner is in the weeds of sales management
          instead of running the business. Fractional sales management replaces the chaos with
          structure &mdash; without adding a full-time hire.
        </p>
        <ul className="pills svc" style={{ listStyle: 'none', padding: 0 }}>
          {PROBLEMS.map((p, i) => (
            <li className={`p reveal d${(i % 3) + 1}`} key={p}>{p}</li>
          ))}
        </ul>
      </div></section>

      <section className="panel band" id="services"><div className="wrap">
        <div className="kick reveal">What we do</div>
        <h2 className="h2 reveal d1">Seven things we <em>own</em> for you.</h2>
        <p className="sub reveal d2">
          Every engagement covers the full operating system &mdash; from leadership rhythm down to
          individual agent coaching. Packages differ in coaching volume; the core scope is the same.
        </p>
        <div className="pills svc">
          {SERVICES.map((s, i) => (
            <div className={`p reveal d${(i % 3) + 1}`} key={s.n}>
              <span className="num">{s.n}</span>
              <h3>{s.name}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
        <div className="hcta reveal d2" style={{ marginTop: '2rem' }}>
          <a href="/services" className="cta ghost">See the full engagement model{arrow}</a>
        </div>
      </div></section>

      <section className="panel band" id="who"><div className="wrap">
        <div className="kick reveal">Who it&rsquo;s for</div>
        <h2 className="h2 reveal d1">Three kinds of operators we <em>work with</em>.</h2>
        <div className="pills">
          {AUDIENCES.map((a, i) => (
            <div className={`p reveal d${i + 1}`} key={a.kick}>
              <span className="k">{a.kick}</span>
              <h3>{a.head}</h3>
              <p>{a.body}</p>
            </div>
          ))}
        </div>
      </div></section>

      <section className="panel band" id="tooling"><div className="wrap">
        <div className="kick reveal">Included in your engagement</div>
        <h2 className="h2 reveal d1">The software we run your team <em>on</em>.</h2>
        <p className="sub reveal d2">
          We built our own tooling because the work needed it. It comes with the engagement &mdash;
          there is nothing extra to buy.
        </p>
        <div className="pills">
          <div className="p reveal d1"><span className="k">TRU Pulse</span><h3>See it.</h3><p>Flags who got zero personal contact, what is stuck, and which agent is quietly slipping.</p></div>
          <div className="p reveal d2"><span className="k">TRU Coach</span><h3>Coach it.</h3><p>Hands us the exact 1:1 move for this person, this week, based on how they are wired.</p></div>
          <div className="p reveal d3"><span className="k">TRU Rep</span><h3>Make it stick.</h3><p>Every agent certified on your program through real drills, not skimmed videos.</p></div>
        </div>

      </div></section>

      {/* The "free accountability audit" band was removed on 2026-08-09. It was
          a lead magnet for selling TRU Pulse as a standalone product, which is
          not what this business sells — the software comes with an engagement,
          and there is nothing to buy separately. */}

      <section className="panel ctaband" id="cta"><div className="wrap">
        <span className="badge reveal"><span className="s"></span>30 minutes, your real numbers</span>
        <h2 className="reveal d1" style={{ marginTop: '1.4rem' }}>Build the operating system your team <em>deserves</em>.</h2>
        <p className="sub reveal d2">
          A 30-minute strategy call with our team, to map your bottleneck and the next move.
          No pitch. No pressure.
        </p>
        <div className="hcta reveal d2">
          <a href={BUSINESS.calendly} className="cta" target="_blank" rel="noopener noreferrer">Book a call with our team{arrow}</a>
          <a href="/apply" className="cta ghost">Apply to work with us{arrow}</a>
        </div>
      </div></section>
    </div>
  );
}
