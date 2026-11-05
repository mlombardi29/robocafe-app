# KioskOps

Mobile app for Certain Ventures service visits. The old Robo Café app stays at the repo root.

## Local app

```bash
cd app
cp .env.example .env
# For local Supabase, put the URL and anon key printed by `supabase start` into .env.
npm install
npm run dev
```

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
