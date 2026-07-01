// Tenant provisioning — create org + membership + settings + teams + encrypted FUB
// keys, all with the service role (sidesteps the RLS bootstrap catch-22). Called by
// the admin /provision route; the web onboarding flow posts here after signup.
import type { Env } from './env.js';
import type { Db } from './db.js';
import { importEncKey, encryptKey } from './crypto.js';

export interface ProvisionInput {
  orgName: string;
  userId: string; // Supabase auth.users id of the signing-up leader
  role?: string;  // default 'admin'
  teams: Array<{ name: string; fubKey: string; subdomain?: string }>;
}

export async function provision(env: Env, database: Db, input: ProvisionInput) {
  const org = await database.insert('orgs', { name: input.orgName });
  await database.insert('memberships', { org_id: org.id, user_id: input.userId, role: input.role ?? 'admin' });
  await database.insert('org_settings', { org_id: org.id });

  const encKey = await importEncKey(env.FUB_ENC_KEY);
  const teamIds: string[] = [];
  for (const t of input.teams) {
    const team = await database.insert('teams', {
      org_id: org.id,
      name: t.name,
      fub_subdomain: t.subdomain ?? null,
    });
    const enc = await encryptKey(encKey, t.fubKey);
    await database.upsert('team_secrets', [{ team_id: team.id, org_id: org.id, fub_key_enc: enc }], 'team_id');
    teamIds.push(team.id);
  }
  return { orgId: org.id, teamIds };
}
