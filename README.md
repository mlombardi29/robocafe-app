# Robo Cafe - internal app

Web app for Certain Ventures' robo-kiosk coffee operations (inventory, kiosk stock reports, servicing, schedule, reimbursements, backups).

- `index.html` - single-file frontend, hosted by GitHub Pages at https://mlombardi29.github.io/robocafe-app/
- `Code.gs` - Google Apps Script backend (paste into the Apps Script editor bound to the database Sheet); serves a JSON API the page calls over the web
- `CHANGES.md` - plain-language history of changes

## Deploy
- Frontend: push `index.html` to `main` - GitHub Pages redeploys automatically.
- Backend: paste `Code.gs` into the Apps Script editor, then Deploy -> Manage deployments -> New version (Execute as: Me, Who has access: Anyone).
