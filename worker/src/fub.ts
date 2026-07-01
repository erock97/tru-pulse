// Follow Up Boss API client — fetch-based (Workers runtime). Ported from the audit
// tool (accountability_audit.py): same endpoints, same per-person call/text counts,
// so Pulse's flags match the audit exactly. Retries 429/503 with Retry-After.

const BASE = 'https://api.followupboss.com/v1';
const MAX_PAGES = 40;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FubResult {
  status: number;
  body: any;
}

export async function fubGet(
  key: string,
  path: string,
  params?: Record<string, string | number>,
): Promise<FubResult> {
  const url = new URL(BASE + path);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const auth = btoa(key.trim() + ':');
  const headers = { Authorization: 'Basic ' + auth, Accept: 'application/json' };

  for (let attempt = 0; attempt < 4; attempt++) {
    let res: Response;
    try {
      res = await fetch(url.toString(), { headers });
    } catch {
      await sleep((attempt + 1) * 500);
      continue;
    }
    if (res.status === 429 || res.status === 503) {
      const ra = Number(res.headers.get('Retry-After')) || attempt + 1;
      await sleep(ra * 1000);
      continue;
    }
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    return { status: res.status, body };
  }
  return { status: 429, body: null };
}

/** Paginate /people newest-first until older than the window (or MAX_PAGES). */
export async function pullPeople(key: string, windowDays: number): Promise<any[]> {
  const cutoff = Date.now() - windowDays * 86400_000;
  const leads: any[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { status, body } = await fubGet(key, '/people', {
      limit: 100,
      offset,
      sort: '-created',
    });
    if (status !== 200 || !body) break;
    const people: any[] = body.people ?? [];
    if (people.length === 0) break;
    let stop = false;
    for (const p of people) {
      const created = Date.parse(p.created ?? '');
      if (!Number.isNaN(created) && created < cutoff) {
        stop = true;
        break;
      }
      leads.push(p);
    }
    if (stop || people.length < 100) break;
    offset += 100;
  }
  return leads;
}

/** Non-automated outgoing texts for a person (isIncoming === false). */
export async function countOutgoingTexts(key: string, personId: number): Promise<number> {
  const { status, body } = await fubGet(key, '/textMessages', { personId, limit: 100 });
  if (status !== 200 || !body) return 0;
  const msgs: any[] = body.textmessages ?? body.textMessages ?? [];
  return msgs.filter((m) => m.isIncoming !== true).length;
}

/** Calls for a person, either direction. */
export async function countCalls(key: string, personId: number): Promise<number> {
  const { status, body } = await fubGet(key, '/calls', { personId, limit: 100 });
  if (status !== 200 || !body) return 0;
  const calls: any[] = body.calls ?? [];
  if (calls.length) return calls.length;
  const total = body._metadata?.total;
  return typeof total === 'number' ? total : 0;
}

/** Scan /identity for the team's *.followupboss.com subdomain. */
export async function detectSubdomain(key: string): Promise<string | null> {
  const { status, body } = await fubGet(key, '/identity');
  if (status !== 200 || !body) return null;
  const found: string[] = [];
  const walk = (o: any) => {
    if (o && typeof o === 'object') {
      for (const v of Object.values(o)) walk(v);
    } else if (typeof o === 'string') {
      const m = o.match(/([a-z0-9][a-z0-9-]*)\.followupboss\.com/i);
      if (m && !['api', 'www', 'app', 'docs', 'help'].includes(m[1].toLowerCase())) {
        found.push(m[1].toLowerCase());
      }
    }
  };
  walk(body);
  return found[0] ?? null;
}
