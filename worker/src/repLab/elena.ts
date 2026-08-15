/** Elena Brooks — Day 1 closer. 8/10, no critical miss. Keys stay on the server. */

import type { LabCheck, LabGrade, LabSubmission } from './avery.js';

export const ELENA_ID = 'elena-homework';

function norm(s: string | undefined): string {
  return (s ?? '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
}
function hasAny(hay: string, needles: string[]): boolean {
  return needles.some((n) => hay.includes(n));
}

interface Weighted extends LabCheck { points: number; max: number }

export function gradeElena(sub: LabSubmission): LabGrade & { score: number; max: number } {
  const note = norm(sub.note);
  const stage = norm(sub.stage);
  const title = norm(sub.task?.title);
  const due = norm(sub.task?.due);
  const owner = norm(sub.task?.owner);
  const name = norm(sub.contactName);
  const channel = norm(sub.channel);

  const items: Weighted[] = [];

  const contactOk = !!name && (name.includes('elena') || name.includes('brooks'));
  items.push(check('contact', contactOk, 1, !contactOk, contactOk ? 'Correct record.' : 'This is not the assigned practice contact.'));

  const contextOk = hasAny(note, ['4:30', '430', '908', '875', 'alder', 'viewed', 'saved']);
  items.push(check('context', contextOk, 1, false, contextOk ? 'Context is in the note.' : 'The note does not show you read the visible activity or contact timing.'));

  const channelOk = !channel || hasAny(channel, ['phone', 'call', 'practice']);
  items.push(check('channel', channelOk, 1, false, channelOk ? 'Channel is acceptable.' : 'Use the confirmed calling path or name the practice substitute.'));

  const reached = hasAny(note, ['reached', 'spoke', 'talked', 'connected']);
  items.push(check('attempt', reached, 1, false, reached ? 'The attempt is on the record.' : 'The note does not say you reached her.'));

  const stageOk = stage === 'spoke with customer' || stage === 'spoke with';
  const appointment = stage.includes('appointment');
  items.push(check(
    'stage',
    stageOk,
    2,
    appointment || (!stageOk && !!stage),
    stageOk ? 'Stage matches what happened.' : appointment
      ? 'That stage needs a confirmed date and time. This call did not have one.'
      : 'The stage does not match what actually happened.',
  ));

  const noteBits = [
    hasAny(note, ['sister']),
    hasAny(note, ['olympia', 'lacey']),
    hasAny(note, ['3 bed', 'three bed', '3-bed', 'bedroom']),
    hasAny(note, ['november', 'nov']),
    hasAny(note, ['alder', '908', '875']),
    hasAny(note, ['monday', 'mon', '8/17', 'aug 17']),
  ].filter(Boolean).length;
  const notePts = noteBits >= 5 ? 2 : noteBits >= 3 ? 1 : 0;
  items.push({
    id: 'note',
    pass: notePts === 2,
    points: notePts,
    max: 2,
    required: true,
    critical: hasAny(note, ['pre-approved', 'credit score', 'ready to buy because']),
    message: notePts === 2
      ? 'Note has the outcome, the need, and the next step.'
      : 'The note is missing what happened, what she needs, or what happens next.',
  });

  const taskOk = hasAny(title, ['alder', 'summary', 'elena', 'two-home', 'two home']) && !!owner && hasAny(due, ['mon', 'monday', '8/17', 'aug 17', '9:30', '930']);
  items.push(check('task', taskOk, 2, false, taskOk ? 'Task has an action, an owner, and a time.' : 'The task needs a concrete action, an owner, and Monday morning.'));

  const score = items.reduce((s, c) => s + c.points, 0);
  const max = items.reduce((s, c) => s + c.max, 0);
  const critical = items.some((c) => c.critical && !c.pass);
  const passed = !critical && score >= 8;
  return {
    passed,
    phase: 'repair',
    checks: items.map(({ id, pass, message, required, critical: crit }) => ({ id, pass, message, required, critical: crit })),
    critical,
    score,
    max,
  };
}

function check(id: string, pass: boolean, max: number, critical: boolean, message: string): Weighted {
  return { id, pass, message, required: true, critical, points: pass ? max : 0, max };
}
