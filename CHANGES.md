# Changelog — Robo Café app

A plain-language history of changes to the Robo Café internal app
(`Code.gs` + `Index.html`). Most recent first.

---

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
