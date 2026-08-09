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
    // The reveal styles are all written as `.truland.ready …`, and .truland now
    // lives one level up in PublicSite. Walk up to it, or the hero copy stays
    // permanently at opacity 0.
    const wrap = wrapRef.current?.closest('.truland') as HTMLElement | null;
    const timers: number[] = [];
    const cleanups: Array<() => void> = [];
    const t = (fn: () => void, ms: number) => {
      const id = window.setTimeout(fn, ms);
      timers.push(id);
      return id;
    };

    /* --- Cinematic brand intro: bold reveal plays, then fades to the site --- */
    (function intro() {
      const el = document.getElementById('intro');
      const vid = document.getElementById('introvid') as HTMLVideoElement | null;
      if (!el) return;
      if (reduce) {
        if (el.parentNode) el.remove();
        return;
      }
      const doc = document.documentElement;
      let dismissed = false;
      doc.classList.add('intro-lock');
      function dismiss() {
        if (dismissed) return;
        dismissed = true;
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
        if (p && p.catch) p.catch(() => dismiss());
      }
      const skip = el.querySelector('.skip');
      if (skip) skip.addEventListener('click', dismiss);
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

    if (reduce) {
      const v = document.getElementById('bgvid') as HTMLVideoElement | null;
      if (v) {
        v.removeAttribute('autoplay');
        v.pause();
      }
      wrap?.classList.add('ready');
    } else {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          wrap?.classList.add('ready');
        });
      });
    }
    t(() => wrap?.classList.add('ready'), 300);

    function countUp(el: HTMLElement) {
      const to = parseFloat(el.getAttribute('data-to') || '0');
      const pre = el.getAttribute('data-prefix') || '';
      const fmt = (v: number) => pre + Math.round(v).toLocaleString('en-US');
      const span = el.classList.contains('amt') ? el.querySelector('span') : null;
      if (reduce) {
        if (span) span.textContent = fmt(to);
        else el.textContent = fmt(to);
        return;
      }
      let s: number | null = null;
      const dur = 1600;
      function step(ts: number) {
        if (s === null) s = ts;
        const p = Math.min((ts - s) / dur, 1);
        const val = to * (1 - Math.pow(1 - p, 3));
        if (span) span.textContent = fmt(val);
        else el.textContent = fmt(val);
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }

    const io = new IntersectionObserver(
      function (es) {
        es.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.16, rootMargin: '0px 0px -8% 0px' },
    );
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
    cleanups.push(() => io.disconnect());

    const card = document.getElementById('auditCard');
    if (card) {
      const co = new IntersectionObserver(
        function (es) {
          es.forEach(function (e) {
            if (!e.isIntersecting) return;
            t(() => {
              card.querySelectorAll('[data-to]').forEach((el) => countUp(el as HTMLElement));
            }, 500);
            co.unobserve(card);
          });
        },
        { threshold: 0.35 },
      );
      co.observe(card);
      cleanups.push(() => co.disconnect());
    }

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
      <div className="bg">
        <video id="bgvid" autoPlay muted loop playsInline preload="auto" poster="/hero-poster.jpg">
          <source src="/hero-loop.mp4" type="video/mp4" />
        </video>
        <div className="scrim"></div>
      </div>
      <div className="grain"></div>

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

      {/* The audit gets its own band, as it did on the original page. Appending
          it to the tooling section left the short left column centred against a
          tall card, opening a large dead gap under the three pills. */}
      <section className="panel band" id="audit"><div className="wrap">
        <div className="split">
          <div>
            <div className="kick reveal">TRU Pulse &middot; See it</div>
            <h2 className="h2 reveal d1">The audit you have been <em>avoiding</em>.</h2>
            <p className="sub reveal d2">
              We point Pulse at your pipeline and it counts, in real dollars, the commission
              slipping through leads nobody personally worked.
            </p>
          </div>
          <div className="card reveal d1" id="auditCard">
            <div className="chead asm"><div className="cbrand">T<span className="r">RU</span> <span>Accountability Audit</span></div><div className="cmeta">Last 30 days</div></div>
            <div className="risk asm"><div className="amt" data-to="51000" data-prefix="$"><span>$0</span><span className="per"> / yr</span></div><div className="cap">commission at risk from leads nobody personally worked</div></div>
            <div className="srow asm"><div className="st a"><div className="n" data-to="543">0</div><div className="l">Tracked leads</div></div><div className="st b"><div className="n" data-to="21">0</div><div className="l">Zero contact</div></div><div className="st c"><div className="n" data-to="67">0</div><div className="l">Stuck</div></div></div>
            <div className="leads asm"><div className="lh"><span>Lead</span><span>Source</span></div>
              <div className="lr"><span><span className="dot" style={{ background: 'var(--risk)' }}></span>Marcus D.</span><span className="src">Realtor.com &middot; up front</span></div>
              <div className="lr"><span><span className="dot" style={{ background: 'var(--gold)' }}></span>Priya N.</span><span className="src">Zillow &middot; at close</span></div>
              <div className="lr" style={{ borderBottom: 'none' }}><span><span className="dot" style={{ background: 'var(--risk)' }}></span>Angela R.</span><span className="src">Facebook &middot; up front</span></div>
            </div>
            <p className="cap" style={{ marginTop: '1rem' }}>
              Sample data &mdash; illustrative of the accountability dashboard included in your
              engagement.
            </p>
          </div>
        </div>
      </div></section>

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
