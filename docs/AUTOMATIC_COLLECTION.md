# Automatic FUB collection

FUB webhooks are durably queued before acknowledgement. Each active team has its own recurring 30-minute reconciliation and five-minute failure retry. Existing scheduled triggers register queues for all active teams; no user page or local process is required. People events queue specific person IDs; communication events request reconciliation. Daily reconciliation and weekly briefs retain their existing schedules.

Timeline collection uses the existing account credentials in Infisical `/fub-logins`. This is an authenticated FUB website API session, **not** the public text-message API or a Zillow integration. Account login mapping currently covers the six connected teams. A new account requires its vault login mapping before timeline collection can succeed.

The timeline queue covers tracked, agent-owned leads created within the last 90 days. It reads the complete paginated timeline, verifies person identity and current ownership, and stores normalized communication evidence plus stage-change records. Message bodies are not stored. It targets five-minute refreshes for leads under one day old, 30 minutes under seven days, and six hours for older leads. Twelve contacts are processed per alarm; initial backlogs and upstream failures can increase these intervals. These are scheduling targets, not a real-time SLA.

Errors retain previous evidence and schedule retries. The authenticated contact endpoint reports coverage and failures. The UI refreshes every minute while visible and on returning to the tab. Per-lead collection timestamps remain visible in details. Missing leads are excluded from timing averages, never treated as zero. Existing reviewed gaps and connection caveats are retained. Full pagination alone does not prove the first ever contact, so new evidence defaults to a response upper bound.

Verified Zillow messages also contribute to regular contact checks on subsequent FUB syncs. Pulse merges live lead fields and newly observed stage milestones with its saved historical baseline rather than replacing live results with a frozen snapshot. Saved baseline coverage dates are retained: forward observations do not retroactively prove historical assignment ownership.

Operational health (timestamps and errors only, no credentials or lead data): KV `collector-health:v1:<teamId>` and `sync-health:v1:<teamId>`. A deployment is not verified until cloud alarms have written successful collection receipts. Missing receipts, failures, or a growing coverage backlog require investigation.

Remaining boundaries: older assignment dates cannot be fabricated from current ownership. Historical timeline stage records collected here are retained but do not yet replace the full audited historical snapshot. Weekly coaching reports are scheduled artifacts, not live event streams; their separate publisher must be audited independently before claiming every report in the platform is current.
