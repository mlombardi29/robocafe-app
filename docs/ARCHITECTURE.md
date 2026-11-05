# KioskOps architecture

KioskOps (the new app) is in `/app`. The files at the repo root (`index.html`, `Code.gs`, `README.md`, `CHANGES.md`, `.nojekyll`) are the old Robo Café app. They stay on `main` and keep serving GitHub Pages until cutover. Do not merge this branch until that cutover is planned.

## What runs where

| Piece | Where it lives | Notes |
|---|---|---|
| Phone app | `app/` (Vite, React 18, TypeScript, Tailwind) | Netlify, base directory `app` |
| Database | `supabase/migrations/` | Applied by a person, not by this repo |
| PIN sign-in and admin actions | `supabase/functions/` | Service role stays on the server |
| Checklist wording | `checklists/*.yaml` | `npm run gen:seed` rewrites the seed SQL |

The hosted database is project `kioskops`, ref `ucvacwbmhutedwfffcoj`, region ca-central-1. Nothing in this repo connects to it. The old US project ref is deleted and is not used.

## Sign-in

People do not get email links. `pin-login` checks a bcrypt PIN, then asks Supabase Auth for a session with `generateLink` and `verifyOtp` inside the function. No email is sent. The browser stores the session. A temporary PIN forces the Set PIN screen.

Failed PINs lock that person for 15 minutes after 5 tries. One address is also limited to 20 failures per 15 minutes. Admins can unlock early.

## Practice vs live

Every row has `is_sandbox`. Trainees are always in practice. A tech or admin turns practice on with `set_mode`. Row level security only allows a write when the row's sandbox flag matches that mode. An admin can still read everything. Reports that must ignore practice use `is_sandbox = false` (see `v_live_sessions`).

## Visits

Start now calls `start_session` with a client UUID. Repeating the same id returns the same visit. Each step calls `save_completion`, which keeps one row per step and ignores an older replay. The phone also writes the step to IndexedDB first and retries the queue when the network returns, when the tab wakes, every 5 seconds, and when the app opens.

Complete service calls `complete_session`. A blank end time becomes now. After submit, a tech cannot change the times. They send a correction; an admin approves it with `decide_correction`, which writes an audit row.

Milk cleaning stores `milk_clean_started_at` on the visit, so the countdown survives a reload. Prep steps that would touch the Cameo have to be Done or Not needed before the timer starts, unless the tech gives a reason.

## Due items

`app/src/lib/due.ts` decides what to show. It does not invent stock numbers. A blank threshold reads "Check. Fill if low." The UofT Monday red flag runs only when `sites.opening_time` is set. It is null on purpose.

## Auth metadata

Role is stored on `people.role` and copied to the auth user's `app_metadata`. Policies do not trust `user_metadata`, which a user can edit.
