/**
 * TRU Agents — the shelf.
 *
 * Only a platform owner ever sees this, and the gate is the DATA rather than
 * this file: the component ships in the same bundle a team lead can download,
 * and if one types the route they get the empty state, because the Worker
 * answered 403 and `board` stayed null. Nothing is hidden by hiding code.
 *
 * The shape of this screen is the product argument. It is a fixed shelf of
 * pre-built agents you switch on per team — never a box that asks what you want
 * your agent to do. Someone handed that box does not know what is possible or
 * what is reasonable, so they open it once and never come back. All the scoping
 * happened once, in SQL, and adding an agent to the shelf is a migration.
 *
 * The four modes below are the OWNER's controls. A team lead, when they are
 * eventually given this, sees a switch and "check with me first" — nothing else.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { HqShell } from '../components/hqShell';
import {
  addAutomation, automationBoard, setAutomationMode, signOutClean,
  type Automation, type AutomationBoard, type AutomationMode, type AutomationType,
} from '../lib/api';

/** Plain English, and deliberately not the database's vocabulary. */
const MODE_COPY: Record<AutomationMode, { label: string; hint: string }> = {
  off: { label: 'Off', hint: 'Does nothing at all.' },
  notify_only: { label: 'Watch only', hint: 'Runs and records what it would have done. Sends nothing.' },
  ask_first: { label: 'Ask me first', hint: 'Proposes; nothing reaches anyone until you approve it.' },
  full_auto: { label: 'On', hint: 'Acts on its own.' },
};

const MODE_ORDER: AutomationMode[] = ['off', 'notify_only', 'ask_first', 'full_auto'];

