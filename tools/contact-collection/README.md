# Contact evidence collection

The Costigan pilot uses authenticated FUB timeline reads because the public API key returns 403 for this endpoint. `/textMessages` does not include Zillow Messages. This is a manually run collector, not a continuous Worker feed. It refreshes the existing snapshot cohort only; it does not discover new leads or expand the report period.

Run from the repository root:

```powershell
./tools/contact-collection/collect.ps1 -Snapshot <private-current-snapshot.json> -OutputDirectory <private-collection-directory>
node tools/contact-collection/prepare.mjs <private-current-snapshot.json> <private-collection-directory> <private-review.json> <private-new-snapshot.json>
```

The review file contains `orgId` and a `leads` object mapping explicitly reviewed contact IDs to review notes. Use an empty object to collect evidence without promoting incomplete histories to measured. Complete pagination does not prove a complete personal-contact sequence. Existing missing-record and provider-connection caveats are preserved. Snapshot scope and contact ownership must still match. Any fetch/identity/pagination failure aborts preparation; nothing automatically writes production.

Zillow records retain sentAt, actual sender, inbound/outbound direction and delivery status. Automatic and ambiguous initiation never receive personal-outreach credit. Calls require startedAt; manual logging time is not substituted. Delivery failure remains visible as evidence of an attempt; this metric measures recorded outreach, not successful delivery. Raw timeline records remain in private local files and must not be committed.

Before publishing, inspect the generated report and preserve the current KV snapshot as a rollback. Replace only the matching `pulse-contact:v1:<orgId>` key, with the entire validated snapshot. The Worker recalculates it on read. Public API support or a supported service credential is still needed before scheduling dependable unattended collection.
