import type { WorkshopActivity } from '../../../shared/workshopCatalog';
export type WorkshopSlide = {
  id?: string; activity?: WorkshopActivity;
  chapter: string; title: string; lead: string; body: string; notes: string; cue: string;
  time: number; theme: string; native?: 'practice' | 'deal'; scenario?: string;
};
export type WorkshopData = {
  day: number; version?: string; title: string; hero: string; slides: WorkshopSlide[]; resources: string;
  cases: {name: string; quote: string; goal: string}[] | null;
};
export const workshopMeta: Record<number,{title:string;summary:string;minutes:number;screens:number}> = {
  1:{title:'Welcome to Zillow Preferred',summary:'Find the contact, save the true stage, write a useful note, and set the next task. Includes five original record exercises and a nurture discussion.',minutes:57,screens:17},
  2:{title:'Winning the First Conversation',summary:'Practice an opening in the first ten minutes, then use LEAD, buyer cases, feedback, and a targeted retry.',minutes:67,screens:16},
  3:{title:'Show Like a Pro',summary:'Learn what was missing, revise the plan, and practice the complete showing conversation with attributable partner feedback.',minutes:75,screens:19},
  4:{title:'Zillow Home Loans',summary:'Practice a relevant lender introduction, genuine permission, and a useful next action.',minutes:54,screens:16},
};
export function workshopDay(module: {id: string; cards?: {deck?: string}[] | null}): number | null {
  const ids: Record<string,number> = {
    'a6666666-6666-6666-6666-666666666666': 1,
    'a8888888-8888-8888-8888-888888888888': 2,
    'a7777777-7777-7777-7777-777777777777': 3,
  };
  return ids[module.id] ?? (module.cards?.some(c=>c.deck==='tru-day4') ? 4 : null);
}
