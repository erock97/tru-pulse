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
  expect((await db.query("select relrowsecurity from pg_class where relname in ('teams','leads')")).rows).toEqual([{relrowsecurity:true},{relrowsecurity:true}]);
 }finally{await db.close();}
},20000);
