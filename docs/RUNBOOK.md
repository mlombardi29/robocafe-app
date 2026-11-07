# KioskOps runbook

This is the order to stand up the private test site. Do these yourself. The app code does not connect to the hosted database.

Project: **kioskops**, ref `ucvacwbmhutedwfffcoj`, region ca-central-1.  
URL shape: `https://ucvacwbmhutedwfffcoj.supabase.co`

If the Supabase project is paused, open the dashboard and click Restore. Then come back to step 1.

## 1. Apply the database

In the Supabase dashboard, open SQL Editor. Run these files **one at a time, in this order**, pasting the whole file:

1. `supabase/migrations/0001_schema.sql`
2. `supabase/migrations/0002_rls_grants.sql`
3. `supabase/migrations/0003_seed_content.sql`
4. `supabase/migrations/0004_sandbox.sql`
5. `supabase/migrations/0005_harden_definer_functions.sql`
6. `supabase/migrations/0006_fresh_practice.sql`
7. `supabase/migrations/0007_milk_lock_not_needed.sql`
8. `supabase/migrations/0008_phase1_batches.sql`
9. `supabase/migrations/0009_phase2_pay_inventory.sql`
10. `supabase/migrations/0010_milk_order_guidance.sql`
11. `supabase/migrations/0011_ops_batch.sql`

If a later file fails, stop. Do not re-run an earlier file that already succeeded. If 0001 through 0005 are already applied, run `0006_fresh_practice.sql`, then `0007_milk_lock_not_needed.sql`. `0006` adds `start_fresh_practice` and does not delete rows or change last-done dates. `0007` rejects Done on timer-locked steps while milk cleaning is running, and still allows Not needed on Wipe the Cameo. The phone already does this before `0007` is applied. No edge function redeploy is required for these files.

You should see models, three real sites, three PRACTICE sites, checklist rows, and quiz rows. You should not see any people.

## 2. Turn off public sign-up

Authentication → Providers → Email: disable sign-ups, or confirm "Allow new users to sign up" is off. People are created only by the admin function or the bootstrap script below.

Authentication → JWT expiry: 3600 seconds (1 hour) is enough. Refresh tokens keep a phone signed in.

## 3. Deploy the three functions

On a machine with the Supabase CLI, from the repo root, after `supabase login`:

```bash
supabase link --project-ref ucvacwbmhutedwfffcoj
supabase functions deploy pin-login
supabase functions deploy set-pin
supabase functions deploy admin-person
supabase functions deploy keep-alive
```

`supabase/config.toml` already sets `pin-login` to `verify_jwt = false` so the sign-in screen can load names before anyone has a session. Leave that as it is. The other two functions require a signed-in admin or user.

Hosted functions receive `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` automatically. Do not paste those into the repo. If sign-in creates the user check but then fails at the last step, set a function secret named `SUPABASE_ANON_KEY` to the anon key from Project Settings → API.

## 4. Create Michael and Kajsa

Use a temporary PIN you will say out loud. Do not put it in the repo, in Slack, or in the command history if you can avoid it. A PIN is 4 to 6 digits, not 1234, 12345, 123456, or the same digit repeated.

From the repository root (`npm install` inside `app/` must already have been run):

```bash
SUPABASE_URL=https://ucvacwbmhutedwfffcoj.supabase.co \
SUPABASE_SERVICE_ROLE_KEY='(from Project Settings → API, service_role)' \
ADMIN_FULL_NAME='Full Name' \
ADMIN_GOES_BY='Name' \
ADMIN_EMAIL='name@example.com' \
ADMIN_TEMP_PIN='(say it, do not save it here)' \
npx tsx scripts/bootstrap-admin.ts
```

`name@example.com` is a placeholder. Run the command once per admin, with that person's real name and email in the environment (Michael, then Kajsa). Each admin is linked to the three real sites. The first sign-in asks for a new PIN.

The service role key is a secret. If it lands in a shell history or a screenshot, rotate it in the dashboard.

## 5. Connect Netlify

Team: KioskOps. Site settings:

