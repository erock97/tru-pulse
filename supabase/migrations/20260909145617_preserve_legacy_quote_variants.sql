-- Preserve legacy quote variants without changing immutable reports or receipt contracts.
alter table public.coach_pattern_findings add column quote_conflict boolean not null default false;
alter table public.coach_report_evidence_sources add column quote_variants jsonb not null default '[]';
-- Existing source table remains service-only with RLS enabled.
create or replace function public.coach_receipt_rebuild(p_team uuid) returns void
language plpgsql security invoker set search_path = public,pg_temp as $$
declare rep record; a jsonb; o jsonb; f jsonb; evidence jsonb; pid uuid; touched uuid[]:='{}'; t timestamptz; q text; prior record; latest record; prior_managed boolean;
begin
 delete from public.coach_report_evidence_sources s using public.coach_weekly_reports r where s.report_id=r.id and r.team_id=p_team;
 delete from public.coach_pattern_findings where team_id=p_team;
 for rep in select * from public.coach_weekly_reports where team_id=p_team and status='published' order by coalesce(generated_at,received_at),id loop
  t:=coalesce(rep.generated_at,rep.received_at);
  for a in select value from jsonb_array_elements(coalesce(rep.payload->'agents','[]')) loop
   if lower(regexp_replace(trim(a->>'agentName'),'[^a-zA-Z0-9]+',' ','g'))='eric and adam' then continue; end if;
   for o in select value from jsonb_array_elements(coalesce(a->'opportunityPoints','[]')) loop
    if nullif(o->>'patternKey','') is null then continue; end if;
    select coalesce(jsonb_agg(x),'[]') into evidence from jsonb_array_elements(coalesce(rep.payload->'findings','[]')) x
     where x->>'agentName'=a->>'agentName' and (o->'findingIds') ? (x->>'findingId');
    if jsonb_array_length(evidence)=0 and o ? 'findingIndex' then
     select coalesce(jsonb_agg(x),'[]') into evidence from jsonb_array_elements(coalesce(rep.payload->'findings','[]')) x
      where x->>'agentName'=a->>'agentName' and x->'findingIndex'=o->'findingIndex';
    end if;
    -- A point without durable linked evidence cannot enter the projection.
    if not exists(select 1 from jsonb_array_elements(evidence) x where nullif(x->>'findingId','') is not null) then continue; end if;
    insert into public.coach_patterns(org_id,team_id,agent_name,agent_id,pattern_key,explanation,coaching_move,first_seen_at,last_seen_at,updated_at)
     values(rep.org_id,p_team,a->>'agentName',(rep.agent_links->>(a->>'agentName'))::uuid,o->>'patternKey',o->>'explanation',o->>'coachingMove',t,t,t)
     on conflict(team_id,agent_name,pattern_key) do update set explanation=excluded.explanation,coaching_move=excluded.coaching_move,agent_id=excluded.agent_id,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at
     returning id into pid;
    if not(pid=any(touched)) then update public.coach_patterns set first_seen_at=t where id=pid; touched:=array_append(touched,pid); end if;
    for f in select value from jsonb_array_elements(evidence) loop
     if nullif(f->>'findingId','') is null then continue; end if;
     q:=coalesce(f->>'quote',case when jsonb_array_length(evidence)=1 and o->>'sourceQuality'='verbatim' then o->>'sourceQuote' end);
     select * into prior from public.coach_pattern_findings where pattern_id=pid and finding_id=f->>'findingId';
     if found then
      if prior.occurred_at is distinct from (f->>'occurredAt')::timestamptz or prior.lead_name is distinct from f->>'leadName' or prior.channel is distinct from f->>'channel' then raise exception 'evidence_conflict'; end if;
      if prior.quote_conflict or prior.quote is distinct from q then
       select exists(select 1 from public.coach_report_evidence_sources es join public.coach_weekly_reports wr on wr.id=es.report_id where es.pattern_id=pid and es.finding_id=f->>'findingId' and wr.receipt_managed) into prior_managed;
       if rep.receipt_managed or prior_managed then raise exception 'evidence_conflict'; end if;
       -- Legacy variants describe the same event. Do not select one as truth,
       -- rewrite original reports, or count variants as additional occurrences.
       update public.coach_pattern_findings set quote=null,quote_conflict=true where pattern_id=pid and finding_id=f->>'findingId';
      end if;
     end if;
     insert into public.coach_pattern_findings(pattern_id,finding_id,org_id,team_id,occurred_at,lead_name,lead_url,channel,quote)
      values(pid,f->>'findingId',rep.org_id,p_team,(f->>'occurredAt')::timestamptz,f->>'leadName',f->>'leadUrl',f->>'channel',q) on conflict do nothing;
     insert into public.coach_report_evidence_sources(report_id,pattern_id,finding_id,quote_variants) values(rep.id,pid,f->>'findingId',jsonb_build_array(q))
      on conflict(report_id,pattern_id,finding_id) do update set quote_variants=(select jsonb_agg(distinct v) from jsonb_array_elements(public.coach_report_evidence_sources.quote_variants || excluded.quote_variants) v);
    end loop;
   end loop;
  end loop;
 end loop;
 delete from public.coach_patterns where team_id=p_team and not(id=any(touched));
 select * into latest from public.coach_weekly_reports where team_id=p_team and status='published' order by coalesce(generated_at,received_at) desc,id desc limit 1;
 if found then
  insert into public.coach_team_state(team_id,org_id,last_run_id,window_start,window_end,generated_at,accepted_at)
  values(p_team,latest.org_id,latest.run_id,latest.week_start,latest.week_end,latest.generated_at,coalesce(latest.generated_at,latest.received_at))
  on conflict(team_id) do update set last_run_id=excluded.last_run_id,window_start=excluded.window_start,window_end=excluded.window_end,generated_at=excluded.generated_at,accepted_at=excluded.accepted_at;
 else delete from public.coach_team_state where team_id=p_team; end if;
end $$;

