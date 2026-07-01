import { useState, type FormEvent } from 'react';
import { provisionOrg, triggerSync } from '../lib/api';
import { supabase } from '../lib/supabase';

interface TeamInput {
  name: string;
  fubKey: string;
}

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const [orgName, setOrgName] = useState('');
  const [teams, setTeams] = useState<TeamInput[]>([{ name: '', fubKey: '' }]);
  const [step, setStep] = useState<'form' | 'provisioning' | 'syncing'>('form');
  const [error, setError] = useState('');

  function setTeam(i: number, patch: Partial<TeamInput>) {
    setTeams((ts) => ts.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const clean = teams.filter((t) => t.name.trim() && t.fubKey.trim());
    if (!orgName.trim() || clean.length === 0) {
      setError('Add your team name and at least one Follow Up Boss key.');
      return;
    }
    try {
      setStep('provisioning');
      await provisionOrg(orgName.trim(), clean.map((t) => ({ name: t.name.trim(), fubKey: t.fubKey.trim() })));
      setStep('syncing');
      await triggerSync();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep('form');
    }
  }

  if (step !== 'form') {
    return (
      <div className="center-wrap">
        <div className="onb" style={{ textAlign: 'center', maxWidth: 420 }}>
          <div className="spinner" />
          <h2 style={{ fontSize: 20 }}>
            {step === 'provisioning' ? 'Setting up your workspace…' : 'Pulling your leads from Follow Up Boss…'}
          </h2>
          <p className="muted small">This can take a minute on the first sync. Hang tight.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="center-wrap">
      <div className="onb">
        <div className="brand-logo" style={{ color: 'var(--ink)' }}>
          T<span className="t" style={{ color: 'var(--gold)' }}>RU</span> Pulse
        </div>
        <h2 style={{ fontSize: 24, margin: '14px 0 4px' }}>Let's connect your team.</h2>
        <p className="muted small">
          Paste your Follow Up Boss API key (FUB → Admin → API). It's encrypted and used read-only — we never write to your CRM.
        </p>
        <form onSubmit={submit}>
          <label>Team / brokerage name</label>
          <input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Acme Realty" required />
          {teams.map((t, i) => (
            <div className="row2" key={i}>
              <div className="grow">
                <label>FUB account name</label>
                <input value={t.name} onChange={(e) => setTeam(i, { name: e.target.value })} placeholder="Main office" />
              </div>
              <div className="grow">
                <label>FUB API key</label>
                <input value={t.fubKey} onChange={(e) => setTeam(i, { fubKey: e.target.value })} placeholder="fka_…" />
              </div>
            </div>
          ))}
          <button type="button" className="link" onClick={() => setTeams((ts) => [...ts, { name: '', fubKey: '' }])}>
            + Add another FUB account
          </button>
          {error && <div className="err">{error}</div>}
          <button className="btn full" type="submit">Create &amp; sync</button>
        </form>
        <button className="link small" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    </div>
  );
}
