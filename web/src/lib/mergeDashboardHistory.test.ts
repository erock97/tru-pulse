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
