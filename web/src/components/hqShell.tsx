import { useRef } from 'react';
import type { ReactNode } from 'react';
import { TruLogo } from './TruLogo';
import { Avatar, Icon } from './hqUi';
import { useForceHqDark } from '../hqHooks';
import { hasAdminReturn, adminReturn } from '../lib/api';
import { CommandBar } from './commandBar';
import { FocusWire } from './focusWire';
import { useDeckFocus } from './deckFocus';
import { useRoomLight } from '../lib/deckLight';
import { useGlide } from '../lib/deckMotion';

/** What the floor is doing, said in light rather than in words. Every page
 *  derives it from a number it is already showing:
 *
 *    hot    somebody is past the line / stalled / cannot start
 *    watch  nothing is on fire but there are conversations owed
 *    calm   nobody needs you
 *
 *  It is deliberately below the threshold of "a status colour" — you should
 *  notice the room is warmer before you notice why, and then read the number
 *  that says so. */
export type Mood = 'calm' | 'watch' | 'hot';

export interface ShellNav {
  onHome?: () => void;
  onOpenPulse: () => void;
  onOpenCoach: () => void;
  onOpenRep?: () => void;
  onOpenTeam?: () => void;
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
  isAdmin = false,
  onOpenAdmin,
  hideTopbar = false,
  islandSlot,
  mood = 'calm',
  children,
}: {
  orgName: string;
  role?: string;
  eyebrow?: string;
  title?: string;
  context?: ReactNode;
  onSignOut?: () => void;
  nav: ShellNav;
  /** Platform owner. Adds an Admin tab that nobody else can see or reach. */
  isAdmin?: boolean;
  onOpenAdmin?: () => void;
  /** Skip the shell's own eyebrow/title bar for a page that brings its own
   *  masthead. The sidebar and the phone tab bar are unaffected. */
  hideTopbar?: boolean;
  /** Controls for the island bar, e.g. Pulse's window tabs. The bar itself is
   *  drawn by the shell either way, so every deck page starts at the same y —
   *  when only Pulse rendered it, its content sat 61px lower than the others
   *  and switching tabs looked like the page had jumped. */
  islandSlot?: ReactNode;
  /** The temperature of the floor, cast into the room. See `Mood`. */
  mood?: Mood;
  children: ReactNode;
}) {
  // Active tab derived from the current route so every page highlights its own link
  // (not a hardcoded one). Each page renders its own HqShell on its route.
  const route = typeof window !== 'undefined' ? window.location.hash.replace(/^#\/?/, '') : '';
  // '/' lands on the roster now, so an empty hash is Pulse. Home survives only
  // at #/home for the platform-owner "act as team" tile.
  const activeKey = route.startsWith('coach') ? 'coach'
    : route.startsWith('rep') ? 'rep'
      : route.startsWith('team') ? 'team'
      : route === 'admin' ? 'admin'
      : route === 'home' ? 'home'
        : 'pulse';
  // Platform owner impersonating a team → show a clear exit (adminReturn drops them
  // back to their HQ "Act as a team" picker, not the login).
  const impersonating = hasAdminReturn();
  useForceHqDark();
  // The room answers the cursor and lags the scroll. One delegated listener for
  // the whole shell; see lib/deckLight.
  const shellRef = useRef<HTMLDivElement | null>(null);
  useRoomLight(shellRef);
  // Outside a DeckFocusProvider this is the idle stand-in, so pages that have
  // no roster (Team, Admin) simply never go quiet and never draw a wire.
  const focus = useDeckFocus();
  // One marker for the whole rail, moved — rather than a highlight that
  // vanishes on one tab and appears on another with nothing joining them.
  const navRef = useRef<HTMLElement | null>(null);
  const glide = useGlide(navRef, '.side-link.active', 'y', activeKey);
  const links: Array<{ key: string; label: string; icon: string; onClick?: () => void; soon?: boolean }> = [
    { key: 'pulse', label: 'Pulse', icon: 'pulse', onClick: nav.onOpenPulse },
    { key: 'coach', label: 'Coach', icon: 'coach', onClick: nav.onOpenCoach },
    { key: 'rep', label: 'Rep', icon: 'rep', onClick: nav.onOpenRep },
  ];
  // Who is on the platform at all. Sits under the three products because it is
  // the thing you do once, before any of them have anyone in them — and because
  // "invite" used to be scattered across all three.
  if (nav.onOpenTeam) {
    links.push({ key: 'team', label: 'Team', icon: 'roster', onClick: nav.onOpenTeam });
  }
  // The owner's own tab. Rendered only for a platform owner, and separated
  // from the product tabs because it is about who you are, not what you are
  // looking at.
  if (isAdmin && onOpenAdmin) {
    links.push({ key: 'admin', label: 'Admin', icon: 'shield', onClick: onOpenAdmin });
  }
  return (
    <div className="tru-shell" ref={shellRef}>
      {/* The room. ONE copy of the render, drifting slowly.
          A second mirrored copy was tried and read exactly as what it was —
          the same picture twice, strands everywhere. Clever, and sloppy.
          The core carries `key={activeKey}`, so it flares on every tab change.

          `.tru-room-move` is the parallax carrier and nothing else. The render
          itself is already animated on `transform` by its drift keyframes, and
          a second transform on the same element would have to fight it — so the
          scroll lag rides on a wrapper of exactly the room's own box, which
          leaves every percentage inside it resolving as before. */}
      <div className="tru-room" aria-hidden>
        <div className="tru-room-move">
          <i className="tru-room-a" />
          {/* Keyed on the tab AND on whoever is being held, so the union flares
              when you arrive somewhere and again when you pick a person to
              read the rest of the page against. The room acknowledges you. */}
          <i className="tru-room-core" key={`${activeKey}:${focus.pinned ?? ''}`} />
        </div>
      </div>
      {/* The floor's temperature. Anchored to the screen like the vignette
          rather than to the room, because it is a wash over everything, and it
          sits BEFORE the vignette in paint order so the vignette scrims it. */}
      <div className="tru-mood" data-mood={mood} aria-hidden>
        <i className="m-calm" /><i className="m-watch" /><i className="m-hot" />
      </div>
      <aside className="side">
        <div className="side-logo">
          <button onClick={nav.onHome} style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }} aria-label="TRU HQ home">
            <TruLogo size={28} wordSize={20} sub="HQ" />
          </button>
        </div>
        <nav className="side-nav" ref={navRef}>
          {/* The selection itself. It carries the fill, the hairline and the
              gold edge, so the active link only has to say which one it is. */}
          <i className="side-glide" style={glide} aria-hidden />
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
        {hideTopbar && (
          <div className="dk-island">
            <span className="dk-mk"><i>tru</i><b>TRU <em>HQ</em></b></span>
            {islandSlot && <><span className="dk-div" />{islandSlot}</>}
            <span className="dk-div" />
            <CommandBar
              onOpenPulse={nav.onOpenPulse}
              onOpenCoach={nav.onOpenCoach}
              onOpenRep={nav.onOpenRep ?? nav.onOpenPulse}
              onOpenTeam={nav.onOpenTeam}
              onSignOut={onSignOut}
            />
          </div>
        )}
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
        {/* ONE transition per tab, instead of the three uncoordinated entrance
            systems that used to fire on arrival — per-element JS timers, a
            per-row CSS stagger, and the room flare. Timers are not frame-aligned,
            which is what "stutter" actually was.

            Keyed on the active tab so it re-runs on every switch. The keyframes
            MUST end at `transform: none`: a lingering transform on this wrapper
            would become the containing block for every `position: fixed`
            descendant, and the agent drill-in panel and its scrim live in here. */}
        <div className={`dk-page${focus.quiet ? ' is-quiet' : ''}`} key={activeKey}>{children}</div>
      </main>

      {/* The thread of light from a dot to its row. Renders nothing at all
          unless a person is being pointed at and both ends are on screen. */}
      <FocusWire />

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
