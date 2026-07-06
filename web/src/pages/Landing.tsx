import { useEffect, useRef } from 'react';
import './Landing.css';

type LandingProps = { onEnter?: () => void };

export default function Landing({ onEnter }: LandingProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const enter = (e: React.MouseEvent) => {
    e.preventDefault();
    onEnter?.();
  };

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const wrap = wrapRef.current;
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

    const nav = document.getElementById('nav');
    const onScroll = () => {
      if (!nav) return;
      if (window.scrollY > 40) nav.classList.add('scrolled');
      else nav.classList.remove('scrolled');
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    cleanups.push(() => window.removeEventListener('scroll', onScroll));

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

  return (
    <div className="truland" ref={wrapRef}>
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

      <nav className="nav" id="nav"><div className="wrap">
        <a className="brand" href="#top">T<span className="r">RU</span></a>
        <div className="nlinks"><a href="#audit">Product</a><a href="#loop">How it works</a><a href="#pricing">Pricing</a><a href="#cta">Free Audit</a></div>
        <div className="nright">
          <a href="#/login" className="login" onClick={enter}>Log in</a>
          <a href="#cta" className="cta" onClick={enter}>Get your free audit<span className="pea"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span></a>
        </div>
      </div></nav>

      <main>
        <header className="hero" id="top"><div className="wrap">
          <div>
            <span className="badge fade g1"><span className="s"></span>For the leader who got handed a team</span>
            <h1>
              <span className="line"><span>Know who</span></span>
              <span className="line"><span>needs you</span></span>
              <span className="line"><span className="thin">this week, and</span></span>
              <span className="line"><span className="say">exactly what to say.<svg viewBox="0 0 300 12" preserveAspectRatio="none"><path d="M3 8 C 60 2, 110 11, 160 6 S 250 2, 297 7" /></svg></span></span>
            </h1>
            <p className="hsub fade g2">TRU watches every lead you pay for, tells you which agent is slipping and <em>why</em>, and hands you the coaching move for that person. In four minutes, not four hours.</p>
            <div className="hcta fade g3">
              <a href="#cta" className="cta" onClick={enter}>Get your free audit<span className="pea"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span></a>
              <a href="#audit" className="cta ghost">See how it works<span className="pea"><svg viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6" /></svg></span></a>
              <span className="micro">Read-only. Connects to Follow Up Boss. Nothing stored.</span>
            </div>
          </div>
          <div className="scrollcue">Scroll<i></i></div>
        </div></header>

        <section className="panel band" id="audit"><div className="wrap">
          <div className="split">
            <div>
              <div className="kick reveal">TRU Pulse &middot; See it</div>
              <h2 className="h2 reveal d1">The audit you have been <em>avoiding</em>.</h2>
              <p className="sub reveal d2">Point TRU at your pipeline and it counts, in real dollars, the commission slipping through leads nobody personally worked. In minutes.</p>
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
            </div>
          </div>
        </div></section>

        <section className="panel band" id="loop"><div className="wrap">
          <div className="kick reveal">One system. Not three apps</div>
          <h2 className="h2 reveal d1">The whole loop, <em>closed</em>.</h2>
          <p className="sub reveal d2">See the problem, get the move, make it stick. The full loop a drowning player-coach cannot run alone.</p>
          <div className="pills">
            <div className="p reveal d1"><span className="k">TRU Pulse</span><h3>See it.</h3><p>Flags who got zero personal contact, what is stuck, and which agent is quietly slipping.</p></div>
            <div className="p reveal d2"><span className="k">TRU Coach</span><h3>Coach it.</h3><p>Hands you the exact 1:1 move for this person, this week, based on how they are wired.</p></div>
            <div className="p reveal d3"><span className="k">TRU Rep</span><h3>Make it stick.</h3><p>Every agent certified on your program through real drills, not skimmed videos.</p></div>
          </div>
        </div></section>

        <section className="panel band" id="pricing"><div className="wrap">
          <div className="kick reveal">Pricing</div>
          <h2 className="h2 reveal d1">One standard. Three ways to <em>run it</em>.</h2>
          <p className="sub reveal d2">Start with coaching. Add the accountability dashboard, then full certification, as your standard takes hold.</p>
          <div className="tiers">
            <div className="tier reveal d1">
              <div className="tname">TRU Coach</div>
              <div className="price">$349<span> / mo</span></div>
              <div className="td">Coach every agent the way they&rsquo;re wired &mdash; profiles plus a 4-minute guided 1:1 prep.</div>
              <ul>
                <li><svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg>Behavioral profiling for every agent</li>
                <li><svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg>4-minute guided 1:1 prep</li>
                <li><svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg>Weekly check-ins &amp; goals</li>
                <li><svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg>Ask-TRU AI coaching</li>
              </ul>
              <a href="#cta" className="cta ghost" onClick={enter}>Get your free audit<span className="pea"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span></a>
            </div>
            <div className="tier feat reveal d2">
              <div className="tag">Most teams start here</div>
              <div className="tname">TRU Command</div>
              <div className="price">$649<span> / mo</span></div>
              <div className="td">Everything in Coach, plus the accountability dashboard that watches every lead you pay for.</div>
              <ul>
                <li><svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg>Everything in Coach</li>
                <li><svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg>TRU Pulse accountability dashboard</li>
                <li><svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg>Zero-contact &amp; stuck-lead alerts</li>
                <li><svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg>Speed, closings &amp; the 3-strike ledger</li>
              </ul>
              <a href="#cta" className="cta" onClick={enter}>Get your free audit<span className="pea"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span></a>
            </div>
            <div className="tier reveal d3">
              <div className="tname">TRU Complete</div>
              <div className="price">$999<span> / mo</span></div>
              <div className="td">The whole system &mdash; every agent certified on your standard, nothing left to chance.</div>
              <ul>
                <li><svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg>Everything in Command</li>
                <li><svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg>TRU Rep &mdash; onboarding &amp; certification</li>
                <li><svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg>Program standards, scripts &amp; graded quizzes</li>
                <li><svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg>AI call practice &amp; ALMS grading (coming)</li>
                <li><svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6" /></svg>Priority onboarding &amp; support</li>
              </ul>
              <a href="#cta" className="cta ghost" onClick={enter}>Get your free audit<span className="pea"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span></a>
            </div>
          </div>
          <p className="reveal" style={{ marginTop: '1.4rem', fontSize: '0.82rem', color: 'var(--faint)' }}>Billed annually &middot; up to 15 seats &middot; +$25/agent beyond 15 &middot; month-to-month available &middot; founding-team pricing.</p>
        </div></section>

        <section className="panel ctaband" id="cta"><div className="wrap">
          <span className="badge reveal"><span className="s"></span>20 minutes, your real numbers</span>
          <h2 className="reveal d1" style={{ marginTop: '1.4rem' }}>Set the standard once. Let TRU <em>run it</em> every day.</h2>
          <p className="sub reveal d2">A free Accountability Audit on your own team&#39;s leads. No slides, just the commission you are leaving on the table.</p>
          <div className="hcta reveal d2"><a href="#top" className="cta" onClick={enter}>Get your free audit<span className="pea"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span></a></div>
          <p className="note reveal d3">Preview build &middot; audit figures are illustrative</p>
        </div></section>

        <footer><div className="wrap"><a className="brand" href="#top">T<span className="r">RU</span></a><span className="m">The operating system for real estate team leaders</span></div></footer>
      </main>
    </div>
  );
}
