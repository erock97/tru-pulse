// The Durable Object half of one-time contract approvals — ported verbatim
// from TRU OS. One DO per actor; consume runs inside a storage transaction so
// a token cannot be double-spent; TTL five minutes, because an approval is a
// decision made looking at a specific review, not a standing permission.

import { issueApprovalRecord, consumeApprovalRecord, type ApprovalRecord } from './contractApprovalCore.js';

const APPROVAL_TTL_MS = 5 * 60_000;
const keyFor = (token: string) => `approval:${token}`;
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export class ContractApprovalLedger {
  state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method !== 'POST') return response({ error: 'method not allowed' }, 405);
    const body = (await req.json().catch(() => null)) as Record<string, string> | null;
    if (!body) return response({ error: 'invalid body' }, 400);

    if (url.pathname === '/issue') {
      try {
        const token = crypto.randomUUID();
        const record = issueApprovalRecord(body, token, Date.now(), APPROVAL_TTL_MS);
        await this.state.storage.put(keyFor(token), record);
        return response({ token, expiresAt: record.expiresAt });
      } catch (err) {
        return response({ error: err instanceof Error ? err.message : 'invalid approval scope' }, 400);
      }
    }

    if (url.pathname === '/consume') {
      const result = await this.state.storage.transaction(async (txn) => {
        const record = await txn.get<ApprovalRecord>(keyFor(body.token));
        const consumed = consumeApprovalRecord(record ?? null, body as Partial<ApprovalRecord>, Date.now());
        if (consumed.ok) await txn.put(keyFor(body.token), consumed.record);
        return consumed;
      });
      return result.ok ? response({ ok: true }) : response(result, 409);
    }

    return response({ error: 'not found' }, 404);
  }
}
