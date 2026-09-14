# TruHQ secret delivery

This first cutover connects only Stripe invoicing and Fathom webhook verification
in `tru-pulse-sync` (`api.truhq.co`). It is not a migration of all workers.

The runner authenticates with a Bitwarden machine account and reads the existing
values. It supplies one encrypted Cloudflare Worker secret,
`BITWARDEN_TRUHQ_SECRETS`, through Wrangler stdin. No secret values go into files,
command arguments, logs, Git, or AI prompts. The deployed worker does not need
the Bitwarden access token and does not contact Bitwarden on each request.

| Bitwarden project in TRU Revenue | Delivered key |
| --- | --- |
| Terrason and TRU API Keys \| prod \| /Stripe | STRIPE_SECRET_KEY |
| Terrason and TRU API Keys \| prod \| /Fathom | FATHOM_WEBHOOK_SECRET |

Project matching requires exact names and organization UUID
`31006391-ca4f-4c64-a0a3-b4c5013164af`. Duplicate/missing matches, blank values,
and unresolved Infisical references stop the operation before any write.

## Access and setup

1. Create machine account `truhq-secret-delivery` in TRU Revenue. Grant **read**
   on only the two projects above. The Fathom project also contains its API key;
   project access allows reading it, but this script does not deliver it.
2. Generate a scoped machine access token and store it in the delivery runner's
   protected credential store as `BWS_ACCESS_TOKEN`. Do not paste it into chat,
   shell history, repository files, or a worker binding. Choose an expiry and
   renew it before then. Revoke temporary setup tokens after use.
3. Install the official [Bitwarden CLI](https://bitwarden.com/help/secrets-manager-cli/)
   and run `npm ci` in `worker/`.
4. Supply the verified production `CLOUDFLARE_ACCOUNT_ID`. An interactive operator
   can use their existing Wrangler OAuth login. An unattended runner needs a protected
   `CLOUDFLARE_API_TOKEN` with Workers Scripts edit permission on that account.
   Confirm `tru-pulse-sync` exists in that account before applying. Credentials
   must be injected into the runner environment by its secure store.

## Cutover by Eric or the designated production deployer

Run from `worker/`:

```sh
node ops/sync-bitwarden-secrets.mjs
```

This dry run checks Bitwarden reads and completeness and displays names only.
It does not contact Cloudflare. Review the deployed worker version and record
it for rollback. Deploy the reviewed worker code with its existing bindings
preserved. Without the new secret, its previous lookup behavior is unchanged.
Then, during the approved cutover:

```sh
node ops/sync-bitwarden-secrets.mjs --apply
```

**Apply publishes a new live worker version** through `wrangler secret put`;
it is not a staging operation. It sends both values in one binding so a partial
delivery cannot switch only one integration. Existing unrelated bindings are
not edited. This is for the current single-version deployment, not a gradual
rollout; review deployment strategy before use if that changes.

Verify an authenticated, read-only invoice listing and normal signed Fathom
webhook processing. Do not generate/send an invoice to test credentials. Keep
the original Infisical keys and delivery active until these checks pass.

The bundle is authoritative once present. Malformed or missing entries return
no key; they never silently fall back to an old key. To roll back, the authorized
deployer can remove only `BITWARDEN_TRUHQ_SECRETS` (another live version change),
restoring the prior Infisical/environment lookup. Existing Infisical credentials
must remain valid for that rollback to work.

## Rotation and remaining connections

Editing a value in Bitwarden does **not** automatically update Cloudflare. Run
the delivery again after each approved rotation. No scheduled runner is installed
by this change. Choose the protected runner and its cadence before claiming
continuous synchronization.

Still to verify and migrate separately:

- TruSign runtime lookups in this worker.
- FUB key delivery to `fub-kpi-puller`, `fub-lead-manager`, and
  `fub-weekly-reports` (existing Infisical sync destinations).
- TruHQ receipt receiver/producer credentials and TruPulse/TruCoach dependencies.
- Seven Qwen agent runtimes and Brian: resolve their actual hosts and needed
  projects before granting separate read access. Model names are not runtimes.
- Password Manager logins and authenticator seeds: Secrets Manager machine
  tokens do not unlock the Password Manager vault. The legacy imported login
  snapshot must not replace the two accounts Eric said need corrections.

The obsolete Jarvis laptop/desktop identities are outside this cutover.

## Validation

`npm run typecheck` and `npm test` cover key precedence, fail-closed behavior,
legacy fallback, exact project/organization matching, duplicate rejection, and
reference rejection using synthetic credentials. They do not prove live access
or production delivery; those checks require the machine token and cutover.
