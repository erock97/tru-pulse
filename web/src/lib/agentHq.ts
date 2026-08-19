// Agent HQ — routing, copy, training bay, and attention items.
// Pure helpers so the invite / password / shell / Official Training contracts
// can be locked in tests without mounting the app.

import { AG, PERSONAL_TYPES } from './assessmentData';
import {
  OFFICIAL_TRAINING_CARDS,
  OFFICIAL_TRAINING_ID,
  OFFICIAL_TRAINING_QS,
  OFFICIAL_TRAINING_TITLE,
} from './officialTraining';
import {
  SHOW_LIKE_A_PRO_ID,
  SHOW_LIKE_A_PRO_TITLE,
} from './showLikeAPro';
import {
  RECORD_IS_THE_JOB_CARDS,
  RECORD_IS_THE_JOB_ID,
  RECORD_IS_THE_JOB_QS,
  RECORD_IS_THE_JOB_TITLE,
} from './recordIsTheJob';
import {
  WINNING_FIRST_CONVERSATION_ID,
  WINNING_FIRST_CONVERSATION_TITLE,
} from './winningFirstConversation';
import type { CourseModule, CourseQuestion, LessonCard } from './api';

export const AGENT_SHELL_TABS = ['Home', 'Coach', 'Training'] as const;
export const LEADER_SHELL_TABS = ['Home', 'Pulse', 'Coach', 'Rep'] as const;

export type AgentHqTab = 'home' | 'coach' | 'training';

export const SET_PASSWORD_TITLE = 'Set your password to finish setting up.';
export const SET_PASSWORD_SUB = 'One login for your HQ — training and Coach, in one place.';
export const SET_PASSWORD_EMAIL_NOTE =
  'This is the address your invite was sent to. Use it — a different one will not connect to your HQ.';

/** Session email on the invite link. Empty / missing means claim cannot stick. */
export function lockedInviteEmail(sessionEmail: string | null | undefined): string | null {
  const email = String(sessionEmail ?? '').trim();
  return email.includes('@') ? email : null;
}

/** claim_agent() matches lower(agents.email) to the JWT email. */
export function claimEmailsMatch(inviteEmail: string, registerEmail: string): boolean {
  return inviteEmail.trim().toLowerCase() === registerEmail.trim().toLowerCase();
}

export const AGENT_COACH_HEADINGS = {
  best: 'At your best',
  worst: 'At your worst',
  strongest: 'Strongest when you show up correctly / take care of yourself',
} as const;

export interface AgentCoachCopy {
  best: { work: string; personal: string[] };
  worst: { work: string; personal: string };
  strongest: { edge: string; challenge: string };
}

/** Same GET the leader Coach drill-in uses. AgentCourse never called this. */
export function coachProfilePath(agentId: string): string {
  return `/data/coach/profile?agentId=${encodeURIComponent(agentId)}`;
}

/** Existing AG / PERSONAL_TYPES copy only. Headings stay first-person; no new archetype text. */
export function agentCoachCopy(input: {
  workCode: string;
  personalCode?: string | null;
}): AgentCoachCopy | null {
  const ag = AG[input.workCode];
  if (!ag) return null;
  const personal = input.personalCode ? (PERSONAL_TYPES[input.personalCode] ?? null) : null;
  return {
    best: { work: ag.sup, personal: personal?.strengths ?? [] },
    worst: { work: ag.watch, personal: personal?.watch ?? '' },
    strongest: { edge: ag.edge, challenge: ag.challenge },
  };
}

export const TRAINING_SECTION_LABELS = {
  newAgents: 'New agents',
  zillow: 'Zillow onboarding',
  additional: 'Additional training',
} as const;

export type SignedInKind = 'leader' | 'admin' | 'agent' | 'onboarding';

export function signedInKind(s: { org: boolean; admin: boolean; agent: boolean }): SignedInKind {
  if (s.org) return 'leader';
  if (s.admin) return 'admin';
  if (s.agent) return 'agent';
  return 'onboarding';
}

/** After they set a password, agents land on Agent HQ Home — not the old course screen. */
export function homeAfterPassword(kind: SignedInKind): 'agent-hq' | 'leader-hq' | 'onboarding' {
  if (kind === 'agent') return 'agent-hq';
  if (kind === 'onboarding') return 'onboarding';
  return 'leader-hq';
}

