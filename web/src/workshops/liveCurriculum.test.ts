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
      expect(definition.version).toBe(definition.day === 1 ? '2026-09-14-preferred-foundations-v7' : definition.day === 2 ? '2026-09-15-lead-live-v16' : definition.day === 3 ? '2026-09-16-day3-showing-v5' : WORKSHOP_VERSION);
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

  it('keeps the five original FUB scenarios and deal demonstration in the 57-minute Preferred overview', () => {
    const day = workshopCatalog[1];
    expect(day.duration).toBe(57);
    expect(day.slides.filter(slide => slide.native === 'practice').map(slide => slide.scenario)).toEqual([
      'set-appointment', 'spoke-note', 'noanswer-task', 'avery-repair', 'offer-accepted',
    ]);
    expect(day.slides.filter(slide => slide.native === 'deal')).toHaveLength(1);
    const firstRecord = day.slides.findIndex(slide => slide.native === 'practice');
    expect(day.slides.slice(0, firstRecord).some(slide => slide.native === 'map')).toBe(true);
    expect(day.slides.slice(0, firstRecord).some(slide => slide.id === 'day1-preferred-standards')).toBe(true);
    expect(day.activities.filter(activity => activity.kind === 'choice').map(activity=>activity.id)).toEqual(['day1-capacity-decision']);
    expect(day.activities.find(activity=>activity.id==='day1-capacity-decision')!.fields).toBeUndefined();
    expect(day.slides.map(slide => slide.body).join('')).toContain('/rep-lab/list-full.png');
    expect(day.slides.filter(slide => slide.native === 'map')).toHaveLength(1);
    const nurture = day.activities.find(activity => activity.kind === 'discussion')!;
    expect(nurture.fields).toHaveLength(3);
    expect(nurture.correctChoiceId).toBeUndefined();
    expect(nurture.model).toBeUndefined();
    const note = day.slides.find(slide => slide.activity?.id === nurture.id)!.notes;
    expect(note).toContain('team’s actual nurture rule');
    expect(note).toContain('Do not invent a timeline');
  });

  it('preserves Day 4 while Day 2 introduces and teaches before practice', () => {
    for (const day of [4]) {
      const definition = workshopCatalog[day];
      expect(definition.slides[0].activity?.id).toBe(`day${day}-opening-decision`);
      expect(definition.slides[0].activity?.kind).toBe('choice');
      expect(definition.slides[0].activity?.fields?.length).toBeGreaterThan(0);
      expect(definition.slides[1].activity?.kind).toBe('roleplay');
      expect(definition.slides[1].time + definition.slides[0].time).toBeLessThanOrEqual(10);
      expect(definition.slides[1].notes).toContain('targeted retry');
      expect(definition.slides[1].notes).toContain('Do not label a peer or self-check as coach sign-off');
    }
    const day2 = workshopCatalog[2];
    expect(day2.slides[0].id).toBe('day2-welcome');
    expect(day2.slides[1].id).toBe('day2-agenda');
    expect(day2.duration).toBe(90);
    expect(day2.activities).toHaveLength(8);
    expect(day2.slides).toHaveLength(25);
    expect(day2.slides.find(s=>s.id==='day2-conversation-starters')?.body).toContain('What made you click');
    expect(day2.slides.some(s=>['day2-permission','day2-location','day2-motivation','day2-financing','day2-under-contract'].includes(s.id))).toBe(false);
    expect(day2.slides.find(s=>s.id==='day2-objection-framework')?.body).toContain('Ask questions to understand');
    expect(day2.slides.slice(0,3).every(s => !s.activity)).toBe(true);
    const position = (id: string) => day2.slides.findIndex(s => s.id === `day2-${id}`);
    for (const [instruction, practice] of [['real-time-touring','lead-discussion'],['no-answer','channel-check'],['introduction','opening-decision'],['conversation-starters','discovery-practice'],['summary','summary-practice'],['objection-framework','buyer-concerns'],['buyer-concerns','market-concern'],['objection-framework','objection-practice'],['market-concern','objection-practice'],['summary-practice','full-call-practice']]) {
      expect(position(instruction)).toBeGreaterThanOrEqual(0);
      expect(position(instruction)).toBeLessThan(position(practice));
    }
    expect(day2.activities.filter(a => a.kind === 'roleplay').map(a => a.id)).toEqual(['day2-discovery-practice','day2-full-call-practice']);
    expect(day2.activities.find(a => a.id === 'day2-full-call-practice')?.useCases).toBe(true);
    expect(day2.slides.find(s => s.id === 'day2-discovery-practice')?.body).toContain('Switch buyer and agent');
    // Screenshot walkthroughs need room to teach before the first submitted check.
    // Cap uninterrupted instruction by minutes, rather than forcing a quiz every few slides.
    let teachingMinutes = 0;
    for (const slide of day2.slides) {
      if (slide.activity) teachingMinutes = 0;
      else expect(teachingMinutes += slide.time).toBeLessThanOrEqual(13);
    }
    expect(position('lead-route-check')).toBe(-1);
    expect(day2.slides.find(s => s.id === 'day2-live-connection')?.body).toContain('live-screen-0.png');
    expect(day2.slides.find(s => s.id === 'day2-real-time-touring')?.body).toContain('rtt-request.png');
    expect(JSON.stringify(day2)).not.toMatch(/Jordan|Maya|Back to Jordan|Variation:/);
    expect(day2.slides.findIndex(s => s.id === 'day2-alms')).toBeLessThan(day2.slides.findIndex(s => s.id === 'day2-opening-decision'));
    expect(position('whole-call-one')).toBe(-1);
    expect(position('whole-call-two')).toBe(-1);
    expect(position('no-answer') + 1).toBe(position('unanswered'));
    expect(position('unanswered') + 1).toBe(position('channel-check'));
    expect(day2.slides.find(s => s.id === 'day2-full-call-practice')?.time).toBe(16);
    expect(position('objection-practice')).toBeLessThan(position('summary'));
    expect(position('summary-practice') + 1).toBe(position('full-call-practice'));
    expect(day2.slides.every(s => s.notes.includes('Handoff:') && s.cue.length > 30)).toBe(true);
    expect(day2.slides.find(s => s.id === 'day2-alms')?.body).toContain('Lead with who you are');
    expect(day2.slides.find(s => s.id === 'day2-channel')?.lead).toContain('normal business hours, 8 a.m.–8 p.m.');
  });

  it('preserves full rotations and the existing instructional body behind the openings', () => {
    expect(workshopCatalog[4].slides.find(slide => slide.sourceScreen === 12)?.time).toBe(8);
    for (const [day, required] of [[4, [3, 4, 5, 6, 7, 10, 11, 13, 14, 15, 16, 17, 18]]] as const) {
      for (const originalScreen of required) expect(workshopCatalog[day].slides.some(slide => slide.sourceScreen === originalScreen)).toBe(true);
    }
  });

  it('teaches Day 3 before practice and makes reasoning and an agreed plan observable', () => {
    const day=workshopCatalog[3];
    expect(day.duration).toBe(75);
    expect(day.slides.slice(0,2).map(s=>s.id)).toEqual(['day3-welcome','day3-agenda']);
    const pos=(id:string)=>day.slides.findIndex(s=>s.id===`day3-${id}`);
    for(const [teach,practice] of [['buyer-concerns','concern-framework'],['prepare','comparison-discussion'],['question-bank','different-priorities'],['concern-framework','problem-solving-discussion'],['plan-demo','full-showing-practice'],['record-the-plan','write-the-follow-up-record']]) {
      expect(pos(teach)).toBeGreaterThanOrEqual(0);
      expect(pos(teach)).toBeLessThan(pos(practice));
    }
    expect(day.activities.filter(a=>a.kind==='choice').every(a=>a.fields?.some(f=>f.id==='reason'))).toBe(true);
    const discussion=day.activities.find(a=>a.id==='day3-problem-solving-discussion')!;
    expect(discussion.kind).toBe('discussion');
    expect(discussion.correctChoiceId).toBeUndefined();
    expect(discussion.fields!.map(f=>f.id)).toEqual(['question','branches']);
    const practice=day.slides.find(s=>s.id==='day3-full-showing-practice')!;
    expect(practice.time).toBe(16);
    expect(practice.activity?.useCases).toBe(true);
    expect(practice.activity?.fields?.map(f=>f.id)).toEqual(['buyer-answer','plan-change','retry']);
    expect(practice.notes).toContain('after the conversation, not before the buyer has spoken');
    expect(practice.notes).toContain('Do not label a peer or self-check as coach sign-off');
    expect(day.slides.every(s=>s.notes.includes('Handoff:') && s.cue.length>30)).toBe(true);
    expect(day.cases).toHaveLength(3);
    expect(day.slides.at(-1)?.chapter).toBe('Wrap-up');
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
      expect(guide).toContain(day.version);
      expect(guide).toContain('unsubmitted writing stays private');
      expect(guide).toContain('Practice readiness, quiz certification, and activation remain separate');
      expect(guide).toContain('fresh case in three days');
    }
    expect(worksheet2).not.toContain(workshopCatalog[2].activities[0].model);
    expect(worksheet2).toContain('this printable worksheet is a backup');
  });
});

it('teaches the cap before a quiz with an explicit valid maximum',()=>{
  const day=getWorkshopDefinition(1)!;
  const quiz=day.slides.find(s=>s.id==='day1-capacity-decision')!;
  expect(day.slides.findIndex(s=>s.id==='day1-preferred-standards')).toBeLessThan(day.slides.indexOf(quiz));
  expect(quiz.activity!.choices!.find(c=>c.id===quiz.activity!.correctChoiceId)!.text).toBe('15 new leads.');
  expect(quiz.lead).toContain('completed the first month');
  expect(quiz.body).not.toContain('fewer than 20');
});

it('gives every Day 2 discussion question choices and an explanation field',()=>{const questions=getWorkshopDefinition(2)!.activities.filter(a=>a.kind!=='roleplay');expect(questions).toHaveLength(6);for(const question of questions){expect(question.kind).toBe('choice');expect(question.choices!.length).toBeGreaterThanOrEqual(2);expect(question.fields).toHaveLength(1);expect(question.prompt).toContain('explain');}});
