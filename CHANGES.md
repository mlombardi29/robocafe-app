# Changelog — Robo Café app

A plain-language history of changes to the Robo Café internal app
(`Code.gs` + `Index.html`). Most recent first.

---

## Correcting a submitted service (and catching AM/PM slips)
**Asked for by Peter,** who logged an end time at RBC as 11:45 **PM** instead of AM
and had no way to fix it after submitting.

- **Technicians can now correct their own submitted service** — service date, start
  time, end time and the milk-bag toggle — from Service history → tap the service →
  **"✏️ Correct these times."**
- **The window is the end of the day it was submitted**, as the team agreed, with a
  **3-hour floor**: a service submitted at 11:50 PM stays editable until 2:50 AM
  rather than locking ten minutes later. RBC concert nights and late Sinai visits run
  right up to midnight, so a strict cut-off would have been useless exactly when it's
  needed.
- **Managers can correct any service at any time.** Peter reported his mistake the
  next day — under a technician-only window that would already have been unfixable.
- **New: an over-long service is questioned at submit.** Anything over 6 hours asks
  "That works out to 12 h 45 m — double-check AM vs PM" before it can be submitted.
  This is the part that stops the mistake reaching the labour totals in the first
  place. The same check runs when correcting times, and a long service already on
  record shows a warning on its detail screen.
- **Every correction is recorded** — who changed it, when, and from what to what —
  shown on the service and kept in the Sheet (`editLog`), so hand-edited hours have a
  paper trail.
- Backend change: paste `Code.gs` and deploy a new version. No editor function to run.

## Fixed duplicate service reports + much faster autosave
**Reported by Rob:** "auto save too slow, and when I submit a report it still shows
service in progress." Both were real, and they had the same root cause.

- **What was happening.** A checklist had no ID until its first save came back from
  the server. The rule on the server is "ID given = update that record, no ID =
  create a new one." Autosave fires a couple of seconds after each tap — so if a
  technician hit **Complete service** while an autosave was still in flight, both
  requests said "no ID" and the server created **two** records for one service. The
  autosave's copy stayed "in progress" (exactly what Rob saw), and when it was later
  resumed and finished it became a second completed record.
- **Why it mattered:** those phantom records were **double-counting hours in Labour &
  reimbursements** — about 8.6 hours across 13 services since mid-June.
- **The fix:** every checklist now gets its ID the moment it opens, so the autosave
  and the Complete button always write to the same record. Plus two safety nets: a
  late autosave can no longer re-open a finished service, and completing a service
  auto-closes any leftover "in progress" record for that kiosk.
- **Autosave is now instant.** Progress saves to the phone immediately (no spinner,
  no waiting) and the server copy is refreshed quietly in the background, when you
  leave the checklist, and on submit. Leaving mid-service and coming back still
  restores everything, on the same phone or another one. Separately, saving a record
  used to write ~20 separate times to the Sheet; it's now a single write.
- **Historical cleanup:** `previewDuplicateServiceSessions()` shows the affected
  records and `cleanupDuplicateServiceSessions()` voids the phantom ones (run from
  the Apps Script editor). Nothing is deleted — voided rows stay in the Sheet with a
  note explaining what happened, and are ignored in history, reports and hours.
  Genuine repeat visits to the same kiosk on the same day are left alone.

## New: Order list (manager) — what to buy, grouped by supplier
- New manager tile **🛒 Order list**. It shows everything that's out, below its
  minimum, or about to run out, **grouped by where you buy it**: Kiosoft (email),
  Amazon, Costco via Instacart, Propeller, Eversys, Hatch Coffee, 8 Ounce (1883
  syrups), and a technicians-buy-it section for 2% milk (information only).
- Each line says exactly how much to order in the unit you actually buy —
  "2 × pack of 10 (20 bags)", "1 × box of 1,000 cups".
- **Kiosoft group has "✉️ Open order email"** — writes "Hi team, I'd like to order
  the following…" pre-addressed and ready to send. Every group has "📋 Copy list."
  The order email address lives in the private Sheet (Config key `orderEmails`),
  never in this public code.
