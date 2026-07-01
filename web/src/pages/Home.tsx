import type { ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { TruLogo } from '../components/TruLogo';

const svg = (c: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>{c}</svg>
);
const ICON = {
  pulse: svg(<path d="M3 12h4l2 6 4-15 2.5 9H21" />),
  coach: svg(<><circle cx="12" cy="8" r="3.2" /><path d="M5 21c0-3.6 3-6.2 7-6.2s7 2.6 7 6.2" /></>),
  rep: svg(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0 0 12 0M12 17v4M8 21h8" /></>),
};

interface Product {
  key: string;
  name: string;
  tag: string;
  desc: string;
  color: string;
  icon: ReactNode;
  status: 'active' | 'soon';
  href?: string;
}

const PRODUCTS: Product[] = [
  {
    key: 'pulse', name: 'TRU Pulse', tag: 'See it', color: '#a9791f', icon: ICON.pulse, status: 'active',
    desc: "Watches every tracked lead — paid-up-front and pay-at-close — flags who isn't working them, builds the strike ledger, and pushes your moves each week.",
  },
  {
    key: 'coach', name: 'TRU Coach', tag: 'Coach it', color: '#2e8b57', icon: ICON.coach, status: 'active',
    href: 'https://trucoaching.co',
    desc: 'Profiles how each agent is wired and preps the 1:1 that actually lands — for the agent and the leader.',
  },
  {
    key: 'rep', name: 'TRU Rep', tag: 'Make it stick', color: '#2f6bb0', icon: ICON.rep, status: 'soon',
    desc: 'Agents rehearse the call against an AI buyer, and their real calls get graded on ALMS. Coming soon.',
  },
];

export default function Home({ org, onOpenPulse }: { org: { id: string; name: string }; onOpenPulse: () => void }) {
  return (
    <div className="hq">
      <header className="topbar">
        <TruLogo size={30} wordSize={22} sub="HQ" />
        <div className="topbar-right">
          <span className="muted small">{org.name}</span>
          <button className="link small" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>
      <main className="hq-main">
        <div className="hq-hero fu">
          <div className="eyebrow">Welcome back</div>
          <h1>{org.name}'s HQ</h1>
          <p>Unlock the best version of your team — and yourself. Your TRU products, one place.</p>
        </div>
        <div className="hq-cards">
          {PRODUCTS.map((p, i) => (
            <div key={p.key} className={`hq-card fu${p.status === 'soon' ? ' soon' : ''}`} style={{ animationDelay: `${0.08 * i}s` }}>
              <div className="hq-ico" style={{ background: p.color + '1a', color: p.color }}>{p.icon}</div>
              <div className="hq-tag" style={{ color: p.color }}>{p.tag}</div>
              <h3>{p.name}</h3>
              <p>{p.desc}</p>
              {p.status === 'active' ? (
                <button
                  className="btn"
                  onClick={() => (p.key === 'pulse' ? onOpenPulse() : p.href && (window.location.href = p.href))}
                >
                  Open {p.name.replace('TRU ', '')} →
                </button>
              ) : (
                <span className="hq-soon">Coming soon</span>
              )}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
