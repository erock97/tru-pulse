/** Fewer leads per outcome means stronger conversion. Compare before rounding. */
export function minimumExpectation(ratio: number | null, maximumLeads: number, leads?: number): string {
  if (ratio === null || !Number.isFinite(ratio) || ratio <= 0) return leads === undefined ? 'Not established' : leads > 0 ? 'No contracts yet' : 'No leads in this period';
  if (ratio < maximumLeads) return 'Exceeds minimum';
  if (ratio > maximumLeads) return 'Below minimum';
  return 'At minimum';
}

/** A zero-contract cohort still has a known lead count; missing data does not. */
export function contractRateLabel(ratio: number | null, leads: number): string {
  if (ratio !== null && Number.isFinite(ratio) && ratio > 0) return `1 in ${Math.floor(ratio)}`;
  return `0 for ${leads}`;
}
