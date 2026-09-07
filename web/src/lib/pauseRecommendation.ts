import {belowMinimum,contractRateLabel} from './minimumExpectation';
export function pauseRecommendation(row:{leads:number;perContract:number|null}|undefined,minimum:number|null,assignedThisMonth:number|null,cap:number|null):string|null {
 const reasons:string[]=[];
 if(cap!==null&&assignedThisMonth!==null&&assignedThisMonth>=cap)reasons.push(`Monthly cap reached: ${assignedThisMonth}/${cap}`);
 if(row&&minimum!==null&&belowMinimum(row.perContract,minimum,row.leads))reasons.push(`Conversion below minimum: ${contractRateLabel(row.perContract,row.leads)}; target 1 in ${minimum}`);
 return reasons.length?`Pause recommended · ${reasons.join(' · ')}`:null;
}
