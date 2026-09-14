import type { Env } from './env.js';

/** undefined keeps the legacy route; an installed but invalid bundle fails closed. */
export function getBitwardenSecret(env: Env, key: 'STRIPE_SECRET_KEY' | 'FATHOM_WEBHOOK_SECRET'): string | null | undefined {
  if (env.BITWARDEN_TRUHQ_SECRETS === undefined) return undefined;
  try {
    const bundle: unknown = JSON.parse(env.BITWARDEN_TRUHQ_SECRETS);
    if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) return null;
    const value = (bundle as Record<string, unknown>)[key];
    return typeof value === 'string' && value.trim() ? value : null;
  } catch {
    return null;
  }
}
