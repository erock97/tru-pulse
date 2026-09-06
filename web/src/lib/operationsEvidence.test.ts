import { describe,it,expect } from 'vitest';
import { productionEvidence } from './productionEvidence';
import { reviewEarnings, earningsFields, earnings, strictDate, csvCell } from './earningsImport';
import type { StageLogRow } from './api';
const hit:StageLogRow={team_id:'team',fub_person_id:1,stage_class:'uc',changed_at:'2026-09-03T12:00:00Z',date_source:'live',agent_user_id:1,agent_name:'Agent'};
describe('recorded production',()=>{
  it('counts dated history without needing a newly created lead',()=>expect(productionEvidence([hit],'mtd',new Date('2026-09-05T12:00:00Z')).counts.uc).toBe(1));
  it('deduplicates milestones but keeps tenant identity',()=>expect(productionEvidence([hit,hit,{...hit,team_id:'second'}],'mtd',new Date('2026-09-05T12:00:00Z')).counts.uc).toBe(2));
  it('excludes seeds, missing identities and future events',()=>expect(productionEvidence([{...hit,date_source:'seed'},{...hit,team_id:undefined},{...hit,changed_at:'2027-01-01'}],'mtd',new Date('2026-09-05T12:00:00Z')).records).toHaveLength(0));
});
const mapping=Object.fromEntries(earningsFields.map(k=>[k,k])) as Record<typeof earningsFields[number],string>;
const head=earningsFields.join(',')+'\n';
describe('earnings import',()=>{
  it('calculates brokerage share after referral and does not invent missing expenses',()=>{const r=reviewEarnings(head+'d1,Agent,2026-08-01,10000,2000,30,,Zillow',mapping,'');expect(r.errors).toEqual([]);expect(earnings(r.rows[0])).toEqual({retained:2400,contribution:null});});
  it('uses explicit expense amounts including zero',()=>{const r=reviewEarnings(head+'d1,Agent,2026-08-01,10000,2000,30,500,Zillow',mapping,'');expect(earnings(r.rows[0]).contribution).toBe(1900);});
  it('rejects duplicate sides rather than counting twice',()=>expect(reviewEarnings(head+'d1,A,2026-08-01,100,0,50,0,Z\nd1,A,2026-08-01,100,0,50,0,Z',mapping,'').errors).toHaveLength(1));
  it('rejects missing fees and invalid shares',()=>{expect(reviewEarnings(head+'d1,A,2026-08-01,100,,50,0,Z',mapping,'').errors).toHaveLength(1);expect(reviewEarnings(head+'d1,A,2026-08-01,100,0,101,0,Z',mapping,'').errors).toHaveLength(1);});
  it('rejects impossible dates',()=>expect(strictDate('2026-02-30')).toBe(false));
  it('uses a default only when no row percentage is supplied',()=>{const r=reviewEarnings(head+'d1,A,2026-08-01,100,0,,0,Z',mapping,'25');expect(earnings(r.rows[0]).retained).toBe(25);});
  it('neutralizes spreadsheet formulas in exported text',()=>expect(csvCell('=1+1')).toBe('"\'=1+1"'));
});
