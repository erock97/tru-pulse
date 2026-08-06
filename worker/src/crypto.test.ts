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
