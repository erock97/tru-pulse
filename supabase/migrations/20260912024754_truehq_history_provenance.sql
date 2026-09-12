-- Canonical event evidence is private. Existing person_stage_log remains the
-- compatibility milestone projection, not the source event store.
create table public.history_accounts (
 account_id bigint primary key,
 team_id uuid not null unique references public.teams(id),
 org_id uuid not null references public.orgs(id),
 domain text not null,
 verified_at timestamptz not null,
 unique(account_id,team_id,org_id)
);
create table public.history_stage_events (
 account_id bigint not null,
 team_id uuid not null,
 org_id uuid not null,
 person_id bigint not null,
 upstream_kind text not null check(upstream_kind in ('ChangeLog','peopleStageUpdated')),
 upstream_id text not null,
 occurred_at timestamptz not null,
 original_timestamp text not null,
 from_stage text,
 to_stage text not null,
 evidence jsonb not null,
 captured_at timestamptz not null default now(),
 primary key(account_id,person_id,upstream_kind,upstream_id),
 foreign key(account_id,team_id,org_id) references public.history_accounts(account_id,team_id,org_id)
);
create table public.history_receipts (
 account_id bigint not null references public.history_accounts(account_id),
 person_id bigint not null,
 content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
 captured_at timestamptz not null,
 source_raw text,
 source_policy text not null,
 parser_version text not null,
 provenance jsonb not null,
 primary key(account_id,person_id,content_hash)
);
create table public.history_jobs (
 id uuid primary key default gen_random_uuid(),
 account_id bigint not null references public.history_accounts(account_id),
 from_at timestamptz not null,
 cutoff timestamptz not null,
 source_policy text not null,
 state text not null default 'planned' check(state in ('planned','collecting','partial','validated','published','failed')),
 census_complete boolean not null default false,
 expected_people bigint,
 unresolved_people bigint,
 profile_dispositions jsonb not null default '[]',
 failures jsonb not null default '[]',
 lease_owner text,
 lease_until timestamptz,
 created_at timestamptz not null default now(),
 check(from_at < cutoff),
 unique(account_id,from_at,cutoff,source_policy)
);
create table public.history_coverage (
 job_id uuid not null references public.history_jobs(id),
 person_id bigint not null,
 from_at timestamptz not null,
 through_at timestamptz not null,
 content_hash text not null,
 pagination_complete boolean not null default false,
 state text not null check(state in ('collected','validated','published','failed')),
 attempt_count integer not null default 0,
 failure_reason text,
 captured_at timestamptz not null,
 primary key(job_id,person_id,from_at,through_at,content_hash),
 check(from_at < through_at),
 check(state not in ('validated','published') or pagination_complete)
);
create table public.history_snapshot_versions (
 version_id text primary key check(version_id ~ '^[a-f0-9]{64}$'),
 job_id uuid not null references public.history_jobs(id),
 org_id uuid not null references public.orgs(id),
 team_id uuid not null references public.teams(id),
 snapshot jsonb not null,
 created_at timestamptz not null default now()
);
create table public.history_publications (
 id bigint generated always as identity primary key,
 team_id uuid not null references public.teams(id),
 version_id text not null references public.history_snapshot_versions(version_id),
 previous_version_id text references public.history_snapshot_versions(version_id),
 legacy_rollback_key text,
 published_at timestamptz not null default now()
);
create index history_stage_events_window on public.history_stage_events(team_id,occurred_at);
create index history_publications_latest on public.history_publications(team_id,id desc);

alter table public.history_accounts enable row level security;
alter table public.history_stage_events enable row level security;
alter table public.history_receipts enable row level security;
alter table public.history_jobs enable row level security;
alter table public.history_coverage enable row level security;
alter table public.history_snapshot_versions enable row level security;
alter table public.history_publications enable row level security;
revoke all on public.history_accounts,public.history_stage_events,public.history_receipts,
 public.history_jobs,public.history_coverage,public.history_snapshot_versions,public.history_publications from public,anon,authenticated;
grant select,insert,update on public.history_accounts,public.history_stage_events,public.history_receipts,
 public.history_jobs,public.history_coverage,public.history_snapshot_versions,public.history_publications to service_role;
grant usage,select on sequence public.history_publications_id_seq to service_role;

-- An import batch is atomic. A reused ID with different evidence is a failure,
-- never a silent overwrite. Parser version is deliberately absent from identity.
create function public.history_import_events(p_account_id bigint,p_team_id uuid,p_org_id uuid,p_events jsonb)
returns integer language plpgsql security invoker set search_path=public,pg_temp as $$
declare e jsonb; old public.history_stage_events; n integer := 0;
begin
 if not exists(select 1 from history_accounts a join teams t on t.id=a.team_id and t.org_id=a.org_id
  where a.account_id=p_account_id and a.team_id=p_team_id and a.org_id=p_org_id) then raise exception 'History account scope mismatch'; end if;
 if jsonb_typeof(p_events)<>'array' or jsonb_array_length(p_events)>500 then raise exception 'Invalid import batch'; end if;
 perform pg_advisory_xact_lock(p_account_id);
 for e in select value from jsonb_array_elements(p_events) loop
  select * into old from history_stage_events where account_id=p_account_id and person_id=(e->>'personId')::bigint
   and upstream_kind=e->>'kind' and upstream_id=e->>'upstreamId';
  if found then
   if old.evidence<>e then raise exception 'Conflicting source event identity'; end if;
  else
   if e->>'accountId' is distinct from p_account_id::text or e->>'teamId' is distinct from p_team_id::text or e->>'orgId' is distinct from p_org_id::text then raise exception 'Event identity mismatch'; end if;
   if coalesce(e->>'occurredAt','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'Event timestamp requires offset'; end if;
   insert into history_stage_events(account_id,team_id,org_id,person_id,upstream_kind,upstream_id,occurred_at,original_timestamp,from_stage,to_stage,evidence)
    values(p_account_id,p_team_id,p_org_id,(e->>'personId')::bigint,e->>'kind',e->>'upstreamId',(e->>'occurredAt')::timestamptz,e->>'occurredAt',e->>'from',e->>'to',e);
   n:=n+1;
  end if;
 end loop;
 return n;
end $$;
revoke all on function public.history_import_events(bigint,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.history_import_events(bigint,uuid,uuid,jsonb) to service_role;
