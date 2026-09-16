import { workshopCatalog } from '../../../shared/workshopCatalog';
import type { WorkshopActivity } from '../../../shared/workshopCatalog';
export type WorkshopSlide = {
  id?: string; activity?: WorkshopActivity;
  chapter: string; title: string; lead: string; body: string; notes: string; cue: string;
  time: number; theme: string; native?: 'practice' | 'deal' | 'map'; scenario?: string;
};
export type WorkshopData = {
  day: number; version?: string; title: string; hero: string; slides: WorkshopSlide[]; resources: string;
  cases: {name: string; quote: string; goal: string}[] | null;
};
const summaries: Record<number,string> = {
  1:'Watch the steps, practice five Follow Up Boss record scenarios, and verify saved actions.',
  2:'Discuss and practice lead response, LEAD, discovery, and an agreed next step.',
  3:'Prepare the tour, conduct the showing, ask about an offer, and agree on a useful plan.',
  4:'Understand financing questions, offer a useful lender introduction, and complete the handoff.',
};
export const workshopMeta: Record<number,{title:string;summary:string;minutes:number;screens:number}> = Object.fromEntries(
  Object.values(workshopCatalog).map(day => [day.day,{title:day.title,summary:summaries[day.day],minutes:day.duration,screens:day.slides.length}])
);
export function workshopDay(module: {id: string; cards?: {deck?: string}[] | null}): number | null {
  const ids: Record<string,number> = {
    'a6666666-6666-6666-6666-666666666666': 1,
    'a8888888-8888-8888-8888-888888888888': 2,
    'a7777777-7777-7777-7777-777777777777': 3,
  };
  return ids[module.id] ?? (module.cards?.some(c=>c.deck==='tru-day4') ? 4 : null);
}
