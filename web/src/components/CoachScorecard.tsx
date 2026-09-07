import {belowMinimum} from '../lib/minimumExpectation';
import { ConversionComparison } from './ConversionComparison';
import { PeriodSelect } from './PeriodSelect';
import { WINDOWS, PERIOD_OPTIONS } from '../lib/rosterData';
import { useEffect, useState } from 'react';
import { loadDashboard, type AgentRow } from '../lib/api';
import { norm, useRosterData, DEFAULT_LINE } from '../lib/rosterData';
import { inPulsePeriod } from '../lib/pulsePeriod';
import { useSavedTarget } from './TargetControl';
import { useOperations } from './OperationsContext';
import { useCoachReview } from './CoachReviewContext';
import { PulseProof } from './PulseProof';

export function CoachScorecard({ name }: { name: string }) {
  const { orgId } = useCoachReview();
  const target = useSavedTarget(orgId, 'leads-per-contract', DEFAULT_LINE);
  const cap = useSavedTarget(orgId, 'mtd-new-assignment-pause', 15);
  const data = useRosterData(target.saved, null, orgId);
  const [periodKey,setPeriodKey]=useState('mtd');
  const period=WINDOWS.find(w=>w.key===periodKey)!;
  const ops = useOperations();
  const [agents, setAgents] = useState<AgentRow[]>([]);
  useEffect(() => {
    let active = true;
    loadDashboard(orgId).then(d => { if (active) setAgents(d.agents); }).catch(() => {});
    return () => { active = false; };
  }, [orgId]);
  const matches = agents.filter(a => norm(a.name) === norm(name));
  const id = matches.length === 1 ? matches[0].id : null;
  const assignments = id ? (ops?.assignments ?? []).filter(a => a.agentId === id && inPulsePeriod(a.at, 'mtd')) : [];
  const count = new Set(assignments.map(a => a.leadId)).size;
  const hasIntake = !!ops?.assignmentFile && !!id;
  const row = data.rows?.find(r => norm(r.name) === norm(name));
  const month = new Date().toLocaleDateString('en-US', { month: 'long' });
  return <section className="coach-scorecard" aria-label={`${name} performance scorecard`}>
    <div className="coach-scorecard-heading"><h4>Performance at a glance</h4><a href="#/pulse">Open Pulse</a></div>
    <PeriodSelect label="Conversion comparison period" value={periodKey} options={PERIOD_OPTIONS} onChange={setPeriodKey}/><p className="coach-scorecard-note">Period selects the comparison date. Monthly intake stays month to date; conversion uses all available history.</p>
    <dl className="coach-scorecard-rows">
      <div><dt>Leads taken this month<small>{month} to date · new assignments</small></dt>
        <dd className={hasIntake && cap.ready && count >= cap.saved ? 'needs-attention' : ''}>{hasIntake ? count : 'Not connected'}<small>{cap.ready ? `${cap.saved} leads before pause` : cap.notice || 'Loading saved allowance…'}</small></dd></div>
      <div><dt>Lead-to-contract rate<small>Across available history</small></dt>
        <dd className={row && target.ready && belowMinimum(row.perContract,target.saved,row.leads) ? 'needs-attention' : ''}>{row ? <ConversionComparison current={row} leads={data.proof.get(norm(name)) ?? []} history={data.historyInfo} period={period.days} through={data.historyInfo?.through}/> : data.err ? 'Unavailable' : !data.rows ? 'Loading…' : 'Unavailable'}<small>{target.ready ? `Minimum expectation: 1 in ${target.saved}` : target.notice || 'Loading saved expectation…'}</small></dd></div>
      <div><dt>Raw conversion<small>Under contract or closed · counted once per lead</small></dt>
        <dd>{row && row.leads > 0 ? `${(row.rawConversion ?? 0).toFixed(1)}%` : data.err ? 'Unavailable' : !data.rows ? 'Loading…' : 'Not established'}<small>{row ? `${row.contracts} of ${row.leads} leads · available history` : 'Available lead history'}</small></dd></div>
    </dl>
    {data.historyInfo && <p className="coach-scorecard-note">Historical baseline through {data.historyInfo.through}. New leads and recorded stage changes update automatically.</p>}
    {data.err && <p role="alert" className="coach-scorecard-note">Performance could not be loaded. Open Pulse to retry.</p>}
    {row && <PulseProof row={row} leads={data.proof.get(norm(name)) ?? []} teams={data.teams} />}
    <details className="coach-intake-proof"><summary>How intake is counted</summary>
      {hasIntake ? <><p>We count distinct lead IDs assigned to this agent this calendar month in {ops!.assignmentFile}. Repeated rows for the same lead count once. This import is held for this workspace visit; completeness is not independently verified.</p>{assignments.map(a => <p key={`${a.leadId}-${a.line}`}>{a.leadName || 'Name unavailable'} · assigned {new Date(a.at).toLocaleString()} · file row {a.line}</p>)}</> : <p>Assignment dates have not been connected for this agent. Lead creation dates do not prove when an agent received a lead, so we do not use them to judge the monthly allowance. Assignment evidence can be imported in Pulse.</p>}
    </details>
  </section>;
}
