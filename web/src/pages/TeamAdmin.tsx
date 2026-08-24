import { useEffect, useMemo, useState } from 'react';

import { HqShell } from '../components/hqShell';
import { Avatar } from '../components/hqUi';
import {
  loadTeamRoster, setExcluded, setCoaching, setTeamRole, inviteAgent,
  signOutClean, TEAM_ROLE_LABELS, type TeamMember, type TeamRole,
} from '../lib/api';
import '../truHqDark.css';

/* ============================================================
   TEAM — the one place a leader manages who is on the platform.

   Before this page, "invite" lived in four places: a column in Rep,
   a picker in Coach, a re-invite in the platform-owner intake, and
   the agent drill-down. Each showed a slice, none showed the list,
   and taking someone OFF the team was not possible in the product
   at all — it was a database call.

   So this page is deliberately one table, not a dashboard. Every
   person Follow Up Boss gave us is a row, including the ones a
   leader has already hidden, because this is the screen where you
   decide that. Nothing here is derived, scored, or inferred: each
   column is a stored fact with a control that changes it.

   The one subtlety worth knowing: sending an invite creates the
   login immediately, so "has an account" has never meant "has
   turned up". Those are two separate columns here, and the gap
   between them — emailed, never arrived — is the state a leader
   most needs to see.
   ============================================================ */

type Filter = 'all' | 'off' | 'waiting' | 'hidden';

