/**
 * Admin — pick a team to act as.
 *
 * Only a platform owner ever sees this. It is the one screen that exists
 * because of who you are rather than what you are looking at, and until now
 * it lived on the retired Home page, which is why signing out of a team left
 * no way back into one.
 *
 * It is built in the deck's own language rather than the old shell, so a
 * platform owner does not cross a visual seam every time they switch teams.
 */

import { useMemo, useState } from 'react';

import { HqShell } from '../components/hqShell';
import { adminActAs, signOutClean, type AdminLeader } from '../lib/api';

export default function AdminTeams({
  leaders, onOpenPulse, onOpenCoach, onOpenRep,
}: {
  leaders: AdminLeader[];
  onOpenPulse: () => void;
  onOpenCoach: () => void;
  onOpenRep: () => void;
}) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? leaders.filter((l) =>
        `${l.team_name} ${l.org_name} ${l.name} ${l.email}`.toLowerCase().includes(needle))
      : leaders;
    return [...list].sort((a, b) => a.org_name.localeCompare(b.org_name) || a.team_name.localeCompare(b.team_name));
  }, [leaders, q]);

  const orgs = useMemo(() => new Set(leaders.map((l) => l.org_name)).size, [leaders]);

  async function act(email: string) {
    if (busy) return;
    setBusy(email);
    setErr('');
    try {
      await adminActAs(email);
      window.location.hash = '/';
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start that session.');
      setBusy(null);
    }
  }

  return (
    <div className="tru-dark">
      <HqShell
        orgName="TRU HQ"
        role="Platform owner"
        onSignOut={() => signOutClean()}
        nav={{ onOpenPulse, onOpenCoach, onOpenRep }}
        isAdmin
        onOpenAdmin={() => { window.location.hash = '/admin'; }}
        hideTopbar
      >
        <div className="dk-main">
          <header className="dk-mast">
            <div>
              <span className="dk-eyebrow"><i />Platform owner</span>
              <h1>Act as <em>any team</em>.</h1>
              <p className="dk-sub">
                {leaders.length} {leaders.length === 1 ? 'leader' : 'leaders'} across {orgs}{' '}
                {orgs === 1 ? 'organisation' : 'organisations'}. Choosing one signs you into
                their HQ as them; the sidebar then carries an exit back here.
              </p>
            </div>
          </header>

          <div className="dk-sec">
            <h2>Teams</h2>
            <p>{shown.length === leaders.length ? 'all of them' : `${shown.length} matching`}</p>
            <span className="dk-key">
              <input
                className="ad-input adm-search"
                placeholder="Search team, org, or leader…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </span>
          </div>

          {err && <div className="ad-inline-err" style={{ marginBottom: 14 }}>{err}</div>}

          {shown.length === 0 ? (
            <div className="rs-plate dk-table" style={{ padding: 28 }}>
              <p style={{ margin: 0, color: 'var(--text-60)' }}>No team matches “{q}”.</p>
            </div>
          ) : (
            <div className="dk-focus">
              {shown.map((l) => (
                <article
                  key={l.email}
                  className="dk-fr adm-row"
                  tabIndex={0}
                  onClick={() => act(l.email)}
                  onKeyDown={(e) => { if (e.key === 'Enter') act(l.email); }}
                >
                  <span className="rs-av h-holding">
                    {l.team_name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="dk-fr-name">{l.team_name}</span>
                  <span className="dk-fr-why">{l.org_name} · {l.name} · {l.email}</span>
                  <span className="dk-fr-do">
                    {busy === l.email ? 'Signing in…' : 'Act as this team'}
                  </span>
                </article>
              ))}
            </div>
          )}
        </div>
      </HqShell>
    </div>
  );
}
