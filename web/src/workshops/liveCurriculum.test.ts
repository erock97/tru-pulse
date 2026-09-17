import { describe, expect, it } from 'vitest';
import { getWorkshopDefinition, learnerWorkshopDefinition, workshopCatalog } from '../../../shared/workshopCatalog';
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
      expect(definition.version).toBe(definition.day===4?'2026-09-17-day4-two-sections-v5':`2026-09-16-day${definition.day}-quadrants-v${definition.day===3?4:2}`);
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

  it('keeps the five original FUB scenarios and deal demonstration in the 61-minute Preferred overview', () => {
    const day = workshopCatalog[1];
    expect(day.duration).toBe(61);
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

  it('introduces every day and discusses each quadrant before teaching on days 2–4', () => {
    for (const day of [2,3,4]) {
      const d=workshopCatalog[day];
      expect(d.slides[0].activity).toBeUndefined();
      expect(d.slides[1].id).toBe(`day${day}-agenda`);
      const starts=d.slides.flatMap((s,i)=>s.theme.includes('quadrant-cover')?[i]:[]);
      expect(starts).toHaveLength(day===4?2:4);
      for(const start of starts){
        const first=d.slides[start+1];
        // A consolidated concern list may introduce the topic before its discussion.
        expect(first.activity || d.slides[start+2].activity).toBeTruthy();
      }
    }
    const day2=workshopCatalog[2];
    expect(day2.duration).toBe(90);
    expect(day2.activities.filter(a=>a.kind==='roleplay').map(a=>a.id)).toEqual(['day2-discovery-practice','day2-full-call-practice']);
    expect(day2.slides.find(s=>s.id==='day2-full-call-practice')?.time).toBe(16);
    expect(day2.slides.find(s=>s.id==='day2-live-connection')?.body).toContain('live-screen-0.png');
    expect(day2.slides.find(s=>s.id==='day2-real-time-touring')?.body).toContain('rtt-request.png');
    expect(day2.slides.find(s=>s.id==='day2-alms')?.body).toContain('Lead with who you are');
    const pos=(id:string)=>day2.slides.findIndex(s=>s.id===`day2-${id}`);
    expect(pos('discuss-opening')).toBeLessThan(pos('alms'));
    expect(pos('conversation-starters')).toBeLessThan(pos('discovery-practice'));
    expect(pos('discuss-concern')).toBeLessThan(pos('objection-framework'));
    expect(pos('summary')).toBeLessThan(pos('full-call-practice'));
    const day4=workshopCatalog[4];
    expect(day4.slides.findIndex(s=>s.id==='day4-how-to-introduce-your-loan-officer')).toBeLessThan(day4.slides.findIndex(s=>s.id==='day4-practice-with-a-buyer-and-an-observer'));
  });

  it('retains lender knowledge and protects a speaking turn for every agent in Day Four', () => {
    const day=workshopCatalog[4];
    const ids=day.slides.map(s=>s.id);
    for(const id of ['loan-options','buyability','pre-qualification-pre-approval-and-final-approval','credit-review','lender-collaboration','questions-for-the-loan-officer'])expect(ids).toContain(`day4-${id}`);
    expect(ids.indexOf('day4-lender-experience')).toBeLessThan(ids.indexOf('day4-what-zillow-home-loans-offers-your-buyer'));
    expect(ids.indexOf('day4-discuss-introduction')).toBeLessThan(ids.indexOf('day4-when-to-introduce'));
    const practice=day.slides.find(s=>s.id==='day4-practice-with-a-buyer-and-an-observer')!;
    expect(practice.time).toBe(13);
    expect(practice.body).toContain('Three rounds · 4 minutes each');
    expect(practice.activity?.useCases).toBe(true);
    expect(day.cases).toHaveLength(4);
    expect(day.slides.find(s=>s.id==='day4-when-to-introduce')!.body).toContain('not a ZHL lending requirement');
    expect(day.slides.find(s=>s.id==='day4-credit-concerns')!.body).toContain('Let the loan officer assess credit and loan eligibility');
  });

  it('teaches Day 3 before practice and makes reasoning and an agreed plan observable', () => {
    const day=workshopCatalog[3];
    expect(day.duration).toBe(74);
    expect(day.slides.slice(0,2).map(s=>s.id)).toEqual(['day3-welcome','day3-agenda']);
    const pos=(id:string)=>day.slides.findIndex(s=>s.id===`day3-${id}`);
    for(const [teach,practice] of [['buyer-concerns','concern-framework'],['prepare','comparison-discussion'],['question-bank','different-priorities'],['problem-solving-discussion','concern-framework'],['plan-demo','full-showing-practice'],['record-the-plan','write-the-follow-up-record']]) {
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
    expect(day.slides.at(-1)?.chapter).toBe('Review and reference');
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

  it('keeps generated guides in sync and separates practice from review explanations', () => {
    for (const [index, guide] of [guide1, guide2, guide3, guide4].entries()) {
      const day = workshopCatalog[index + 1];
      expect(guide).toContain(`${day.duration} minutes including practice`);
      expect(guide).toContain(day.version);
      expect(guide).toContain('unsubmitted writing stays private');
      expect(guide).toContain('Practice readiness, quiz certification, and activation remain separate');
      expect(guide).toContain('fresh case in three days');
    }
    const answerSection = worksheet2.indexOf('<h2>Review after your first attempt</h2>');
    expect(answerSection).toBeGreaterThan(worksheet2.indexOf('<h2>Practice notes</h2>'));
    expect(worksheet2.slice(0, answerSection)).not.toContain(workshopCatalog[2].activities[0].model);
    expect(worksheet2.slice(answerSection)).toContain(workshopCatalog[2].activities[0].model);
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

it('keeps choices separate from open discussion and gives both an explanation',()=>{
 const questions=getWorkshopDefinition(2)!.activities.filter(a=>a.kind!=='roleplay');
 expect(questions.filter(a=>a.kind==='choice')).toHaveLength(6);
 expect(questions.filter(a=>a.kind==='discussion')).toHaveLength(4);
 for(const q of questions){expect(q.fields).toHaveLength(1);expect(q.model).toBeTruthy();if(q.kind==='choice')expect(q.choices!.length).toBeGreaterThanOrEqual(2);}
});
