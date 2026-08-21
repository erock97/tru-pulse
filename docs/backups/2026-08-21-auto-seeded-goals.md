# Backup — auto-seeded coaching goals removed 2026-08-21

Deleted 9 `goals` rows and 62 `commitments` rows from the TRU Pulse Supabase
project (`yeyoteredgunhvhqmais`).

## Why

Opening an agent's Coach profile silently created a goal row seeded with
`GOAL_DEFAULTS` — 6 contracts a quarter, 3 of them from company leads, a **4%
company conversion rate and a 12% sphere conversion rate that nobody
measured** — plus six commitment rows of generic copy. No leader typed any of
it. Every funnel number shown on those agents' pages was downstream of those
two invented rates.

These 9 were selected because **all** of the following were true:

- goal was still the exact untouched default: `q_goal=6, alloc_company=3,
  cvr_company=4, cvr_sphere=12`
- **zero** hand-written commitments (`is_custom = true`)
- **zero** commitments ever ticked off (`done = true`)

Anything showing a single sign of real use was left alone. Specifically kept:

| Agent | Why kept |
|---|---|
| Adam Walters (Costigan) | goal edited to 5 |
| Cara Benak (Costigan) | goal edited to 7, 4 from company |
| Trevor Holland (Costigan) | sphere rate edited to 10; 3 hand-written commitments, all done |
| Sarah Mulvaney (Costigan) | 3 hand-written commitments |

## What was deleted

Agents (9): Ana Nasrin, Chad Rabello, Emily Marinucci, Erica Stevens,
Fernanda Silva, Ron Dayley, Stuart Gray, Todd Bradley, Truitt Robinson.

Goal rows — all identical apart from ids and ownership:

```
quarter='Q3 2026', q_goal=6, alloc_company=3, cvr_company=4, cvr_sphere=12
```

| goal id | org_id | team_id | agent_id | updated_at |
|---|---|---|---|---|
| e1a4859b-fc02-4c2d-a3ca-462f5a7de677 | fed61cea-31cd-4d26-a195-9772a8ecfc9c | 96ddb98f-1fb6-4d99-80f6-20ef615dec34 | 283ebcd6-8dd7-4a63-9701-89322d5a85cf | 2026-07-10 |
| 9d991c66-e660-47e8-b853-22a38a94409a | bfada794-d88a-401c-80db-74b106178c86 | cb0fcbbb-c332-4f61-90f8-2b51b673bca8 | 92040771-ee19-4e07-a169-169cc05d49b0 | 2026-06-26 |
| 25e1b5a5-a53d-4c2d-b7ed-ec43069185ea | 100630b4-4bd0-4f74-bf70-4bf798f7ef9c | 3a84fd98-13f2-46e7-83a2-a1ed3aeadab7 | a3167968-1c25-448f-a0ba-b133e8e84000 | 2026-06-25 |
| deb608a4-f454-4fcd-8624-e258635c035b | 100630b4-4bd0-4f74-bf70-4bf798f7ef9c | 3a84fd98-13f2-46e7-83a2-a1ed3aeadab7 | 178aea67-ce19-4baf-83af-c8e0b92cd33e | 2026-06-25 |
| 1795b82a-b0c6-4d77-a361-64e0f70eeddd | 100630b4-4bd0-4f74-bf70-4bf798f7ef9c | 3a84fd98-13f2-46e7-83a2-a1ed3aeadab7 | 4c1a87c1-199e-4165-be03-74b7730dcfdf | 2026-07-13 |
| ae3871c4-4767-4190-9df7-aa76156e759a | bfada794-d88a-401c-80db-74b106178c86 | cb0fcbbb-c332-4f61-90f8-2b51b673bca8 | 6fc6777b-2b62-4641-ba0b-d8892f26d927 | 2026-06-23 |
| dfc7320c-2c9f-457d-b3ab-b3ade9a0f095 | bfada794-d88a-401c-80db-74b106178c86 | cb0fcbbb-c332-4f61-90f8-2b51b673bca8 | 664cdaa6-550b-4aa3-8179-dffb9da94e8b | 2026-06-24 |
| 61b76010-c221-4833-bf41-a03da4ec82a8 | bfada794-d88a-401c-80db-74b106178c86 | cb0fcbbb-c332-4f61-90f8-2b51b673bca8 | 2d73dd07-6b55-44de-b7a3-bc2f2b728756 | 2026-06-23 |
| 3a38d891-c243-45c2-abb8-8da3e5304faf | bfada794-d88a-401c-80db-74b106178c86 | cb0fcbbb-c332-4f61-90f8-2b51b673bca8 | 1098be50-c6c3-4bfb-9bfd-eea1a26fa44e | 2026-06-23 |

Commitment rows — 62 in total, every one `is_custom=false, done=false`, all
drawn from the fixed strings in `generateBaseCommitments()` in
`web/src/lib/coachData.ts`. Nothing bespoke was lost.

## How to restore

Insert a goal row per `(org_id, team_id, agent_id)` above with the five
default values, then run the same generator. Before the fix that removed the
auto-seeding, simply opening each agent's Coach profile recreated all of it.
