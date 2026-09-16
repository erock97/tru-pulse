import {it,expect} from 'vitest';
import {pipelineFixture} from '../../shared/pipelineFixture';
import {reconcilePipeline} from '../../shared/pipelineReconciliation';
it('reconciles every owner, stage and progression drilldown in the reference report',()=>{
 expect(reconcilePipeline(pipelineFixture()).ok).toBe(true);
});
it('detects corrupted totals, duplicate identities and mismatched drilldown membership',()=>{
 const r=pipelineFixture();r.totals.total++;r.leads.push(r.leads[0]);r.stages[0].leadKeys.push('foreign');r.agents[0].total++;
 const audit=reconcilePipeline(r);expect(audit.ok).toBe(false);
 expect(audit.issues).toContain('Duplicate lead identities');
 expect(audit.issues).toContain('Current-stage reconciliation');
 expect(audit.issues.some(x=>x.startsWith('Owner drilldown'))).toBe(true);
});
