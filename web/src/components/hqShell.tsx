import type { ReactNode } from 'react';
import { TruLogo } from './TruLogo';
import { Avatar, Icon } from './hqUi';
import { useHqTheme } from '../hqHooks';
import { hasAdminReturn, adminReturn } from '../lib/api';

export interface ShellNav {
  onHome?: () => void;
  onOpenPulse: () => void;
  onOpenCoach: () => void;
  onOpenRep?: () => void;
}

/** The dark unified HQ shell: sidebar + slim top bar. Wired to the REAL
 *  product-open callbacks (not a hash router) so nothing about routing changes. */
export function HqShell({
  orgName,
  role = 'Admin',
  eyebrow,
  title,
  context,
  onSignOut,
  nav,
  children,
}: {
  orgName: string;
  role?: string;
  eyebrow?: string;
  title: string;
  context?: ReactNode;
  onSignOut?: () => void;
  nav: ShellNav;
  children: ReactNode;
}) {
  // Active tab derived from the current route so every page highlights its own link
  // (not a hardcoded one). Each page renders its own HqShell on its route.
  const route = typeof window !== 'undefined' ? window.location.hash.replace(/^#\/?/, '') : '';
  const activeKey = route.startsWith('pulse') ? 'pulse'
    : route.startsWith('coach') ? 'coach'
      : route.startsWith('rep') ? 'rep'
        : 'home';
  // Platform owner impersonating a team → show a clear exit (adminReturn drops them
  // back to their HQ "Act as a team" picker, not the login).
  const impersonating = hasAdminReturn();
  const links: Array<{ key: string; label: string; icon: string; onClick?: () => void; soon?: boolean }> = [
    { key: 'home', label: 'Home', icon: 'home', onClick: nav.onHome },
    { key: 'pulse', label: 'Pulse', icon: 'pulse', onClick: nav.onOpenPulse },
    { key: 'coach', label: 'Coach', icon: 'coach', onClick: nav.onOpenCoach },
    { key: 'rep', label: 'Rep', icon: 'rep', onClick: nav.onOpenRep },
  ];
  return (
    <div className="tru-shell">
      <aside className="side">
        <div className="side-logo">
          <button onClick={nav.onHome} style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }} aria-label="TRU HQ home">
            <TruLogo size={28} wordSize={20} sub="HQ" />
          </button>
        </div>
        <nav className="side-nav">
          {links.map((l) => (
            <button
              key={l.label}
              className={`side-link ${l.key === activeKey ? 'active' : ''}`}
              onClick={l.soon ? undefined : l.onClick}
              disabled={l.soon}
            >
              <Icon name={l.icon} size={20} />
              <span>{l.label}</span>
              {l.soon && <span className="side-soon">Soon</span>}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <div className="side-user">
            <Avatar name={orgName} size={38} tone={0} />
            <div>
              <div className="side-user-name">{orgName}</div>
              <div className="side-user-role">{role}</div>
            </div>
          </div>
          {impersonating && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '11px 12px', borderRadius: 12, background: 'rgba(169,121,31,0.12)', border: '1px solid rgba(169,121,31,0.35)' }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', color: 'var(--accent-hi)' }}>
                ● ACTING AS {orgName.toUpperCase()}
              </span>
              <button
                onClick={() => { void adminReturn(); }}
                style={{ background: 'var(--accent)', color: '#1a1206', border: 0, borderRadius: 8, padding: '8px 10px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}
              >
                Exit — switch teams
              </button>
            </div>
          )}
          {onSignOut && (
            <button className="side-link-btn" onClick={onSignOut}>
              Sign out
            </button>
          )}
        </div>
      </aside>

      <main className="main">
        <header className="topbar reveal">
          <div>
            {eyebrow && <div className="main-eyebrow">{eyebrow}</div>}
            <h1>{title}</h1>
          </div>
          <div className="topbar-ctx">
            {context}
            <ThemeToggle />
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

/** Dark / Warm theme switch. Persists via useHqTheme(); default dark. */
export function ThemeToggle() {
  const [theme, toggle] = useHqTheme();
  const warm = theme === 'warm';
  return (
    <button
      className="theme-toggle"
      onClick={toggle}
      role="switch"
      aria-checked={warm}
      aria-label={`Theme: ${warm ? 'Warm' : 'Dark'}. Switch to ${warm ? 'Dark' : 'Warm'}.`}
      title={`Switch to ${warm ? 'Dark' : 'Warm'} theme`}
    >
      <span className={`theme-opt ${!warm ? 'on' : ''}`}>
        <MoonIcon /> Dark
      </span>
      <span className={`theme-opt ${warm ? 'on' : ''}`}>
        <SunIcon /> Warm
      </span>
      <span className={`theme-knob ${warm ? 'warm' : ''}`} aria-hidden />
    </button>
  );
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}
function SunIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}
