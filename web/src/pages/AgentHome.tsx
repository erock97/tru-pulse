// What to do today. Filled in by Task 4 of the agent-experience plan.
import type { AgentHome, AgentIdentity } from '../lib/api';

export default function AgentHomeView({ home }: {
  agent: AgentIdentity;
  home: AgentHome | null;
  onHome: (h: AgentHome) => void;
  onOpenTraining: () => void;
}) {
  if (!home) return <div className="center-wrap"><div className="spinner" /></div>;
  return <main className="ac-main" />;
}
