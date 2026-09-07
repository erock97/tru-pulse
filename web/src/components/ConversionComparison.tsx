import { contractRateLabel } from '../lib/minimumExpectation';
import { pulseCutoff, type PulsePeriod } from '../lib/pulsePeriod';
import './conversionComparison.css';

type Counts = {leads:number;contracts:number;perContract:number|null};
/** Current-owner records cannot establish historical ownership or a past rate. */
export function ConversionComparison({current,period,through}:{current:Counts;period:PulsePeriod;through?:string}) {
  const cutoff=pulseCutoff(period);
  const date=cutoff===null?null:new Date(cutoff).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  return <div className="conversion-comparison">
    <strong>{contractRateLabel(current.perContract,current.leads)}</strong>
    <small>Latest overall{through?` · through ${through}`:''}</small>
    <details><summary>Historical comparison unavailable</summary>
      <p>{date?`Compare with ${date}. `:''}The latest records do not establish each agent’s lead ownership at that date. No improving or declining signal is assigned.</p>
      <p>{current.contracts} contracts from {current.leads} leads across available history. Each converted lead counts once. This overall rate stays fixed when the reporting period changes.</p>
    </details>
  </div>;
}
