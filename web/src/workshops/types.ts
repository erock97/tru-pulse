export type WorkshopSlide = {
  chapter: string; title: string; lead: string; body: string; notes: string; cue: string;
  time: number; theme: string; native?: 'practice' | 'deal'; scenario?: string;
};
export type WorkshopData = {
  day: number; title: string; hero: string; slides: WorkshopSlide[]; resources: string;
  cases: {name: string; quote: string; goal: string}[] | null;
};
export const workshopMeta: Record<number,{title:string;summary:string;minutes:number;screens:number}> = {
  1:{title:'Welcome to Zillow Preferred',summary:'Find the contact, update the true stage, write a useful note, and set the next task. Includes five record exercises.',minutes:79,screens:24},
  2:{title:'Winning the First Conversation',summary:'Use LEAD on the first call. Practice introductions, showing invitations, buyer questions, and follow-up.',minutes:71,screens:18},
  3:{title:'Show Like a Pro',summary:'Prepare the tour, learn what the buyer thought, and agree on the next step. Includes buyer cases and partner feedback.',minutes:73,screens:19},
  4:{title:'Zillow Home Loans',summary:'Practice lender introductions, buyer concerns, and follow-up.',minutes:58,screens:18},
};
export function workshopDay(module: {id: string; cards?: {deck?: string}[] | null}): number | null {
  const ids: Record<string,number> = {
    'a6666666-6666-6666-6666-666666666666': 1,
    'a8888888-8888-8888-8888-888888888888': 2,
    'a7777777-7777-7777-7777-777777777777': 3,
  };
  return ids[module.id] ?? (module.cards?.some(c=>c.deck==='tru-day4') ? 4 : null);
}