- How quantities are worked out: enough to cover ~45 days of real usage, rounded up
  to whole boxes/packs. Guards: usage is only trusted after 14+ days and 3+
  withdrawals (one recent pull no longer reads as "one per day"), no order exceeds
  3× the item's minimum, and short-life items are capped lower — espresso beans
  30 days (roast freshness).
- Suppliers, order sizes, lead times and reorder minimums for all 29 items are now
  recorded in the database (run `applyOrderingSetup()` once from the Apps Script
  editor; it's safe to re-run, and everything stays editable under Items).
  Milk-bag minimums raised to 20; cups and lids now measured in 1,000-unit boxes.
- Backend change: paste `Code.gs`, deploy a new version, then run
  `applyOrderingSetup()` once.

## Schedule now forecasts milk-bag changes
- Future service days show a dashed **"🥛 Scheduled milk bag change"** marker so
  technicians can plan ahead. Past days keep the solid "Milk bag changed" marker for
  changes that actually happened.
- The forecast uses the 4-day bag life: counting from the kiosk's last recorded
  change, the next change lands on the **first service day on or after day 4** — if
  day 4 falls on a day that kiosk isn't visited (U of T weekends, RBC non-concert
  days), it simply waits for the next visit rather than pulling a day earlier.
  Each projected change restarts the clock, so markers repeat down the schedule.
  (Revised same day: the original version pulled changes earlier, which was too
  conservative.)
- A kiosk with no bag change on record shows the marker on its next service day.
- Frontend-only change: deployed by the push, no Apps Script paste needed.

## Fixed "Invalid Date" coverage requests that never expired
- The schedule, payments and charges readers were the last three that didn't convert
  the Sheet's typed date/time cells to clean text (the known date gotcha). One root
  cause, four symptoms — all fixed:
  - "Coverage needed" showed **Invalid Date** and listed requests whose dates had
    already passed (they now hide automatically once the date is gone).
  - Tapping "Request coverage" repeatedly created **duplicate rows** instead of
    updating one (the row matching never matched a typed date cell).
  - **Picking up coverage didn't clear the request**, so old requests lingered forever.
  - Labour: paid/unpaid detection and the charges date-range filter could misjudge
    rows because dates were compared as long raw text.
- No data cleanup needed: the 9 stale requests (7 were duplicate taps of one June 27
  request) disappear from view on their own now that the past-date filter works.
- Backend change: paste `Code.gs` into the Apps Script editor and deploy a new version.

## Instant screens (speed pass 2)
- Screens you've visited before now open **instantly** from data remembered on the
  device, while fresh numbers load quietly in the background — if anything changed,
  the screen updates itself a moment later.
- This applies to read-only listings (dashboard, warehouse stock, histories, reports,
  labour, pick-up list, schedule). Screens where you enter data — and the kiosk stock
  report and service checklist — always load live data, never remembered data.
- Anything you submit wipes the remembered data first, so you never see
  pre-submission numbers after saving something.
- Frontend-only change: deploying it is just this push (no Apps Script paste needed).

## Moved to GitHub Pages + real sign-in security + speed
- **The app now lives at `https://mlombardi29.github.io/robocafe-app/`.** The page is
  hosted from this repo by GitHub Pages and talks to the Apps Script backend over the
  web. Deploying a frontend change is now just a push to this repo — pasting into the
  Apps Script editor is only needed when `Code.gs` itself changes.
- The old Apps Script link now shows a **"Robo Café has moved"** notice with the new
  link, in case anyone lands there from an old bookmark.
- **Real sign-in security.** Signing in with your PIN now issues a private session pass
  that every request must carry — the backend rejects anything without one, so knowing
  the backend URL alone no longer gets you in. Sessions last 30 days.
- **Wrong-PIN protection.** Five wrong PIN attempts locks that PIN. The lock screen says
  to message a manager directly; a manager's **Reset PIN** button (Settings → People)
  clears the PIN *and* the lock, and works on anyone — technicians and managers alike.
