import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
let pg: PGlite;
const agent = '00000000-0000-4000-8000-000000000001', user = '00000000-0000-4000-8000-000000000002';
const other = '00000000-0000-4000-8000-000000000003', leader = '00000000-0000-4000-8000-000000000004';
const role = (who: string) => pg.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${who}',false);`);
const save = (id = agent, name = 'Rachel Ortiz') => pg.query('select public.set_agent_display_name($1,$2) name', [id, name]);
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`create role authenticated; create role anon; create role service_role; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon;
    create table agents(id uuid primary key, auth_id uuid, org_id uuid, name text, email text);
    create function public.has_org_role(org uuid, role text) returns boolean language sql stable as $$select auth.uid()='${leader}'::uuid and org='${agent}'::uuid and role='leader'$$;
    alter table agents enable row level security;
    grant select on agents to authenticated;
    create policy agents_read on agents for select to authenticated using(auth_id=auth.uid() or public.has_org_role(org_id,'leader'));
    insert into agents values('${agent}','${user}','${agent}','Rachel Ortez','rachel4410@icloud.com'),('${other}','${other}','${other}','Another Agent','other@example.com');`);
  await pg.exec(readFileSync(new URL('../../supabase/migrations/20260916000615_agent_display_names.sql', import.meta.url), 'utf8'));
}, 30000);
afterAll(async () => { await pg.close(); });
beforeEach(async () => { await pg.exec('reset role; truncate agent_display_names;'); await role(user); });
it('agent saves and updates own name while source identity stays unchanged', async () => {
  await save(); expect((await save(agent, 'Rachel Ortiz Smith')).rows).toEqual([{ name: 'Rachel Ortiz Smith' }]);
  expect((await pg.query('select name,email from agents')).rows).toEqual([{ name: 'Rachel Ortez', email: 'rachel4410@icloud.com' }]);
});
it('rejects another agent and cross-organization leader writes', async () => {
  await expect(save(other)).rejects.toThrow('row-level security');
  await role(leader); await save(); await expect(save(other)).rejects.toThrow('row-level security');
});
it('hides names from other agents and rejects reassignment and direct invalid writes', async () => {
  await save();
  await expect(pg.exec(`update agent_display_names set agent_id='${other}'`)).rejects.toThrow('row-level security');
  await expect(save(agent, '   ')).rejects.toThrow();
  await role(other); expect((await pg.query('select * from agent_display_names')).rows).toEqual([]);
});
it('anonymous clients cannot read or invoke name updates', async () => {
  await pg.exec('reset role; set role anon;');
  await expect(save()).rejects.toThrow('permission denied');
  await expect(pg.query('select * from agent_display_names')).rejects.toThrow('permission denied');
});
