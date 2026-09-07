# Coaching assignments and agent Home

Coaches can assign a published training or practice on its own from an agent’s Coach detail, above Run this 1:1. Each assignment has a coach-authored commitment and follow-up date. Saving an assignment is separate from logging the meeting.

Agents see the earliest open assignment on Home and all assignments in Coach. They can open the linked training and save a short practice example. Quiz completion is read from rep_progress; practice notes and coach review never award a training pass. Coaches review the assignment with an agent-visible note, finish it, cancel it, or keep it open with a new follow-up date. A keep-practicing review requires a later practice note before the assignment becomes ready for review again.

Home also shows the next available unfinished module, the most recent passed training, and up to two open commitments from existing 1:1/goal records. SMS preferences remain accessible. Assessment completion does not gate access to assignments or existing commitments.

## Access and storage

GET/POST /data/coaching-assignments uses the authenticated Worker session and the user’s Supabase client. Agent visibility is checked through RLS before private KV is accessed. Organization membership roles (leader/coach/admin) or the existing is_admin RPC permit assignment/review. Only the agent whose auth_id matches the session can submit practice. Cross-origin writes are denied. Private checkin_leader notes are never queried.

Existing SESSIONS KV holds three prefixes, each scoped by organization and agent: coaching-assignment:v1, coaching-practice:v1, coaching-review:v1. Assignment creation uses a client-generated UUID for retries; mismatched retries are rejected. Practice and review use separate records so simultaneous edits do not overwrite each other. Records have no automatic expiry; the existing profile deletion flow does not delete coaching records. The latest practice and review are retained, not an immutable revision audit. No schema or production data migration is needed.

KV is eventually consistent between locations. Successful writes return their confirmed assignment/patch and the UI applies it immediately; another browser may take time to see an update. This is a coaching workflow, not a transaction lock. If an agent or organization is removed, their KV records become inaccessible through the API but need explicit administrative cleanup under the organization’s retention process.

## Demo and verification

The demo uses a clearly labeled shared browser-local workspace, allowing a coach-view action to appear in the agent preview even though the sample names differ. It never writes to the production assignment API. Demo training results last for the existing in-memory demo session.

Automated coverage checks agent/organization isolation, coach and agent write restrictions, published module access, real training status, idempotent creation, separate practice/review storage, closed assignments, follow-up dates, invalid payloads and visible service errors. Browser QA covers desktop and 390px Home, practice entry, coach review and assignment creation. A live agent/coach authenticated pair has not been used for a production write test.
