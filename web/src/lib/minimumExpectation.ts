/** Fewer leads per outcome means stronger conversion. Compare before rounding. */
export function minimumExpectation(ratio: number | null, maximumLeads: number): string {
  if (ratio === null || !Number.isFinite(ratio) || ratio <= 0) return 'Not established';
  if (ratio < maximumLeads) return 'Exceeds minimum';
  if (ratio > maximumLeads) return 'Below minimum';
  return 'At minimum';
}
