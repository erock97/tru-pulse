-- Clean-slate date for the no-closings pause rule (`pause_no_close`).
-- The rule flags an agent who took N leads (default 30) with none ever reaching
-- Under Contract / Closed. FUB exposes no stage history, so `person_stage_log`
-- only holds closings the sync personally witnessed — an agent's pre-tracking
-- book reads as "never produced" and falsely trips the rule (see
-- docs/pause-no-close-clean-slate-spec.md). This column lets a leader enforce the
-- rule only over the window we can actually see closes in.
--
-- NULL = count all lead history (today's behavior). Non-destructive; no data touched.
alter table org_settings add column if not exists pause_no_close_since timestamptz;
