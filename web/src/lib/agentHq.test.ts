import { describe, expect, it } from 'vitest';
import agentHqPage from '../pages/AgentHq.tsx?raw';
import agentHqShell from '../components/agentHqShell.tsx?raw';
import { OFFICIAL_TRAINING_CARDS, OFFICIAL_TRAINING_ID, OFFICIAL_TRAINING_TITLE } from './officialTraining';
import { SHOW_LIKE_A_PRO_ID, SHOW_LIKE_A_PRO_TITLE } from './showLikeAPro';
import {
  WINNING_FIRST_CONVERSATION_ID,
  WINNING_FIRST_CONVERSATION_TITLE,
} from './winningFirstConversation';
import { AG, PERSONAL_TYPES } from './assessmentData';
import {
  AGENT_COACH_HEADINGS,
  AGENT_HQ_EMPTY,
  AGENT_SHELL_TABS,
  LEADER_SHELL_TABS,
  SET_PASSWORD_EMAIL_NOTE,
  SET_PASSWORD_SUB,
  SET_PASSWORD_TITLE,
  TRAINING_SECTION_LABELS,
  agentCoachCopy,
  attentionItems,
  canOpenModule,
  claimEmailsMatch,
  coachProfilePath,
  courseCardsFor,
  homeAfterPassword,
  lockedInviteEmail,
  parseAgentHqTab,
  shellTabsFor,
  signedInKind,
  trainingBay,
} from './agentHq';

describe('invite / password landing', () => {
  it('sends the agent to Agent HQ Home after they set a password', () => {
    expect(signedInKind({ org: false, admin: false, agent: true })).toBe('agent');
    expect(homeAfterPassword('agent')).toBe('agent-hq');
  });

  it('leaves a leader on leader HQ after they set a password', () => {
    expect(signedInKind({ org: true, admin: false, agent: false })).toBe('leader');
    expect(homeAfterPassword('leader')).toBe('leader-hq');
  });

  it('SetPassword copy is their HQ — not Pulse and Coach', () => {
    expect(SET_PASSWORD_TITLE.toLowerCase()).toContain('password');
    expect(SET_PASSWORD_SUB).toMatch(/your HQ/i);
    expect(SET_PASSWORD_SUB).not.toMatch(/Pulse/);
    expect(SET_PASSWORD_SUB).not.toMatch(/Pulse and Coach/);
  });

  it('locks the invite email from the session — they cannot type a different address', () => {
    expect(lockedInviteEmail('Jordan@Sample.com')).toBe('Jordan@Sample.com');
    expect(lockedInviteEmail('  ')).toBeNull();
    expect(lockedInviteEmail(null)).toBeNull();
    expect(claimEmailsMatch('jordan@sample.com', 'Jordan@Sample.com')).toBe(true);
    expect(claimEmailsMatch('jordan@sample.com', 'other@sample.com')).toBe(false);
    expect(SET_PASSWORD_EMAIL_NOTE.toLowerCase()).toMatch(/invite was sent/);
    expect(SET_PASSWORD_EMAIL_NOTE.toLowerCase()).toMatch(/different/);
  });
});

describe('agent vs leader shell', () => {
  it('gives agents Home / Coach / Training — never Pulse or Rep', () => {
    expect(shellTabsFor('agent')).toEqual(AGENT_SHELL_TABS);
    expect(AGENT_SHELL_TABS).toEqual(['Home', 'Coach', 'Training']);
    expect(AGENT_SHELL_TABS).not.toContain('Pulse');
    expect(AGENT_SHELL_TABS).not.toContain('Rep');
  });

  it('leaves the leader shell on Home / Pulse / Coach / Rep', () => {
    expect(shellTabsFor('leader')).toEqual(LEADER_SHELL_TABS);
    expect(LEADER_SHELL_TABS).toEqual(['Home', 'Pulse', 'Coach', 'Rep']);
  });

  it('routes Agent HQ tabs from the hash without claiming leader Pulse/Rep', () => {
    expect(parseAgentHqTab('/')).toBe('home');
    expect(parseAgentHqTab('#/coach')).toBe('coach');
    expect(parseAgentHqTab('/training')).toBe('training');
    expect(parseAgentHqTab('/learn')).toBe('home');
    expect(parseAgentHqTab('/learn/training')).toBe('training');
    expect(parseAgentHqTab('/learn/coach')).toBe('coach');
    expect(parseAgentHqTab('/pulse')).toBe('home');
    expect(parseAgentHqTab('/rep')).toBe('home');
  });
});

