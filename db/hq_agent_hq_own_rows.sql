-- TRU HQ — Agent HQ own-row policies (PROPOSAL)
-- ═══════════════════════════════════════════════════════════════════════════
-- STATUS: PROPOSAL ONLY — do not apply as a side effect of this code change.
-- Eric reviews and runs it in the SQL Editor when he is ready.
--
-- Why: signed-in agents already have assessments_agent_self and
-- commitments_agent_self (db/hq_coach.sql). They can READ their 1:1
-- commitments via checkin_items_agent_read, but that policy is SELECT-only,
-- so ticking a 1:1 commitment off is refused. They also cannot UPDATE their
-- own agents.personal_code after finishing the assessment inside HQ
-- (agents_self_read is SELECT-only).
--
-- Smallest own-row policies. No leader data. No checkin_leader access.
-- ═══════════════════════════════════════════════════════════════════════════

-- Agent may mark their own 1:1 commitments done (checkin_items.status).
drop policy if exists checkin_items_agent_own_update on checkin_items;
create policy checkin_items_agent_own_update on checkin_items
  for update to authenticated
  using (agent_id in (select id from agents where auth_id = auth.uid()))
  with check (agent_id in (select id from agents where auth_id = auth.uid()));

-- Agent may write their own personal_code / personal_axes after the Assess flow.
drop policy if exists agents_self_update on agents;
create policy agents_self_update on agents
  for update to authenticated
  using (auth_id = auth.uid())
  with check (auth_id = auth.uid());
