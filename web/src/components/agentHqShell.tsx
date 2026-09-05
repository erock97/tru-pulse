import type { ReactNode } from 'react';
import { TruLogo } from './TruLogo';
import { Avatar, Icon } from './hqUi';
import { useForceHqDark } from '../hqHooks';
import { AGENT_SHELL_TABS, agentHqPath, parseAgentHqTab, type AgentHqTab } from '../lib/agentHq';

const TAB_ICON: Record<AgentHqTab, string> = {
  home: 'home',
  coach: 'coach',
  training: 'play',
};

const TAB_KEY: Record<string, AgentHqTab> = {
  Home: 'home',
  Coach: 'coach',
  Training: 'training',
};

/** Agent-only shell. Same dark HQ language as the leader shell — never Pulse / Rep. */
export function AgentHqShell({
  name,
  eyebrow,
  title,
  onSignOut,
  onGo,
  children,
}: {
  name: string;
  eyebrow?: string;
  title: string;
  onSignOut?: () => void;
  onGo: (tab: AgentHqTab) => void;
  children: ReactNode;
}) {
  const route = typeof window !== 'undefined' ? window.location.hash.replace(/^#/, '') : '/';
  const active = parseAgentHqTab(route);
  useForceHqDark();
  const links = AGENT_SHELL_TABS.map((label) => {
    const key = TAB_KEY[label];
    return { key, label, icon: TAB_ICON[key], onClick: () => onGo(key) };
  });
  return (
    <div className="tru-shell">
      <aside className="side">
        <div className="side-logo">
          <button onClick={() => onGo('home')} style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }} aria-label="Your HQ home">
            <TruLogo size={28} wordSize={20} sub="HQ" />
          </button>
        </div>
        <nav className="side-nav">
          {links.map((l) => (
            <button
              key={l.label}
              className={`side-link ${l.key === active ? 'active' : ''}`}
              onClick={l.onClick}
              aria-current={l.key === active ? 'page' : undefined}
            >
              <Icon name={l.icon} size={20} />
              <span>{l.label}</span>
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <div className="side-user">
            <Avatar name={name} size={38} tone={0} />
            <div>
              <div className="side-user-name">{name}</div>
              <div className="side-user-role">Agent</div>
            </div>
          </div>
          {onSignOut && (
            <button className="side-link-btn" onClick={onSignOut}>
              Sign out
            </button>
          )}
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            {eyebrow && <div className="main-eyebrow">{eyebrow}</div>}
            <h1>{title}</h1>
          </div>
        </header>
        {children}
      </main>

      <nav className="tabbar" aria-label="Sections">
        {links.map((l) => (
          <button
            key={l.key}
            className={`tabbar-btn ${l.key === active ? 'active' : ''}`}
            onClick={l.onClick}
            aria-current={l.key === active ? 'page' : undefined}
          >
            <Icon name={l.icon} size={21} />
            <span>{l.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export function goAgentTab(tab: AgentHqTab) {
  window.location.hash = agentHqPath(tab);
}
