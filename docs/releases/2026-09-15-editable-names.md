# Editable profile names

## Behavior

- Agents can use **Profile → Edit name**. Team admins and leaders can use **Team → Edit name** on a roster row.
- Saving updates the profile heading, initials, signed-in header, team roster and Rep board. The saved display name is read again on login/reload.
- A dedicated `agent_display_names` table holds the name. CRM source names and historical report labels are preserved; changing a display name does not reattribute metrics or rewrite historical reports.
- FUB sync links previously unlinked rows by trimmed, case-insensitive email instead of name. An established FUB user ID remains the durable link if the CRM email later changes. Sync does not change login email or authentication identity.
- Duplicate or conflicting email matches are skipped rather than joining two accounts. Blank emails never match each other. These accounts require identity cleanup before linking.
- Name edits cannot alter team, organization, role, login, or CRM IDs. RLS permits only the agent or an admin/leader of their organization to write. The write function uses the caller's privileges.

## Validation

Twenty new worker/database tests cover matching, ambiguity, validation, presentation overlays, real PostgreSQL RLS, direct writes, and cross-organization/anonymous denial. Three browser-component tests cover save, failure/retry and cancel. Browser QA verifies both controls and immediate profile/header updates using demo data.

## Release order

This change crosses web, worker and database because names must persist and permissions must be enforced server-side.

1. Apply `supabase/migrations/20260916000615_agent_display_names.sql` through the approved production migration process. This adds a table and invoker RPC, without modifying existing agent records or access policies.
2. Deploy the worker, then the web build. The worker's name reads require the migration first.
3. As platform owner, act as **Signature Realty**, open **Team**, search Rachel, confirm the existing account against her email and phone, then use **Edit name** to save **Rachel Ortiz**.
4. Reload the team page to verify persistence. Verify Rachel's profile on her next login. Run/observe the next normal sync and verify the saved name remains intact.

The migration, live correction, merge and production deployment have not been performed by this implementation task. Do not resend invitations or create a replacement account.

## Review locally

Run `npm --prefix web run dev`, then open:

- `http://127.0.0.1:5173/?demo=1#/learn/profile`
- `http://127.0.0.1:5173/?demo=1#/team`

Demo edits are session previews. Persistence and access control are tested against embedded PostgreSQL without touching the shared production database.

## Rollback

Revert the web and worker deploys together. Leave the display-name table intact so saved names are retained for a corrected release. Source agent rows were never renamed.
