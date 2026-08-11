import { useState, type FormEvent } from 'react';
import { adminIntake, adminResendInvite, type IntakeResult } from '../lib/api';

// Platform-owner intake. TRU HQ is sold by hand, so this is the path that
// actually gets used: Eric fills it in with the brokerage's Follow Up Boss key,
// and each team leader is emailed a set-password link. Two leaders on one team
// get two separate logins — see the design spec for why.

interface TeamRow { name: string; fubKey: string; subdomain: string }
interface LeaderRow { name: string; email: string; teamIndex: number }

const emptyTeam = (): TeamRow => ({ name: '', fubKey: '', subdomain: '' });
const emptyLeader = (): LeaderRow => ({ name: '', email: '', teamIndex: 0 });

export function AdminIntake() {
  const [orgName, setOrgName] = useState('');
  const [teams, setTeams] = useState<TeamRow[]>([emptyTeam()]);
  const [leaders, setLeaders] = useState<LeaderRow[]>([emptyLeader()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [resent, setResent] = useState<Record<string, string>>({});

  const setTeam = (i: number, patch: Partial<TeamRow>) =>
    setTeams((ts) => ts.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  const setLeader = (i: number, patch: Partial<LeaderRow>) =>
    setLeaders((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  function reset() {
    setOrgName(''); setTeams([emptyTeam()]); setLeaders([emptyLeader()]);
    setResult(null); setError(''); setResent({});
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      setResult(await adminIntake({
        orgName: orgName.trim(),
        teams: teams.map((t) => ({
          name: t.name.trim(),
          fubKey: t.fubKey.trim(),
          ...(t.subdomain.trim() ? { subdomain: t.subdomain.trim() } : {}),
        })),
        leaders: leaders.map((l) => ({
          name: l.name.trim(),
          email: l.email.trim(),
          teamIndex: Math.min(l.teamIndex, teams.length - 1),
        })),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function resend(email: string, name: string) {
    try {
      const r = await adminResendInvite({ email, name, orgName });
      setResent((m) => ({ ...m, [email]: r.sent ? 'Sent.' : `Send failed — link: ${r.link ?? 'n/a'}` }));
    } catch (err) {
      setResent((m) => ({ ...m, [email]: err instanceof Error ? err.message : String(err) }));
    }
  }

  if (result) {
    return (
      <div>
        <p style={{ color: 'var(--text-60)', marginBottom: 14 }}>
          <strong style={{ color: 'var(--text)' }}>{orgName}</strong> is set up. Their leads are
          syncing now — the dashboard fills in within a few minutes.
        </p>
        <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px', display: 'grid', gap: 10 }}>
          {result.leaders.map((l) => (
            <li key={l.email} style={{ display: 'grid', gap: 4 }}>
              <div>
                <strong>{l.name}</strong> · {l.email}{' '}
                {l.status === 'invited' && <span style={{ color: 'var(--ok, #7ac77a)' }}>— invite sent</span>}
                {l.status === 'email_failed' && (
                  <span style={{ color: 'var(--warn, #e0b055)' }}>— account created, email failed</span>
                )}
                {l.status === 'failed' && <span className="err">— could not create a login: {l.error}</span>}
              </div>
              {l.link && (
                <input
                  readOnly
                  value={l.link}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label={`Set-password link for ${l.name}`}
                />
              )}
              {l.status !== 'failed' && (
                <div>
                  <button type="button" className="link" onClick={() => resend(l.email, l.name)}>
                    Resend invite
                  </button>
                  {resent[l.email] && (
                    <span style={{ marginLeft: 8, color: 'var(--text-60)' }}>{resent[l.email]}</span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        <button type="button" className="btn" onClick={reset}>Add another team</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <label>Brokerage / team name</label>
      <input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Acme Realty" required />

      <h4 style={{ margin: '20px 0 6px' }}>Follow Up Boss accounts</h4>
      {teams.map((t, i) => (
        <div className="row2" key={i}>
          <div className="grow">
            <label>Account name</label>
            <input value={t.name} onChange={(e) => setTeam(i, { name: e.target.value })} placeholder="Main office" required />
          </div>
          <div className="grow">
            <label>API key</label>
            <input value={t.fubKey} onChange={(e) => setTeam(i, { fubKey: e.target.value })} placeholder="fka_…" required />
          </div>
        </div>
      ))}
      <button type="button" className="link" onClick={() => setTeams((ts) => [...ts, emptyTeam()])}>
        + Add another Follow Up Boss account
      </button>

      <h4 style={{ margin: '20px 0 6px' }}>Team leaders</h4>
      <p style={{ color: 'var(--text-60)', fontSize: 13, marginTop: 0 }}>
        Each leader gets their own login and their own set-password email.
      </p>
      {leaders.map((l, i) => (
        <div className="row2" key={i}>
          <div className="grow">
            <label>Name</label>
            <input value={l.name} onChange={(e) => setLeader(i, { name: e.target.value })} placeholder="Dana Lee" required />
          </div>
          <div className="grow">
            <label>Email</label>
            <input type="email" value={l.email} onChange={(e) => setLeader(i, { email: e.target.value })} placeholder="dana@acme.com" required />
          </div>
          {teams.length > 1 && (
            <div className="grow">
              <label>Leads which account</label>
              <select value={l.teamIndex} onChange={(e) => setLeader(i, { teamIndex: Number(e.target.value) })}>
                {teams.map((t, ti) => (
                  <option key={ti} value={ti}>{t.name || `Account ${ti + 1}`}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      ))}
      <button type="button" className="link" onClick={() => setLeaders((ls) => [...ls, emptyLeader()])}>
        + Add another team leader
      </button>

      {error && <div className="err" style={{ marginTop: 12 }}>{error}</div>}
      <button className="btn full" type="submit" disabled={busy} style={{ marginTop: 16 }}>
        {busy ? 'Setting them up…' : 'Create team & send invites'}
      </button>
    </form>
  );
}
