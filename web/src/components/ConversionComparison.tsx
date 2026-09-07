import { contractRateLabel } from '../lib/minimumExpectation';
import type { PulsePeriod } from '../lib/pulsePeriod';
import type { LeadRow, DashboardData } from '../lib/api';
import { conversionTrend, type ConversionCounts } from '../lib/conversionTrend';
import './conversionComparison.css';

export function ConversionComparison({current,period,leads,history}:{current:ConversionCounts;period:PulsePeriod;through?:string;leads?:LeadRow[];history?:DashboardData['historyInfo']}) {
  const trend=conversionTrend(leads,current,period,history);
  const date=trend.cutoff===null?null:new Date(trend.cutoff).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  const tone=trend.direction==='Improving'?'up':trend.direction==='Declining'?'down':trend.direction==='Unchanged'?'flat':'missing';
  const label=tone==='up'?'↑ TRENDING UP':tone==='down'?'↓ TRENDING DOWN':tone==='flat'?'→ UNCHANGED':trend.prior?'NO EARLIER LEADS':'Historical comparison unavailable';
  return <div className="conversion-comparison">
    <strong>{contractRateLabel(current.perContract,current.leads)}</strong>
    <small>Latest overall</small>
    <details className={`conversion-trend trend-${tone}`}>
      <summary>{label}</summary>
      {trend.prior?<div className="conversion-before-after">
        <div><span>Then · {date}</span><b>{contractRateLabel(trend.prior.perContract,trend.prior.leads)}</b><small>{trend.prior.contracts} contracts from {trend.prior.leads} leads</small></div>
        <div><span>Now</span><b>{contractRateLabel(current.perContract,current.leads)}</b><small>{current.contracts} contracts from {current.leads} leads</small></div>
      </div>:<p>{date?`${date}: `:''}{trend.reason}</p>}
      {trend.prior&&<small className="conversion-basis">{tone==='missing'?'No earlier baseline. ':''}Higher conversion = trending up. Current-owner attribution.</small>}
    </details>
  </div>;
}
