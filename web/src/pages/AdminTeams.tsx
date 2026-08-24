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

import { AdminIntake } from '../components/AdminIntake';
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
  const [adding, setAdding] = useState(false);

  // One tile per TEAM, never per login. A team can have several leaders
  // (Synergy has two), and a tile per leader read as two separate companies.
  // Every leader of a team lands in the same HQ, so acting as the first one
  // is acting as the team; the other names still show so it's clear who's in.
  const teams = useMemo(() => {
    const by = new Map<string, { team: string; org: string; leaders: AdminLeader[] }>();
    for (const l of leaders) {
      const g = by.get(l.team_name);
      if (g) g.leaders.push(l);
      else by.set(l.team_name, { team: l.team_name, org: l.org_name, leaders: [l] });
    }
    return [...by.values()].sort((a, b) => a.org.localeCompare(b.org) || a.team.localeCompare(b.team));
  }, [leaders]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return teams;
    return teams.filter((t) =>
      `${t.team} ${t.org} ${t.leaders.map((l) => `${l.name} ${l.email}`).join(' ')}`
        .toLowerCase().includes(needle));
  }, [teams, q]);

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
                {teams.length} {teams.length === 1 ? 'team' : 'teams'} across {orgs}{' '}
                {orgs === 1 ? 'organisation' : 'organisations'}. Choosing one signs you into
                that team's HQ as its leader; the sidebar then carries an exit back here.
              </p>
            </div>
            <button
              className="ad-btn"
              onClick={() => { window.location.hash = '/admin/agents'; }}
            >
              Agents
            </button>
          </header>

          <div className="dk-sec">
            <h2>Teams</h2>
            <p>{shown.length === teams.length ? 'all of them' : `${shown.length} matching`}</p>
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
              {shown.map((t) => {
                const doorEmail = t.leaders[0].email;
                const who = t.leaders.length === 1
                  ? `${t.leaders[0].name} · ${t.leaders[0].email}`
                  : t.leaders.map((l) => l.name).join(' & ');
                return (
                  <article
                    key={t.team}
                    className="dk-fr adm-row"
                    tabIndex={0}
                    onClick={() => act(doorEmail)}
                    onKeyDown={(e) => { if (e.key === 'Enter') act(doorEmail); }}
                  >
                    <span className="rs-av h-holding">
                      {t.team.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="dk-fr-name">{t.team}</span>
                    <span className="dk-fr-why">{t.org} · {who}</span>
                    <span className="dk-fr-do">
                      {busy === doorEmail ? 'Signing in…' : 'Act as this team'}
                    </span>
                  </article>
                );
              })}
            </div>
          )}

          {/* ── Add a new team — the same intake that lived on the retired Home
                 page, now where the platform owner actually starts: name the
                 brokerage, add each leader or admin with their email and role,
                 and every one of them is emailed a create-account link. */}
          <div className="dk-sec" style={{ marginTop: 34 }}>
            <h2>Add a new team</h2>
            <p>
              {adding
                ? 'Each person below gets their own set-password email.'
                : 'Set a brokerage up and email its leaders their logins.'}
            </p>
            <span className="dk-key">
              <button className="tm-invite" onClick={() => setAdding((a) => !a)}>
                {adding ? 'Close' : 'Add a team'}
              </button>
            </span>
          </div>
          {adding && (
            <div className="rs-plate dk-table adm-intake">
              <AdminIntake />
            </div>
          )}
        </div>
      </HqShell>
    </div>
  );
}
