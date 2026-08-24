// Owner intake — one call that turns "here is a brokerage and its FUB key" into
// a working tenant whose leaders have been emailed a set-password link.
//
// TRU HQ is sold by hand, so the leader-initiated onboarding screen inverts the
// real motion: Eric holds the key and the relationship. This is the path he
// drives.
//
// Ordering matters. Validation happens first and writes nothing, so a bad
// payload is free. Past that point the tenant is REAL, and a failed invite
// email must not roll it back — otherwise Eric is left guessing what state
// things are in. Each leader reports its own outcome instead.
import type { Env } from './env.js';
import type { Db } from './db.js';
import { provision, type ProvisionMember } from './provision.js';
import { mintAuthLink, sendInviteEmail, authUserIdByEmail } from './invite.js';

export interface IntakeTeam { name: string; fubKey: string; subdomain?: string }
/** role decides the memberships row: 'leader' (default) or 'admin'. Both get
 *  the same set-password email — the role is what their login will BE. */
export interface IntakeLeader { name: string; email: string; teamIndex?: number; role?: 'leader' | 'admin' }
export interface IntakeInput { orgName: string; teams: IntakeTeam[]; leaders: IntakeLeader[] }

export interface IntakeLeaderResult {
  name: string;
  email: string;
  /** invited = emailed. email_failed = login exists, link in `link`. failed = no login. */
  status: 'invited' | 'email_failed' | 'failed';
  link?: string;
  error?: string;
}

export interface IntakeResult {
  orgId: string;
  teamIds: string[];
  leaders: IntakeLeaderResult[];
}

/** The connectTeamKey signature from index.ts, passed in to avoid a cyclic import. */
export type ConnectTeamKey = (
  env: Env,
  database: Db,
  ctx: ExecutionContext,
  origin: string,
  team: { id: string; org_id: string },
  fubKey: string,
  subdomain: string | null,
) => Promise<void>;

/** Deliberately loose — catches typos and empties, not exotic-but-valid addresses. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateIntake(
  input: unknown,
): { ok: true; value: IntakeInput } | { ok: false; error: string } {
  const raw = input as any;
  const orgName = String(raw?.orgName ?? '').trim();
  if (!orgName) return { ok: false, error: 'A brokerage name is required.' };

  if (!Array.isArray(raw?.teams) || raw.teams.length === 0) {
    return { ok: false, error: 'Add at least one Follow Up Boss account.' };
  }
  const teams: IntakeTeam[] = [];
  for (const t of raw.teams) {
    const name = String(t?.name ?? '').trim();
    const fubKey = String(t?.fubKey ?? '').trim();
    if (!name) return { ok: false, error: 'Every Follow Up Boss account needs a name.' };
    if (!fubKey) return { ok: false, error: `Add a Follow Up Boss API key for "${name}".` };
    const subdomain = String(t?.subdomain ?? '').trim();
    teams.push({ name, fubKey, ...(subdomain ? { subdomain } : {}) });
  }

  if (!Array.isArray(raw?.leaders) || raw.leaders.length === 0) {
    return { ok: false, error: 'Add at least one team leader.' };
  }
  const leaders: IntakeLeader[] = [];
  const seen = new Set<string>();
  for (const l of raw.leaders) {
    const name = String(l?.name ?? '').trim();
    const email = String(l?.email ?? '').trim().toLowerCase();
    if (!name) return { ok: false, error: 'Every team leader needs a name.' };
    if (!EMAIL_RE.test(email)) return { ok: false, error: `"${l?.email ?? ''}" is not a valid email address.` };
    if (seen.has(email)) return { ok: false, error: `Each email can only be used once — ${email} appears twice.` };
    seen.add(email);
    const teamIndex = Number.isInteger(l?.teamIndex) ? Number(l.teamIndex) : 0;
    if (teamIndex < 0 || teamIndex >= teams.length) {
      return { ok: false, error: `${name} is assigned to a Follow Up Boss account that doesn't exist.` };
    }
    const role = l?.role === undefined ? 'leader' : String(l.role);
    if (role !== 'leader' && role !== 'admin') {
      return { ok: false, error: `${name} has an unknown role — use "leader" or "admin".` };
    }
    leaders.push({ name, email, teamIndex, role });
  }

  return { ok: true, value: { orgName, teams, leaders } };
}

export async function runIntake(
  env: Env,
  database: Db,
  ctx: ExecutionContext,
  origin: string,
  input: IntakeInput,
  connectTeamKey: ConnectTeamKey,
): Promise<IntakeResult> {
  // 1. Every leader needs a login BEFORE provisioning, because memberships and
  //    the Coach `leaders` row are both keyed by auth user id. A leader whose
  //    email already has a login gets a recovery link instead of an invite, so
  //    re-running intake for an existing person is safe.
  const minted: Array<{ leader: IntakeLeader; link: string | null; userId: string | null; error?: string }> = [];
  for (const leader of input.leaders) {
    try {
      const existing = await authUserIdByEmail(env, leader.email);
      const { link, userId } = await mintAuthLink(env, leader.email, existing ? 'recovery' : 'invite');
      minted.push({ leader, link, userId: userId ?? existing });
    } catch (e) {
      minted.push({ leader, link: null, userId: null, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const members: ProvisionMember[] = minted
    .filter((m) => m.userId)
    .map((m) => ({
      userId: m.userId as string,
      role: m.leader.role ?? 'leader',
      name: m.leader.name,
      email: m.leader.email,
      teamIndex: m.leader.teamIndex ?? 0,
    }));
  if (members.length === 0) {
    throw new Error('Could not create a login for any of the team leaders — nothing was created.');
  }

  // 2. The tenant itself.
  const { orgId, teamIds } = await provision(env, database, {
    orgName: input.orgName,
    members,
    teams: input.teams.map((t) => ({ name: t.name, subdomain: t.subdomain })),
  });

  // 3. Bring each team's data online through the one path that also registers
  //    FUB webhooks and starts a first sync.
  for (let i = 0; i < input.teams.length; i++) {
    await connectTeamKey(
      env, database, ctx, origin,
      { id: teamIds[i], org_id: orgId },
      input.teams[i].fubKey,
      input.teams[i].subdomain ?? null,
    );
  }

  // 4. Now tell the humans. The tenant already exists, so an email failure is
  //    reported, not fatal — the link is handed back for Eric to pass along.
  const leaders: IntakeLeaderResult[] = [];
  for (const m of minted) {
    if (!m.link || !m.userId) {
      leaders.push({
        name: m.leader.name,
        email: m.leader.email,
        status: 'failed',
        error: m.error ?? 'could not create a login',
      });
      continue;
    }
    const sent = await sendInviteEmail(env, {
      to: m.leader.email, name: m.leader.name, orgName: input.orgName, link: m.link,
    });
    leaders.push(
      sent
        ? { name: m.leader.name, email: m.leader.email, status: 'invited' }
        : { name: m.leader.name, email: m.leader.email, status: 'email_failed', link: m.link },
    );
  }

  return { orgId, teamIds, leaders };
}
