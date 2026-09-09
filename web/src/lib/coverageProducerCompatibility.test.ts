import complete from './fixtures/coverage/complete.json';
import partial from './fixtures/coverage/partial.json';
import incomplete from './fixtures/coverage/incomplete-roster.json';
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { validateCoachBrief } from '../../../shared/coachBrief';
import { coverageState, PARTIAL_REPORT_PUBLISHING_ENABLED } from '../../../shared/reportCoverage';
import { toView, type BriefReportRow } from './coachBriefData';
import { ReportCoverageNotice } from '../components/CoachBrief';
const fixture = (name:string): any => structuredClone(({complete, partial, 'incomplete-roster': incomplete} as Record<string, unknown>)[name]);
function viewOf(raw:any){const checked=validateCoachBrief(raw);expect(checked.ok).toBe(true);if(!checked.ok)throw Error(checked.errors.join(';'));return toView({id:'offline',team_id:'offline',team_slug:'costigan',week_start:raw.run.startDate,week_end:raw.run.endDate,generated_at:null,received_at:'2030-01-08',payload:checked.brief} as BriefReportRow)!;}
describe('laptop supplied coverage fixtures',()=>{
 it.each([['complete','complete','Review coverage complete'],['partial','partial','1 known unresolved contact'],['incomplete-roster','partial','additional contacts may be missing']])('%s validates and renders correctly',(name,state,label)=>{const raw=fixture(name);const view=viewOf(raw);expect(coverageState(view.coverage)).toBe(state);expect(view.coverage).toEqual(raw.coverage);expect(renderToStaticMarkup(createElement(ReportCoverageNotice,{view}))).toContain(label);expect(new TextEncoder().encode(JSON.stringify(raw)).byteLength).toBeLessThan(4000000);expect(raw.responseTiming).toBeUndefined()});
 it('partial warning identifies the unresolved person and failure without asserting no response',()=>{const html=renderToStaticMarkup(createElement(ReportCoverageNotice,{view:viewOf(fixture('partial')),print:true}));expect(html).toContain('Second Example');expect(html).toContain('collection failed');expect(html).toContain('Missing information does not mean zero activity or no response');expect(html).toContain('open=""');});
 it('legacy missing coverage stays unknown despite complete run status',()=>{const raw=fixture('complete');delete raw.coverage;raw.run.status='complete';const view=viewOf(raw);expect(coverageState(view.coverage)).toBe('unknown');expect(renderToStaticMarkup(createElement(ReportCoverageNotice,{view}))).toContain('Report coverage unknown')});
 it.each(['complete','partial','incomplete-roster'])('%s retains synthetic observed evidence independently',name=>{const raw=fixture(name);raw.agents=[{agentName:'Example Agent',metrics:{},doingRight:[],opportunities:[{text:'Synthetic observed finding',findingIndexes:[0]}],objections:[],coachingActions:[]}];raw.findings=[{findingIndex:0,findingId:'synthetic-observation',agentName:'Example Agent',leadName:'Second Example',channel:'text',quote:'Synthetic observed message'}];const view=viewOf(raw);expect(view.agents[0].opportunities[0].evidence[0].quote).toBe('Synthetic observed message');expect(view.agents[0].metrics.noOutreach).toBeUndefined();expect(view.agents[0].metrics.reviewedContacts).toBeUndefined()});
 it('keeps partial publication disabled',()=>expect(PARTIAL_REPORT_PUBLISHING_ENABLED).toBe(false));
});
