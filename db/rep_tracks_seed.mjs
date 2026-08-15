// TRU Rep — seed the two launch tracks (data-only; hq_rep_library.sql owns the schema).
// Usage: node rep_tracks_seed.mjs <path-to-secrets.json>   (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
//
// Idempotent: fixed uuids + upsert, safe to re-run. This file is the versioned
// source of truth for which module sits on which track.
import { readFileSync } from 'node:fs';

const secrets = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const BASE = secrets.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1';
const H = {
  apikey: secrets.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: 'Bearer ' + secrets.SUPABASE_SERVICE_ROLE_KEY,
  'Content-Type': 'application/json',
};

const T_ZILL = 'b2222222-2222-2222-2222-222222222222';
const T_FUND = 'b1111111-1111-1111-1111-111111111111';

// Module ids from rep_curriculum.mjs — the shared TRU curriculum (org_id null).
const M0 = 'a0000000-0000-0000-0000-000000000000';  // Welcome to Preferred
const M1 = 'a1111111-1111-1111-1111-111111111111';  // Speed to Lead
const M2 = 'a2222222-2222-2222-2222-222222222222';  // The ALMS Call Framework
const M3 = 'a3333333-3333-3333-3333-333333333333';  // Working a Paid Lead End to End
const M4 = 'a4444444-4444-4444-4444-444444444444';  // Follow-Up Discipline & the CRM
const M5 = 'a5555555-5555-5555-5555-555555555555';  // The Flex Standard

const TRACKS = [
  { id: T_ZILL, org_id: null, slug: 'zillow-preferred-onboarding', order_idx: 1,
    title: 'Zillow Preferred Onboarding',
    subtitle: 'Day 1 — from the connection to a record another agent could take over.',
    active: true },
  { id: T_FUND, org_id: null, slug: 'tru-fundamentals', order_idx: 2,
    title: 'TRU Fundamentals',
    subtitle: 'Speed, the ALMS call, working a paid lead, and telling the CRM the truth.',
    active: true },
];

// The Zillow track starts with only the shared "Welcome to Preferred" module and
// fills out in Phase 3 — see plans/2026-08-14-rep-03-day1-track.md. Fundamentals
// carries the rest of today's curriculum, in course order.
const LINKS = [
  { track_id: T_ZILL, module_id: M0, idx: 1, required: true },
  { track_id: T_FUND, module_id: M1, idx: 1, required: true },
  { track_id: T_FUND, module_id: M2, idx: 2, required: true },
  { track_id: T_FUND, module_id: M3, idx: 3, required: true },
  { track_id: T_FUND, module_id: M4, idx: 4, required: true },
  { track_id: T_FUND, module_id: M5, idx: 5, required: true },
];

// Browse metadata — what the shelf shows before you open anything.
const META = {
  [M0]: { kind: 'lesson', duration_min: 12, level: 'core', tags: ['zillow', 'standards', 'stages'] },
  [M1]: { kind: 'lesson', duration_min: 9, level: 'core', tags: ['speed', 'lead-response'] },
  [M2]: { kind: 'lesson', duration_min: 11, level: 'core', tags: ['alms', 'scripts', 'calls'] },
  [M3]: { kind: 'lesson', duration_min: 9, level: 'core', tags: ['paid-leads', 'pipeline'] },
  [M4]: { kind: 'lesson', duration_min: 8, level: 'core', tags: ['crm', 'follow-up'] },
  [M5]: { kind: 'lesson', duration_min: 8, level: 'core', tags: ['team', 'standards'] },
};

async function must(res, what) {
  if (!res.ok) throw new Error(`${what} ${res.status}: ${await res.text()}`);
}

const tracksRes = await fetch(`${BASE}/rep_tracks?on_conflict=id`, {
  method: 'POST',
  headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify(TRACKS),
});
await must(tracksRes, 'tracks');

const linksRes = await fetch(`${BASE}/rep_track_modules?on_conflict=track_id,module_id`, {
  method: 'POST',
  headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify(LINKS),
});
await must(linksRes, 'links');

let updated = 0;
for (const [id, patch] of Object.entries(META)) {
  const res = await fetch(`${BASE}/rep_modules?id=eq.${id}`, {
    method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(patch),
  });
  await must(res, `module ${id}`);
  updated++;
}

console.log(`tracks: ${TRACKS.length}, links: ${LINKS.length}, modules updated: ${updated}`);
