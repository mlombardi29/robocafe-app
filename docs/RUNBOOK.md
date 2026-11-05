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

If a later file fails, stop. Do not re-run an earlier file that already succeeded. If 0001 through 0004 are already applied, run only `0005_harden_definer_functions.sql`.

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

```bash
cd app
SUPABASE_URL=https://ucvacwbmhutedwfffcoj.supabase.co \
SUPABASE_SERVICE_ROLE_KEY='(from Project Settings → API, service_role)' \
ADMIN_FULL_NAME='Full Name' \
ADMIN_GOES_BY='Name' \
ADMIN_EMAIL='name@example.com' \
ADMIN_TEMP_PIN='(say it, do not save it here)' \
npx tsx ../scripts/bootstrap-admin.ts
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

`netlify.toml` in the repo root already sets the base directory, the build, the publish folder, the SPA redirect, and `noindex`. You still choose the production branch in the Netlify UI. Do **not** set the production branch to `main`. `main` is the old GitHub Pages app.

Environment variables (all deploy contexts):

- `VITE_SUPABASE_URL` = `https://ucvacwbmhutedwfffcoj.supabase.co`
- `VITE_SUPABASE_ANON_KEY` = the anon key (added when you have it)

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

Admin → Checklist items. Titles, details, cadence, required, and status save on blur. Per-site "fill below X" boxes start blank. Leave them blank until you decide a number. Techs then see "Check. Fill if low."

Admin → RBC show days. One line per show: `YYYY-MM-DD HH:MM`. The real season list is not in the app yet. While you are in Practice mode, the paste writes the practice RBC site.

The free project can pause after about 7 days with no use. `keep-alive` only answers `{ "ok": true }`. After the functions are deployed, a daily request to `https://ucvacwbmhutedwfffcoj.supabase.co/functions/v1/keep-alive` with the anon key in the `apikey` header is enough. You can add that later as a Supabase scheduled function or any free scheduler. Opening the test site also counts as activity.

## 10. If something is wrong

- Names do not load: the `pin-login` function is not deployed, or the anon key on Netlify is missing.
- A tech sees no sites: they are in the wrong mode, or they have no site assignment. Trainees should see only PRACTICE sites.
- A submitted time will not change: that is intentional. My time → Request a correction. Admin → Time corrections.
- The project paused: dashboard → Restore, then open the test site once.

Do not merge `kioskops-v1` into `main` until cutover. Merging would put this app next to the old GitHub Pages files. Netlify should keep deploying this branch on its own.
