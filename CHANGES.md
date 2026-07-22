# Changelog — Robo Café app

A plain-language history of changes to the Robo Café internal app
(`Code.gs` + `Index.html`). Most recent first.

---

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
1. Paste the updated `Code.gs` and `Index.html` into the Apps Script editor.
2. **Deploy → Manage deployments → New version.**
3. If a change added a Sheet column, run `setup()` once (it's safe to re-run).