describe('Official Training is openable without a quiz', () => {
  it('opens Official Training even when qs is empty', () => {
    expect(canOpenModule({
      id: OFFICIAL_TRAINING_ID,
      title: OFFICIAL_TRAINING_TITLE,
      qs: [],
      cards: [],
    })).toBe(true);
  });

  it('still opens Days 2 and 3 the way they already play — by cards or quiz', () => {
    expect(canOpenModule({
      id: WINNING_FIRST_CONVERSATION_ID,
      qs: [{ id: 'q' }],
      cards: [],
    })).toBe(true);
    expect(canOpenModule({
      id: SHOW_LIKE_A_PRO_ID,
      qs: [],
      cards: [{ t: 'slide' }],
    })).toBe(true);
  });

  it('fills Official Training cards when the live row has none', () => {
    const cards = courseCardsFor({ id: OFFICIAL_TRAINING_ID, cards: [] });
    expect(cards.length).toBeGreaterThan(0);
    expect(cards).toEqual(OFFICIAL_TRAINING_CARDS);
  });
});

describe('Training bay sections', () => {
  it('labels the three sections exactly and places Official Training as start-here', () => {
    const extra = { id: 'custom-1', title: 'Sphere scripts' };
    const bay = trainingBay([
      { id: SHOW_LIKE_A_PRO_ID, title: SHOW_LIKE_A_PRO_TITLE },
      extra,
      { id: OFFICIAL_TRAINING_ID, title: OFFICIAL_TRAINING_TITLE },
      { id: WINNING_FIRST_CONVERSATION_ID, title: WINNING_FIRST_CONVERSATION_TITLE },
    ]);
    expect(bay.map((s) => s.label)).toEqual([
      TRAINING_SECTION_LABELS.newAgents,
      TRAINING_SECTION_LABELS.zillow,
      TRAINING_SECTION_LABELS.additional,
    ]);
    expect(TRAINING_SECTION_LABELS).toEqual({
      newAgents: 'New agents',
      zillow: 'Zillow onboarding',
      additional: 'Additional training',
    });
    expect(bay[0].modules.map((m) => m.title)).toEqual([OFFICIAL_TRAINING_TITLE]);
    expect(bay[1].modules.map((m) => m.title)).toEqual([
      SHOW_LIKE_A_PRO_TITLE,
      OFFICIAL_TRAINING_TITLE,
      WINNING_FIRST_CONVERSATION_TITLE,
    ]);
    expect(bay[2].modules).toEqual([extra]);
  });
});

describe('Home — needs your attention', () => {
  it('lists assessment, unfinished Zillow days, and unticked 1:1 commitments', () => {
    const items = attentionItems({
      assessed: false,
      unfinishedZillow: [{ id: OFFICIAL_TRAINING_ID, title: OFFICIAL_TRAINING_TITLE }],
      openCommitments: [{ id: 'c1', text: 'Call every new lead within 5 minutes' }],
    });
    expect(items.map((i) => i.key)).toEqual([
      'assessment',
      `training-${OFFICIAL_TRAINING_ID}`,
      'commit-c1',
    ]);
    expect(items[0].tab).toBe('coach');
    expect(items[1].tab).toBe('training');
  });

  it('has a short premium empty state when they are current — not a blank page', () => {
    expect(attentionItems({ assessed: true, unfinishedZillow: [], openCommitments: [] })).toEqual([]);
    expect(AGENT_HQ_EMPTY.length).toBeGreaterThan(20);
    expect(AGENT_HQ_EMPTY.length).toBeLessThan(160);
  });
});

describe('Coach headings Eric locked', () => {
  it('uses the existing first-person headings only', () => {
    expect(AGENT_COACH_HEADINGS.best).toBe('At your best');
    expect(AGENT_COACH_HEADINGS.worst).toBe('At your worst');
    expect(AGENT_COACH_HEADINGS.strongest).toBe(
      'Strongest when you show up correctly / take care of yourself',
    );
  });

  it('maps those headings onto AG + PERSONAL_TYPES — no invented archetype text', () => {
    const work = 'P-Pro-R-D';
    const personal = 'P-Rec-R-I';
    const copy = agentCoachCopy({ workCode: work, personalCode: personal });
    expect(copy).not.toBeNull();
    expect(copy?.best.work).toBe(AG[work].sup);
    expect(copy?.worst.work).toBe(AG[work].watch);
    expect(copy?.strongest.edge).toBe(AG[work].edge);
    expect(copy?.strongest.challenge).toBe(AG[work].challenge);
    expect(copy?.best.personal).toEqual(PERSONAL_TYPES[personal].strengths);
    expect(copy?.worst.personal).toBe(PERSONAL_TYPES[personal].watch);
  });

  it('wires the Coach tab through GET /data/coach/profile?agentId=', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(coachProfilePath(id)).toBe(`/data/coach/profile?agentId=${id}`);
  });
});

describe('Agent HQ visibility', () => {
  function classNamesWithReveal(src: string): string[] {
    return [...src.matchAll(/className=\{?[`'"]([^`'"]*)[`'"]/g)]
      .map((m) => m[1])
      .filter((c) => /\breveal\b/.test(c));
  }

  it('does not apply .reveal, so content starts at opacity 1 without the leader observer', () => {
    expect(classNamesWithReveal(agentHqPage)).toEqual([]);
    expect(classNamesWithReveal(agentHqShell)).toEqual([]);
  });
});
