-- TRU Rep — Block A: certification stays on core modules.
-- Additive. Apply in the TRU-Pulse SQL editor before the matching Worker/web deploy.
-- Does NOT renumber existing idx values. New custom modules get idx from the Worker.

alter table rep_modules add column if not exists core boolean not null default true;

comment on column rep_modules.core is
  'When true, the module counts toward certification and unlocks the Live Sim. Custom library uploads are inserted with core=false.';