- **Speed.** The device now remembers your sign-in (no PIN re-entry every open), remembers
  the item/people lists so screens draw instantly while fresh data loads quietly behind,
  and bundles a screen's several server calls into one round trip instead of many.
- **Privacy.** The backup email addresses were removed from the code (the repo is public
  now). Recipients live in the private database instead: Config tab, key `backupEmails`,
  value = comma-separated addresses. If missing, snapshots go to the Sheet's owner.
- File housekeeping: `Index.html` is renamed **`index.html`** (required by GitHub Pages).

## Backups — retention & cleanup
- Reduced automatic backup retention from 30 copies to **2** (the two most recent).
- Added maintenance functions to run manually from the Apps Script editor:
  - `listTriggers()` — lists every scheduled trigger, to spot a runaway or duplicate.
  - `resetBackupSchedule()` — removes any leftover/duplicate backup triggers and installs exactly one clean daily backup (~2am).
  - `cleanupBackups()` — trashes all but the 2 newest backup copies. Reversible — files go to Drive Trash, nothing is permanently deleted.

## Kiosk stock reports
- A report can now be submitted even when nothing is Low or Out — a "clean" report is allowed.
- Added a **Submit** button at the top of the report, so a clean kiosk can be submitted without scrolling to the bottom.
- A submission is now the authoritative current state for that kiosk: submitting **clears** any previous Low/Out warnings there, then records whatever is marked now.
- When a report is opened, items already flagged are **pre-selected**, so a submission won't accidentally wipe a flag that's still valid.

## Servicing checklists
- **Mandatory start and end time when completing a service.** If either is missing, completion is blocked, the missing field gets a "★ incomplete" marker, and the view scrolls up to it. (Saving progress or leaving without finishing is still fine — the requirement only applies to completing.)
- **Autosave.** Progress — checkmarks, notes, times, flags — now saves quietly in the background as you go, and again the moment you leave the checklist. Leaving mid-service and coming back restores everything. The manual button is now labelled **"Save progress."**
- **Fixed service history showing empty after a submission.** The Sheet stored dates and times as typed cells, which Apps Script handed back as Date objects and broke the data sent to the browser. All service data is now converted to clean text on the server before it's sent.

## Speed
- Screens that made several server calls in a row (service checklist, manager dashboard, labour, reports) now make those calls **in parallel**, cutting the loading wait noticeably.

## Mobile layout
- Fixed the **Start time / End time inputs overlapping on iPhone**, with a fix that's also safe on Android.

## Backup system (initial build)
- **Daily automatic backup:** a full, timestamped copy of the entire database Sheet is saved to a "Robo Café — DB backups" Google Drive folder.
- **One-tap "Back up now"** button in manager Settings.
- **Off-Drive email snapshot every 60 days:** a complete `.xlsx` of every tab, emailed to the team, with a lifetime-totals summary.
- Run `enableBackups()` once from the editor to grant permissions and switch on the daily schedule.

## Earlier UX pass
- Fixed dead / unresponsive submit taps (a toast overlay was intercepting them).
- Blocked submitting an end time earlier than the start time.
- Coverage request button now toggles to "Coverage requested ✓" for the requester.
- Rebuilt the reimbursements layout and renamed "Labour hours" → **"Labour & reimbursements."**
- Reworked the header into a clean back / title / home layout.
- Simplified the manager dashboard to tappable count tiles that drill into detail.
- Added **milk-bag tracking:** a separate "milk bag changed today" toggle, an overdue prompt after 4 days, and milk-bag markers in the schedule history.

---

## How to deploy a change (reminder)
- **Frontend (`index.html`):** just push to this repo — GitHub Pages updates the live
  app automatically within a minute or two.
- **Backend (`Code.gs`):** paste the updated file into the Apps Script editor, then
  **Deploy → Manage deployments → New version.**
- If a change added a Sheet column, run `setup()` once (it's safe to re-run).
- After every deploy: open GitHub Desktop → robocafe-app → **Fetch origin** to sync
  the local clone.
