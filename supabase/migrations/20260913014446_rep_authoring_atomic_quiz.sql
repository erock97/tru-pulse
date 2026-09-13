-- Apply before deploying the updated Rep authoring Worker. No existing course
-- rows or certification records are changed. Only the Worker may call this RPC.
create or replace function public.rep_replace_custom_questions(
  p_module_id uuid, p_org_id uuid, p_questions jsonb
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  m public.rep_modules%rowtype;
  q jsonb;
  saved jsonb;
begin
  select * into m from public.rep_modules where id = p_module_id for update;
  if not found or m.source is distinct from 'custom' or m.org_id is distinct from p_org_id then
    raise exception 'Custom module unavailable';
  end if;
  if m.status is distinct from 'draft' then
    raise exception 'Save the module as a draft before changing its quiz';
  end if;
  if p_questions is null or jsonb_typeof(p_questions) <> 'array' then
    raise exception 'questions[] required';
  end if;
  for q in select value from jsonb_array_elements(p_questions) loop
    if jsonb_typeof(q->'prompt') is distinct from 'string' or btrim(q->>'prompt') = ''
      or jsonb_typeof(q->'choices') is distinct from 'array' then
      raise exception 'Each question needs a prompt and choices';
    end if;
    if jsonb_array_length(q->'choices') < 2 or exists (
      select 1 from jsonb_array_elements(q->'choices') c
      where jsonb_typeof(c) <> 'string' or btrim(c #>> '{}') = ''
    ) then raise exception 'Each question needs at least two nonblank choices'; end if;
    if jsonb_typeof(q->'answer') is distinct from 'number'
      or (q->>'answer') !~ '^[0-9]+$' then
      raise exception 'Each question needs a valid answer index';
    end if;
    if (q->>'answer')::numeric >= jsonb_array_length(q->'choices') then
      raise exception 'Each question needs a valid answer index';
    end if;
  end loop;
  -- One transaction: an insert error rolls the delete back too. The module lock
  -- serializes this operation with publication and other quiz replacements.
  delete from public.rep_questions where module_id = p_module_id;
  insert into public.rep_questions(module_id,idx,prompt,choices,answer,explain)
  select p_module_id, n::int, btrim(items.q->>'prompt'), items.q->'choices',
    (items.q->>'answer')::int, items.q->>'explain'
  from jsonb_array_elements(p_questions) with ordinality as items(q,n);
  select coalesce(jsonb_agg(to_jsonb(r) order by r.idx),'[]'::jsonb) into saved
  from (select id,idx,prompt,choices,answer,explain from public.rep_questions
    where module_id = p_module_id) r;
  return jsonb_build_object('count',jsonb_array_length(saved),'questions',saved);
end;
$$;
revoke all on function public.rep_replace_custom_questions(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.rep_replace_custom_questions(uuid,uuid,jsonb) to service_role;

-- Protect the list's Publish shortcut and direct API callers as well as the
-- editor. Existing system curriculum and its certification thresholds stay as-is.
create or replace function public.rep_check_custom_publication() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.source = 'custom' and new.status = 'published' then
    if new.pass_pct is null or new.pass_pct < 1 or new.pass_pct > 100 then
      raise exception 'Pass percentage must be between 1 and 100';
    end if;
    if not exists(select 1 from public.rep_questions where module_id = new.id) then
      raise exception 'Add a quiz before publishing';
    end if;
    if exists(select 1 from public.rep_questions q where q.module_id = new.id and (
      btrim(q.prompt) = '' or jsonb_typeof(q.choices) <> 'array'
      or case when jsonb_typeof(q.choices) = 'array' then
        jsonb_array_length(q.choices) < 2 or q.answer < 0 or q.answer >= jsonb_array_length(q.choices)
        or exists(select 1 from jsonb_array_elements(q.choices) c
          where jsonb_typeof(c) <> 'string' or btrim(c #>> '{}') = '')
      else true end
    )) then raise exception 'Repair the quiz before publishing'; end if;
  end if;
  return new;
end;
$$;
revoke all on function public.rep_check_custom_publication() from public,anon,authenticated;
drop trigger if exists rep_custom_publication_check on public.rep_modules;
create trigger rep_custom_publication_check before insert or update on public.rep_modules
for each row execute function public.rep_check_custom_publication();
