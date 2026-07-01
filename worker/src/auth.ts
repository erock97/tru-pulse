// Validate a caller's Supabase user token (for self-serve onboarding/sync) without
// handling JWT secrets: ask Supabase who the token belongs to. Returns the user id.
import type { Env } from './env.js';
import type { Db } from './db.js';

export async function verifySupabaseUser(env: Env, authHeader: string | null): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const res = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/user', {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token },
  });
  if (!res.ok) return null;
  const user = (await res.json()) as { id?: string };
  return user.id ?? null;
}

/** Org ids the user belongs to (service-role read — RLS-independent). */
export async function userOrgIds(database: Db, userId: string): Promise<string[]> {
  const rows = await database.select('memberships', `user_id=eq.${userId}&select=org_id`);
  return rows.map((r) => r.org_id as string);
}