const rank = (m: AutomationMode) => MODE_ORDER.indexOf(m);

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(mins)) return 'never';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 36) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function AdminAutomations({
  onOpenPulse, onOpenCoach, onOpenRep,
}: {
  onOpenPulse: () => void;
  onOpenCoach: () => void;
  onOpenRep: () => void;
}) {
  const [board, setBoard] = useState<AutomationBoard | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => setBoard(await automationBoard()), []);
  useEffect(() => { void load(); }, [load]);

  const typeByKey = useMemo(
    () => new Map((board?.types ?? []).map((t) => [t.key, t])),
    [board],
  );

  const byTeam = useMemo(() => {
    const m = new Map<string, Automation[]>();
    for (const a of board?.automations ?? []) {
      m.set(a.team_id, [...(m.get(a.team_id) ?? []), a]);
    }
    return m;
  }, [board]);

  async function change(a: Automation, mode: AutomationMode) {
    if (busy) return;
    setBusy(a.id); setErr('');
    try {
      await setAutomationMode(a.id, mode);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not change that setting.');
    } finally {
      setBusy(null);
    }
  }

  async function add(teamId: string, typeKey: string) {
    if (busy) return;
    setBusy(`${teamId}:${typeKey}`); setErr('');
    try {
      await addAutomation(teamId, typeKey);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not add that agent.');
    } finally {
      setBusy(null);
    }
  }

  const shell = (children: React.ReactNode) => (
    <div className="tru-dark">
      <HqShell
        orgName="TRU HQ"
        role="Platform owner"
        onSignOut={() => signOutClean()}
        nav={{ onOpenPulse, onOpenCoach, onOpenRep }}
        isAdmin
        onOpenAdmin={() => { window.location.hash = '/admin'; }}
        onOpenTeamData={() => { window.location.hash = '/admin/targets'; }}
        onOpenRevenue={() => { window.location.hash = '/admin/revenue'; }}
        onOpenContracts={() => { window.location.hash = '/admin/contracts'; }}
        hideTopbar
      >
        <div className="dk-main">{children}</div>
      </HqShell>
    </div>
  );

  if (board === undefined) return shell(<p style={{ color: 'var(--text-60)' }}>Loading…</p>);

  // Null means the Worker refused. For an owner that is a real fault worth
  // saying out loud; for anyone else it is simply not their screen. We cannot
  // tell the two apart from here and should not pretend to.
  if (board === null) {
    return shell(
      <div className="rs-plate dk-table" style={{ padding: 28 }}>
        <p style={{ margin: 0, color: 'var(--text-60)' }}>Nothing to show here.</p>
      </div>,
    );
  }

  const stopped = !board.flags.automation_enabled;

  return shell(
    <>
      <header className="dk-mast">
        <div>
          <span className="dk-eyebrow"><i />Platform owner</span>
          <h1>Agents, <em>per team</em>.</h1>
          <p className="dk-sub">
            A fixed set of agents you switch on for a team. Every one of them starts off,
            and the ones that could touch a client's data can only go as far as their own
            ceiling allows — raising that is a deliberate change, not a setting.
          </p>
        </div>
      </header>

      {stopped && (
        <div className="ad-inline-err" style={{ marginBottom: 14 }}>
          Everything is stopped platform-wide. No agent will act until that is turned back on.
        </div>
      )}
      {!board.flags.automation_live_sends && !stopped && (
        <div className="rs-plate dk-table" style={{ padding: 16, marginBottom: 14 }}>
          <p style={{ margin: 0, color: 'var(--text-60)' }}>
            Live sending is off platform-wide, so anything switched on will record what it
            would have done rather than doing it. That is the intended state until a
            delivery route has been proven end to end.
          </p>
        </div>
      )}
      {err && <div className="ad-inline-err" style={{ marginBottom: 14 }}>{err}</div>}

      {board.teams.map((team) => {
        const mine = byTeam.get(team.id) ?? [];
        const missing = board.types.filter((t) => !mine.some((a) => a.type_key === t.key));
        return (
          <section key={team.id} style={{ marginBottom: 34 }}>
            <div className="dk-sec">
              <h2>{team.name}</h2>
              <p>
                {team.org_name} · {team.timezone.split('/')[1]?.replace('_', ' ') ?? team.timezone}
                {' · '}synced {ago(team.last_sync_at)}
              </p>
            </div>

            <div className="dk-focus">
              {mine.map((a) => {
                const type = typeByKey.get(a.type_key);
                if (!type) return null;
                return (
                  <AgentCard
                    key={a.id}
                    a={a}
                    type={type}
                    team={team}
                    busy={busy === a.id}
                    onChange={(m) => change(a, m)}
                  />
                );
              })}

              {missing.map((t) => (
                <article key={t.key} className="rs-plate dk-table" style={{ padding: 20, opacity: 0.72 }}>
                  <h3 style={{ margin: '0 0 4px' }}>{t.label}</h3>
                  <p style={{ margin: '0 0 14px', color: 'var(--text-60)' }}>{t.blurb}</p>
                  <button
                    className="ad-btn"
                    disabled={busy === `${team.id}:${t.key}`}
                    onClick={() => add(team.id, t.key)}
                  >
                    {busy === `${team.id}:${t.key}` ? 'Adding…' : 'Add to this team'}
                  </button>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </>,
  );
}

function AgentCard({
  a, type, team, busy, onChange,
}: {
  a: Automation;
  type: AutomationType;
  team: { capabilities: string[] };
  busy: boolean;
  onChange: (m: AutomationMode) => void;
}) {
  // A capability this team has not been granted is shown as the reason a mode is
  // unavailable, rather than the mode silently failing when someone picks it.
  const needsCap = type.capability && !team.capabilities.includes(type.capability);
  const ceiling = rank(type.max_mode);

  return (
    <article className="rs-plate dk-table" style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
        <h3 style={{ margin: '0 0 4px' }}>{type.label}</h3>
        <span style={{ color: 'var(--text-60)', fontSize: 13 }}>
          {a.enabled ? MODE_COPY[a.mode].label : 'Off'}
        </span>
      </div>
      <p style={{ margin: '0 0 14px', color: 'var(--text-60)' }}>{type.blurb}</p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        {MODE_ORDER.map((m) => {
          const beyondCeiling = rank(m) > ceiling;
          const disabled = busy || beyondCeiling;
          return (
            <button
              key={m}
              className="ad-btn"
              aria-pressed={a.mode === m}
              disabled={disabled}
              title={
                beyondCeiling
                  ? `${type.label} is not allowed to go this far.`
                  : MODE_COPY[m].hint
              }
              style={a.mode === m ? undefined : { opacity: disabled ? 0.35 : 0.6 }}
              onClick={() => onChange(m)}
            >
              {MODE_COPY[m].label}
            </button>
          );
        })}
      </div>

      <p style={{ margin: 0, color: 'var(--text-60)', fontSize: 13 }}>
        {MODE_COPY[a.mode].hint}
        {' '}
        {a.hasRecipient
          ? `Goes to ${a.recipientMasked}.`
          : 'Nobody is set to receive this yet.'}
        {needsCap && ' This team has not been cleared for it, so it will hold rather than act.'}
        {rank(type.max_mode) < rank('full_auto') &&
          ` It can go no further than “${MODE_COPY[type.max_mode].label}”.`}
      </p>
    </article>
  );
}
