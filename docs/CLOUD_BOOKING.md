# Cloud booking operations

The public page calls `https://api.truhq.co/calendar-public/slots`. Availability
comes from a private Cloudflare Durable Object snapshot, plus current scheduling
rules, meeting visibility and held bookings in Supabase. Google event contents
are never sent to the browser. Each offer contains only start and end times.

This release serves the explicitly mapped legacy owner
`d6b9504c-f35e-49c9-af99-6a2de2069db8`, using the existing Infisical `/Google`
credential. Other Google-linked owners remain blocked from publishing until a
per-owner credential adapter is implemented. Never fall back to this credential
for another owner.

## Refresh and booking

- Google events/watch sends authenticated notifications to
  `/calendar-public/google-push`; the worker then refreshes busy intervals.
- This deliberately uses Google's freeBusy projection instead of storing and
  incrementally reconstructing private event payloads and recurrence rules.
  Concurrent notifications share a refresh. There is no open connection or
  browser/laptop polling for availability.
- A persistent alarm checks settlement every minute, refreshes busy intervals
  hourly, and renews the seven-day notification channel a day before expiration.
- Cached availability older than two hours requires a successful refresh;
  an outage never becomes an empty/free calendar.
- Book/cancel/reschedule retain the existing token-protected Supabase edge
  functions and exclusion constraint. Cloud requests wake settlement immediately;
  the alarm retries work if a request or process fails.
- Settlement checks live Google busy time and other reservations before writing.
  Google event IDs are deterministic, and the legacy private booking property is
  reconciled before checking busy time. This prevents a lost insert response from
  becoming a duplicate or falsely rejecting its own event as a conflict.
- A durable intent survives insertion/cancellation races until the event is
  confirmed or removed. Infrastructure failures retry; holds without a possibly
  successful insertion are cancelled after 15 minutes with an infrastructure
  reason. Uncertain insertion outcomes remain held until reconciled.

## Release / rollback

These endpoints require `x-admin-token`, never a browser query parameter:

1. POST `/ops/booking-calendar/prepare`: read Google, warm snapshot, register push.
   Does not activate booking settlement.
2. GET `/ops/booking-calendar/status`: sanitized cache/push/alarm timestamps.
3. Stop and disable only the Windows **TRU Slot Worker**, after checking pending
   bookings. Keep its source/configuration for rollback.
4. POST `/ops/booking-calendar/activate`: refresh and start durable alarms.
5. Deploy the public page referencing `book-v3.js`; verify real availability,
   notification receipt, and a successful alarm. Unit tests cover event writes;
   no test invitation is sent to a real attendee.

Rollback: POST `/ops/booking-calendar/pause`, then restore the Windows task.
The public cloud availability snapshot remains readable; the restored worker
can settle the same Supabase booking queue. Revert the page to the preceding
release if necessary. Do not run both settlement engines during normal operation.
The old laptop-specific slot-request polling endpoint is no longer used by the
current public page; previously open pages should be reloaded.

No changes to FUB tasks, credentials, or login automation are part of this move.
