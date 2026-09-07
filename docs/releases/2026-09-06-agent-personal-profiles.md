# Agent personal profiles

Agent HQ now includes Profile. Agents can edit their headline, story, home base, markets, career start year, favorite thing, goal, interests, portrait, cover and three personal photos. Five themes, three type styles, three cover patterns, a decorative accent, and movable/hideable sections let each page feel personal. Edits preview before saving. Navigation and cancel warn about unsaved changes.

## Access and storage

GET/PUT `/data/personal-profile` uses the existing authenticated Worker session and the signed-in user's RLS-visible agent link. No owner or organization parameter is accepted. Exactly one linked agent is required. Profile records use existing private SESSIONS KV under `agent-profile:v1:<auth-user-id>`, without expiry. Earned awards use `agent-profile-badges:v1:<auth-user-id>`. No schema or roster changes. Team information does not form the profile key. Concurrent saves use last-write-wins behavior; KV has eventual consistency between locations.

Only the owner can read or edit this first release. No public links, directory, feed, comments, messages or cross-team browsing are enabled. A deleted/unlinked agent account retains its stored profile but needs a valid agent link to access it again. Account deletion workflows must include these two key prefixes if permanent erasure is requested.

Photos are resized locally and stored as bounded JPG/PNG/WebP data. No external image URLs, SVG, HTML, CSS, or script input. Text is rendered through React escaping. The server checks shape, counts, lengths, image signatures and a 2.1 MB total request limit. Writes require an allowed origin; browser preflight explicitly permits PUT.

## Accomplishments

Training badges derive from server-recorded `rep_progress.status=passed`; agents cannot submit badges. Contract milestones count distinct contacts credited to the agent's FUB ID and team in the existing imported history, at 1/5/10/25/50/100. UC and closed for the same contact count once. These imports attribute credits using ownership at import, not verified ownership at the historical event. Therefore labels say **recorded contracts**, and the profile explains that they reflect assigned leads in imported history. They are not a verified lifetime production total. Already recorded awards stay attached to the profile. Missing history earns no invented awards. Self-reported career start is explicitly labeled as agent-provided; tenure awards wait for a trustworthy program-start source.

## Review and validation

Demo: `https://app.truhq.co/?demo=1#/learn/profile`. The sample identity, sample badges and browser-only save behavior are explicitly labeled. Actual agents use `https://app.truhq.co/#/profile`.

Browser checks: desktop and 390 px phone layout; no horizontal overflow; theme/type changes; save/reload in demo; section reordering and hiding; discard restores saved content. Automated checks cover unauthenticated access, owner isolation, invalid payloads/images, cross-origin writes, storage failure, badge provenance/deduplication, sticky awards, client error handling and photo resizing/URL cleanup. Production account writes require a signed-in linked agent and were not exercised through an administrator identity.

Deployment order: Worker first, then web, from the merged commit. Rollback: redeploy prior Worker and web; profile data remains in KV for a subsequent release.
