# Profile privacy and customization

## Privacy controls

The editor explains upload rights, provider/staff operational access, current owner-only browsing, removal controls and the distinction between deleting a profile and deleting original business records. Optional profile uploads have a dated agreement (2026-09-06) accepted explicitly in the editor and required by the Worker on save. The accepted version and server timestamp are recorded with the profile. Existing profiles migrate with an empty agreement field; acceptance is never inferred. Revised Privacy and Terms pages cover profile data categories, purposes, storage, visibility, user ownership, a limited service license, no implied advertising/AI-training permission, retention, essential login cookies, demo browser storage and removal requests. Profile terms apply on explicit acceptance; the existing general change-notice provision remains.

DELETE /data/personal-profile requires an authenticated owner and allowed origin. It deliberately works even after the agent-team link is removed. It removes the owner’s profile and badge-copy keys. A minimal account-linked deletion timestamp prevents the next GET from regenerating deleted badges. Successful creation of a new profile clears that marker. Original course, coaching and transaction records are unaffected. No database schema or records changed by this release. KV propagation is eventual, and no promise of instantaneous deletion of provider recovery copies is made.

## Retention and account-erasure handling

Profile content remains while the user maintains it, with no automatic expiry. This is separate from the existing form/contact-record retention period. Leaving a team is not automatic erasure. Self-service deletion is in Edit profile > Privacy. People without access can use the privacy contact; follow the existing published request-response period.

For an authenticated self-service request, the API handles scope and removal. For an account-erasure request received by support:
1. Verify the requester’s identity and their Supabase auth user ID using the existing account records. Never infer identity from a display name or treat a team ID as the user ID.
2. Include exactly these Cloudflare SESSIONS keys in the approved account-erasure operation: agent-profile:v1:<auth-user-id>, agent-profile-badges:v1:<auth-user-id>, and agent-profile-deleted:v1:<auth-user-id>. Do not clear the namespace. Only remove the marker as part of account closure, since an active account without a marker can earn badges again.
3. Disable/close the authenticated account as part of the separately authorized account-closure process so later reads cannot recreate data. Resolve any documented legal retention exceptions for underlying course, coaching, transaction, billing and security records separately; deleting the profile is not evidence that all systems are erased.
4. Verify the three exact keys are absent after provider propagation. Record the request ID, verified owner ID, scope, timestamp, outcome and any lawful retention exception without copying photos or profile text into support logs.
5. Tell the requester what was removed and what, if anything, remains. Do not promise removal from every provider recovery copy unless that has been verified.

This is an operational implementation and policy update, not a determination of every applicable state or international privacy law. Counsel should review jurisdictional applicability and final retention requirements. Sources reviewed: FTC Protecting Personal Information (https://www.ftc.gov/business-guidance/resources/protecting-personal-information-guide-business) and FTC privacy-policy change guidance (https://search.ftc.gov/policy/advocacy-research/tech-at-ftc/2024/02/ai-other-companies-quietly-changing-your-terms-service-could-be-unfair-or-deceptive).

## Personalization

Agents can rename each section, choose Story / Photos / Compact layouts, adjust portrait and cover vertical framing, and view gallery photos full size in an accessible native dialog. Portraits have greater presence. Photos layout places the gallery first on selection and gives its first image more room; agents can reorder afterward. Empty sections stay out of the finished view. First-time setup points to photo, bio and interests without requiring every field. Accomplishments include their recorded date when available. Self-reported experience remains labeled; no unverified skill or tenure awards were invented.

## Validation and release

Legacy profiles receive safe defaults without losing existing text/photos/themes. Tests cover owner-scoped deletion, cross-origin denial, team-independent deletion, partial deletion failure/retry, suppression of badge recreation, agreement enforcement, migration defaults, title/crop/layout validation and failed client deletion. Browser QA covers renamed headings, compact layout save/reload, agreement blocking, demo deletion/reload, phone setup, and no horizontal overflow. Real file-picker upload and real-agent production writes require a manual account/device check; photo preparation and server validation are exercised automatically.

Deploy the Worker first, then tru-pulse-app and tru-landing from the merged commit. Both hosts serve the updated legal routes. No feed, directory, public profile link or cross-team sharing was added.

Public privacy links use a version query to reach the verified current notice while an upstream cache continues serving older HTML at the unversioned public URL. The application policy route is current.
