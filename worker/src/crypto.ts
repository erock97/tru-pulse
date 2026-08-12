// AES-GCM encryption for per-tenant FUB API keys (WebCrypto, native in Workers).
// Ciphertext format: base64( iv[12] || ciphertext ). Same shape as the voice-ISA.

function b64encode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── HMAC-SHA256 → hex ───────────────────────────────────────────────────────
async function hmacHex(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(message)));
  return [...sig].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string compare — no early exit on the first differing byte. */
export function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Follow Up Boss signs every webhook with a `FUB-Signature` header so we can prove
 * a request really came from them and that the body wasn't altered in flight.
 *
 * Their spec, exactly (from the FUB webhooks guide's PHP sample):
 *   hash_hmac('sha256', base64_encode($rawBody), X_SYSTEM_KEY)
 * so the HMAC INPUT is the base64 of the raw body — not the raw body itself — and
 * the digest is hex. Getting this wrong rejects every legitimate webhook, which is
 * why the caller rolls it out in log-only mode first.
 */
export async function fubSignature(systemKey: string, rawBody: string): Promise<string> {
  return hmacHex(systemKey, btoa(unescape(encodeURIComponent(rawBody))));
}

/**
 * A per-team callback token, derived rather than stored.
 *
 * The old design put ONE shared secret in every team's callback URL. Every
 * customer can read their own registered webhook URL inside their own FUB
 * settings, so that "secret" was known to all of them — and rotating it meant
 * re-registering everyone. Deriving it per team means a customer who reads their
 * own URL learns nothing about any other team's, with no new storage and no
 * migration. It also closes a replay gap: FUB's signature covers the body but not
 * the query string, so without this a signed request could be replayed against a
 * different `?team=`.
 */
export async function teamWebhookToken(masterSecret: string, teamId: string): Promise<string> {
  return (await hmacHex(masterSecret, `webhook:${teamId}`)).slice(0, 32);
}

export async function importEncKey(b64Key: string): Promise<CryptoKey> {
  const raw = b64decode(b64Key);
  if (raw.length !== 32) throw new Error('FUB_ENC_KEY must be 32 bytes (base64)');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptKey(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64encode(out);
}

export async function decryptKey(key: CryptoKey, b64: string): Promise<string> {
  const data = b64decode(b64);
  const iv = data.slice(0, 12);
  const ct = data.slice(12);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}
