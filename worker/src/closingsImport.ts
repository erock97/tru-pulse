// Deal import — one team+source batch per call.
//
// The client loops files sequentially, one call per file, exactly as TRU OS's
// importer did: a mid-batch failure then leaves an honest ordered account
// ("file 1 saved, file 2 failed") rather than an interleaved mystery.
//
// Dedup lives server-side in tru_import_closings (repeated client name within
// the team, address-aware) and comes back as `duplicates`, which the UI
// reports as "Skipped N — already on the books".

import type { Db } from './db.js';

export interface ImportDeal {
  client_name?: string;
  close_date?: string;
  address?: string;
  agent_name?: string;
}

export interface ImportResult {
  team: string;
  source: string;
  imported: number;
  duplicates: { client_name: string; address: string | null; close_date: string | null }[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function validateImport(input: {
  team?: string;
  source?: string;
  deals?: ImportDeal[];
}): { ok: true; team: string; source: string; deals: ImportDeal[] } | { ok: false; error: string } {
  const team = String(input.team || '').trim();
  if (!team) return { ok: false, error: 'Which team?' };
  const source = String(input.source || '').trim();
  if (!source) return { ok: false, error: 'A batch needs a lead source.' };
  const deals = Array.isArray(input.deals) ? input.deals : [];
  if (!deals.length) return { ok: false, error: 'No deals to import.' };
  if (deals.length > 500) return { ok: false, error: 'Too many deals in one batch — split the file.' };
  for (const d of deals) {
    if (!String(d?.client_name || '').trim()) return { ok: false, error: 'Every deal needs a client name.' };
    if (!DATE_RE.test(String(d?.close_date || ''))) {
      return { ok: false, error: 'Every deal needs a close date (YYYY-MM-DD).' };
    }
  }
  return { ok: true, team, source, deals };
}

export async function importClosings(
  database: Db,
  input: { team?: string; source?: string; deals?: ImportDeal[] },
): Promise<ImportResult> {
  const checked = validateImport(input);
  if (!checked.ok) throw new Error(checked.error);

  const out = (await database.rpc('tru_import_closings', {
    p_team_name: checked.team,
    p_source: checked.source,
    p_deals: checked.deals.map((d) => ({
      client_name: String(d.client_name).trim(),
      close_date: String(d.close_date),
      address: String(d.address || '').trim() || null,
      agent_name: String(d.agent_name || '').trim() || null,
    })),
  })) as Record<string, unknown>;

  return {
    team: String(out.team || checked.team),
    source: String(out.source || checked.source),
    imported: Number(out.imported) || 0,
    duplicates: (Array.isArray(out.duplicates) ? out.duplicates : []) as ImportResult['duplicates'],
  };
}
