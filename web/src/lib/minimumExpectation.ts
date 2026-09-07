/** Fewer leads per outcome means stronger conversion. Compare before rounding. */
export function minimumExpectation(ratio: number | null, maximumLeads: number, leads?: number): string {
  if (ratio === null || !Number.isFinite(ratio) || ratio <= 0) return leads === undefined ? 'Not established' : leads > 0 ? 'No contracts yet' : 'No leads in this period';
  if (ratio < maximumLeads) return 'Exceeds minimum';
  if (ratio > maximumLeads) return 'Below minimum';
  return 'At minimum';
}

/** A zero-contract cohort still has a known lead count; missing data does not. */
export function contractRateLabel(ratio: number | null, leads: number): string {
  if (ratio !== null && Number.isFinite(ratio) && ratio > 0) return `${Number(ratio.toFixed(2))===ratio?'':'≈ '}1 in ${Number(ratio.toFixed(2))}`;
  return `0 for ${leads}`;
}

/** Zero contracts with known leads is below a positive conversion standard. */
export function belowMinimum(ratio:number|null,maximumLeads:number,leads:number):boolean {
 return leads>0&&(ratio===null||ratio>maximumLeads);
}

/** No contracts is the weakest known rate; no leads has no rate to rank. */
export function contractSortValue(row:{leads:number;perContract:number|null}|undefined):number|null {
 return !row||row.leads===0?null:row.perContract??Infinity;
}
