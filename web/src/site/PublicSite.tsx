import { useEffect, useRef } from 'react';
import type { PublicRoute, PublicView } from '../lib/routes';
import { applyHead, type PageMeta } from '../lib/head';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import Home from './pages/Home';
import Services from './pages/Services';
import About from './pages/About';
import Apply from './pages/Apply';
import Work from './pages/Work';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import RefundPolicy from './pages/RefundPolicy';
import SmsTerms from './pages/SmsTerms';
import NotFound from './pages/NotFound';
import '../pages/Landing.css';
import './site.css';
// Last, so its token overrides win on source order. See the note at the top of
// the file: this is the whole marketing palette moving onto the app's.
import './forest.css';
import './forge.css';

export const META: Record<PublicRoute, Omit<PageMeta, 'path'>> = {
  '/': {
    title: 'TRU — Fractional sales management for real estate teams',
    description:
      'We take sales management off the team owner’s plate — agent accountability, pipeline oversight, Zillow Preferred conversion, and the daily operating rhythm — without adding a full-time hire.',
  },
  '/services': {
    title: 'Services & engagement model — TRU',
    description:
      'Seven things we own for you, four packages scaled to your team size, and exactly how an engagement starts.',
  },
  '/about': {
    title: 'About — TRU',
    description:
      'Who you’d actually be working with. Twelve years in sales, eight of them in real estate prop tech at Zillow — recruiting, agent development, leadership training, KPIs and SOPs, and lead flow for some of the largest brokerages and teams in the country.',
  },
  '/apply': {
    title: 'Apply to work with us — TRU',
    description:
      'Five short questions about your team. We review every application personally and reply within two business days.',
  },
  '/work': {
    title: 'Work — TRU',
    description:
      'What changes when the operating system actually runs. Three engagements, and what we built in each.',
  },
  '/privacy': {
    title: 'Privacy Policy — TRU',
    description: 'What we collect, how we use it, and the choices you have.',
  },
  '/terms': {
    title: 'Terms of Service — TRU',
    description: 'The terms governing your use of truhq.co.',
  },
  '/refund-policy': {
    title: 'Refund & Cancellation Policy — TRU',
    description:
      'The 90-day initial term, the 48-hour refund window, how to cancel, and how per-deal payouts work.',
  },
  '/sms-terms': {
    title: 'SMS Terms & Conditions — TRU',
    description:
      'Who receives text messages from TRU, how consent is collected, what we send, and how to stop them. Internal team communication only — never marketing, and never to clients or leads.',
  },
};

const NOT_FOUND_META: Omit<PageMeta, 'path'> = {
  title: 'Page not found — TRU',
  description: 'This page does not exist.',
  robots: 'noindex',
};

export default function PublicSite({ route }: { route: PublicView }) {
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (route === 'not-found') {
      applyHead({ ...NOT_FOUND_META, path: window.location.pathname });
    } else {
      applyHead({ ...META[route], path: route });
    }
    if (route !== '/') window.scrollTo(0, 0);
  }, [route]);

  // The reveal-on-scroll machinery belongs to every marketing page. `.ready`
  // unlocks fade/underline styles; the observer adds `.in` to each `.reveal`.
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    const raf = requestAnimationFrame(() => shell.classList.add('ready'));
    const settle = window.setTimeout(() => shell.classList.add('ready'), 300);

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.16, rootMargin: '0px 0px -8% 0px' },
    );
    shell.querySelectorAll('.reveal').forEach((el) => io.observe(el));

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
      io.disconnect();
    };
  }, [route]);

  useEffect(() => {
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const v = document.getElementById('bgvid') as HTMLVideoElement | null;
    if (!v) return;
    v.removeAttribute('autoplay');
    v.pause();
  }, [route]);

  return (
    <div className="truland" ref={shellRef}>
      <a className="skiplink" href="#main">Skip to content</a>
      <div className="bg">
        <video
          id="bgvid"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          poster="/hero-poster.jpg"
        >
          <source src="/hero-loop.mp4" type="video/mp4" />
        </video>
        <div className="scrim"></div>
      </div>
      <div className="grain"></div>
      <SiteHeader current={route} />
      <main id="main">
        {route === '/' && <Home />}
        {route === '/services' && <Services />}
        {route === '/about' && <About />}
        {route === '/apply' && <Apply />}
        {route === '/work' && <Work />}
        {route === '/privacy' && <Privacy />}
        {route === '/terms' && <Terms />}
        {route === '/refund-policy' && <RefundPolicy />}
        {route === '/sms-terms' && <SmsTerms />}
        {route === 'not-found' && <NotFound />}
      </main>
      <SiteFooter />
    </div>
  );
}