| Setting | Value |
|---|---|
| Repository | `mlombardi29/robocafe-app` |
| Production branch | `kioskops-v1` |
| Base directory | `app` |
| Build command | `npm ci && npm run build` |
| Publish directory | `dist` (relative to `app`, so the site publishes `app/dist`) |
| Node | 20 |

`netlify.toml` at the repo root already sets the base directory (`app`), the build command (`npm ci && npm run build`), the publish directory (`dist`, relative to `app`), the SPA redirect, and `noindex`. Connecting the repo is enough for those. You still choose the production branch in the Netlify UI. Set it to **`kioskops-v1`**. Do **not** set it to `main`. `main` is the old GitHub Pages app.

You do not need to add Supabase env vars. The production build reads the public project URL and the anon key from `app/.env.production`. That key is the anon role only. The service role key stays out of the repo and out of Netlify. If you later set `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` in Netlify, those values override the file.

Trigger a deploy of `kioskops-v1`. The test address is the site's `*.netlify.app` URL. It is unlisted (`noindex`) and every screen needs a PIN. Netlify password protection is a paid feature and is not used.

## 6. Add a tech or trainee

Sign in as an admin → Admin → Add a person.

- Tech or admin: pick the real sites they work.
- Trainee: they only ever see PRACTICE sites. You can still tick Mount Sinai and UofT so those links are waiting if you later change them to a tech. Tell them the temporary PIN in person.

Sunday training names from the signed-off list, when you are ready (do this in the app, not in git):

| Name | Goes by | Email | Intended sites |
|---|---|---|---|
| Imran Aslam | Imran | imran7757@yahoo.com | UofT, Mount Sinai |
| Viweahan Shanthasivam | Vin | viweahan@live.ca | UofT, Mount Sinai |

Role: trainee. No schedule yet.

## 7. Reset a PIN or unlock

Admin → People. Enter a new temporary PIN and tap Reset PIN, or tap Unlock to clear a 15-minute lock without changing the PIN. Deactivate ends their sign-in and adds offboarding reminders. Those reminders do not contain codes. The codes list is empty on purpose.

## 8. Reset practice data

Admin → Reset practice data. This deletes practice visits and restores the practice "last done" dates and the practice RBC show days. Live visits are not deleted.

## 9. Checklist edits and show days

Admin → Order thresholds. The sentence under each site is what techs see. A blank number with no instruction still says "Check. Fill if low." A saved 50% reads as below half, 67% as below two-thirds, and a stored instruction with no number is shown as written.

Photo audit, stock flags, Dupont pickup, and KC Manager lines stay quiet until `0011_ops_batch.sql` is applied. Nothing in that file sends email or uploads a photo. Drive upload also needs the `photo-audit-upload` function deployed with secrets `DRIVE_RELAY_URL` and `DRIVE_RELAY_TOKEN`. Until those exist, a photo stays on the phone and an admin cannot mark it OK. Do not put those secrets in the repo.

Link a checklist step to a Dupont or grocery item, and set a KC max, only after you choose the real values. The app does not invent them. Reorder check stores a held list and does not email.

Admin → RBC show days. One line per show: `YYYY-MM-DD HH:MM`. The real season list is not in the app yet. While you are in Practice mode, the paste writes the practice RBC site.

The free project can pause after about 7 days with no use. `keep-alive` only answers `{ "ok": true }`. After the functions are deployed, a daily request to `https://ucvacwbmhutedwfffcoj.supabase.co/functions/v1/keep-alive` with the anon key in the `apikey` header is enough. You can add that later as a Supabase scheduled function or any free scheduler. Opening the test site also counts as activity.

## 10. If something is wrong

- Names do not load: the `pin-login` function is not deployed, or the anon key on Netlify is missing.
- A tech sees no sites: they are in the wrong mode, or they have no site assignment. Trainees should see only PRACTICE sites.
- A submitted time will not change: that is intentional. My time → Request a correction. Admin → Time corrections.
- The project paused: dashboard → Restore, then open the test site once.

Do not merge `kioskops-v1` into `main` until cutover. Merging would put this app next to the old GitHub Pages files. Netlify should keep deploying this branch on its own.
