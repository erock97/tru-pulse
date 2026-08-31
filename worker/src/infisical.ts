// Infisical secret layer — the same REST client TRU OS's worker uses, ported
// verbatim. Eric keeps credentials in Infisical deliberately: one place to
// rotate a key without a deploy, and one place to look when something 401s.
// The Stripe key is read from here first (path /Stripe), so it never has to
// be pasted into this worker by hand; the env var is only a fallback.
//
// HARD RULES carried over:
//   * Never log a secret VALUE. Names/paths only.
//   * Fail soft, always — every failure mode returns null, never throws past
//     this module's boundary.
//   * Read-only.

import type { Env } from './env.js';

function siteUrl(env: Env): string {
  return (env.INFISICAL_SITE_URL || 'https://app.infisical.com').replace(/\/+$/, '');
}

export function isConfigured(env: Env): boolean {
  return !!(env.INFISICAL_CLIENT_ID && env.INFISICAL_CLIENT_SECRET && env.INFISICAL_PROJECT_ID);
}

// Module-level cache — reused across requests within the same isolate; a cold
// isolate just re-authenticates.
let tokenCache: { token: string; expiresAt: number } | null = null;
let authPromise: Promise<string | null> | null = null;

async function getToken(env: Env): Promise<string | null> {
  if (!isConfigured(env)) return null;
  const now = Date.now();
  if (tokenCache && now < tokenCache.expiresAt) return tokenCache.token;
  if (authPromise) return authPromise;

  authPromise = (async () => {
    try {
      const res = await fetch(`${siteUrl(env)}/api/v1/auth/universal-auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: env.INFISICAL_CLIENT_ID, clientSecret: env.INFISICAL_CLIENT_SECRET }),
      });
      if (!res.ok) {
        console.warn(`[infisical] universal-auth login failed (HTTP ${res.status})`);
        return null;
      }
      const data = (await res.json()) as { accessToken?: string; expiresIn?: number };
      if (!data.accessToken) return null;
      // Conservative reuse window: re-auth well before any plausible expiry
      // rather than trust a fragile TTL.
      const ttlMs = Math.max(60_000, (data.expiresIn ? data.expiresIn * 1000 : 45 * 60_000) - 60_000);
      tokenCache = { token: data.accessToken, expiresAt: Date.now() + ttlMs };
      return tokenCache.token;
    } catch (err) {
      console.warn('[infisical] universal-auth login error —', (err as Error).message);
      return null;
    } finally {
      authPromise = null;
    }
  })();
  return authPromise;
}

const SECRET_TTL_MS = 5 * 60 * 1000;
const secretCache = new Map<string, { value: string | null; expiresAt: number }>();

// Fetch one secret by name from `path` (default project root). Returns the
// string value, or null if unavailable for any reason (never throws).
export async function getSecret(env: Env, name: string, path = '/'): Promise<string | null> {
  const key = `${env.INFISICAL_ENV || 'prod'}::${path}::${name}`;
  const cached = secretCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.value;

  const token = await getToken(env);
  if (!token) return null;

  try {
    const qs = new URLSearchParams({
      workspaceId: env.INFISICAL_PROJECT_ID || '',
      environment: env.INFISICAL_ENV || 'prod',
      secretPath: path,
    });
    const res = await fetch(`${siteUrl(env)}/api/v3/secrets/raw/${encodeURIComponent(name)}?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      // 404 = secret not at this path — an expected miss while trying
      // multiple fallback paths, not logged as a warning.
      if (res.status !== 404) {
        console.warn(`[infisical] getSecret('${name}', path='${path}') failed (HTTP ${res.status})`);
      }
      secretCache.set(key, { value: null, expiresAt: Date.now() + SECRET_TTL_MS });
      return null;
    }
    const data = (await res.json()) as { secret?: { secretValue?: string } };
    const value = data?.secret?.secretValue ?? null;
    secretCache.set(key, { value, expiresAt: Date.now() + SECRET_TTL_MS });
    return value;
  } catch (err) {
    console.warn(`[infisical] getSecret('${name}', path='${path}') error —`, (err as Error).message);
    return null;
  }
}
