import { useState, type FormEvent } from 'react';
import { provisionOrg, triggerSync, signOutClean } from '../lib/api';
import { TruLogo } from '../components/TruLogo';
import '../truHqDark.css';

interface TeamInput {
  name: string;
  fubKey: string;
}

// First-run: name the org + connect Follow Up Boss. AUTH/PROVISIONING LOGIC UNCHANGED —
// dark reskin onto the shared auth field.
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

  const backdrop = (
    <>
      <video className="tru-auth-video" autoPlay muted loop playsInline poster="/hero-poster.jpg" aria-hidden>
        <source src="/hero-loop.mp4" type="video/mp4" />
      </video>
      <div className="tru-auth-scrim" aria-hidden />
    </>
  );

  if (step !== 'form') {
    return (
      <div className="tru-dark tru-auth">
        {backdrop}
        <div className="tru-auth-card" style={{ textAlign: 'center' }}>
          <div className="spinner" />
          <h2 className="tru-auth-title" style={{ fontSize: 22 }}>
            {step === 'provisioning' ? 'Setting up your workspace…' : 'Pulling your leads from Follow Up Boss…'}
          </h2>
          <p className="tru-auth-sub">This can take a minute on the first sync. Hang tight.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="tru-dark tru-auth">
      {backdrop}
      <div className="tru-auth-card" style={{ maxWidth: 520 }}>
        <div className="tru-auth-logo"><TruLogo size={28} wordSize={20} sub="HQ" /></div>
        <h1 className="tru-auth-title">Let&rsquo;s connect your team.</h1>
        <p className="tru-auth-sub">
          Paste your Follow Up Boss API key (FUB &rarr; Admin &rarr; API). It&rsquo;s encrypted and used read-only &mdash; we never write to your CRM.
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
                <input value={t.fubKey} onChange={(e) => setTeam(i, { fubKey: e.target.value })} placeholder="fka_&hellip;" />
              </div>
            </div>
          ))}
          <button type="button" className="link" onClick={() => setTeams((ts) => [...ts, { name: '', fubKey: '' }])}>
            + Add another FUB account
          </button>
          {error && <div className="err">{error}</div>}
          <button className="btn full" type="submit">Create &amp; sync</button>
        </form>
        <div className="tru-auth-foot">
          <button className="link" onClick={() => signOutClean()}>Sign out</button>
        </div>
      </div>
    </div>
  );
}
