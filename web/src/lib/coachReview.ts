import type { BriefAgentView, BriefPointView } from './coachBriefData';

/** Both Coach surfaces use the report's order and evidence, never a second plan. */
export function reviewFindings(agent: BriefAgentView): BriefPointView[] {
  const primary = agent.opportunities.length ? agent.opportunities : agent.coachingActions;
  const seen = new Set<string>();
  return primary.filter(point => {
    const key = point.text.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!key || !point.evidence.length || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
