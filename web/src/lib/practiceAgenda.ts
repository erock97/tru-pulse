import {assignmentClosed, type CoachingAssignment} from '../../../shared/coachingAssignments';

export function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

/** Submitted practice needs a response even while a linked quiz is unfinished. */
export function practiceAgenda(rows: CoachingAssignment[], today = localDay()) {
  const open = rows.filter(a => !assignmentClosed(a));
  const pending = (a: CoachingAssignment) => !!a.practiceAt && (!a.reviewedAt || a.practiceAt > a.reviewedAt);
  const dateOrder = (a: CoachingAssignment, b: CoachingAssignment) =>
    (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || (a.practiceAt || a.createdAt).localeCompare(b.practiceAt || b.createdAt);
  return {
    toReview: open.filter(pending).sort(dateOrder),
    overdue: open.filter(a => !pending(a) && /^\d{4}-\d{2}-\d{2}$/.test(a.dueDate) && a.dueDate < today).sort(dateOrder),
  };
}
