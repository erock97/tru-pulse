import type { RawLiveState } from './liveSessions.js';

/** Empty-roster sessions are administrator rehearsals. No agent identities are created. */
export function rehearsalState(raw: RawLiveState, viewerId: string): RawLiveState {
  if (!raw.canPresent || raw.session.day !== 2 || raw.session.roster.length) return raw;
  const s = raw.session, evidence = s.rehearsal_evidence ?? {};
  const participant = { agentId: s.id, userId: viewerId, orgId: '', teamId: '',
    name: 'Test learner', teamName: 'Solo rehearsal', coachId: viewerId,
    coachName: 'Presenter', joinedAt: evidence.joinedAt ?? null, lastSeenAt: evidence.lastSeenAt ?? null };
  return { ...raw, session: { ...s, roster: [participant], groups: evidence.groups ?? [] },
    rehearsal: true, myAgentId: s.id, participants: [participant],
    attempts: evidence.attempts ?? [], progress: evidence.progress ?? [],
    observations: evidence.observations ?? [], followups: [] };
}
