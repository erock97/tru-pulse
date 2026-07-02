// Social Studio service layer — orchestrates voice-profile setup and calendar
// generation over Supabase + the guardrail + the AI generator. Called by the
// Worker routes. Shares almost none of the Prospect/telephony spine by design.
import type { Env } from '../env.js';
import type { Db } from '../db.js';
import { runGuardrail } from './guardrail.js';
import type { BrandKit } from './generator.js';
import { deriveVoiceTone, generateCalendar } from './generator.js';

export interface SaveVoiceProfileInput {
  orgId: string;
  agentId: string;
  samplePosts?: string[];
  audience?: string;
  brandKit?: BrandKit;
}

export interface VoiceProfileRow {
  id: string;
  org_id: string;
  agent_id: string;
  tone_summary: string | null;
  sample_posts: string[];
  audience: string | null;
  brand_kit: BrandKit;
}

/** Create/update an agent's voice profile. Derives tone from samples (best-effort). */
export async function saveVoiceProfile(env: Env, database: Db, input: SaveVoiceProfileInput): Promise<VoiceProfileRow> {
  const samples = input.samplePosts?.filter((s) => s.trim().length > 0) ?? [];
  const tone = await deriveVoiceTone(env, samples);
  await database.upsert(
    'social_voice_profiles',
    [{
      org_id: input.orgId, agent_id: input.agentId, tone_summary: tone,
      sample_posts: samples, audience: input.audience ?? null, brand_kit: input.brandKit ?? {},
      updated_at: new Date().toISOString(),
    }],
    'org_id,agent_id',
  );
  const rows = await database.select('social_voice_profiles', `org_id=eq.${input.orgId}&agent_id=eq.${input.agentId}&select=*`);
  return rows[0] as VoiceProfileRow;
}

export async function loadVoiceProfile(database: Db, orgId: string, agentId: string): Promise<VoiceProfileRow | null> {
  const rows = await database.select('social_voice_profiles', `org_id=eq.${orgId}&agent_id=eq.${agentId}&select=*`);
  return (rows[0] as VoiceProfileRow) ?? null;
}

export interface GenerateCalendarInput {
  orgId: string;
  agentId: string;
  focus: string;
  days?: number;
  startDate?: string; // ISO date; defaults to today
}

export interface GenerateCalendarResult {
  batchId: string;
  generated: number;
  flagged: number; // posts with at least one fair-housing flag (still stored as drafts)
}

/**
 * Generate a batch of social content for an agent. ONE batched Claude call, every
 * caption/script run through the fair-housing + disclosure guardrail before
 * storage. Flagged posts are still saved as drafts (never silently dropped) so a
 * human reviews them — the compliance array is visible in the UI.
 */
export async function generateSocialCalendar(
  env: Env,
  database: Db,
  input: GenerateCalendarInput,
): Promise<GenerateCalendarResult> {
  const days = Math.max(1, Math.min(31, input.days ?? 30));
  const profile = await loadVoiceProfile(database, input.orgId, input.agentId);
  const tone = profile?.tone_summary ?? 'Warm, professional, and approachable — clear sentences, no jargon, a genuine local-expert tone.';
  const brandKit = profile?.brand_kit ?? {};

  const posts = await generateCalendar(env, { focus: input.focus, tone, audience: profile?.audience ?? null, days });

  const batchId = crypto.randomUUID();
  const start = input.startDate ? new Date(input.startDate) : new Date();
  let flagged = 0;

  const rows = posts.map((p) => {
    const captionResult = runGuardrail(p.caption, brandKit);
    const scriptResult = p.script ? runGuardrail(p.script, brandKit) : null;
    const flags = [...captionResult.flags, ...(scriptResult?.flags ?? [])];
    if (flags.length) flagged += 1;

    const day = new Date(start);
    day.setDate(day.getDate() + Math.max(0, p.dayOffset));

    return {
      org_id: input.orgId,
      agent_id: input.agentId,
      batch_id: batchId,
      scheduled_for: day.toISOString().slice(0, 10),
      pillar: p.pillar,
      format: p.format,
      hook: p.hook,
      caption: captionResult.text,
      script: scriptResult?.text ?? p.script ?? null,
      status: 'draft',
      compliance: {
        fair_housing_ok: flags.length === 0,
        disclosure_appended: captionResult.disclosureAppended || (scriptResult?.disclosureAppended ?? false),
        flags,
      },
    };
  });

  if (rows.length) await database.upsert('social_content', rows, 'id');
  return { batchId, generated: rows.length, flagged };
}

export async function listSocialCalendar(database: Db, orgId: string, agentId?: string): Promise<any[]> {
  const filter = agentId ? `agent_id=eq.${agentId}&` : '';
  return database.select('social_content', `${filter}org_id=eq.${orgId}&order=scheduled_for.asc&select=*`);
}

export async function setContentStatus(
  database: Db,
  orgId: string,
  contentId: string,
  status: 'draft' | 'approved' | 'scheduled' | 'posted' | 'rejected',
): Promise<void> {
  await database.update('social_content', `id=eq.${contentId}&org_id=eq.${orgId}`, { status, updated_at: new Date().toISOString() });
}
