// Follow Up Boss API client — fetch-based (Workers runtime). Ported from the audit
// tool (accountability_audit.py): same endpoints, same per-person call/text counts,
// so Pulse's flags match the audit exactly. Retries 429/503 with Retry-After.

const BASE = 'https://api.followupboss.com/v1';
const MAX_PAGES = 100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface FubResult {
  status: number;
  body: any;
}

export async function fubGet(
  key: string,
  path: string,
  params?: Record<string, string | number>,
  extra: Record<string, string> = {},
): Promise<FubResult> {
  const url = new URL(BASE + path);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const auth = btoa(key.trim() + ':');
  const headers = { Authorization: 'Basic ' + auth, Accept: 'application/json', ...extra };

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

/** Team members with their contact info — FUB is the source of truth for these. */
export async function pullUsers(key: string): Promise<any[]> {
  const { status, body } = await fubGet(key, '/users', { limit: 100 });
  if (status !== 200 || !body) return [];
  return body.users ?? [];
}

/** Pond id → name, for labeling pond-assigned leads. */
export async function pullPonds(key: string): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  const { status, body } = await fubGet(key, '/ponds', { limit: 100 });
  if (status === 200 && body) {
    for (const p of body.ponds ?? []) map.set(Number(p.id), String(p.name ?? 'Pond'));
  }
  return map;
}

/** All deals (paginated) — stage, price, projected close, assigned users. */
export async function pullDeals(key: string): Promise<any[]> {
  const deals: any[] = [];
  let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { status, body } = await fubGet(key, '/deals', { limit: 100, offset });
    if (status !== 200 || !body) break;
    const batch: any[] = body.deals ?? [];
    deals.push(...batch);
    if (batch.length < 100) break;
    offset += 100;
  }
  return deals;
}

export async function fubPost(key: string, path: string, body: unknown, extra: Record<string, string> = {}): Promise<FubResult> {
  const auth = btoa(key.trim() + ':');
  let res: Response | null = null;
  try {
    res = await fetch(BASE + path, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + auth, Accept: 'application/json', 'Content-Type': 'application/json', ...extra },
      body: JSON.stringify(body),
    });
  } catch {
    return { status: 0, body: null };
  }
  const b = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, body: b };
}

// The FUB events that can change a lead's flag — new lead, stage/tag edits, and the
// contact activity (calls/texts) the "worked" rule counts. Registering these makes
// Pulse update live instead of waiting on the cron.
export const FUB_WEBHOOK_EVENTS = [
  'peopleCreated', 'peopleUpdated', 'peopleStageUpdated', 'callsCreated', 'textMessagesCreated',
];

// FUB requires webhook creation to identify a registered integration via these
// headers. We reuse Eric's existing FUB system (same key as the Terrason dashboard).
const X_SYSTEM = 'TerrasonFUBDashboard';

/** Idempotently register the flag-affecting webhooks for this account → callbackUrl. */
export async function registerWebhooks(
  key: string,
  callbackUrl: string,
  systemKey?: string,
): Promise<Array<{ event: string; status: number; id?: number; error?: string }>> {
  const sys: Record<string, string> = systemKey ? { 'X-System': X_SYSTEM, 'X-System-Key': systemKey } : {};
  const existing = await fubGet(key, '/webhooks', { limit: 100 }, sys);
  const have = new Set<string>();
  if (existing.status === 200 && existing.body) {
    for (const w of existing.body.webhooks ?? []) have.add(`${w.event}|${w.url}`);
  }
  const out: Array<{ event: string; status: number; id?: number; error?: string }> = [];
  for (const event of FUB_WEBHOOK_EVENTS) {
    if (have.has(`${event}|${callbackUrl}`)) { out.push({ event, status: 200 }); continue; }
    const r = await fubPost(key, '/webhooks', { event, url: callbackUrl }, sys);
    out.push({ event, status: r.status, id: r.body?.id, error: r.status >= 300 ? JSON.stringify(r.body) : undefined });
  }
  return out;
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
