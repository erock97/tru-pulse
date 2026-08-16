// One roster size → one package. Apply and Services read these labels from
// here so a 12-agent team cannot be "6–20" on the form and "Performance" on
// the model.
//
// The old apply buckets (1 / 2–5 / 6–20 / 21–50 / 50+) did not line up with
// the four packages, and the old services bands overlapped at 10, 20, and 40
// ("Up to 10" vs "10 to 20"). These ranges are exclusive.

export const TEAM_BANDS = [
  { band: 'Up to 10 agents', name: 'Essentials', minAgents: 1, maxAgents: 10 },
  { band: '11 to 20 agents', name: 'Performance', minAgents: 11, maxAgents: 20 },
  { band: '21 to 40 agents', name: 'Performance+', minAgents: 21, maxAgents: 40 },
  { band: '41+ agents', name: 'Mega Team', minAgents: 41, maxAgents: Infinity },
] as const;

export type TeamBand = (typeof TEAM_BANDS)[number];

export const TEAM_SIZE_OPTIONS = TEAM_BANDS.map((b) => b.band);

export function packageForAgentCount(count: number): TeamBand | null {
  if (!Number.isFinite(count) || count < 1) return null;
  return TEAM_BANDS.find((b) => count >= b.minAgents && count <= b.maxAgents) ?? null;
}
