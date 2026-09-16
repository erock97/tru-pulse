import type { UserClient } from './asUser.js';
import { validateDisplayName } from '../../shared/displayName.js';

/** Applied only to presentation responses. CRM reporting keeps its source names. */
export async function displayNames<T extends { id: string; name: string }>(client: UserClient, agents: T[]): Promise<T[]> {
  if (!agents.length) return agents;
  const names = await client.select<{ agent_id: string; display_name: string }>(
    'agent_display_names', 'select=agent_id,display_name', { strict: true },
  );
  const byId = new Map(names.map(row => [row.agent_id, row.display_name]));
  return agents.map(agent => ({ ...agent, name: byId.get(agent.id) ?? agent.name }));
}

export async function handleDisplayName(req: Request, client: UserClient, cors: Record<string,string>, originOk: boolean): Promise<Response> {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { ...cors, 'Cache-Control': 'private, no-store' } });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!originOk) return json({ error: 'Origin denied' }, 403);
  let body: { agentId?: unknown; name?: unknown };
  let name: string;
  try {
    const text = await req.text();
    if (text.length > 2048) return json({ error: 'Name request is too large' }, 413);
    body = JSON.parse(text);
    name = validateDisplayName(body?.name);
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'Invalid name' }, 400); }
  if (typeof body.agentId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.agentId)) return json({ error: 'Invalid agent' }, 400);
  try {
    // Invoker RPC: RLS permits the owner or their team's admin/leader only.
    const result = await client.rpc<string>('set_agent_display_name', { p_agent_id: body.agentId, p_name: name });
    if (!result.ok || result.data !== name) return json({ error: 'You cannot change this name.' }, 403);
    return json({ name: result.data });
  } catch { return json({ error: 'Your name could not be saved. Please try again.' }, 503); }
}
