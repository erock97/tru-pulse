// The Coach hash route: `#/coach` for the roster, `#/coach/<agentId>` for one
// agent's 1:1 sheet. Keeping the open agent in the URL means a refresh, the
// back button, and a bookmark all land back on the same sheet instead of the
// top of the team list.
//
// Pure string work on purpose — no `window` — so it is unit-testable in the
// node test environment the web package uses.

/** Strip any query string; routes here never carry one meaningfully. */
function pathOf(route: string): string {
  return route.split('?')[0];
}

export function coachRoute(agentId: string | null): string {
  return agentId ? `/coach/${encodeURIComponent(agentId)}` : '/coach';
}

export function isCoachRoute(route: string): boolean {
  const p = pathOf(route);
  return p === '/coach' || p.startsWith('/coach/');
}

export function parseCoachAgentId(route: string): string | null {
  const p = pathOf(route);
  if (!p.startsWith('/coach/')) return null;
  let raw = p.slice('/coach/'.length);
  if (!raw) return null;
  // `/coach/<id>/profile` still names the same agent; the trailing segment is
  // which VIEW of them is open (see parseCoachView).
  if (raw.endsWith('/profile')) raw = raw.slice(0, -'/profile'.length);
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw; // a malformed escape is still better than crashing the route
  }
}

/** Which view of the open agent: their 1:1 prep sheet, or the full Profile. */
export function parseCoachView(route: string): 'sheet' | 'profile' {
  return pathOf(route).endsWith('/profile') ? 'profile' : 'sheet';
}

export function coachProfileRoute(agentId: string): string {
  return `/coach/${encodeURIComponent(agentId)}/profile`;
}
