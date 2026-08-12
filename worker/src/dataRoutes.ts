// Data the browser used to fetch straight from Supabase, now fetched here — as the
// user, so row-level security still decides what they can see.
//
// Response shapes match what the web app already expects, so switching a caller over
// is a one-line change on the client and the UI is none the wiser.
import type { Env } from './env.js';
import { readCookie } from './session.js';
import { supabaseAsUser } from './asUser.js';

// Ids come from the query string, so validate the shape before it reaches a
// PostgREST filter. Filters AND together so an id can't be widened to another
// tenant's row, but a malformed one could still override `select`.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LEAD_COLS = 'team_id,assigned_to,flag,source_family,name,stage,fub_person_id,fub_created,pond';
const STAGE_LOG_COLS = 'fub_person_id,stage_class,changed_at,date_source,agent_user_id,agent_name,team_id';
const SETTINGS_COLS =
  'org_id,avg_gci,close_rate,window_hours,strike_limit,per_agent_capacity,sources,' +
  'pause_volume_on,pause_volume_leads,pause_no_close_on,pause_no_close_leads,pause_no_close_since';

const json = (obj: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json', ...headers },
  });

export async function handleDataRoutes(
  req: Request,
  env: Env,
  url: URL,
  cors: Record<string, string>,
  originOk = true,
): Promise<Response | null> {
  if (!url.pathname.startsWith('/data/')) return null;

  const db = await supabaseAsUser(env, readCookie(req));
  if (!db) return json({ error: 'not signed in' }, 401, cors);

  // ── Everything the Pulse dashboard needs, in one round trip. ──
  // The browser previously made eight calls (two of them paged); doing it here also
  // removes eight cross-origin round trips from a phone on a bad connection.
  if (url.pathname === '/data/dashboard' && req.method === 'GET') {
    const sinceIso = new Date(Date.now() - 30 * 86400_000).toISOString();
    const [teams, settings, leads, cases, agents, deals, stageLog] = await Promise.all([
      db.select('teams', 'select=id,name,fub_subdomain'),
      // org_id is selected so a later save can name the exact row that was read, and
      // the order makes "the first row" deterministic — without it a user in more than
      // one org could be shown a different org's numbers from one load to the next.
      db.select('org_settings', `select=${SETTINGS_COLS}&order=org_id.asc&limit=1`),
      db.selectAll('leads', LEAD_COLS, 'fub_person_id.asc'),
      db.select('accountability_cases', `select=assigned_to,status,opened_at&opened_at=gte.${sinceIso}`),
      db.select('agents', 'select=id,name,email,phone,is_paused,pause_reason,pause_note,paused_at'),
      db.select('deals', 'select=team_id,stage,stage_class,price,commission,agent_name,fub_person_id,projected_close,fub_created'),
      db.selectAll('person_stage_log', STAGE_LOG_COLS, 'fub_person_id.asc'),
    ]);

    return json({
      teams,
      settings: (settings as unknown[])[0] ?? null,
      leads,
      cases,
      agents,
      deals,
      stageLog,
    }, 200, cors);
  }


  // ── Coach: the roster behind loadRoster(). ──
  // Keeps the nested select the browser used (assessments + checkins embedded), so the
  // response maps 1:1 onto RosterAgent and the client change is one line. personal_code
  // is fetched separately because the column may not exist on older databases — the
  // browser treated that as best-effort and so do we.
  if (url.pathname === '/data/coach/roster' && req.method === 'GET') {
    const [agents, pcodes] = await Promise.all([
      db.select(
        'agents',
        'select=id,team_id,token,name,email,phone,created_at,coaching_enabled,' +
        'assessments(code,taken_at),checkins(created_at,met,leads,convos,focus)' +
        '&order=created_at.asc',
      ),
      db.select('agents', 'select=id,personal_code'),
    ]);
    return json({ agents, pcodes }, 200, cors);
  }

  // ── Coach: one agent's check-in history with its structured children. ──
  // The browser made three round trips (checkins, then items and leader by id list).
  // Doing it here is one trip and cannot fetch children for a checkin the caller
  // couldn't see, because every query runs under their own policies.
  if (url.pathname === '/data/coach/checkins' && req.method === 'GET') {
    const agentId = url.searchParams.get('agentId') ?? '';
    if (!UUID_RE.test(agentId)) return json({ error: 'invalid agentId' }, 422, cors);

    const checkins = await db.select<{ id: string }>(
      'checkins', `select=*&agent_id=eq.${agentId}&order=created_at.desc`,
    );
    if (checkins.length === 0) return json({ checkins: [], items: [], leader: [] }, 200, cors);
    const ids = checkins.map((c) => c.id).join(',');
    const [items, leader] = await Promise.all([
      db.select('checkin_items', `select=*&checkin_id=in.(${ids})&order=position.asc`),
      db.select('checkin_leader', `select=*&checkin_id=in.(${ids})`),
    ]);
    return json({ checkins, items, leader }, 200, cors);
  }


  // ── Rep: the leader's certification board (loadRep). ──
  if (url.pathname === '/data/rep/board' && req.method === 'GET') {
    const [modules, questions, progress, agents, practice] = await Promise.all([
      // `active` is the runtime switch, `status` the authoring lifecycle — both must
      // read live, same belt-and-suspenders filter the browser used.
      db.select('rep_modules', 'select=id,idx,title,summary,body,pass_pct,cards&active=eq.true&status=eq.published&order=idx.asc'),
      db.select('rep_questions_public', 'select=module_id'),
      db.select('rep_progress', 'select=agent_id,module_id,status,score,passed_at,signed_off_at'),
      db.select('agents', 'select=id,name,email,auth_id&excluded=eq.false&order=name.asc'),
      db.select('rep_practice', 'select=agent_id,scenario,status,score,passed,created_at'),
    ]);
    return json({ modules, questions, progress, agents, practice }, 200, cors);
  }

  // ── Rep: one agent's own course view (loadCourse). ──
  // Questions come from rep_questions_public, which exposes prompt and choices but
  // NOT the answer — that stays server-side so the course can't be read for answers.
  if (url.pathname === '/data/rep/course' && req.method === 'GET') {
    const agentId = url.searchParams.get('agentId') ?? '';
    if (!UUID_RE.test(agentId)) return json({ error: 'invalid agentId' }, 422, cors);
    const [modules, questions, progress, practice] = await Promise.all([
      db.select('rep_modules', 'select=id,idx,title,summary,body,pass_pct,cards&active=eq.true&status=eq.published&order=idx.asc'),
      db.select('rep_questions_public', 'select=id,module_id,idx,prompt,choices&order=idx.asc'),
      db.select('rep_progress', `select=module_id,status,score,passed_at,signed_off_at&agent_id=eq.${agentId}`),
      db.select('rep_practice', `select=scenario,status,score,passed,created_at&agent_id=eq.${agentId}&order=created_at.desc`),
    ]);
    return json({ modules, questions, progress, practice }, 200, cors);
  }

  // ── Coach writes ──────────────────────────────────────────────────────────
  // Mutations run under the caller's own token, so Postgres applies WITH CHECK and
  // refuses a write into another tenant's row exactly as it refuses to read one. A
  // refusal is answered 403 — a permission decision, not a server fault — and the
  // route never falls back to the service role to "make it work".
  //
  // Every mutating route also needs a recognised browser Origin (checked in index.ts's
  // caller for /auth; repeated here because /data mutations are equally cookie-driven).
  if (req.method === 'POST' && url.pathname.startsWith('/data/coach/')) {
    if (!originOk) return json({ error: 'origin not allowed' }, 403, cors);
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return json({ error: 'invalid body' }, 422, cors);

    // Goal fields for one agent.
    if (url.pathname === '/data/coach/goal') {
      const agentId = String(body.agentId ?? '');
      if (!UUID_RE.test(agentId)) return json({ error: 'invalid agentId' }, 422, cors);
      const rows = await db.update('goals', `agent_id=eq.${agentId}`, body.fields ?? {});
      if (!rows) return json({ error: 'not allowed' }, 403, cors);
      return json({ goal: rows[0] ?? null }, 200, cors);
    }

    // Add / update / toggle / delete a commitment.
    if (url.pathname === '/data/coach/commitment') {
      const action = String(body.action ?? '');
      if (action === 'add') {
        const agentId = String(body.agentId ?? '');
        if (!UUID_RE.test(agentId)) return json({ error: 'invalid agentId' }, 422, cors);
        const rows = await db.insert('commitments', body.row ?? {});
        if (!rows) return json({ error: 'not allowed' }, 403, cors);
        return json({ commitment: rows[0] ?? null }, 200, cors);
      }
      const id = String(body.id ?? '');
      if (!UUID_RE.test(id)) return json({ error: 'invalid id' }, 422, cors);
      if (action === 'update' || action === 'toggle') {
        const rows = await db.update('commitments', `id=eq.${id}`, body.fields ?? {});
        if (!rows) return json({ error: 'not allowed' }, 403, cors);
        return json({ commitment: rows[0] ?? null }, 200, cors);
      }
      if (action === 'delete') {
        const ok = await db.remove('commitments', `id=eq.${id}`);
        return ok ? json({ ok: true }, 200, cors) : json({ error: 'not allowed' }, 403, cors);
      }
      return json({ error: 'unknown action' }, 422, cors);
    }

    // Log a structured 1:1. Stays an RPC because it writes the check-in plus its items
    // and leader note in one transaction — splitting it here could leave a half-saved
    // 1:1, which is worse than the round trip it would save.
    if (url.pathname === '/data/coach/checkin') {
      const { ok, data } = await db.rpc('log_structured_checkin', body.args ?? {});
      if (!ok) return json({ error: 'not allowed' }, 403, cors);
      return json({ result: data }, 200, cors);
    }

    // Pause / coaching toggles. Both database functions already check the caller's org
    // role themselves (has_org_role / is_org_member) and raise if it fails, so a
    // refusal surfaces as ok:false rather than a silent no-op.
    if (url.pathname === '/data/coach/agent-flags') {
      const agentId = String(body.agentId ?? '');
      if (!UUID_RE.test(agentId)) return json({ error: 'invalid agentId' }, 422, cors);
      if (body.pause !== undefined) {
        const { ok } = await db.rpc('set_agent_pause', {
          p_agent_id: agentId, p_is_paused: !!body.pause,
          p_reason: body.reason ?? null, p_note: body.note ?? null,
        });
        if (!ok) return json({ error: 'not allowed' }, 403, cors);
      }
      if (body.coaching !== undefined) {
        const { ok } = await db.rpc('set_coaching', { p_agent_id: agentId, p_on: !!body.coaching });
        if (!ok) return json({ error: 'not allowed' }, 403, cors);
      }
      return json({ ok: true }, 200, cors);
    }

    return json({ error: 'not found' }, 404, cors);
  }

  return json({ error: 'not found' }, 404, cors);
}
