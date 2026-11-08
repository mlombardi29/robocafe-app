# KioskOps data model

Migrations:

1. `supabase/migrations/0001_schema.sql` — tables, triggers, RPCs
2. `supabase/migrations/0002_rls_grants.sql` — explicit grants and row level security
3. `supabase/migrations/0003_seed_content.sql` — models, real sites, checklists, draft quiz
4. `supabase/migrations/0004_sandbox.sql` — practice sites and `reset_sandbox()`
5. `supabase/migrations/0005_harden_definer_functions.sql` — move policy helpers out of the public API, keep admin checks inside admin functions, lock search_path
6. `supabase/migrations/0006_fresh_practice.sql` — practice-only fresh visit; voids the caller's own open practice attempt and keeps its rows
7. `supabase/migrations/0007_milk_lock_not_needed.sql` — while the milk timer is running, Done is rejected on locked steps; Not needed stays allowed on Wipe the Cameo (later reversed for **new** visits by `0015`, without rewriting old snapshots)

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

## Phase 2 tables

`skus`, `sku_packs`, `site_skus`, `inventory_tx`, `stock_flags`, `payments`, `charges`. `0009` adds pay rates, payment lines, and held reorder notices. `0011` adds photo-audit metadata, KC confirmations, an optional checklist-to-SKU link, and the kiosk a Dupont pickup was for. `0013` adds `notification_outbox` for disabled pickup and reorder previews, and an empty `private.drive_file_acks` row that only the upload function can write after Drive returns a file. `0014` adds the photo version on that acknowledgement and an optional photo flag on `start_session`. It does not update existing visit rows. Reorder addresses live in empty `private.notification_recipients` slots named `michael` and `kajsa`. Screens exist for stock, flags, pickup, pay, photo review, and catalogue preview. Stock add/take/recount can enter a pack size or base units and shows the conversion before saving; pack rows stay optional and empty until an admin adds them. Coverage, reimbursements, and Drive backup do not. Admins can write stock and pay through the functions. Techs can read rows for their own sites or their own pay, and only in the mode they are in. Photo and KC rows are not writable from the client except through those functions. Photo rows do not contain image bytes. Reorder notices cannot be marked sent.

## Helpers

`current_person_id()`, `is_admin()`, `is_active()`, `can_see_site(uuid)`, `in_practice()`, `can_write()`. They are `security definer` with `search_path` locked to `public`. Trigger functions live in the `private` schema so the API does not expose them.

## Real sites (seed)

| Site | Model | Serial | Cadence | Active |
|---|---|---|---|---|
| Mount Sinai Hospital | Series 3.5 E | TLCQP24370000062 | daily | yes |
| UofT Sidney Smith – Sid's Cafe | Series 2.2 | TKCQP25770200028 | Mon / Wed / Fri | yes, opening time blank |
| RBC Amphitheatre – Bud Stage | Series 5 (Lite Gen 5.2) | TLCQP23090200051 | show days | no (offline since Oct 15 2026) |

Practice copies are named `PRACTICE – Sinai (3.5)`, `PRACTICE – UofT (2.2)`, and `PRACTICE – RBC (S5)`. No people and no PINs are seeded.

## Arm calibration vs arm sensor

- `arm_calibration` (Sinai and RBC): approved seven-step Auto Calibrate **weight** procedure in `checklists/*.yaml` and `0015`. It is not the cup presence sensor.
- `arm_sensor` stays `pending_validation`. Details text is only: "Pass/fail criteria are being confirmed with KioCafe (Albert Kim). For now, note what you see." Do not treat an unconfirmed reply as procedure.

## Servicing feedback (`0015`)

`0015_servicing_feedback.sql` updates published checklist item titles/details to match YAML, stamps `not_needed_allowed` on **new** visit snapshots, and rejects Not needed only when that flag is false. Existing and offline snapshots without the flag stay finishable. Pinned `0011`–`0014` are unchanged. Do not rewrite applied `0003` history to carry these edits.
