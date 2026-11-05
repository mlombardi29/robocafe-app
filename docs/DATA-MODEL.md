# KioskOps data model

Migrations:

1. `supabase/migrations/0001_schema.sql` — tables, triggers, RPCs
2. `supabase/migrations/0002_rls_grants.sql` — explicit grants and row level security
3. `supabase/migrations/0003_seed_content.sql` — models, real sites, checklists, draft quiz
4. `supabase/migrations/0004_sandbox.sql` — practice sites and `reset_sandbox()`
5. `supabase/migrations/0005_harden_definer_functions.sql` — move policy helpers out of the public API, keep admin checks inside admin functions, lock search_path
6. `supabase/migrations/0006_fresh_practice.sql` — practice-only fresh visit; voids the caller's own open practice attempt and keeps its rows

The hosted project does not expose tables until a grant exists. `anon` has no table grants. `auth_pins` and `login_attempts` have no grants for `anon` or `authenticated`. Edge functions use the service role.

## Columns on every table

`id` (uuid), `created_at`, `created_by`, `is_sandbox`, `legacy_id`. Exceptions: `auth_pins` uses `person_id` as its primary key, and `config` uses `key`. Client-written tables also have a unique `idempotency_key`.

## Phase 1 tables

- `people`, `person_sites` — name, role (`admin`, `tech`, `trainee`, `visitor`), `mode` (`live` or `practice`)
- `auth_pins`, `login_attempts` — PIN hash, lockout, and address limits. Service role only
- `models`, `sites`, `schedule_rules`, `show_days`
- `checklist_templates`, `checklist_sections`, `checklist_items`
- `site_item_settings` — per-site fill level. Null until a number is chosen
- `site_item_state` — last time a step was marked done
- `service_sessions`, `service_item_completions`
- `time_corrections`, `audit_log`
- `training_progress`, `quiz_questions`, `quiz_attempts`
- `config`, `offboarding_tasks`
- `site_codes` — empty. No codes are seeded

## Phase 2 tables (no screens yet)

`skus`, `sku_packs`, `site_skus`, `inventory_tx`, `stock_flags`, `payments`, `charges`. Admins can write them. Techs can read rows for their own sites or their own pay, and only in the mode they are in.

## Helpers

`current_person_id()`, `is_admin()`, `is_active()`, `can_see_site(uuid)`, `in_practice()`, `can_write()`. They are `security definer` with `search_path` locked to `public`. Trigger functions live in the `private` schema so the API does not expose them.

## Real sites (seed)

| Site | Model | Serial | Cadence | Active |
|---|---|---|---|---|
| Mount Sinai Hospital | Series 3.5 E | TLCQP24370000062 | daily | yes |
| UofT Sidney Smith – Sid's Cafe | Series 2.2 | TKCQP25770200028 | Mon / Wed / Fri | yes, opening time blank |
| RBC Amphitheatre – Bud Stage | Series 5 (Lite Gen 5.2) | TLCQP23090200051 | show days | no (offline since Oct 15 2026) |

Practice copies are named `PRACTICE – Sinai (3.5)`, `PRACTICE – UofT (2.2)`, and `PRACTICE – RBC (S5)`. No people and no PINs are seeded.

## Arm sensor

Items with key `arm_sensor` are `pending_validation`. The details text is only: "Pass/fail criteria are being confirmed with KioCafe (Albert Kim). For now, note what you see."
