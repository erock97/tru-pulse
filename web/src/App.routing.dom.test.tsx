// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import App from './App';
import { myOrg, adminLeaders, claimAgent, myAgent } from './lib/api';
import type { AuthState } from './lib/auth';
const auth = vi.hoisted(() => ({ session: { user: { id: 'michael', email: 'mnavarrarealtor@gmail.com' } } as AuthState | null }));
vi.mock('./lib/auth', () => ({
 onAuthChange: (fn: (s: AuthState | null) => void) => { fn(auth.session); return () => {}; },
 onPasswordRecovery: () => () => {}, signOut: vi.fn(), exchangeLink: vi.fn(),
}));
vi.mock('./lib/api', () => ({ isDemo: false, myOrg: vi.fn(), adminLeaders: vi.fn(), claimAgent: vi.fn(), myAgent: vi.fn() }));
vi.mock('./components/OperationsContext', () => ({ OperationsProvider: ({ children }: any) => children }));
vi.mock('./pages/Earnings', () => ({ default: () => <div>Earnings</div> }));
vi.mock('./pages/Today', () => ({ default: () => <div>Today</div> }));
vi.mock('./pages/Login', () => ({ default: () => <div>Login</div> }));
vi.mock('./pages/Home', () => ({ default: () => <div>Home</div> }));
vi.mock('./pages/AdminTeams', () => ({ default: () => <div>AdminTeams</div> }));
vi.mock('./pages/AdminAutomations', () => ({ default: () => <div>AdminAutomations</div> }));
vi.mock('./pages/AdminTargets', () => ({ default: () => <div>AdminTargets</div> }));
vi.mock('./pages/AdminRevenue', () => ({ default: () => <div>AdminRevenue</div> }));
vi.mock('./pages/AdminContracts', () => ({ default: () => <div>AdminContracts</div> }));
vi.mock('./pages/AdminCalendar', () => ({ default: () => <div>AdminCalendar</div> }));
vi.mock('./pages/AdminFailureLogs', () => ({ default: () => <div>AdminFailureLogs</div> }));
vi.mock('./pages/TeamAdmin', () => ({ default: () => <div>TeamAdmin</div> }));
vi.mock('./pages/PulseLab', () => ({ default: () => <div>PulseLab</div> }));
vi.mock('./pages/Lab', () => ({ default: () => <div>Lab</div> }));
vi.mock('./pages/RosterDeck', () => ({ default: () => <div>RosterDeck</div> }));
vi.mock('./pages/Dashboard', () => ({ default: () => <div>Dashboard</div> }));
vi.mock('./pages/Coach', () => ({ default: () => <div>Coach</div> }));
vi.mock('./pages/Rep', () => ({ default: () => <div>Rep</div> }));
vi.mock('./pages/AgentHq', () => ({ default: () => <div>AgentHq</div> }));
vi.mock('./pages/DeckPreview', () => ({ default: () => <div>DeckPreview</div> }));
vi.mock('./pages/WorkshopLesson', () => ({ default: () => <div>WorkshopLesson</div> }));
vi.mock('./pages/LiveSessions', () => ({ default: () => <div>LiveSessions</div> }));
vi.mock('./pages/SetPassword', () => ({ default: () => <div>SetPassword</div> }));
vi.mock('./pages/Assess', () => ({ default: () => <div>Assess</div> }));
vi.mock('./pages/ConfirmClosings', () => ({ default: () => <div>ConfirmClosings</div> }));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
 vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
 vi.stubGlobal('scrollTo', vi.fn());
 window.history.replaceState(null, '', '/');
 auth.session = { user: { id: 'michael', email: 'mnavarrarealtor@gmail.com' } };
 vi.mocked(myOrg).mockResolvedValue(null);
 vi.mocked(adminLeaders).mockResolvedValue(null);
 vi.mocked(claimAgent).mockResolvedValue(null);
 vi.mocked(myAgent).mockResolvedValue(null);
 host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(<App />)); }
it('shows account help, never team provisioning, when a signed-in invite cannot be matched', async () => {
 await render();
 expect(host.textContent).toContain('Let’s connect your account.');
 expect(host.textContent).toContain('mnavarrarealtor@gmail.com');
 expect(host.textContent).toContain('Try again');
 expect(host.textContent).toContain('Sign in with another email');
 expect(host.querySelector('input')).toBeNull();
 expect(host.textContent).not.toContain('FUB API key');
 expect(host.textContent).not.toContain('Create & sync');
});
it('resolves a linked agent even when the claim request fails', async () => {
 vi.mocked(claimAgent).mockRejectedValue(new Error('network'));
 vi.mocked(myAgent).mockResolvedValue({ id: 'a', name: 'Michael', org_id: 'o', team_id: 't' });
 await render(); expect(host.textContent).toBe('AgentHq');
});
it('offers recovery when the agent lookup rejects', async () => {
 vi.mocked(myAgent).mockRejectedValue(new Error('network'));
 await render(); expect(host.textContent).toContain('Let’s connect your account.');
});
it('keeps leaders in their workspace', async () => {
 vi.mocked(myOrg).mockResolvedValue({ id: 'o', name: 'Loving', plan: 'pro' });
 await render(); expect(host.textContent).toBe('Today');
});
it('keeps platform owners in team administration', async () => {
 vi.mocked(adminLeaders).mockResolvedValue([]);
 await render(); expect(host.textContent).toBe('AdminTeams');
});
it('keeps signed-out visitors on login', async () => {
 auth.session = null; await render(); expect(host.textContent).toBe('Login');
});
it('keeps password setup ahead of account help', async () => {
 window.location.hash = 'type=invite';
 await render(); expect(host.textContent).toBe('SetPassword');
});

