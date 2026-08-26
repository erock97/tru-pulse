-- Rollback for db/hq_sms_consent.sql — the agent_home() that was live in the
-- TRU-Pulse project immediately before the SMS consent migration was applied on
-- 2026-08-24, captured with pg_get_functiondef.
--
-- Run this alone if the new agent_home() misbehaves. It restores the old shape
-- (no `sms` key), which the Worker already handles: shapeAgentHome() maps a
-- missing key to null and every screen hides the feature. The consent tables and
-- RPCs can stay in place while this runs — nothing else depends on them.
CREATE OR REPLACE FUNCTION public.agent_home()
 RETURNS json
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with me as (select id, name, welcome_seen_at, gated from agents where auth_id = auth.uid() limit 1)
  select json_build_object(
    'agent',           (select json_build_object('id', m.id, 'name', m.name) from me m),
    'welcome_seen_at', (select m.welcome_seen_at from me m),
    'gated',           (select coalesce(m.gated, false) from me m),
    'assessment', (
      select json_build_object('code', s.code, 'personal_code', a.personal_code,
                               'taken_at', s.taken_at)
        from assessments s
        join agents a on a.id = s.agent_id
       where a.id = (select m.id from me m)
       order by s.taken_at desc
       limit 1),
    'commitments', (
      select coalesce(json_agg(json_build_object(
               'id', i.id, 'body', i.body, 'agent_done', i.agent_done,
               'status', i.status, 'created_at', i.created_at)
             order by i.position, i.created_at), '[]'::json)
        from checkin_items i
       where i.agent_id = (select m.id from me m)
         and i.kind = 'commitment'
         and i.status is null),
    'latest_checkin', (
      select max(k.created_at) from checkins k where k.agent_id = (select m.id from me m))
  );
$function$;
revoke execute on function agent_home() from public, anon;
grant  execute on function agent_home() to authenticated;
notify pgrst, 'reload schema';