const AGO = (iso: string | null) => {
  if (!iso) return '';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d} days ago`;
  if (d < 60) return 'last month';
  return `${Math.floor(d / 30)} months ago`;
};

/** The three states a person can be in, in the order they happen. */
function stageOf(m: TeamMember): { key: 'here' | 'waiting' | 'off'; label: string; note: string } {
  if (m.signedInAt) return { key: 'here', label: 'On the platform', note: `last in ${AGO(m.signedInAt)}` };
  if (m.invitedAt) return { key: 'waiting', label: 'Invited', note: `sent ${AGO(m.invitedAt)} · not signed in` };
  return { key: 'off', label: 'Not invited', note: m.email ? 'no login has been sent' : 'no email on file' };
}

export default function TeamAdmin({
  org, onHome,
}: {
  org: { id: string; name: string };
  onHome?: () => void;
}) {
  const [rows, setRows] = useState<TeamMember[] | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  // Per-row in-flight state, so one slow toggle never freezes the table.
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [said, setSaid] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    loadTeamRoster()
      .then((r) => { if (live) setRows(r); })
      .catch((e) => { if (live) setErr(e instanceof Error ? e.message : 'Could not load your team.'); });
    return () => { live = false; };
  }, []);

  const counts = useMemo(() => {
    const r = rows ?? [];
    const on = r.filter((m) => !m.excluded);
    return {
      total: r.length,
      on: on.length,
      hidden: r.length - on.length,
      here: on.filter((m) => m.signedInAt).length,
      waiting: on.filter((m) => !m.signedInAt && m.invitedAt).length,
      off: on.filter((m) => !m.invitedAt).length,
      coached: on.filter((m) => m.coaching).length,
    };
  }, [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? [])
      .filter((m) => {
        if (filter === 'hidden') return m.excluded;
        if (m.excluded) return false;
        if (filter === 'off') return !m.invitedAt;
        if (filter === 'waiting') return !m.signedInAt && !!m.invitedAt;
        return true;
      })
      .filter((m) => !needle || `${m.name} ${m.email ?? ''}`.toLowerCase().includes(needle));
  }, [rows, q, filter]);

  /** Every control on this page follows the same shape: change it on screen
   *  first, then tell the server, and put it back if the server refuses. A
   *  checkbox that waits on a round trip before moving feels broken. */
  async function commit(id: string, what: string, patch: Partial<TeamMember>, run: () => Promise<void>) {
    const before = (rows ?? []).find((m) => m.id === id);
    if (!before) return;
    setBusy((b) => ({ ...b, [id]: what }));
    setErr('');
    setRows((rs) => (rs ?? []).map((m) => (m.id === id ? { ...m, ...patch } : m)));
    try {
      await run();
    } catch (e) {
      setRows((rs) => (rs ?? []).map((m) => (m.id === id ? before : m)));
      setErr(e instanceof Error ? e.message : 'That change did not save.');
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[id]; return n; });
    }
  }

  const toggleShown = (m: TeamMember) =>
    commit(m.id, 'shown',
      // Taking someone off the team switches coaching off with them; the
      // database does the same thing, so the screen must not disagree with it.
      { excluded: !m.excluded, coaching: m.excluded ? m.coaching : false },
      () => setExcluded(m.id, !m.excluded));

  const toggleCoach = (m: TeamMember) =>
    commit(m.id, 'coach', { coaching: !m.coaching }, () => setCoaching(m.id, !m.coaching));

  const invite = (m: TeamMember) =>
    commit(m.id, 'invite', {}, async () => {
      const r = await inviteAgent(m.id);
      setSaid((s) => ({ ...s, [m.id]: r.reinvite ? `Re-sent to ${r.email}` : `Sent to ${r.email}` }));
      // The invite mints the login, so the row's state really has changed.
      setRows((rs) => (rs ?? []).map((x) =>
        (x.id === m.id ? { ...x, invitedAt: x.invitedAt ?? new Date().toISOString() } : x)));
    });

  const changeRole = (m: TeamMember, role: TeamRole) =>
    commit(m.id, 'role', { role }, () => setTeamRole(m.id, role));

  // ── Invite everyone at once ──────────────────────────────────────────────
  // Eligible = on the team, has an email, never been sent a login, and the
  // AGENT role. Leaders, admins and pond accounts ride in with the FUB roster
  // but are not agents — they must never be mailed an agent login and an
  // assessment, which is the whole point of the Role column.
  // Re-sends stay per-row on purpose: a bulk re-send would spam people who
  // simply haven't gotten around to signing in yet.
  const eligible = useMemo(
    () => (rows ?? []).filter((m) => !m.excluded && m.email && !m.invitedAt && m.role === 'agent'),
    [rows],
  );
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [bulkSaid, setBulkSaid] = useState('');
  // The confirm step: the button shows WHO is about to get an email before
  // anything sends, and any name can be unticked.
  const [confirming, setConfirming] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  function openConfirm() {
    if (bulk || eligible.length === 0) return;
    setBulkSaid('');
    setPicked(new Set(eligible.map((m) => m.id)));
    setConfirming(true);
  }

  async function inviteAll() {
    const list = eligible.filter((m) => picked.has(m.id));
    setConfirming(false);
    if (bulk || list.length === 0) return;
    setErr('');
    setBulkSaid('');
    setBulk({ done: 0, total: list.length });
    let sent = 0;
    let failed = 0;
    // One at a time, deliberately: each invite mints a login and sends an
    // email, and a burst of parallel calls is how rate limits eat half a team.
    for (const m of list) {
      try {
        const r = await inviteAgent(m.id);
        sent += 1;
        setSaid((s) => ({ ...s, [m.id]: `Sent to ${r.email}` }));
        setRows((rs) => (rs ?? []).map((x) =>
          (x.id === m.id ? { ...x, invitedAt: x.invitedAt ?? new Date().toISOString() } : x)));
      } catch {
        failed += 1;
      }
      setBulk((b) => (b ? { ...b, done: b.done + 1 } : b));
    }
    setBulk(null);
    setBulkSaid(failed === 0
      ? `All ${sent} ${sent === 1 ? 'invite' : 'invites'} sent.`
      : `${sent} sent · ${failed} did not go through — use Send login on those rows to retry.`);
  }

  const TABS: Array<[Filter, string, number]> = [
    ['all', 'On the team', counts.on],
    ['off', 'No login sent', counts.off],
    ['waiting', 'Waiting on them', counts.waiting],
    ['hidden', 'Taken off', counts.hidden],
  ];

  return (
    <div className="tru-dark">
      <HqShell
        orgName={org.name}
        onSignOut={() => signOutClean()}
        hideTopbar
        nav={{
          onHome: () => onHome?.(),
          onOpenPulse: () => { window.location.hash = '/pulse'; },
          /* '/coach', not '/'. The root used to be Coach's home and later became
             the roster — this handler was written in that earlier world and never
             updated, so from this tab the Coach link quietly took you to Pulse.
             (Coach.tsx has its own correct coachNav; this page hand-rolls the
             same object, which is exactly how the two drifted apart.) */
          onOpenCoach: () => { window.location.hash = '/coach'; },
          onOpenRep: () => { window.location.hash = '/rep'; },
          onOpenTeam: () => { window.location.hash = '/team'; },
        }}
      >
        <div className="dk-main tm-main">
          <header className="dk-mast">
            <div>
              <span className={counts.off > 0 ? 'dk-eyebrow hot' : 'dk-eyebrow'}>
                <i />
                {rows === null ? 'Loading your team'
                  : counts.off > 0 ? `${counts.off} cannot sign in yet`
                    : 'Everybody has a login'}
              </span>
              <h1>
                {rows === null ? <>Your team.</>
                  : <>{counts.total} came from <em>Follow Up Boss</em>.</>}
              </h1>
              <p className="dk-sub">
                {rows === null
                  ? 'Reading the roster.'
                  : <>
                    {counts.on} {counts.on === 1 ? 'is' : 'are'} on the team
                    {counts.hidden > 0 && <> and {counts.hidden} {counts.hidden === 1 ? 'has' : 'have'} been taken off</>}.
                    {' '}Untick anyone who should not be here — an office manager, a
                    lender, someone who left — and they disappear from Pulse, Coach
                    and Rep. Their past business still counts toward the team. Set
                    each person's role once: only agents are included when you send
                    all invites.
                  </>}
              </p>
            </div>
            {(eligible.length > 0 || bulk || bulkSaid) && (
              <div className="dk-mast-do">
                {bulkSaid && <span className="tm-sent">{bulkSaid}</span>}
                {(eligible.length > 0 || bulk) && (
                  <button className="tm-invite-all" disabled={!!bulk || confirming} onClick={openConfirm}>
                    {bulk
                      ? `Sending ${Math.min(bulk.done + 1, bulk.total)} of ${bulk.total}…`
                      : `Send all ${eligible.length} ${eligible.length === 1 ? 'invite' : 'invites'}`}
                  </button>
                )}
              </div>
            )}
          </header>

          {err && <div className="ad-inline-err" style={{ marginBottom: 14 }}>{err}</div>}

          {confirming && (
            <div className="tm-confirm">
              <p className="tm-confirm-head">
                These {picked.size === 1 ? 'is the one person' : `are the ${picked.size} people`} about
                to get a login email. Untick anyone who shouldn't.
              </p>
              <ul className="tm-confirm-list">
                {eligible.map((m) => (
                  <li key={m.id}>
                    <label className="tm-check">
                      <input
                        type="checkbox"
                        checked={picked.has(m.id)}
                        onChange={() => setPicked((p) => {
                          const n = new Set(p);
                          if (n.has(m.id)) n.delete(m.id); else n.add(m.id);
                          return n;
                        })}
                      />
                      <span aria-hidden />
                    </label>
                    <b>{m.name}</b>
                    <i>{m.email}</i>
                  </li>
                ))}
              </ul>
              <div className="tm-confirm-do">
                <button className="tm-invite-all" disabled={picked.size === 0} onClick={inviteAll}>
                  Send {picked.size} {picked.size === 1 ? 'invite' : 'invites'}
                </button>
                <button className="tm-invite" onClick={() => setConfirming(false)}>Cancel</button>
              </div>
            </div>
          )}

          <div className="dk-sec">
            <h2>Everyone</h2>
            <p>
              {counts.here} on the platform · {counts.waiting} invited and waiting ·{' '}
              {counts.coached} in Coach
            </p>
            <span className="dk-key">
              <input
                className="ad-input adm-search"
                placeholder="Search a name or email…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </span>
          </div>

          <div className="tm-tabs">
            {TABS.map(([k, label, n]) => (
              <button
                key={k}
                className={filter === k ? 'tm-tab is-on' : 'tm-tab'}
                onClick={() => setFilter(k)}
              >
                {label}<b>{n}</b>
              </button>
            ))}
          </div>

          <div className="rs-plate dk-table tm-plate">
            <table className="tru-table tm-table">
              <thead>
                <tr>
                  <th className="tm-c-tick" title="Untick to take someone off the team">On the team</th>
                  <th className="tm-c-who">Person</th>
                  <th className="tm-c-role" title="Only agents are included when you send all invites">Role</th>
                  <th className="tm-c-state">Account</th>
                  <th className="tm-c-tick">In Coach</th>
                  <th className="tm-c-act">Login</th>
                </tr>
              </thead>
              <tbody>
                {rows === null && (
                  <tr><td colSpan={6} className="tm-empty">Loading…</td></tr>
                )}
                {rows !== null && shown.length === 0 && (
                  <tr>
                    <td colSpan={6} className="tm-empty">
                      {q ? <>Nobody matches “{q}”.</> : 'Nobody in this group.'}
                    </td>
                  </tr>
                )}
                {shown.map((m, i) => {
                  const st = stageOf(m);
                  const working = busy[m.id];
                  return (
                    <tr key={m.id} className={m.excluded ? 'tm-row is-off' : 'tm-row'}
                        style={{ animationDelay: `${Math.min(i, 8) * 18}ms` }}>
                      <td className="tm-c-tick">
                        <label className="tm-check" title={m.excluded ? 'Put back on the team' : 'Take off the team'}>
                          <input
                            type="checkbox"
                            checked={!m.excluded}
                            disabled={working === 'shown'}
                            onChange={() => toggleShown(m)}
                          />
                          <span aria-hidden />
                        </label>
                      </td>
                      <td className="tm-c-who">
                        <div className="rs-who">
                          <Avatar name={m.name} size={34} tone={i % 5} />
                          <div>
                            <div className="cell-name">{m.name}</div>
                            <div className="rs-sub2">
                              {m.email || 'no email on file'}
                              {m.paused && ' · paused'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="tm-c-role">
                        <select
                          className={m.role === 'agent' ? 'tm-role' : 'tm-role is-nonagent'}
                          value={m.role}
                          disabled={working === 'role'}
                          aria-label={`Role for ${m.name}`}
                          onChange={(e) => changeRole(m, e.target.value as TeamRole)}
                        >
                          {(Object.keys(TEAM_ROLE_LABELS) as TeamRole[]).map((r) => (
                            <option key={r} value={r}>{TEAM_ROLE_LABELS[r]}</option>
                          ))}
                        </select>
                      </td>
                      <td className="tm-c-state">
                        <span className={`tm-state st-${st.key}`}>{st.label}</span>
                        <div className="rs-sub2">{st.note}</div>
                      </td>
                      <td className="tm-c-tick">
                        <label className="tm-check" title={m.excluded ? 'Put them back on the team first' : 'Show this person in Coach'}>
                          <input
                            type="checkbox"
                            checked={m.coaching}
                            disabled={m.excluded || working === 'coach'}
                            onChange={() => toggleCoach(m)}
                          />
                          <span aria-hidden />
                        </label>
                      </td>
                      <td className="tm-c-act">
                        {said[m.id]
                          ? <span className="tm-sent">{said[m.id]}</span>
                          : (
                            <button
                              className="tm-invite"
                              disabled={!m.email || m.excluded || working === 'invite'}
                              title={!m.email ? 'Add an email in Follow Up Boss first — the login is sent there.'
                                : m.role !== 'agent' ? `Marked as ${TEAM_ROLE_LABELS[m.role].toLowerCase()} — bulk invites skip them. This button still sends an agent login if you really mean to.`
                                  : undefined}
                              onClick={() => invite(m)}
                            >
                              {working === 'invite' ? 'Sending…'
                                : m.invitedAt ? 'Send again' : 'Send login'}
                            </button>
                          )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="tm-foot">
            This list is whoever Follow Up Boss reports as a user on the account —
            which is why agents, admin staff and lenders all arrive together. Taking
            someone off here does not touch Follow Up Boss.
          </p>
        </div>
      </HqShell>
    </div>
  );
}
