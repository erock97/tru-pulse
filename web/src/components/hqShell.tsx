import type { ReactNode } from 'react';
import { TruLogo } from './TruLogo';
import { Avatar, Icon } from './hqUi';
import { useForceHqDark } from '../hqHooks';
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
  hideTopbar = false,
  children,
}: {
  orgName: string;
  role?: string;
  eyebrow?: string;
  title?: string;
  context?: ReactNode;
  onSignOut?: () => void;
  nav: ShellNav;
  /** Skip the shell's own eyebrow/title bar for a page that brings its own
   *  masthead. The sidebar and the phone tab bar are unaffected. */
  hideTopbar?: boolean;
  children: ReactNode;
}) {
  // Active tab derived from the current route so every page highlights its own link
  // (not a hardcoded one). Each page renders its own HqShell on its route.
  const route = typeof window !== 'undefined' ? window.location.hash.replace(/^#\/?/, '') : '';
  // '/' lands on the roster now, so an empty hash is Pulse. Home survives only
  // at #/home for the platform-owner "act as team" tile.
  const activeKey = route.startsWith('coach') ? 'coach'
    : route.startsWith('rep') ? 'rep'
      : route === 'home' ? 'home'
        : 'pulse';
  // Platform owner impersonating a team → show a clear exit (adminReturn drops them
  // back to their HQ "Act as a team" picker, not the login).
  const impersonating = hasAdminReturn();
  useForceHqDark();
  const links: Array<{ key: string; label: string; icon: string; onClick?: () => void; soon?: boolean }> = [
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
        {!hideTopbar && (
          <header className="topbar reveal">
            <div>
              {eyebrow && <div className="main-eyebrow">{eyebrow}</div>}
              <h1>{title}</h1>
            </div>
            <div className="topbar-ctx">
              {context}
            </div>
          </header>
        )}
        {children}
      </main>

      {/* Phone navigation. Same links as the sidebar, fixed to the bottom where a
          thumb reaches — and the reason the sidebar can stop trying to be a
          horizontal strip, which is what forced the whole page 340px wider than
          the screen. Hidden by CSS above 860px. */}
      <nav className="tabbar" aria-label="Sections">
        {links.map((l) => (
          <button
            key={l.key}
            className={`tabbar-btn ${l.key === activeKey ? 'active' : ''}`}
            onClick={l.soon ? undefined : l.onClick}
            disabled={l.soon}
            aria-current={l.key === activeKey ? 'page' : undefined}
          >
            <Icon name={l.icon} size={21} />
            <span>{l.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
