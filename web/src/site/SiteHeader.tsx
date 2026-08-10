import { useEffect } from 'react';
import { BUSINESS } from '../config/business';
import type { PublicRoute } from '../lib/routes';

// Reuses the existing .nav / .brand / .nlinks / .cta classes from Landing.css —
// same nav, new destinations. The scroll-state handler moved here from
// Landing.tsx so it runs on every marketing page, not just the home page.
export default function SiteHeader({ current }: { current: PublicRoute }) {
  useEffect(() => {
    const nav = document.getElementById('nav');
    const onScroll = () => {
      if (!nav) return;
      if (window.scrollY > 40) nav.classList.add('scrolled');
      else nav.classList.remove('scrolled');
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const link = (href: PublicRoute, label: string) => (
    <a href={href} aria-current={current === href ? 'page' : undefined}>{label}</a>
  );

  return (
    <nav className="nav" id="nav"><div className="wrap">
      <a className="brand" href="/" aria-label={`${BUSINESS.brandFull} home`}>T<span className="r">RU</span></a>
      <div className="nlinks">
        {link('/services', 'Services')}
        {link('/work', 'Work')}
        {link('/about', 'About')}
        {link('/apply', 'Apply')}
      </div>
      <div className="nright">
        <a href={BUSINESS.appUrl} className="login">Client log in</a>
        <a href="/apply" className="cta">
          Apply to work with us
          <span className="pea"><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
        </a>
      </div>
    </div></nav>
  );
}
