-- Permit an administrator to rehearse the real hosted session without learners.
-- Patch only the two create-path expressions, preserving other deployed logic and grants.
do $migration$
declare definition text;
 old_guard text := $old$if jsonb_array_length(p_body->'participants') not between 1 and 100 then raise exception 'Choose 1 to 100 participants'; end if;$old$;
 new_guard text := $new$if jsonb_typeof(p_body->'participants') is distinct from 'array' then raise exception 'Choose a participant list'; end if;
  if jsonb_array_length(p_body->'participants') > 100 then raise exception 'Choose up to 100 participants'; end if;$new$;
 old_title text := $old$p_body->'definition'->>'title',p_body->'definition'->>'version'$old$;
 new_title text := $new$(case when roster='[]'::jsonb then 'Test · ' else '' end)||(p_body->'definition'->>'title'),p_body->'definition'->>'version'$new$;
begin
 select pg_get_functiondef('public.rep_live_mutate(uuid,uuid,text,jsonb)'::regprocedure) into definition;
 if position(old_guard in definition)=0 or position(old_title in definition)=0 then
  raise exception 'Session create function changed; review solo-test migration before applying';
 end if;
 execute replace(replace(definition,old_guard,new_guard),old_title,new_title);
end $migration$;
