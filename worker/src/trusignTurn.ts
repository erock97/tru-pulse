// Whose signature a contract is actually waiting on. Ported verbatim from
// TRU OS's trusignTurn.mjs.
//
// The contracts list knows a contract is "sent" but not who is holding it up,
// which is the only thing that makes the list actionable: a contract waiting
// on Eric is his to do, and one waiting on a broker is not.
//
// Sequential routing (TruSign's default) means only the lowest unsigned
// routing order is live — everyone behind them is waiting on the person in
// front. Parallel routing means everyone unsigned is live at once. Copy
// recipients are never waited on; they receive, they do not sign.

const SIGNING_ROLES = new Set(['signer', 'approver']);
const DONE = new Set(['signed', 'completed', 'declined']);

export interface TurnRecipient {
  name?: string;
  email?: string;
  role?: string;
  status?: string;
  routingOrder?: number;
  routing_order?: number;
}

/** Anyone whose signature the envelope is currently blocked on. */
export function whoseTurn(
  envelope: { status?: string; routing?: string },
  recipients: TurnRecipient[] | null | undefined,
): TurnRecipient[] {
  const status = String(envelope?.status || '');
  // A draft has not reached anybody yet; a finished or dead envelope waits on
  // nobody. Only a live, sent envelope is waiting on a person.
  if (status !== 'sent') return [];

  const live = (recipients || [])
    .filter((r) => SIGNING_ROLES.has(String(r.role || '')))
    .filter((r) => !DONE.has(String(r.status || '')));
  if (!live.length) return [];

  const sequential = String(envelope?.routing || 'sequential') !== 'parallel';
  if (!sequential) return live;

  const next = Math.min(...live.map((r) => Number(r.routingOrder ?? r.routing_order ?? 0)));
  return live.filter((r) => Number(r.routingOrder ?? r.routing_order ?? 0) === next);
}
