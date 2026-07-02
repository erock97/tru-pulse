// Supabase-backed ProspectStore — PostgREST via the service role (bypasses RLS),
// same posture as worker/src/db.ts. Implements the pure pipeline's store interface
// so buildCircleCampaign() persists into the prospect_* tables.
import type { Env } from '../env.js';
import type { ProspectStore } from './circle.js';

export function supabaseProspectStore(env: Env): ProspectStore {
  const base = env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';
  const H: Record<string, string> = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
    'Content-Type': 'application/json',
  };

  async function insertReturning(table: string, row: unknown): Promise<any> {
    const res = await fetch(`${base}/${table}`, {
      method: 'POST', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error(`insert ${table} ${res.status}: ${await res.text()}`);
    return ((await res.json()) as any[])[0];
  }
  async function upsertReturning(table: string, row: unknown, onConflict: string): Promise<any> {
    const url = new URL(`${base}/${table}`);
    url.searchParams.set('on_conflict', onConflict);
    const res = await fetch(url.toString(), {
      method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error(`upsert ${table} ${res.status}: ${await res.text()}`);
    return ((await res.json()) as any[])[0];
  }
  async function upsertMinimal(table: string, rows: unknown[], onConflict: string): Promise<void> {
    if (!rows.length) return;
    const url = new URL(`${base}/${table}`);
    url.searchParams.set('on_conflict', onConflict);
    const res = await fetch(url.toString(), {
      method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows),
    });
    if (!res.ok) throw new Error(`upsert ${table} ${res.status}: ${await res.text()}`);
  }
  async function selectRows(table: string, query: string): Promise<any[]> {
    const res = await fetch(`${base}/${table}?${query}`, { headers: H });
    if (!res.ok) throw new Error(`select ${table} ${res.status}: ${await res.text()}`);
    return res.json();
  }
  // PostgREST in-list: quote each value and percent-encode so '+' in E.164 phones
  // isn't read as a space.
  const inList = (vals: string[]) => vals.map((v) => encodeURIComponent(`"${v}"`)).join(',');

  return {
    async upsertProperty(p) {
      const r = await insertReturning('prospect_properties', {
        org_id: p.orgId, team_id: p.teamId, address_line1: p.addressLine1, city: p.city ?? null,
        state: p.state ?? null, postal_code: p.postalCode ?? null, apn: p.apn ?? null,
        latitude: p.latitude ?? null, longitude: p.longitude ?? null, owner_name: p.ownerName ?? null,
        owner_occupied: p.ownerOccupied ?? null, tenure_years: p.tenureYears ?? null,
        est_value: p.estValue ?? null, est_equity: p.estEquity ?? null, equity_pct: p.equityPct ?? null,
        mls_id: p.mlsId ?? null, list_price: p.listPrice ?? null, days_on_market: p.daysOnMarket ?? null,
        price_changes: p.priceChanges ?? [], listing_status: p.listingStatus ?? null,
      });
      return { id: r.id };
    },
    async upsertPerson(p) {
      const r = await upsertReturning('prospect_people', {
        org_id: p.orgId, team_id: p.teamId, dedupe_key: p.dedupeKey, property_id: p.propertyId,
        full_name: p.fullName, best_phone_e164: p.bestPhoneE164, timezone: p.timezone,
        source: p.source, owning_agent_id: p.owningAgentId, updated_at: new Date().toISOString(),
      }, 'org_id,dedupe_key');
      return { id: r.id };
    },
    async upsertPhones(personId, orgId, phones) {
      await upsertMinimal('prospect_phones', phones.map((ph) => ({
        org_id: orgId, person_id: personId, phone_e164: ph.phoneE164, line_type: ph.lineType,
        confidence: ph.confidence, dnc_status: ph.dncStatus, is_best: ph.isBest, source: ph.source,
        scrubbed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      })), 'person_id,phone_e164');
    },
    async checkSuppression(orgId, phones) {
      const out = new Map<string, { optedOut: boolean; onDnc: boolean }>();
      for (const p of phones) out.set(p, { optedOut: false, onDnc: false });
      if (!phones.length) return out;
      const list = inList(phones);
      const [opts, dncs] = await Promise.all([
        selectRows('prospect_opt_outs', `org_id=eq.${orgId}&phone_e164=in.(${list})&select=phone_e164`),
        selectRows('prospect_dnc', `phone_e164=in.(${list})&select=phone_e164,org_id`),
      ]);
      for (const o of opts) { const c = out.get(o.phone_e164); if (c) c.optedOut = true; }
      for (const d of dncs) {
        if (d.org_id === null || d.org_id === orgId) { const c = out.get(d.phone_e164); if (c) c.onDnc = true; }
      }
      return out;
    },
    async enqueue(row) {
      await upsertMinimal('prospect_call_queue', [{
        org_id: row.orgId, team_id: row.teamId, campaign_id: row.campaignId, person_id: row.personId,
        phone_e164: row.phoneE164, channel: row.channel, priority: row.priority, state: row.state,
        last_gate_decision: row.gateDecision, next_eligible_at: row.nextEligibleAt,
        updated_at: new Date().toISOString(),
      }], 'campaign_id,person_id');
    },
    async audit(entry) {
      const res = await fetch(`${base}/prospect_audit`, {
        method: 'POST', headers: { ...H, Prefer: 'return=minimal' },
        body: JSON.stringify([{ org_id: entry.orgId, person_id: entry.personId, event_type: entry.eventType, payload: entry.payload }]),
      });
      if (!res.ok) throw new Error(`audit ${res.status}: ${await res.text()}`);
    },
  };
}
