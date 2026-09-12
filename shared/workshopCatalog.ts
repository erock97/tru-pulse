import day1 from '../web/public/workshops/day1.json';
import day2 from '../web/public/workshops/day2.json';
import day3 from '../web/public/workshops/day3.json';
import day4 from '../web/public/workshops/day4.json';

/** JSON is the single source for the web player, server snapshots, and guides. */
export const WORKSHOP_VERSION = '2026-09-12-live-v1';
export type WorkshopActivityKind = 'choice' | 'written' | 'record' | 'roleplay' | 'discussion' | 'commitment';
export type WorkshopActivity = {
  id: string;
  kind: WorkshopActivityKind;
  prompt: string;
  choices?: { id: string; text: string }[];
  correctChoiceId?: string;
  explanation?: string;
  fields?: { id: string; label: string }[];
  rubric?: { id: string; label: string }[];
  /** Plain text: never render learner responses, model, or explanation as HTML. */
  model?: string;
  scenario?: string;
};
export type CatalogSlide = {
  id: string;
  chapter: string;
  title: string;
  lead: string;
  body: string;
  notes: string;
  cue: string;
  time: number;
  theme: string;
  native?: 'practice' | 'deal';
  scenario?: string;
  sourceScreen?: number;
  activity?: WorkshopActivity;
};
export type CatalogActivity = WorkshopActivity & { slideId: string; title: string };
export type WorkshopDefinition = {
  day: number;
  title: string;
  version: string;
  duration: number;
  slides: CatalogSlide[];
  activities: CatalogActivity[];
  hero: string;
  resources: string;
  cases: { name: string; quote: string; goal: string }[] | null;
};

function flattenActivities(slides: CatalogSlide[]): CatalogActivity[] {
  return slides.flatMap(slide => slide.activity ? [{ ...slide.activity, slideId: slide.id, title: slide.title }] : []);
}

export const workshopCatalog: Record<number, WorkshopDefinition> = Object.fromEntries(
  [day1, day2, day3, day4].map(data => {
    const slides = data.slides as CatalogSlide[];
    return [data.day, { ...data, slides, activities: flattenActivities(slides) }];
  }),
);

/** Copy at creation time; persist the complete result with the session. */
export function getWorkshopDefinition(day: number): WorkshopDefinition | null {
  const definition = workshopCatalog[day];
  return definition ? JSON.parse(JSON.stringify(definition)) as WorkshopDefinition : null;
}

/** The live React activity UI owns responses; the legacy HTML remains self-paced. */
export function liveActivityBody(body: string): string {
  return body
    .replace(/<label\s+class="field">[\s\S]*?<\/label>/g, '')
    .replace(/<div\s+class="choices"[^>]*>[\s\S]*?<\/div>/g, '')
    .replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '')
    .replace(/<div\s+class="scorecard"[^>]*>[\s\S]*?<\/div>/g, '')
    .replace(/<p\b[^>]*(?:class="feedback"|id="score")[^>]*>[\s\S]*?<\/p>/g, '')
    .replace(/<button\b[^>]*>[\s\S]*?<\/button>/g, '');
}

/**
 * Learner and projected views receive no instructor notes or unrevealed keys.
 * Call on the saved session snapshot, never on the latest catalog at read time.
 * This is controlled delivery of practice material, not an exam security boundary:
 * the self-paced course and facilitator guides remain available separately.
 */
export function learnerWorkshopDefinition(
  definition: WorkshopDefinition,
  revealedActivityIds: readonly string[] = [],
): WorkshopDefinition {
  const result = JSON.parse(JSON.stringify(definition)) as WorkshopDefinition;
  const revealed = new Set(revealedActivityIds);
  result.slides = result.slides.map(slide => {
    const clean = { ...slide, notes: '', cue: '' };
    if (clean.activity) {
      clean.body = liveActivityBody(clean.body);
      if (!revealed.has(clean.activity.id)) {
        delete clean.activity.correctChoiceId;
        delete clean.activity.explanation;
        delete clean.activity.model;
      }
    }
    return clean;
  });
  result.activities = flattenActivities(result.slides);
  return result;
}
