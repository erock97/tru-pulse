import {it,expect} from 'vitest';
import {mergeDashboardHistory} from './mergeDashboardHistory';
const lead:any={team_id:'t',fub_person_id:1,name:'Old name',stage:'Nurture',history:{uc:null}};
it('retains saved proof, updates the owner/name and includes new live leads',()=>{
 const proof={eventId:'x',date:'2026-01-01',kind:'observed'};
 const r=mergeDashboardHistory([{...lead,history:{uc:proof}}],[{...lead,name:'Current name',assigned_to:'New owner'},{...lead,fub_person_id:2}],[],[],new Set(['t']));
 expect(r.leads).toHaveLength(2);expect(r.leads[0].name).toBe('Current name');expect(r.leads[0].assigned_to).toBe('New owner');expect(r.leads[0].history?.uc).toEqual(proof);
});
it('adds a new live contract without inventing a date from a seed or leaking other teams',()=>{
 const log:any={team_id:'t',fub_person_id:1,stage_class:'uc',changed_at:'2026-09-07T00:00:00Z',date_source:'live'};
 const r=mergeDashboardHistory([lead],[{...lead,team_id:'other'}],[],[log],new Set(['t']));expect(r.leads).toHaveLength(1);expect(r.leads[0].history?.uc?.date).toBe(log.changed_at);
 const seed=mergeDashboardHistory([lead],[],[],[{...log,date_source:'seed'}],new Set(['t']));expect(seed.leads[0].history?.uc).toBeNull();
});

it('preserves exact source scope and excludes older or unrelated live leads',()=>{
 const scoped={...lead,source_family:'Zillow Preferred',fub_created:'2026-03-01T12:00:00Z'};
 const live=[{...scoped,source:'Zillow Preferred',source_family:'Zillow',name:'Updated'},{...scoped,fub_person_id:2,source:'Facebook'},{...scoped,fub_person_id:3,source:'Zillow Preferred',fub_created:'2025-01-01T00:00:00Z'},{...scoped,fub_person_id:4,source:'Zillow Preferred'}];
 const r=mergeDashboardHistory([scoped],live,[],[],new Set(['t']),{'Zillow Preferred':'2026-01-01'});
 expect(r.leads.map(l=>l.fub_person_id)).toEqual([1,4]);expect(r.leads[0].source_family).toBe('Zillow Preferred');
});
it('keeps newer live fields after a saved lead changes source without expanding the historical cohort',()=>{
 const saved={...lead,source_family:'Zillow Preferred',fub_created:'2025-01-01T00:00:00Z'};
 const r=mergeDashboardHistory([saved],[{...saved,source:'Sphere',stage:'Closed',assigned_to:'New owner'},{...saved,fub_person_id:2,source:'Sphere'}],[],[],new Set(['t']),{'Zillow Preferred':'2026-01-01'});
 expect(r.leads).toHaveLength(1);expect(r.leads[0]).toMatchObject({stage:'Closed',assigned_to:'New owner',source_family:'Zillow Preferred'});
});
it('prefers dated evidence over seeds and later observations while repeated milestones count once',()=>{
 const event:any={team_id:'t',fub_person_id:1,stage_class:'uc',changed_at:'2026-06-01T00:00:00Z',date_source:'fub_change_log'};
 const r=mergeDashboardHistory([lead],[],[{...event,date_source:'seed'}],[{...event,changed_at:'2026-07-01T00:00:00Z',date_source:'live'},event,{...event,changed_at:'2026-08-01T00:00:00Z'}],new Set(['t']));
 expect(r.stageLog).toHaveLength(1);expect(r.stageLog[0].changed_at).toBe(event.changed_at);
});
