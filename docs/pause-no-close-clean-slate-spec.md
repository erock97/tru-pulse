# Spec: clean-slate the "no-closings" pause rule (`pause_no_close`)

**Status:** ready to implement · **Type:** non-destructive (settings + one denominator filter) · **Owner:** fix session

## Problem (why we're doing this)

The `no_close` pause rule flags an agent when they've taken `pause_no_close_leads`
(default **30**) leads with none ever going Under Contract / Closed. The "produced"
signal comes from `person_stage_log`, which is a log the app *accrues itself* — FUB
exposes **no stage history via its API** (see `db/hq_stage_log.sql` header). So the log
only knows about closings the sync **personally witnessed**. A lead that came in a year
ago and closed a month ago — before we were syncing that team, or where the close landed
on a FUB **Deal** / came via **Tableau** instead of flipping the person's live stage —
has **no hit**, and it's unrecoverable.

Real case (Julia Roman): all of her currently-assigned leads (39) read `ever_produced =
false`, so her drought = 39 ≥ 30 → flagged, even though FUB/Tableau show 3 penned/closed
in 6 months. The rule isn't miscounting a threshold; its production feed for her legacy
book is simply empty and can't be backfilled.

**Decision:** stop judging agents on the pre-tracking era. Enforce the rule only over the
window where we can actually *see* closes — a **clean-slate start date**. This is a
settings change + a denominator filter. **We do NOT delete any data.**

## What "clean slate" means precisely

- The no-closings drought counts **only leads with `fub_created >= pause_no_close_since`**.
- Leads with a **null** `fub_created` are excluded while a slate date is set (we can't tell
  when they arrived).
- **Production credit is unchanged** (still generous / all-time). We only window the
  *denominator* (the leads counted), never the *numerator* (production that resets it).
- Leaving the date **blank** = today's behavior (count all history). Setting it to **now**
  resets everyone.

The **volume** pause rule (`pause_volume`) already windows to the current month
(`monthStart`) — it is inherently rolling and needs **no** change. Only `no_close` (the
all-time rule) needs the slate.

## Files to touch

1. `db/schema.sql` (or a new migration) — add the column.
2. `web/src/lib/api.ts` — `Settings` interface, the `org_settings` select list, demo default.
3. `web/src/pages/Dashboard.tsx` — read the setting + filter the denominator.
4. `web/src/pages/Dashboard.tsx` (Settings UI) — a date input + copy.

---

## 1. DB — `org_settings`

Add, in the self-healing add-column style used everywhere else:

```sql
alter table org_settings add column if not exists pause_no_close_since timestamptz;
```

Non-destructive; NULL = count all history (current behavior).

## 2. `web/src/lib/api.ts`

**Settings interface** (after line 628):

```ts
  pause_no_close_leads?: number | null; // rule 2 threshold (default 30)
  pause_no_close_since?: string | null; // rule 2 clean-slate: only count leads created on/after this ISO date; null = all history
```

**`org_settings` select** (line 692) — append the column:

```
...,pause_no_close_on,pause_no_close_leads,pause_no_close_since
```

**Demo default** (in `demoDashboard()` settings, ~line 808): leave `pause_no_close_since`
undefined/null so demo behaves as today. (Optional: set it to a recent date to demo the
warm-up.)

## 3. `web/src/pages/Dashboard.tsx` — the rule

**Read the setting.** After line 281 (`const pauseNoCloseLeads = ...`):

```ts
  const pauseNoCloseSince = data.settings?.pause_no_close_since
    ? Date.parse(data.settings.pause_no_close_since) : null;
```

**Window the denominator.** Replace the lead-grouping loop (current lines 308–312):

```ts
    // BEFORE
    const leadsByAgent = new Map<string, LeadRow[]>();
    for (const l of data.leads) {
      if (!l.assigned_to) continue;
      const arr = leadsByAgent.get(l.assigned_to);
      if (arr) arr.push(l); else leadsByAgent.set(l.assigned_to, [l]);
    }
```

```ts
    // AFTER — clean slate: pre-slate and undated leads don't count toward the drought
    const leadsByAgent = new Map<string, LeadRow[]>();
    for (const l of data.leads) {
      if (!l.assigned_to) continue;
      if (pauseNoCloseSince != null) {
        if (!l.fub_created) continue;                                 // unknown intake date → exclude while slate is set
        if (Date.parse(l.fub_created) < pauseNoCloseSince) continue;  // pre-slate lead → not counted
      }
      const arr = leadsByAgent.get(l.assigned_to);
      if (arr) arr.push(l); else leadsByAgent.set(l.assigned_to, [l]);
    }
```

Everything downstream (the `< pauseNoCloseLeads` guard, the live-UC short-circuit, the
newest-first sort, the carry-forward drought walk, lines 313–323) is unchanged — it now
just operates on the windowed set.

## 4. Settings UI (Dashboard.tsx settings card)

Near the existing "Pause on no closings" controls, add a date input bound to
`form.pause_no_close_since` plus a "Reset to today" button that sets it to
`new Date().toISOString()`. Suggested copy:

> **Clean-slate date** — only leads received on or after this date count toward the
> no-closings rule. Set it to today to give everyone a fresh start; leave blank to count
> all history. (We can only enforce this rule over the period we've been tracking closings.)

Make sure the settings **save** path (`org_settings` upsert) includes
`pause_no_close_since`.

---

## The real risk — verify go-forward capture BEFORE trusting the slate

A clean slate is worthless if new closings *also* fail to reach `person_stage_log`. If
Julia's closings never logged because they live on FUB **Deals**/**Tableau** rather than
the person's live stage, resetting the clock just reproduces the false flag in a few
months. **Prove capture works first:**

1. Pick a live test person in FUB that is not closing. Move them into an **Under Contract**
   (or **Closed**) stage on the **person** record.
2. Trigger a sync (wait for the 30-min cron, or fire the sync endpoint / key-entry path).
3. Query:
   ```sql
   select fub_person_id, stage, stage_class, changed_at, date_source, detected_at
   from person_stage_log
   where fub_person_id = <TEST_PID>
   order by detected_at desc;
   ```
4. **Row appears** (stage_class `uc`/`closed`, `date_source = 'live'`, `changed_at ≈ now`) →
   capture works, the slate is safe to roll out.
   **No row** → the sync isn't seeing stage changes from the person object (closings are
   probably Deal/Tableau-only). Do **not** rely on the rule until Deals/Tableau closings
   are wired into `person_stage_log` — that's separate work; flag it back to Eric.

Populating logic to check if step 4 fails: `worker/src/sync.ts` (~lines 121–146) inserts a
hit only when the mapped **person `stage`** hits offer/uc/closed.

## Rollout expectations

- After setting the slate to today, existing `no_close` flags **clear** (denominators reset
  to ~0). That is correct, not a regression.
- Flags stay quiet until an agent genuinely accrues `pause_no_close_leads` (30) **post-slate**
  leads with zero UC/close — weeks/months out. The silence is the rule warming up.

## Non-goals / do NOT

- Do **not** delete or truncate `leads` or `person_stage_log`.
- Do **not** touch the volume pause rule (already rolling-monthly).
- Do **not** attempt to backfill historical closings — unrecoverable via the FUB API.
