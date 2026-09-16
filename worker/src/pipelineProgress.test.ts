import { describe, expect, it } from 'vitest';
import { calculatePipeline, pipelineSnapshotContent, type PipelineLead } from '../../shared/pipeline';
import { PROGRESSION, type ProgressEvent } from '../../shared/pipelineProgress';

const lead:PipelineLead={team_id:'t',fub_person_id:1,name:'Buyer',assigned_to:'Agent',assigned_user_id:7,stage:'Nurture',source_family:'Zillow',fub_created:'2026-01-01T12:00:00Z'};
const event=(to:string,from:string|null=null,date='2026-02-01T12:00:00Z'):ProgressEvent=>({team_id:'t',person_id:1,to_stage:to,from_stage:from,occurred_at:date,upstream_id:to+date,upstream_kind:'peopleStageUpdated'});
const calculate=(events:ProgressEvent[]=[],patch:Partial<PipelineLead>={})=>calculatePipeline({
  leads:[{...lead,...patch}],events,agents:[{id:'a',team_id:'t',name:'Agent',fub_user_id:7}],
  teams:[{id:'t',org_id:'o',name:'Team',fub_subdomain:null}],
  filters:{orgId:'o',teamId:'t',from:'2026-01-01T00:00:00Z',through:'2026-02-01T00:00:00Z',timezone:'UTC',sources:[]},
  now:'2026-09-16T12:00:00Z',
});
const reached=(report:ReturnType<typeof calculate>)=>report.progression.filter(s=>s.count).map(s=>s.key);
describe('retained pipeline progression',()=>{
  it('Lead directly to Met with includes every preceding step',()=>{
    expect(reached(calculate([event('Met with Customer','Lead')],{stage:'Met with Customer'})))
      .toEqual(['lead','attempted','spoke','appointment','met']);
  });
  it('Met with to Nurture preserves prior steps without granting later stages',()=>{
    const r=calculate([event('Met with Customer','Lead'),event('Nurture','Met with Customer','2026-03-01T12:00:00Z')]);
    expect(reached(r)).toEqual(['lead','attempted','spoke','appointment','met']);
    expect(r.totals).toMatchObject({total:1,nurture:1,conversions:0});
    expect(r.leads[0].progress.met.at).toBe('2026-02-01T12:00:00Z');
    expect(r.progression.every(s=>s.count===s.leadKeys.length)).toBe(true);
  });
  it('retains the JSON backfill after current status changes',()=>{
    expect(reached(calculate([],{history:{met:{date:'2026-02-01',eventId:'saved'}}}))).toEqual(['lead','attempted','spoke','appointment','met']);
  });
  it('uses current Met with when historical dates are unavailable without inventing a date',()=>{
    const r=calculate([],{stage:'Met with Customer'});
    expect(r.progression.find(s=>s.key==='appointment')?.count).toBe(1);
    expect(r.leads[0].progress.appointment.at).toBeNull();
  });
  it('retains progression through Closed on a backwards move without repeating credits',()=>{
    const e=event('Closed','Lead');
    const r=calculate([e,e,event('Rejected','Closed')],{stage:'Rejected'});
    expect(reached(r)).toEqual(PROGRESSION.map(([key])=>key));
    expect(r.progression.every(s=>s.count===1)).toBe(true);
    expect(r.totals.rejected).toBe(1);
    expect(r.totals.conversions).toBe(0); // Explicitly labeled current conversions.
  });
  it('does not manufacture progress from Nurture, Rejected or unknown stages',()=>{
    for(const stage of ['Nurture','Rejected','Unknown'])expect(reached(calculate([event(stage)],{stage}))).toEqual(['lead']);
  });
  it('a departing stage proves prior progress but not its original date',()=>{
    const r=calculate([event('Nurture','Met with Customer')]);
    expect(r.leads[0].progress.met.at).toBeNull();expect(r.leads[0].progress.offer).toBeUndefined();
  });
  it('excludes other teams and people, invalid timestamps and future events',()=>{
    const e=event('Closed');
    expect(reached(calculate([{...e,team_id:'foreign'},{...e,person_id:2},{...e,occurred_at:'not-a-date'},{...e,occurred_at:'2027-01-01'}]))).toEqual(['lead']);
  });
  it('received-date filtering does not erase progress made after the lead-received period',()=>{
    expect(reached(calculate([event('Met with Customer',null,'2026-05-01')]))).toContain('met');
  });
  it('changes the snapshot when retained progression changes even if current stage stays Nurture',()=>{
    expect(pipelineSnapshotContent(calculate())).not.toBe(pipelineSnapshotContent(calculate([event('Met with Customer')])));
  });
});
