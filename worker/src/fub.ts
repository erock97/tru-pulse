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

/** Fetch an absolute FUB URL (auth + retry), used for CURSOR pagination via the
 *  _metadata.nextLink FUB returns. Mirrors fubGet's retry/backoff.
 *  SECURITY: only ever send the per-tenant FUB credential to FUB's own host. The URL
 *  comes from an API response; validating the host prevents leaking the key to an
 *  arbitrary origin if that response were ever tampered with (SSRF-style exfil). */
export async function fubGetUrl(key: string, fullUrl: string): Promise<FubResult> {
  let parsed: URL;
  try {
    parsed = new URL(fullUrl);
  } catch {
    return { status: 400, body: null };
  }
  if (parsed.protocol !== 'https:' || parsed.host !== new URL(BASE).host) {
    return { status: 400, body: null };
  }
  const auth = btoa(key.trim() + ':');
  const headers = { Authorization: 'Basic ' + auth, Accept: 'application/json' };
  for (let attempt = 0; attempt < 4; attempt++) {
    let res: Response;
    try {
      res = await fetch(fullUrl, { headers });
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

/** Paginate /people newest-first via FUB's CURSOR (_metadata.nextLink).
 *  WHY CURSOR, NOT OFFSET: FUB enforces keyset/cursor pagination past a ~10k offset
 *  ceiling (docs.followupboss.com/reference/pagination) — the old `offset` loop
 *  silently truncated large teams at 10,000 people, so their older CLOSED leads
 *  (created earlier in the year) never synced. Cursor paging walks the whole set.
 *  Bounded to `sinceMs` (default ~13 months, covering the 12-month baseline window
 *  + buffer) so a huge team's pull stays complete-but-finite rather than dragging in
 *  years of history and blowing the Worker subrequest budget. */
export async function pullPeople(key: string, sinceMs = Date.now() - 400 * 86400_000): Promise<any[]> {
  const leads: any[] = [];
  const HARD_CAP = 3000; // runaway guard only (~300k people)
  let result = await fubGet(key, '/people', { limit: 100, sort: '-created' });
  for (let page = 0; page < HARD_CAP; page++) {
    if (result.status !== 200 || !result.body) break;
    const people: any[] = result.body.people ?? [];
    if (people.length === 0) break;
    leads.push(...people);
    // Newest-first: once the oldest row on this page predates the window, stop.
    const oldest = people[people.length - 1]?.created;
    if (oldest && !Number.isNaN(Date.parse(oldest)) && Date.parse(oldest) < sinceMs) break;
    if (people.length < 100) break;
    const nextLink: string | undefined = result.body._metadata?.nextLink;
    if (!nextLink) break;
    result = await fubGetUrl(key, nextLink);
  }
  return leads;
}

/** Fetch specific people by comma-separated FUB ids — the webhook stage-log path. */
export async function getPeopleByIds(key: string, ids: string): Promise<any[]> {
  const { status, body } = await fubGet(key, '/people', { id: ids, limit: 100 });
  if (status !== 200 || !body) return [];
  return body.people ?? [];
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

export async function fubDelete(key: string, path: string, extra: Record<string, string> = {}): Promise<FubResult> {
  const auth = btoa(key.trim() + ':');
  let res: Response | null = null;
  try {
    res = await fetch(BASE + path, {
      method: 'DELETE',
      headers: { Authorization: 'Basic ' + auth, Accept: 'application/json', ...extra },
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
// headers. Historically we reused Eric's existing FUB system (same key as the
// Terrason dashboard) — but FUB disables a webhook when two integrations share
// one system identity, so the name is now configurable via env.FUB_SYSTEM_NAME
// (falling back to this default so behavior is unchanged until it's set).
const DEFAULT_X_SYSTEM = 'TerrasonFUBDashboard';

/** Idempotently register the flag-affecting webhooks for this account → callbackUrl. */
export async function registerWebhooks(
  key: string,
  callbackUrl: string,
  systemKey?: string,
  systemName?: string,
): Promise<Array<{ event: string; status: number; id?: number; error?: string }>> {
  const sys: Record<string, string> = systemKey
    ? { 'X-System': systemName || DEFAULT_X_SYSTEM, 'X-System-Key': systemKey }
    : {};
  const out: Array<{ event: string; status: number; id?: number; error?: string }> = [];

  // FUB deduplicates webhooks by URL *path* (it ignores the ?query string), and a
  // webhook that ever got auto-disabled never recovers — so re-registering the same
  // path just silently skips and leaves the dead one in place. Delete every existing
  // webhook on OUR exact path first (matched by the path prefix, so fub-sync and any
  // other integration on a different path are never touched), then create fresh ones
  // that inherit the current — fixed — handler's behavior.
  const pathPrefix = callbackUrl.split('?')[0];
  const existing = await fubGet(key, '/webhooks', { limit: 100 }, sys);
  if (existing.status === 200 && existing.body) {
    for (const w of existing.body.webhooks ?? []) {
      if (String(w.url ?? '').startsWith(pathPrefix)) {
        const del = await fubDelete(key, `/webhooks/${w.id}`, sys);
        out.push({ event: `deleted:${w.event}#${w.id}`, status: del.status });
      }
    }
  }

  for (const event of FUB_WEBHOOK_EVENTS) {
    const r = await fubPost(key, '/webhooks', { event, url: callbackUrl }, sys);
    out.push({ event, status: r.status, id: r.body?.id, error: r.status >= 300 ? JSON.stringify(r.body) : undefined });
  }
  return out;
}

// ── Writeback (TRU Prospect dispositions → FUB) ─────────────────────────────
// A circle-prospected neighbor is a NEW contact — we create it in FUB the first
// time a warm disposition fires, then reuse its id for later notes/tasks.

function splitName(name: string | null | undefined): { firstName?: string; lastName?: string } {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return {};
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

/** Create a person in FUB and return its id. Use only when we don't already hold one. */
export async function fubCreatePerson(
  key: string,
  p: { name?: string | null; phone?: string | null; source?: string; tags?: string[] },
  systemKey?: string,
): Promise<number | null> {
  const sys: Record<string, string> = systemKey ? { 'X-System': DEFAULT_X_SYSTEM, 'X-System-Key': systemKey } : {};
  const person: any = { source: p.source ?? 'TRU Prospect', ...splitName(p.name) };
  if (p.phone) person.phones = [{ value: p.phone, type: 'mobile' }];
  if (p.tags?.length) person.tags = p.tags;
  const r = await fubPost(key, '/people', person, sys);
  if (r.status >= 200 && r.status < 300 && r.body?.id) return Number(r.body.id);
  return null;
}

/** Append a note to a person. */
export async function fubAddNote(key: string, personId: number, body: string, subject = 'TRU Prospect'): Promise<boolean> {
  const r = await fubPost(key, '/notes', { personId, subject, body });
  return r.status >= 200 && r.status < 300;
}

/** Create a follow-up task on a person. dueDate is ISO (YYYY-MM-DD or full). */
export async function fubAddTask(
  key: string,
  personId: number,
  opts: { description: string; dueDate?: string; type?: string },
): Promise<boolean> {
  const payload: any = { personId, type: opts.type ?? 'Follow Up', description: opts.description };
  if (opts.dueDate) payload.dueDate = opts.dueDate;
  const r = await fubPost(key, '/tasks', payload);
  return r.status >= 200 && r.status < 300;
}

function subdomainFrom(body: any): string | null {
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

/** Scan /identity for the team's *.followupboss.com subdomain. */
export async function detectSubdomain(key: string): Promise<string | null> {
  const { status, body } = await fubGet(key, '/identity');
  if (status !== 200 || !body) return null;
  return subdomainFrom(body);
}

/** Validate a FUB API key via /identity — the authoritative connect check. Returns
 *  whether the key works and the account's subdomain, in one call. */
export async function validateKey(key: string): Promise<{ valid: boolean; subdomain: string | null }> {
  const { status, body } = await fubGet(key, '/identity');
  if (status !== 200 || !body) return { valid: false, subdomain: null };
  return { valid: true, subdomain: subdomainFrom(body) };
}
