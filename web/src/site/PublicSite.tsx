import { useEffect, useRef } from 'react';
import type { PublicRoute } from '../lib/routes';
import { applyHead, type PageMeta } from '../lib/head';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import Home from './pages/Home';
import Services from './pages/Services';
import About from './pages/About';
import Apply from './pages/Apply';
import '../pages/Landing.css';
import './site.css';

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
};

export default function PublicSite({ route }: { route: PublicRoute }) {
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    applyHead({ ...META[route], path: route });
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
      </main>
      <SiteFooter />
    </div>
  );
}
