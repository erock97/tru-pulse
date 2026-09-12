import { describe, expect, it } from 'vitest';
import { getWorkshopDefinition, learnerWorkshopDefinition, workshopCatalog, WORKSHOP_VERSION } from '../../../shared/workshopCatalog';
import guide1 from '../../public/workshops/day1-guide.html?raw';
import guide2 from '../../public/workshops/day2-guide.html?raw';
import guide3 from '../../public/workshops/day3-guide.html?raw';
import guide4 from '../../public/workshops/day4-guide.html?raw';
import worksheet2 from '../../public/workshops/day2-resources.html?raw';

describe('versioned live curriculum', () => {
  it('uses globally unique stable slide/activity/choice/field identifiers and matching durations', () => {
    const slideIds: string[] = [];
    const activityIds: string[] = [];
    for (const definition of Object.values(workshopCatalog)) {
      expect(definition.version).toBe(WORKSHOP_VERSION);
      expect(definition.duration).toBe(definition.slides.reduce((sum, slide) => sum + slide.time, 0));
      slideIds.push(...definition.slides.map(slide => slide.id));
      activityIds.push(...definition.activities.map(activity => activity.id));
      for (const activity of definition.activities) {
        expect(definition.slides.find(slide => slide.id === activity.slideId)?.activity?.id).toBe(activity.id);
        if (activity.choices) {
          expect(new Set(activity.choices.map(choice => choice.id)).size).toBe(activity.choices.length);
          expect(activity.choices.some(choice => choice.id === activity.correctChoiceId)).toBe(true);
        }
        if (activity.fields) expect(new Set(activity.fields.map(field => field.id)).size).toBe(activity.fields.length);
        if (activity.kind !== 'choice') expect(activity.correctChoiceId).toBeUndefined();
      }
    }
    expect(new Set(slideIds).size).toBe(slideIds.length);
    expect(new Set(activityIds).size).toBe(activityIds.length);
  });

  it('keeps the five original FUB scenarios and deal demonstration in the 57-minute task-first flow', () => {
    const day = workshopCatalog[1];
    expect(day.duration).toBe(57);
    expect(day.slides.filter(slide => slide.native === 'practice').map(slide => slide.scenario)).toEqual([
      'set-appointment', 'spoke-note', 'noanswer-task', 'avery-repair', 'offer-accepted',
    ]);
    expect(day.slides.filter(slide => slide.native === 'deal')).toHaveLength(1);
    const firstRecord = day.slides.findIndex(slide => slide.native === 'practice');
    expect(day.slides.slice(0, firstRecord).reduce((sum, slide) => sum + slide.time, 0)).toBe(5);
    expect(day.activities.some(activity => activity.kind === 'choice')).toBe(false);
    expect(day.slides.map(slide => slide.body).join('')).toContain('/rep-lab/list-full.png');
    expect(day.slides.map(slide => slide.body).join('')).toContain('/rep-lab/detail-full.png');
    const nurture = day.activities.find(activity => activity.kind === 'discussion')!;
    expect(nurture.fields).toHaveLength(3);
    expect(nurture.correctChoiceId).toBeUndefined();
    expect(nurture.model).toBeUndefined();
    const note = day.slides.find(slide => slide.activity?.id === nurture.id)!.notes;
    expect(note).toContain('team’s actual nurture rule');
    expect(note).toContain('Do not invent a timeline');
  });

  it('starts Days 2–4 with individual responses and an observed attempt inside ten minutes', () => {
    for (const day of [2, 3, 4]) {
      const definition = workshopCatalog[day];
      expect(definition.slides[0].activity?.id).toBe(`day${day}-opening-decision`);
      expect(definition.slides[0].activity?.kind).toBe('choice');
      expect(definition.slides[0].activity?.fields?.length).toBeGreaterThan(0);
      expect(definition.slides[1].activity?.kind).toBe('roleplay');
      expect(definition.slides[1].time + definition.slides[0].time).toBeLessThanOrEqual(10);
      expect(definition.slides[1].notes).toContain('targeted retry');
      expect(definition.slides[1].notes).toContain('Do not label a peer or self-check as coach sign-off');
    }
    const model = workshopCatalog[2].slides[0].activity!.model!;
    expect(model).toContain('Sam with Northside Realty');
    expect(model).toContain('featured partner with Zillow');
    expect(model).toContain('calling about your request to see');
    expect(model).toContain('Saturday morning or afternoon');
  });

  it('preserves full rotations and the existing instructional body behind the openings', () => {
    expect(workshopCatalog[2].slides.find(slide => slide.sourceScreen === 14)?.time).toBe(16);
    expect(workshopCatalog[3].slides.find(slide => slide.sourceScreen === 15)?.time).toBe(16);
    expect(workshopCatalog[4].slides.find(slide => slide.sourceScreen === 12)?.time).toBe(8);
    for (const [day, required] of [[2, [3, 4, 7, 8, 9, 10, 11, 13, 15, 16, 17, 18]], [3, [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 17, 18, 19]], [4, [3, 4, 5, 6, 7, 10, 11, 13, 14, 15, 16, 17, 18]]] as const) {
      for (const originalScreen of required) expect(workshopCatalog[day].slides.some(slide => slide.sourceScreen === originalScreen)).toBe(true);
    }
  });

  it('asks for a changed showing plan only after the buyer has supplied an answer', () => {
    const [opening, practice] = workshopCatalog[3].slides;
    expect(opening.activity!.fields!.map(field => field.id)).toEqual(['next-question']);
    expect(opening.body).not.toContain('data-save="plan-change"');
    expect(practice.activity!.fields!.map(field => field.id)).toEqual(['buyer-answer', 'plan-change', 'retry']);
    expect(practice.notes).toContain('after the conversation, not before the buyer has spoken');
    expect(practice.notes).toContain('previous opening activity’s model');
  });

  it('redacts unrevealed answers, models, and instructor notes from the live learner snapshot', () => {
    for (const definition of Object.values(workshopCatalog)) {
      const learner = learnerWorkshopDefinition(definition);
      for (const slide of learner.slides) {
        expect(slide.notes).toBe('');
        expect(slide.cue).toBe('');
        if (!slide.activity) continue;
        expect(slide.body).not.toMatch(/data-correct|data-feedback|<textarea|<input|<button|<details/);
        expect(slide.activity.correctChoiceId).toBeUndefined();
        expect(slide.activity.model).toBeUndefined();
        expect(slide.activity.explanation).toBeUndefined();
      }
      for (const activity of learner.activities) {
        expect(activity.model).toBeUndefined();
        expect(activity.correctChoiceId).toBeUndefined();
      }
    }
  });

  it('reveals one activity without exposing other keys or mutating the frozen snapshot', () => {
    const original = getWorkshopDefinition(2)!;
    const first = original.activities[0];
    const revealed = learnerWorkshopDefinition(original, [first.id]);
    expect(revealed.activities[0].model).toBe(first.model);
    expect(revealed.activities[0].correctChoiceId).toBe(first.correctChoiceId);
    expect(revealed.activities.slice(1).every(activity => activity.model === undefined)).toBe(true);
    revealed.slides[0].title = 'A local change';
    expect(original.slides[0].title).not.toBe('A local change');
    original.slides[0].title = 'Another local change';
    expect(getWorkshopDefinition(2)!.slides[0].title).not.toBe('Another local change');
    expect(getWorkshopDefinition(99)).toBeNull();
  });

  it('keeps generated guides in sync and excludes answer examples from the learner worksheet', () => {
    for (const [index, guide] of [guide1, guide2, guide3, guide4].entries()) {
      const day = workshopCatalog[index + 1];
      expect(guide).toContain(`${day.duration} minutes including practice`);
      expect(guide).toContain(WORKSHOP_VERSION);
      expect(guide).toContain('unsubmitted writing stays private');
      expect(guide).toContain('Practice readiness, quiz certification, and activation remain separate');
      expect(guide).toContain('fresh case in three days');
    }
    expect(worksheet2).not.toContain(workshopCatalog[2].activities[0].model);
    expect(worksheet2).toContain('this printable worksheet is a backup');
  });
});
