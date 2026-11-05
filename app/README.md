# KioskOps

Mobile app for Certain Ventures service visits. The old Robo Café app stays at the repo root.

## Local app

```bash
cd app
npm install
npm run dev
```

`npm run build` uses `app/.env.production` (the public hosted URL and anon key). For a local Supabase, copy `.env.example` to `.env` and fill in the URL and anon key printed by `supabase start`. A variable already set in the shell overrides both files.

Scripts: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

`npm test` includes an in-process database check of the migrations and row level security. It does not call the hosted project.

## Regenerate checklist seed

Edit `checklists/*.yaml`, then from `app/`:

```bash
npm run gen:seed
```

Commit the YAML and the generated SQL together.

## Hosted setup

See `docs/RUNBOOK.md`. Do not put the anon key, service role key, or any PIN in git.
