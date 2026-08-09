import { useEffect, useRef } from 'react';
import type { PublicRoute } from '../lib/routes';
import { applyHead, type PageMeta } from '../lib/head';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import Home from './pages/Home';
import Services from './pages/Services';
import Work from './pages/Work';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import RefundPolicy from './pages/RefundPolicy';
import '../pages/Landing.css';
import './site.css';

export const META: Record<PublicRoute, Omit<PageMeta, 'path'>> = {
  '/': {
    title: 'TRU — Fractional sales management for real estate teams',
    description:
      'We take sales management off the team owner’s plate — agent accountability, pipeline oversight, Zillow Flex conversion, and the daily operating rhythm — without adding a full-time hire.',
  },
  '/services': {
    title: 'Services & engagement model — TRU',
    description:
      'Seven things we own for you, four packages scaled to your team size, and exactly how an engagement starts.',
  },
  '/work': {
    title: 'Work — TRU',
    description:
      'What changes when the operating system actually runs. Three engagements, and what we built in each.',
  },
  '/apply': {
    title: 'Apply to work with us — TRU',
    description:
      'Five short questions about your team. We review every application personally and reply within two business days.',
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
    description: 'How cancellations, pauses, and refunds work.',
  },
};

export default function PublicSite({ route }: { route: PublicRoute }) {
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    applyHead({ ...META[route], path: route });
    if (route !== '/') window.scrollTo(0, 0);
  }, [route]);

  // The reveal-on-scroll machinery belongs to every marketing page, not just the
  // home page. `.ready` unlocks the hero's fade/underline styles (they are all
  // written as `.truland.ready …`); the observer adds `.in` to each `.reveal` as
  // it comes into view. Without this, every page but the home page renders its
  // copy at opacity 0.
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

  return (
    <div className="truland" ref={shellRef}>
      <a className="skiplink" href="#main">Skip to content</a>
      <SiteHeader current={route} />
      <main id="main">
        {route === '/' && <Home />}
        {route === '/services' && <Services />}
        {route === '/work' && <Work />}
        {route === '/privacy' && <Privacy />}
        {route === '/terms' && <Terms />}
        {route === '/refund-policy' && <RefundPolicy />}
        {/* The apply form arrives in Task 9. */}
      </main>
      <SiteFooter />
    </div>
  );
}
