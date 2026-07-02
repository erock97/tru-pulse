-- ═══════════════════════════════════════════════════════════════════════════
-- TRU Rep — Phase B: agent logins + take-the-course flow
-- ═══════════════════════════════════════════════════════════════════════════
-- Run in the TRU-Pulse (HQ backbone) SQL Editor. Additive + idempotent.
-- Adds: agent self-read on their own agents row; agent self-read on their own
-- rep_progress; a claim RPC that links a fresh login to an agent by verified
-- email; and an answer-less view of quiz questions so correct answers never
-- reach the browser (the Worker grades server-side with the service role).

-- ── 1. Agent reads their OWN agents row ──────────────────────────────────────
-- Agents aren't org members, so the existing is_org_member policies don't let
-- them see themselves. This does (auth_id = auth.uid()). Additive to the
-- existing agents_org_read / agents_org_write policies (RLS is OR-of-policies).
drop policy if exists agents_self_read on agents;
create policy agents_self_read on agents for select to authenticated
  using (auth_id = auth.uid());

-- ── 2. Agent reads their OWN rep_progress ────────────────────────────────────
-- SELECT only — the agent never writes progress directly (that goes through the
-- Worker so a pass can't be forged). The leader policy rep_progress_org stays.
drop policy if exists rep_progress_agent_self on rep_progress;
create policy rep_progress_agent_self on rep_progress for select to authenticated
  using (agent_id in (select id from agents where auth_id = auth.uid()));

-- ── 3. Claim: link this login to an agent row by verified email ──────────────
-- Called once on the agent's first authenticated load. Safe: a user can only
-- ever match the agents row carrying THEIR OWN verified JWT email, and only
-- when it isn't already linked. Mirrors my_agent_token().
create or replace function claim_agent()
returns uuid language plpgsql security definer set search_path = public as $$
declare aid uuid;
begin
  update agents
     set auth_id = auth.uid()
   where auth_id is null
     and email is not null
     and lower(email) = lower(auth.jwt() ->> 'email')
  returning id into aid;
  if aid is null then
    -- already linked (or no match) → return the existing link if any
    select id into aid from agents where auth_id = auth.uid() limit 1;
  end if;
  return aid;
end $$;
grant execute on function claim_agent() to authenticated;

-- ── 4. Answer-hiding: questions without the correct answer ───────────────────
-- Drop the client read policy on the base table so `answer`/`explain` are never
-- readable with the anon key, then expose a definer view with only the fields a
-- learner needs. The view runs with owner rights (bypasses base RLS) but carries
-- the same module-visibility predicate; the Worker still reads the base table
-- with the service role to grade.
drop policy if exists rep_questions_read on rep_questions;

create or replace view rep_questions_public
with (security_invoker = false) as
  select q.id, q.module_id, q.idx, q.prompt, q.choices
    from rep_questions q
    join rep_modules m on m.id = q.module_id
   where m.active
     and (m.org_id is null or is_org_member(m.org_id));

grant select on rep_questions_public to anon, authenticated;

notify pgrst, 'reload schema';