export function parseAgentHqTab(route: string): AgentHqTab {
  const path = route.replace(/^#/, '').split('?')[0] || '/';
  if (path === '/learn/coach') return 'coach';
  if (path === '/learn/training') return 'training';
  if (path === '/learn') return 'home';
  if (path === '/coach' || path.startsWith('/coach/')) return 'coach';
  if (path === '/training' || path.startsWith('/training/')) return 'training';
  return 'home';
}

function demoMode(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1';
}

export function agentHqPath(tab: AgentHqTab, demo = demoMode()): string {
  if (demo) {
    if (tab === 'coach') return '/learn/coach';
    if (tab === 'training') return '/learn/training';
    return '/learn';
  }
  if (tab === 'coach') return '/coach';
  if (tab === 'training') return '/training';
  return '/';
}

export function shellTabsFor(kind: 'agent' | 'leader'): readonly string[] {
  return kind === 'agent' ? AGENT_SHELL_TABS : LEADER_SHELL_TABS;
}

export function isOfficialTraining(m: { id: string; title?: string | null }): boolean {
  return m.id === OFFICIAL_TRAINING_ID || m.title === OFFICIAL_TRAINING_TITLE;
}

export function isWinningFirstConversation(m: { id: string; title?: string | null }): boolean {
  return m.id === WINNING_FIRST_CONVERSATION_ID || m.title === WINNING_FIRST_CONVERSATION_TITLE;
}

export function isShowLikeAPro(m: { id: string; title?: string | null }): boolean {
  return m.id === SHOW_LIKE_A_PRO_ID || m.title === SHOW_LIKE_A_PRO_TITLE;
}

export function isRecordIsTheJob(m: { id: string; title?: string | null }): boolean {
  return m.id === RECORD_IS_THE_JOB_ID || m.title === RECORD_IS_THE_JOB_TITLE;
}

export function isZillowOnboarding(m: { id: string; title?: string | null }): boolean {
  return isOfficialTraining(m) || isWinningFirstConversation(m) || isShowLikeAPro(m);
}

/** Official Training opens even when its quiz list is empty. Days 2–3 already play. */
export function canOpenModule(m: { id: string; title?: string | null; qs?: unknown[]; cards?: unknown[] }): boolean {
  if (isOfficialTraining(m)) return true;
  return (m.cards?.length ?? 0) > 0 || (m.qs?.length ?? 0) > 0;
}

export function courseCardsFor(m: { id: string; title?: string | null; cards?: LessonCard[] | null }): LessonCard[] {
  if (m.cards?.length) return m.cards;
  if (isOfficialTraining(m)) return OFFICIAL_TRAINING_CARDS;
  if (isRecordIsTheJob(m)) return RECORD_IS_THE_JOB_CARDS;
  return m.cards ?? [];
}

/** Empty live qs still get the in-repo Day 1 quiz — same fallback as cards. */
export function courseQuestionsFor(m: { id: string; title?: string | null; qs?: CourseQuestion[] | null }): CourseQuestion[] {
  if (m.qs?.length) return m.qs;
  if (isOfficialTraining(m)) return OFFICIAL_TRAINING_QS;
  if (isRecordIsTheJob(m)) return RECORD_IS_THE_JOB_QS;
  return m.qs ?? [];
}

export interface TrainingSection<T> {
  label: string;
  modules: T[];
}

/** Three labeled bays. Official Training is the start-here module and also Day 1. */
export function trainingBay<T extends { id: string; title?: string | null }>(mods: T[]): TrainingSection<T>[] {
  const newAgents = mods.filter((m) => isOfficialTraining(m) || isRecordIsTheJob(m));
  const zillow = mods.filter(isZillowOnboarding);
  const additional = mods.filter((m) => !isZillowOnboarding(m));
  return [
    { label: TRAINING_SECTION_LABELS.newAgents, modules: newAgents },
    { label: TRAINING_SECTION_LABELS.zillow, modules: zillow },
    { label: TRAINING_SECTION_LABELS.additional, modules: additional },
  ];
}

export interface AttentionItem {
  key: string;
  title: string;
  detail: string;
  tab: AgentHqTab;
}

export function attentionItems(input: {
  assessed: boolean;
  unfinishedZillow: { id: string; title: string }[];
  openCommitments: { id: string; text: string }[];
}): AttentionItem[] {
  const out: AttentionItem[] = [];
  if (!input.assessed) {
    out.push({
      key: 'assessment',
      title: 'Personality assessment',
      detail: 'Your Coach is waiting on this — two short parts, then your type is yours.',
      tab: 'coach',
    });
  }
  for (const m of input.unfinishedZillow) {
    out.push({
      key: `training-${m.id}`,
      title: m.title,
      detail: 'A Zillow day is unfinished. Pick it up in Training.',
      tab: 'training',
    });
  }
  for (const c of input.openCommitments) {
    out.push({
      key: `commit-${c.id}`,
      title: c.text,
      detail: 'An open 1:1 commitment. Tick it off when it is done.',
      tab: 'coach',
    });
  }
  return out;
}

export const AGENT_HQ_EMPTY =
  'You are current. Nothing waiting — your training and Coach are here when you need them.';

export function withOpenableOfficialTraining(mods: CourseModule[]): CourseModule[] {
  return mods.map((m) => {
    if (!isOfficialTraining(m) && !isRecordIsTheJob(m)) return m;
    const qs = courseQuestionsFor(m);
    return { ...m, cards: courseCardsFor(m), qs, questions: qs.length };
  });
}
