-- ═══════════════════════════════════════════════════════════════════════════
-- hq_agent_pause — manual agent-pause control (leader-set, sole source of
-- truth for "Paused"). Idempotent + additive. Safe to run more than once.
-- Depends on schema.sql (agents table, is_org_member helper).
--
-- Mirrors the exact mechanism hq_coach_assessment.sql uses for the
-- coaching_enabled toggle: plain columns on `agents` + a SECURITY DEFINER
-- RPC gated by is_org_member(org_id) (agents has no direct-UPDATE RLS
-- policy for `authenticated` — schema.sql's agents_org_read is SELECT-only —
-- so writes go through the RPC, exactly like set_coaching()).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── New columns on agents ──
alter table agents add column if not exists is_paused    boolean not null default false;
alter table agents add column if not exists pause_reason text;    -- at_capacity | no_closings | on_leave | coaching | other (code; UI maps to labels)
alter table agents add column if not exists pause_note   text;    -- free text, used when pause_reason = 'other'
alter table agents add column if not exists paused_at    timestamptz;
alter table agents add column if not exists paused_by    uuid references auth.users(id) on delete set null;

create index if not exists agents_paused_idx on agents (team_id) where is_paused;

-- Leader/admin sets or clears manual pause for an agent in their own org.
-- Pausing stops an agent's lead flow — a consequential operational action — so
-- this is gated to admins/leaders (has_org_role), STRICTER than set_coaching()'s
-- plain is_org_member gate. Coaches/other members cannot pause an agent.
create or replace function set_agent_pause(
  p_agent_id uuid, p_is_paused boolean, p_reason text, p_note text
) returns void language plpgsql security definer set search_path = public as $$
begin
  update agents set
    is_paused    = p_is_paused,
    pause_reason = case when p_is_paused then p_reason else null end,
    pause_note   = case when p_is_paused then p_note   else null end,
    paused_at    = case when p_is_paused then now()    else null end,
    paused_by    = case when p_is_paused then auth.uid() else null end
  where id = p_agent_id
    and (has_org_role(org_id, 'admin') or has_org_role(org_id, 'leader'));
  if not found then raise exception 'not authorized for this agent'; end if;
end $$;
grant execute on function set_agent_pause(uuid, boolean, text, text) to authenticated;
