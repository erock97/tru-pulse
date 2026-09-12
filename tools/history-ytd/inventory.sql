-- Read-only inventory. Never export team_secrets values, agent tokens, or emails.
select jsonb_build_object(
 'checkedAt',now(),
 'teams',(select jsonb_agg(jsonb_build_object(
  'id',t.id,'org_id',t.org_id,'name',t.name,'fub_subdomain',t.fub_subdomain,
  'is_active',t.is_active,'org_status',o.status,'has_key',s.fub_key_enc is not null,
  'key_updated_at',s.updated_at,'last_sync_at',ss.last_sync_at))
  from teams t join orgs o on o.id=t.org_id left join team_secrets s on s.team_id=t.id
  left join sync_state ss on ss.team_id=t.id),
 'profiles',(select jsonb_agg(jsonb_build_object('id',id,'team_id',team_id,'org_id',org_id,
  'fub_user_id',fub_user_id,'excluded',excluded)) from agents)
) as inventory;
