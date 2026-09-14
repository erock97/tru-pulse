import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from './env.js';
import { getKey } from './stripeClient.js';
import { getWebhookSecret } from './fathomIngest.js';

afterEach(() => vi.unstubAllGlobals());
describe('Bitwarden delivery for TruHQ', () => {
  it('uses delivered values without consulting Infisical', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const env = {
      BITWARDEN_TRUHQ_SECRETS: JSON.stringify({ STRIPE_SECRET_KEY: 'stripe-test', FATHOM_WEBHOOK_SECRET: 'fathom-test' }),
      INFISICAL_CLIENT_ID: 'old', INFISICAL_CLIENT_SECRET: 'old', INFISICAL_PROJECT_ID: 'old',
      STRIPE_SECRET_KEY: 'old', FATHOM_WEBHOOK_SECRET: 'old',
    } as Env;
    expect(await getKey(env)).toBe('stripe-test');
    expect(await getWebhookSecret(env)).toBe('fathom-test');
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['{', '{}', 'null', '[]', '{"STRIPE_SECRET_KEY":42}', '{"STRIPE_SECRET_KEY":" "}'])('fails closed for invalid installed bundle %s', async bundle => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const env = { BITWARDEN_TRUHQ_SECRETS: bundle, STRIPE_SECRET_KEY: 'old', FATHOM_WEBHOOK_SECRET: 'old' } as Env;
    expect(await getKey(env)).toBeNull();
    expect(await getWebhookSecret(env)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('preserves the existing environment fallback before opt-in and after rollback', async () => {
    const env = { STRIPE_SECRET_KEY: 'legacy-stripe', FATHOM_WEBHOOK_SECRET: 'legacy-fathom' } as Env;
    expect(await getKey(env)).toBe('legacy-stripe');
    expect(await getWebhookSecret(env)).toBe('legacy-fathom');
  });
});
