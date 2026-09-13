# Saved mapping evidence — not activation approval

Offline inspection found the following consistent saved candidates. **None is certified as a current authoritative account-to-canonical-team binding.** They are useful for laptop review; do not provision scope from them until the outstanding evidence below is resolved.

| Laptop account key | Source account domain | Candidate canonical teams.id | Saved orgId | Saved artifact |
|---|---|---|---|---|
| signature | signaturerealtynj28 | 3a84fd98-13f2-46e7-83a2-a1ed3aeadab7 | 100630b4-4bd0-4f74-bf70-4bf798f7ef9c | audit-signature-history.json |
| costigan | compass627 | cb0fcbbb-c332-4f61-90f8-2b51b673bca8 | bfada794-d88a-401c-80db-74b106178c86 | audit-costigan-history.json |
| scottmoore | themooregroupe | 8b61c008-c8b1-4fb6-9de7-093b21a09a22 | 9e61053e-196d-47c1-af69-3d1573e5734f | audit-costigan.json |
| woosley | woosleygroup | 96ddb98f-1fb6-4d99-80f6-20ef615dec34 | fed61cea-31cd-4d26-a195-9772a8ecfc9c | audit-woosley-history.json |
| synergy | elnewhome | 213f7da9-6c3d-425e-86e6-a32d16db32a3 | aecd859e-20bf-4648-9526-1d9904a794c4 | audit-synergy-history.json |
| satish | sbrealty | df216d4d-b05e-4ddf-a84e-0d685182d692 | 1ce65a99-c7d1-45f0-8140-ed387c2f6359 | audit-sb-history.json |

Artifacts are under this task's work directory, outside this repository. A sanitized metadata-only extraction with original artifact SHA-256 and capturedAt timestamps is included in the return package. Original files contain lead history and are NOT included. Source account identifier here is the saved account domain; a numeric upstream account ID is not present in these extracted headers.

Provenance: tools/history-pilot/prepare-live-snapshots.mjs lines 5–12 explicitly bind all six keys/orgs/teams/domains, and checks input inventory/manifest account equality before preparing snapshots. worker/src/fubTimeline.ts corroborates domain-to-key bindings. Saved headers, captured 2026-09-06 for data through 2026-09-05, agree. But the generator hard-codes the team/org mapping; its derived exports are not independent proof of current database association. No collector or script was executed. db/hq_coach_compat.sql's leader seeds corroborate Costigan/Signature/Carson team IDs but do not prove current account ownership.

Duplicate ambiguity: audit-costigan.json actually contains Scott Moore/themooregroupe; use content/provenance, never filename. db/hq_team_duplicate_cleanup.sql resolves canonical Woosley using published run `8194448c-c4e6-48ed-a775-c4cab4bd76c5:woosley`, plus `:satish` and `:synergy`; it guards Satish against the UUID listed above. It distinguishes an inactive Allyson Woosley team from the canonical destination. This is executable cleanup logic, NOT a saved proof it completed. No completed cleanup snapshot/decision receipt was found in the inspected artifacts; old duplicate UUID/current disposition therefore remains unverified. Do not choose any similarly named team as a substitute.

Required read-only verification, only after separate authorization: export actual teams.id/org_id/is_active and the existing org/source-account association for these six accounts; obtain the three exact batch report identities/statuses above; inspect metadata-only decisions/completed_at of cleanup `woosley-production-evidence-8194448c-v1` in truhq_cleanup_private.snapshots. Do not export its customer-data snapshot. Verify uniqueness and account association using existing authoritative integration/account records, not names. If DB lacks authoritative account ID, compare an already saved authenticated FUB identity record; any new FUB API identity request would need separate approval and no browser login. Return query provenance, UTC capture time, row counts and sanitized evidence digest. No such query was performed now.

Offline searches covered this task's saved audits/exports, pinned source/history tools/cleanup SQL and a broader filename search for saved team/cleanup artifacts. Some unrelated folders were access-denied; this is not a claim of exhaustive filesystem absence. Missing proof is reported explicitly rather than promoting inferred mappings to verified status.
