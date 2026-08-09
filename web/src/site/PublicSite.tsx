import { useEffect } from 'react';
import type { PublicRoute } from '../lib/routes';
import { applyHead, type PageMeta } from '../lib/head';
import SiteHeader from './SiteHeader';
import SiteFooter from './SiteFooter';
import Home from './pages/Home';
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
  useEffect(() => {
    applyHead({ ...META[route], path: route });
    if (route !== '/') window.scrollTo(0, 0);
  }, [route]);

  return (
    <div className="truland">
      <a className="skiplink" href="#main">Skip to content</a>
      <SiteHeader current={route} />
      <main id="main">
        {route === '/' && <Home />}
        {/* Remaining page bodies arrive in Tasks 6–9. */}
      </main>
      <SiteFooter />
    </div>
  );
}
