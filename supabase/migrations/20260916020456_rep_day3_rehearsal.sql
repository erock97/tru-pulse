-- Extend the existing admin-only, empty-roster rehearsal to Day 3.
-- Preserve all validation, privileges, and evidence storage in the live function.
do $migration$
declare definition text;
begin
  select pg_get_functiondef('public.rep_live_rehearse(uuid,uuid,text,jsonb)'::regprocedure) into definition;
  if position('s.day<>2' in definition) > 0 then
    execute replace(definition, 's.day<>2', 's.day not in (2,3)');
  elsif position('s.day not in (2,3)' in definition) = 0 then
    raise exception 'Unexpected rehearsal day guard; inspect before changing';
  end if;
end $migration$;
