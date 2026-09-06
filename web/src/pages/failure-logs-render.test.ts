import { describe, it, expect, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProblemCard, failureKind, FailureLogsEmpty } from './AdminFailureLogs';
import type { FailureLogProblem } from '../lib/api';
vi.mock('../lib/api', () => ({ adminFailureLogs: vi.fn(), adminUpdateFailureLog: vi.fn(), signOutClean: vi.fn() }));
const problem: FailureLogProblem = {
  fingerprint: 'synthetic-fp', title: 'Synthetic safe diagnostic', stage: 'collection', severity: 'nonfatal',
  status: 'open', resolutionNotes: null, firstSeen: '2026-09-05T10:00:00Z', lastSeen: '2026-09-05T10:00:00Z',
  occurrenceCount: 1, affectedBatchIds: ['synthetic-batch'], affectedAccountIds: ['synthetic-account'],
  latest: { incidentId: 'synthetic-incident', batchId: 'synthetic-batch', accountId: 'synthetic-account',
    occurredAt: '2026-09-05T10:00:00Z', scope: 'contact', code: 'CONTACT_SKIPPED', explanation: 'A contact was skipped.',
    impact: 'Collection continued.', nextStep: 'Review the diagnostic.', action: 'contact_quarantined', continued: true,
    position: null,total: null,technical: { message: 'Safe diagnostic' } },
};
describe('Failure Logs presentation', () => {
  it('renders the empty state without claiming pipeline health', () => {
    expect(renderToStaticMarkup(createElement(FailureLogsEmpty))).toContain('No incidents match these filters.');
  });
  it('renders a nonfatal contact incident with plain-language fields and collapsed diagnostics', () => {
    const html=renderToStaticMarkup(createElement(ProblemCard,{problem,onStatusChange:vi.fn()}));
    expect(html).toContain('Non-fatal'); expect(html).toContain('What happened:');
    expect(html).toContain('synthetic-batch'); expect(html).toContain('Resolution notes');
    expect(html).not.toContain('synthetic-incident');
  });
  it('renders fatal batch failures', () => {
    const html=renderToStaticMarkup(createElement(ProblemCard,{problem:{...problem,severity:'fatal',latest:{...problem.latest!,scope:'batch',continued:false}},onStatusChange:vi.fn()}));
    expect(html).toContain('Fatal'); expect(html).toContain('safe continuation was impossible');
  });
  it('distinguishes human authentication action, application defects and team failures', () => {
    expect(failureKind('team','MFA_REQUIRED',true,false)).toContain('human action required');
    expect(failureKind('contact','MESSAGE_DIRECTION_UNKNOWN',true,false)).toContain('not automatically rerun');
    expect(failureKind('team','TEAM_WITHHELD',true,false)).toContain('other teams continued');
  });
});

it('renders agent activity, history authors and admin release control',()=>{
  const html=renderToStaticMarkup(createElement(ProblemCard,{problem:{...problem,status:'investigating',version:3,
    claim:{agentId:'brian',claimedAt:'2026-09-05T10:00:00Z',expiresAt:'2026-09-05T10:30:00Z'},
    diagnosis:'Synthetic parser variation.',remediation:'Synthetic bounded repair.',agentNextStep:'Await controlled verification.',
    filesChanged:['src/synthetic.mjs'],testsRun:['synthetic regression'],
    history:[{id:1,version:2,occurredAt:'2026-09-05T10:00:00Z',actor:'brian',operation:'claim',fromStatus:'open',toStatus:'investigating',detail:{}},
    {id:2,version:3,occurredAt:'2026-09-05T10:01:00Z',actor:'administrator',operation:'update',fromStatus:'investigating',toStatus:'investigating',detail:{resolutionNotes:'Synthetic note.'}}]},onStatusChange:vi.fn()}));
  for(const text of ['Assigned agent:','brian','Expires','Synthetic parser variation.','Synthetic bounded repair.','src/synthetic.mjs','synthetic regression','Await controlled verification.','Status history (2)','Brian','Administrator','Release claim']) expect(html).toContain(text);
});
