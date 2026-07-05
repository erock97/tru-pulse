// Thin Supabase (PostgREST) helper using the SERVICE ROLE — bypasses RLS. Only the
// Worker ever holds this key; the browser uses the anon key + a signed-in JWT.
import type { Env } from './env.js';

export function db(env: Env) {
  const base = env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';
  const headers: Record<string, string> = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
    'Content-Type': 'application/json',
  };

  return {
    async select(table: string, query: string): Promise<any[]> {
      const res = await fetch(`${base}/${table}?${query}`, { headers });
      if (!res.ok) throw new Error(`select ${table} ${res.status}: ${await res.text()}`);
      return res.json();
    },
    async insert(table: string, row: any): Promise<any> {
      const res = await fetch(`${base}/${table}`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify(row),
      });
      if (!res.ok) throw new Error(`insert ${table} ${res.status}: ${await res.text()}`);
      return ((await res.json()) as any[])[0];
    },
    async upsert(table: string, rows: any[], onConflict?: string, opts?: { ignoreDuplicates?: boolean }): Promise<void> {
      if (rows.length === 0) return;
      const url = new URL(`${base}/${table}`);
      if (onConflict) url.searchParams.set('on_conflict', onConflict);
      // merge = update on conflict (default); ignore = keep the existing row (used by
      // the stage log so a lead's FIRST time reaching a stage keeps its original date).
      const resolution = opts?.ignoreDuplicates ? 'ignore-duplicates' : 'merge-duplicates';
      // Chunk to stay well under any body limits on big backfills.
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const res = await fetch(url.toString(), {
          method: 'POST',
          headers: { ...headers, Prefer: `resolution=${resolution},return=minimal` },
          body: JSON.stringify(chunk),
        });
        if (!res.ok) throw new Error(`upsert ${table} ${res.status}: ${await res.text()}`);
      }
    },
    async update(table: string, query: string, patch: any): Promise<void> {
      const res = await fetch(`${base}/${table}?${query}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`update ${table} ${res.status}: ${await res.text()}`);
    },
  };
}

export type Db = ReturnType<typeof db>;
