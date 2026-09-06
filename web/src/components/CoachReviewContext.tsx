import { createContext, useContext, useState, type ReactNode } from 'react';

type ReviewState = {
  orgId: string;
  reportId: string | null;
  setReportId: (id: string | null) => void;
  selected: string;
  setSelected: (name: string) => void;
};
const Context = createContext<ReviewState | null>(null);
export function CoachReviewProvider({ orgId, children }: { orgId: string; children: ReactNode }) {
  const [reportId, setReportId] = useState<string | null>(null);
  const [selected, setSelected] = useState('');
  return <Context.Provider value={{ orgId, reportId, setReportId, selected, setSelected }}>{children}</Context.Provider>;
}
export function useCoachReview() {
  const state = useContext(Context);
  if (!state) throw new Error('Coach review requires its team workspace.');
  return state;
}
