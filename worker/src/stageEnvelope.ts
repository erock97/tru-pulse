import {historyTime} from '../../shared/historyPolicy.js';

export type StageEnvelope = {event: 'peopleStageUpdated'; eventId: string; eventCreated: string; resourceIds: string[]; data: {stage: string}};
export type StageReceipt = {teamId:string;orgId:string;personId:string;eventId:string;occurredAt:string;stage:string;capturedAt:string};
export function stageEnvelope(body: unknown): StageEnvelope | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.event !== 'peopleStageUpdated') return null;
  const data = b.data as Record<string, unknown> | undefined;
  if (typeof b.eventId !== 'string' || !/^[\w-]{1,128}$/.test(b.eventId) ||
      !Array.isArray(b.resourceIds) || !b.resourceIds.length || b.resourceIds.length > 1000 ||
      !b.resourceIds.every(id => /^(0|[1-9]\d*)$/.test(String(id))) ||
      typeof data?.stage !== 'string' || !data.stage.trim() || data.stage.length > 512) throw Error('Invalid stage event envelope');
  historyTime(b.eventCreated);
  return {event:'peopleStageUpdated',eventId:b.eventId,eventCreated:b.eventCreated as string,
    resourceIds:[...new Set(b.resourceIds.map(String))].sort(),data:{stage:data.stage}};
}

/** One receipt per upstream event/person, independent of queue coalescing or parser versions. */
export async function retainStageEnvelope(storage: DurableObjectStorage, envelope: StageEnvelope, teamId: string, orgId: string) {
  await storage.transaction(async txn => {
    for (const personId of envelope.resourceIds) {
      const key = `stage-receipt:${envelope.eventId}:${personId}`;
      const receipt = {teamId,orgId,personId,eventId:envelope.eventId,occurredAt:envelope.eventCreated,stage:envelope.data.stage};
      const existing = await txn.get<StageReceipt>(key);
      if (existing && (existing.teamId!==teamId||existing.orgId!==orgId||existing.occurredAt!==receipt.occurredAt||existing.stage!==receipt.stage)) throw Error('Conflicting stage receipt');
      if (!existing) {
        const stored={...receipt,capturedAt:new Date().toISOString()};
        await txn.put(key, stored);
        await txn.put(`stage-pending:${envelope.eventId}:${personId}`, stored);
      }
    }
  });
}
