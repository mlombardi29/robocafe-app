# KioskOps architecture

KioskOps (the new app) is in `/app`. The files at the repo root (`index.html`, `Code.gs`, `README.md`, `CHANGES.md`, `.nojekyll`) are the old Robo Café app. They stay on `main` and keep serving GitHub Pages until cutover. Do not merge this branch until that cutover is planned.

## What runs where

| Piece | Where it lives | Notes |
|---|---|---|
| Phone app | `app/` (Vite, React 18, TypeScript, Tailwind) | Netlify, base directory `app` |
| Database | `supabase/migrations/` | Applied by a person, not by this repo |
| PIN sign-in and admin actions | `supabase/functions/` | Service role stays on the server |
| Checklist wording | `checklists/*.yaml` | Canonical source. Readable pages under `docs/servicing/`. `npm run gen:seed` rewrites greenfield seed SQL only; live template updates use additive migrations such as `0015` |

The hosted database is project `kioskops`, ref `ucvacwbmhutedwfffcoj`, region ca-central-1. Nothing in this repo connects to it. The old US project ref is deleted and is not used.

## Sign-in

People do not get email links. `pin-login` checks a bcrypt PIN, then asks Supabase Auth for a session with `generateLink` and `verifyOtp` inside the function. No email is sent. The browser stores the session. A temporary PIN forces the Set PIN screen.

Failed PINs lock that person for 15 minutes after 5 tries. One address is also limited to 20 failures per 15 minutes. Admins can unlock early.

## Practice vs live

Every row has `is_sandbox`. Trainees are always in practice. A tech or admin turns practice on with `set_mode`. Row level security only allows a write when the row's sandbox flag matches that mode. An admin can still read everything. Reports that must ignore practice use `is_sandbox = false` (see `v_live_sessions`).

## Visits

Start now calls `start_session` with a client UUID. Repeating the same id returns the same visit. Each step calls `save_completion`, which keeps one row per step and ignores an older replay. The phone also writes the step to IndexedDB first and retries the queue when the network returns, when the tab wakes, every 5 seconds, and when the app opens.

Complete service calls `complete_session`. A blank end time becomes now. After submit, a tech cannot change the times. They send a correction; an admin approves it with `decide_correction`, which writes an audit row.

Milk cleaning stores `milk_clean_started_at` on the visit, so the countdown survives a reload. The checklist stays in the recommended order, and the visit screen says which prep steps are recommended first. That order does not block Start milk cleaning, and no override reason is required. Steps that would touch the machine stay locked only while that timer is actually running. Complete service rejects a visit while a required step is still open. Done and Not needed both count. A milk timer that was actually started counts as the start-milk step. Photo audit is required only when that visit's checklist snapshot says `photo_audit.required` is true. This app asks `start_session` to write that field in the same transaction as the new visit. Older open visits, and a start that does not ask, do not have the field, and a missing field does not mean photos are required. Repeating a start does not add or remove the field. A voided or unfinished visit does not count toward the three approved photo audits. Replacing a photo clears its Drive file and approval and will not accept the previous file. The same bytes can be retried. Practice mode cannot change a live visit, and live mode cannot change a practice visit, through these photo, KC, review, and complete functions.

Catalogue import is a preview on the admin screen. It proposes cup and lid conversions and lists discrepancies. It does not write stock or invent a KC max. Stock entry can use a pack size or the item's base unit; the phone converts to base units before `record_stock` and shows the conversion. Pack names stay as entered until Michael confirms terminology. Coverage request/claim/cancel writes `schedule_overrides` only and never emails. Reimbursement charges store an optional receipt link text; Drive upload stays off until separately activated. Drive upload is a CV-owned Apps Script relay in `drive-relay/Code.gs`, called only by `photo-audit-upload` after the relay secrets exist. Until then the photo stays on the phone. Pickup and reorder notices can be previewed. The server records them as disabled and does not send mail.

## Due items

`app/src/lib/due.ts` decides what to show. It does not invent stock numbers. A blank threshold reads "Check. Fill if low." The UofT Monday red flag runs only when `sites.opening_time` is set. It is null on purpose.

## Auth metadata

Role is stored on `people.role` and copied to the auth user's `app_metadata`. Policies do not trust `user_metadata`, which a user can edit.
