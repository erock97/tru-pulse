import type { WorkshopDefinition } from './workshopCatalog.js';
import type { CoachingAssignment } from './coachingAssignments.js';

export type LiveView = 'presenter' | 'shared' | 'agent';
export interface LiveParticipant {
  agentId: string; userId: string | null; orgId: string; teamId: string;
  name: string; teamName: string; coachId: string; coachName?: string; joinedAt: string | null;
  lastSeenAt: string | null;
}
export interface LiveProgress {
  agentId: string; activityId: string; status: 'working' | 'submitted';
  help: 'finding-control' | 'practice' | null; actions: string[];
  dirty: boolean; helpResolvedCount?: number; updatedAt: string;
}
export interface LiveAttempt {
  id: string; agentId: string; activityId: string; attempt: number;
  response: Record<string, unknown>; assisted: boolean; submittedAt: string;
  grade: { passed: boolean; score: number; max: number; checks: {id:string;label:string;pass:boolean;message:string}[] } | null;
}
export interface LiveGroup {
  id: string; activityId: string; round: number;
  agentId: string; buyerId: string | null; observerId: string | null;
  coachId?: string | null;
}
export interface LiveObservation {
  id: string; groupId: string; activityId: string; agentId: string;
  observerId: string; round: number; criteria: Record<string, boolean>;
  correction: string; retry: string; coachReviewed: boolean; submittedAt: string;
}
export interface LiveSessionSummary {
  id: string; day: number; title: string; version: string; timezone: string;
  status: 'active' | 'ended'; createdAt: string; endedAt: string | null;
  currentActivityId: string | null; currentSlideId: string; presenterIds: string[]; canPresent: boolean;
}
export interface LiveSessionState {
  session: LiveSessionSummary; definition: WorkshopDefinition; cursor: string;
  viewerId: string; myAgentId: string | null; canPresent: boolean;
  openedActivityIds: string[]; revealedActivityIds: string[];
  timerEndsAt: string | null; participants: LiveParticipant[];
  progress: LiveProgress[]; attempts: LiveAttempt[]; groups: LiveGroup[];
  observations: LiveObservation[]; followups: LiveFollowup[];
  choiceTotals: Record<string, Record<string, number>>;
}
export interface LiveFollowup extends CoachingAssignment {
  sessionId: string; skillId: string; coachId: string; coachName?: string; timezone: string;
  checkpoint: 1 | 3 | 7; applicationObserved: boolean | null;
}
export interface LivePreflight {
  canCreate: boolean;
  agents: {id:string;name:string;orgId:string;teamId:string;teamName:string;userId:string|null;email:string|null}[];
  coaches: {id:string;name:string;orgId:string|null}[];
}
export type LiveCommand =
  | { action: 'open'; activityId: string }
  | { action: 'slide'; slideId: string }
  | { action: 'timer'; seconds: number }
  | { action: 'reveal'; activityId: string }
  | { action: 'group'; group: LiveGroup }
  | { action: 'end' };
export interface LiveSubmission { id: string; activityId: string; response: Record<string, unknown> }
export const LIVE_POLL_MS = 2000;
export const LIVE_IDLE_POLL_MS = 10000;
/** Identity-scoped local drafts contain no old self-paced notes. */
export const liveDraftKey = (userId:string,sessionId:string,version:string,activityId:string) =>
  `tru:rep-live:v1:${userId}:${sessionId}:${version}:${activityId}`;
