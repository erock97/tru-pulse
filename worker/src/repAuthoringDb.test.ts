import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {beforeAll,afterAll,beforeEach,describe,it,expect} from 'vitest';

let pg: PGlite;
const org = '00000000-0000-4000-8000-000000000001';
const moduleId = '00000000-0000-4000-8000-000000000002';
const question = {prompt:'QA question',choices:['One','Two'],answer:0};
const replace = (questions: unknown, orgId = org) => pg.query(
  'select public.rep_replace_custom_questions($1,$2,$3::jsonb) as result',
  [moduleId,orgId,JSON.stringify(questions)],
);
const publish = () => pg.exec("update rep_modules set status='published',active=true");

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create table rep_modules(id uuid primary key,org_id uuid,source text,status text,pass_pct int,active boolean);
    create table rep_questions(id uuid primary key default gen_random_uuid(),module_id uuid references rep_modules(id),
      idx int not null,prompt text not null,choices jsonb not null,answer int not null,explain text);
    grant usage on schema public to service_role;
    grant all on rep_modules,rep_questions to service_role;`);
  await pg.exec(readFileSync(new URL('../../supabase/migrations/20260913014446_rep_authoring_atomic_quiz.sql',import.meta.url),'utf8'));
},30000);
afterAll(async () => { await pg.close(); });
beforeEach(async () => {
  await pg.exec(`truncate rep_questions,rep_modules; insert into rep_modules values
    ('${moduleId}','${org}','custom','draft',80,false);`);
});

describe('custom course publication and quiz transactions', () => {
  it('preserves the original quiz when replacement insertion fails after deletion', async () => {
    await replace([question]);
    const original = (await pg.query('select * from rep_questions')).rows;
    await pg.exec("alter table rep_questions add constraint qa_failure check (prompt <> 'FAIL INSERT')");
    try {
      await expect(replace([{...question,prompt:'FAIL INSERT'}])).rejects.toThrow('qa_failure');
      expect((await pg.query('select * from rep_questions')).rows).toEqual(original);
    } finally { await pg.exec('alter table rep_questions drop constraint qa_failure'); }
  });
  it('prevents an empty quiz from being published through the list shortcut', async () => {
    await expect(publish()).rejects.toThrow('Add a quiz');
    await replace([question]); await publish();
    expect((await pg.query('select status from rep_modules')).rows[0]).toEqual({status:'published'});
    await expect(replace([])).rejects.toThrow('draft');
  });
  it.each([
    {...question,answer:2}, {...question,answer:-1}, {...question,answer:0.5},
    {...question,choices:['One',' ']}, {...question,prompt:' '}, {...question,choices:'invalid'},
  ])('rejects malformed quiz content without changing the existing questions: %j',async invalid => {
    await replace([question]); await expect(replace([invalid])).rejects.toThrow();
    expect((await pg.query('select prompt from rep_questions')).rows).toEqual([{prompt:question.prompt}]);
  });
  it('persists an empty draft and normalizes order when replacing all questions', async () => {
    await replace([{...question,idx:100},{...question,prompt:'Second',idx:100}]);
    expect((await pg.query('select idx from rep_questions order by idx')).rows).toEqual([{idx:1},{idx:2}]);
    await replace([]); expect((await pg.query('select * from rep_questions')).rows).toHaveLength(0);
  });
  it('denies browser roles and cross-organization writes', async () => {
    for (const role of ['anon','authenticated']) {
      await pg.exec(`set role ${role}`);
      try { await expect(replace([question])).rejects.toThrow('permission denied'); }
      finally { await pg.exec('reset role'); }
    }
    await expect(replace([question],moduleId)).rejects.toThrow('unavailable');
    await pg.exec('set role service_role');
    try { await replace([question]); await publish(); }
    finally { await pg.exec('reset role'); }
  });
  it('does not change system curriculum publication rules', async () => {
    await pg.exec("update rep_modules set source='system',status='published',active=true");
    await expect(replace([question])).rejects.toThrow('unavailable');
  });
});
