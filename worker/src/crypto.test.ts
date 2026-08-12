// The Worker's AES-GCM wrapper is what protects every tenant's Follow Up Boss API
// key at rest (team_secrets.fub_key_enc). It had no tests; these pin the round trip,
// the key-size guard, and — most importantly — that a tampered ciphertext FAILS
// rather than silently decrypting to garbage.
import { describe, it, expect } from 'vitest';
import { importEncKey, encryptKey, decryptKey } from './crypto.js';

const b64 = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const KEY_B64 = b64(new Uint8Array(32).map((_, i) => (i * 7 + 11) % 256));

describe('FUB key encryption', () => {
  it('round-trips a Follow Up Boss key unchanged', async () => {
    const key = await importEncKey(KEY_B64);
    const plaintext = 'fka_live_9f3c1e77aa41bd0e';
    expect(await decryptKey(key, await encryptKey(key, plaintext))).toBe(plaintext);
  });

  it('rejects a key that is not exactly 32 bytes', async () => {
    await expect(importEncKey(b64(new Uint8Array(16)))).rejects.toThrow(/32 bytes/);
    await expect(importEncKey(b64(new Uint8Array(31)))).rejects.toThrow(/32 bytes/);
    await expect(importEncKey(b64(new Uint8Array(33)))).rejects.toThrow(/32 bytes/);
  });

  it('uses a fresh IV per encryption, so the same key never produces the same ciphertext', async () => {
    const key = await importEncKey(KEY_B64);
    const a = await encryptKey(key, 'same-secret');
    const b = await encryptKey(key, 'same-secret');
    expect(a).not.toBe(b);
    expect(await decryptKey(key, a)).toBe('same-secret');
    expect(await decryptKey(key, b)).toBe('same-secret');
  });

  it('fails closed when the ciphertext has been tampered with', async () => {
    const key = await importEncKey(KEY_B64);
    const ct = await encryptKey(key, 'fka_live_do_not_forge');
    const bytes = Uint8Array.from(atob(ct), (c) => c.charCodeAt(0));
    bytes[bytes.length - 1] ^= 0xff; // flip a bit in the GCM tag
    await expect(decryptKey(key, b64(bytes))).rejects.toBeDefined();
  });

  it('cannot be decrypted with a different key', async () => {
    const good = await importEncKey(KEY_B64);
    const other = await importEncKey(b64(new Uint8Array(32).map((_, i) => (i * 13 + 3) % 256)));
    const ct = await encryptKey(good, 'fka_live_tenant_a');
    await expect(decryptKey(other, ct)).rejects.toBeDefined();
  });
});

// ── FUB webhook signature + per-team callback token ─────────────────────────
import { fubSignature, teamWebhookToken, secretsMatch } from './crypto.js';

describe('fubSignature', () => {
  // KNOWN-ANSWER TEST. FUB's published PHP sample is:
  //   hash_hmac('sha256', base64_encode($body), X_SYSTEM_KEY)
  // The vector below was produced independently with Node's crypto module, NOT with
  // the implementation under test, so this pins our WebCrypto version to FUB's real
  // algorithm. If someone "tidies" fubSignature and breaks it, this fails here
  // rather than silently rejecting every live webhook in production.
  const KEY = 'sys-key-123';
  const BODY = '{"event":"peopleUpdated","resourceIds":[7,8]}';
  const EXPECTED = '5733435b3a5f7c1ec0e7e4e1f2f8a894e6d8cbfc74034dc9f9d81a27025a63dc';

  it('matches the documented algorithm: hex hmac over the BASE64 of the body', async () => {
    expect(await fubSignature(KEY, BODY)).toBe(EXPECTED);
  });

  it('is hex and 64 chars (sha256)', async () => {
    expect(await fubSignature('k', '{}')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes if a single byte of the body changes', async () => {
    expect(await fubSignature('k', '{"resourceIds":[1]}'))
      .not.toBe(await fubSignature('k', '{"resourceIds":[2]}'));
  });

  it('changes with the system key — a customer cannot forge it without ours', async () => {
    const body = '{"event":"peopleUpdated"}';
    expect(await fubSignature('ours', body)).not.toBe(await fubSignature('theirs', body));
  });

  it('handles non-ascii in the body without throwing', async () => {
    await expect(fubSignature('k', '{"name":"Renée Ortíz — 東京"}')).resolves.toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('teamWebhookToken', () => {
  it('gives each team a DIFFERENT token from the same master secret', async () => {
    const a = await teamWebhookToken('master', 'team-aaa');
    const b = await teamWebhookToken('master', 'team-bbb');
    expect(a).not.toBe(b);
  });

  it('is stable for the same team, so re-registering yields the same URL', async () => {
    expect(await teamWebhookToken('master', 't1')).toBe(await teamWebhookToken('master', 't1'));
  });

  it('never equals the master secret — reading your own URL must not reveal it', async () => {
    const t = await teamWebhookToken('the-master-secret', 't1');
    expect(t).not.toBe('the-master-secret');
    expect(t).not.toContain('the-master-secret');
  });

  it('rotates every team when the master secret changes', async () => {
    expect(await teamWebhookToken('old', 't1')).not.toBe(await teamWebhookToken('new', 't1'));
  });
});

describe('secretsMatch', () => {
  it('is true only for identical strings', () => {
    expect(secretsMatch('abc', 'abc')).toBe(true);
    expect(secretsMatch('abc', 'abd')).toBe(false);
    expect(secretsMatch('abc', 'ab')).toBe(false);
    expect(secretsMatch('', '')).toBe(true);
  });
});
