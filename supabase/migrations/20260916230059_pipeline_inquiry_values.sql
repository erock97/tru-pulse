-- Minimal derived evidence only. Existing leads RLS/grants remain unchanged.
alter table public.leads add column if not exists pipeline_inquiry_value jsonb;
