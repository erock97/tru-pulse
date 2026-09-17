import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
it('applies the additive migration twice without changing data or existing RLS',async()=>{
 const db=new PGlite();
 try{
  await db.exec("create table leads(id int primary key,stage text,assigned_to text); create table teams(id int primary key,name text); alter table leads enable row level security; alter table teams enable row level security; insert into leads values(1,'Nurture','Agent'); insert into teams values(1,'Team');");
  const migration=readFileSync(new URL('../../supabase/migrations/20260916190216_pulse_pipeline.sql',import.meta.url),'utf8');
  await db.exec(migration);await db.exec(migration);
  expect((await db.query('select * from leads')).rows).toEqual([{id:1,stage:'Nurture',assigned_to:'Agent',stage_id:null,assigned_user_id:null,assigned_pond_id:null}]);
  expect((await db.query('select pipeline_stage_mappings from teams')).rows).toEqual([{pipeline_stage_mappings:{}}]);
  const values=readFileSync(new URL('../../supabase/migrations/20260916230059_pipeline_inquiry_values.sql',import.meta.url),'utf8');
  await db.exec(values);await db.exec(values);
  expect((await db.query('select pipeline_inquiry_value from leads')).rows).toEqual([{pipeline_inquiry_value:null}]);
  await db.exec("alter table leads add column synced_at timestamptz; update leads set stage='Met with customer',synced_at='2026-08-01T12:00:00Z';");
  const observations=readFileSync(new URL('../../supabase/migrations/20260917001151_pipeline_observed_stages.sql',import.meta.url),'utf8');
  await db.exec(observations);await db.exec(observations);
  await db.exec("update leads set stage='Trash',synced_at='2026-09-16T12:00:00Z'; update leads set stage='Met with customer',synced_at='2026-09-17T12:00:00Z'; update leads set stage='Nurture',synced_at='2026-09-18T12:00:00Z';");
  const retained=(await db.query<{pipeline_observed_stages:Record<string,string>}>('select pipeline_observed_stages from leads')).rows[0].pipeline_observed_stages;
  expect(new Date(retained['Met with customer']).toISOString()).toBe('2026-08-01T12:00:00.000Z');
  expect((await db.query("select relrowsecurity from pg_class where relname in ('teams','leads')")).rows).toEqual([{relrowsecurity:true},{relrowsecurity:true}]);
 }finally{await db.close();}
},20000);
