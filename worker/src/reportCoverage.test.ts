import { describe, it, expect } from 'vitest';
import { validateCoachBrief } from '../../shared/coachBrief';
import { validateReportCoverage, coverageState, PARTIAL_REPORT_PUBLISHING_ENABLED } from '../../shared/reportCoverage';
const coverage = () => ({ schemaVersion: '1.0', scope: 'report_window', rosterComplete: true, contacts: [
 { leadId: '123', leadName: 'Alex Sample', agentName: 'Agent Example', status: 'unresolved', reason: 'history_incomplete' }
] });
const report = () => ({ schemaVersion: '1.3', run: {runId:'r',teamId:'team',startDate:'2026-09-01',endDate:'2026-09-07'}, agents:[], findings:[{findingId:'f',findingIndex:0,agentName:'Agent Example',leadName:'Alex Sample',quote:'Verified excerpt'}], coverage:coverage() });
describe('report coverage', () => {
 it('retains valid findings and separate coverage without requiring timing', () => { const v=validateCoachBrief(report()); expect(v.ok).toBe(true); if(v.ok){expect(v.brief.findings[0].quote).toBe('Verified excerpt');expect(v.brief.coverage).toEqual(coverage());expect(v.brief.responseTiming).toBeUndefined();} });
 it('does not label legacy reports complete',()=>expect(coverageState()).toBe('unknown'));
 it('derives partial with an unresolved contact',()=>{const v=validateReportCoverage(coverage());if(!v.ok)throw Error();expect(coverageState(v.value)).toBe('partial');});
 it('requires a complete roster even when known contacts are reviewed',()=>{const c=coverage();c.rosterComplete=false;c.contacts=[];const v=validateReportCoverage(c);if(!v.ok)throw Error();expect(coverageState(v.value)).toBe('partial');});
 it('accepts an explicitly verified empty roster',()=>{const c=coverage();c.contacts=[];const v=validateReportCoverage(c);if(!v.ok)throw Error();expect(coverageState(v.value)).toBe('complete');});
 it.each(['orgId','teamId','responseTiming','complete','unresolvedCount'])('rejects extra field %s',key=>expect(validateReportCoverage({...coverage(),[key]:'x'}).ok).toBe(false));
 it('rejects duplicate contacts',()=>{const c=coverage();c.contacts.push(c.contacts[0]);expect(validateReportCoverage(c).ok).toBe(false)});
 it('requires a reason for unresolved contacts',()=>{const c=coverage();(c.contacts[0] as any).reason=null;expect(validateReportCoverage(c).ok).toBe(false)});
 it('rejects unknown status',()=>{const c=coverage();c.contacts[0].status='no_response';expect(validateReportCoverage(c).ok).toBe(false)});
 it('requires coverage version and report version',()=>{expect(validateCoachBrief({...report(),schemaVersion:'1.2'}).ok).toBe(false);expect(validateReportCoverage({...coverage(),schemaVersion:'2.0'}).ok).toBe(false)});
 it('rejects oversized lists without truncation',()=>expect(validateReportCoverage({...coverage(),contacts:Array(10001).fill(coverage().contacts[0])}).ok).toBe(false));
 it('clones validated input',()=>{const c=coverage();const v=validateReportCoverage(c);c.contacts[0].leadName='Changed';if(!v.ok)throw Error();expect(v.value.contacts[0].leadName).toBe('Alex Sample')});
 it('keeps partial publishing disabled',()=>expect(PARTIAL_REPORT_PUBLISHING_ENABLED).toBe(false));
});
