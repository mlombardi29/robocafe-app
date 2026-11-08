# Servicing instructions

Human-readable servicing steps for each kiosk model. Edit `checklists/*.yaml` first, then regenerate these pages with `npm run gen:servicing-docs` from `app/`.

| Model | Sites | Page |
|---|---|---|
| Series 3.5 E (`s35`) | Mount Sinai / PRACTICE Sinai | [Open](./s35.md) |
| Series 2.2 (`s22`) | UofT / PRACTICE UofT | [Open](./s22.md) |
| Series 5 (Lite Gen 5.2) (`s5`) | RBC / PRACTICE RBC | [Open](./s5.md) |

## Canonical sources

| What | Where |
|---|---|
| Wording techs follow | `checklists/s35.yaml`, `checklists/s22.yaml`, `checklists/s5.yaml` |
| Greenfield seed SQL | `npm run gen:seed` → `supabase/migrations/0003_seed_content.sql` and `0004_sandbox.sql` (do **not** re-apply rewritten `0003` on a database that already ran it) |
| Live template text + new-visit Not needed rules | `supabase/migrations/0015_servicing_feedback.sql` (after the pinned `0011`–`0014` bundle; does not rewrite visit snapshots) |
| Arm sensor placeholder guard | `scripts/gen-seed.ts` refuses to ship a made-up arm-sensor pass |

## Held separately

- Cup presence / arm sensor pass-fail criteria still await confirmation. Do not treat an unconfirmed Albert reply as procedure.
- Applying `0011`–`0015` to the hosted database, Netlify publish of the phone app, Google/Drive setup, and live imports or sends stay on their own approvals.
