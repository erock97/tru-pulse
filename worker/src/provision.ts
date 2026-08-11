// Tenant provisioning — every row a new brokerage needs to exist, written with
// the service role (which sidesteps the RLS bootstrap catch-22).
//
// Deliberately does NOT store Follow Up Boss keys. `connectTeamKey()` in
// index.ts is the single path that puts a key on a team, because it also
// registers FUB webhooks and kicks off the first sync — steps this module used
// to skip, leaving tenants silently cron-only. Callers provision first, then
// connect each team's key with the ids returned here.
//
// The row set mirrors the Coach signup RPC `create_team()` in
// db/hq_coach_compat.sql. The two had drifted: this path omitted `leaders`
// (so Coach's current_team_id() returned null and the product was dead for the
// tenant) and `entitlements`.
import type { Env } from './env.js';
import type { Db } from './db.js';

/** A person who should be able to sign in and lead. */
export interface ProvisionMember {
  userId: string;               // Supabase auth.users id
  role: string;                 // 'admin' | 'leader' | 'coach'
  name?: string;                // present → also gets a Coach `leaders` row
  email?: string;               // required alongside `name`
  teamIndex?: number;           // which of `teams` they lead; defaults to 0
}

export interface ProvisionTeam {
  name: string;
  subdomain?: string;
}

export interface ProvisionInput {
  orgName: string;
  members: ProvisionMember[];
  teams: ProvisionTeam[];
  products?: string[];          // entitlements; defaults to pulse + coach
}

export const DEFAULT_PRODUCTS = ['pulse', 'coach'];

export async function provision(
  _env: Env,
  database: Db,
  input: ProvisionInput,
): Promise<{ orgId: string; teamIds: string[] }> {
  const org = await database.insert('orgs', { name: input.orgName });
  await database.insert('org_settings', { org_id: org.id });

  const teamIds: string[] = [];
  for (const t of input.teams) {
    const team = await database.insert('teams', {
      org_id: org.id,
      name: t.name,
      fub_subdomain: t.subdomain ?? null,
    });
    teamIds.push(team.id);
  }

  for (const m of input.members) {
    await database.insert('memberships', { org_id: org.id, user_id: m.userId, role: m.role });
    // A Coach identity, so current_team_id() resolves for them. Two leaders on
    // one team is two rows sharing a team_id — native to the schema, since
    // leaders.id is the auth user id.
    if (m.name && m.email) {
      const teamId = teamIds[m.teamIndex ?? 0] ?? teamIds[0] ?? null;
      await database.upsert(
        'leaders',
        [{ id: m.userId, team_id: teamId, name: m.name, email: m.email }],
        'id',
      );
    }
  }

  const products = input.products ?? DEFAULT_PRODUCTS;
  await database.upsert(
    'entitlements',
    products.map((product) => ({ org_id: org.id, product })),
    'org_id,product',
  );

  return { orgId: org.id, teamIds };
}
