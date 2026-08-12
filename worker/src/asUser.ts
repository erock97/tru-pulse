// Read Supabase AS THE SIGNED-IN USER.
//
// This is the load-bearing piece of the whole migration. The Worker already has a
// service-role key that bypasses row-level security — it needs that for syncing and
// provisioning. But data the browser used to fetch for itself must NOT be fetched
// that way, because RLS is what keeps one brokerage from seeing another's leads.
//
// So these calls carry the USER's access token. Postgres then applies exactly the same
// policies it applied when the browser called directly, and tenant isolation stays
// where it belongs: in the database, audited, not re-implemented in TypeScript.
//
// If you ever find yourself adding a hand-written "does this person belong to this
// org?" check in a route that uses this module, stop. That means the token isn't being
// forwarded, and the fix is to forward it — not to rebuild RLS by hand and hope the
// two definitions never drift.
import type { Env } from './env.js';
import { withFreshToken } from './session.js';

export interface UserClient {
  userId: string;
  /** One PostgREST GET, as the user. `query` is everything after the `?`. */
  select<T = unknown>(table: string, query: string): Promise<T[]>;
  /** Page through a table until exhausted — PostgREST caps each response at 1000. */
  selectAll<T = unknown>(table: string, cols: string, order: string): Promise<T[]>;
}

const PAGE = 1000;

/**
 * Build a client bound to this session, or null when the session is dead.
 * The caller turns null into a 401.
 */
export async function supabaseAsUser(env: Env, sid: string | null): Promise<UserClient | null> {
  if (!sid) return null;
  const sess = await withFreshToken(env, sid);
  if (!sess) return null;

  const base = env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';
  // anon key as apikey + the user's JWT as the bearer: this is precisely the pair the
  // browser used to send, so the database sees the same caller it always did.
  const headers = {
    apikey: env.SUPABASE_ANON_KEY,
    Authorization: 'Bearer ' + sess.accessToken,
  };

  async function select<T = unknown>(table: string, query: string): Promise<T[]> {
    const res = await fetch(`${base}/${table}?${query}`, { headers });
    if (!res.ok) {
      // A table that doesn't exist yet, or a policy that returns nothing, must not take
      // the whole dashboard down — the browser version degraded to [] too.
      return [];
    }
    return (await res.json()) as T[];
  }

  async function selectAll<T = unknown>(table: string, cols: string, order: string): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const res = await fetch(`${base}/${table}?select=${cols}&order=${order}`, {
        headers: { ...headers, Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items' },
      });
      if (!res.ok) break;
      const rows = (await res.json()) as T[];
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
    return out;
  }

  return { userId: sess.userId, select, selectAll };
}
