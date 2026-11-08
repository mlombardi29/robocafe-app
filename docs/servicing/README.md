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
| Current live template + thresholds candidate | `supabase/migrations/0016_servicing_ops_facts.sql` (on DB through 0010; does not rewrite visit snapshots) |
| Frozen historical 0015 | `supabase/migrations/0015_servicing_feedback.sql` (immutable; superseded for new apply by 0016) |

## Held separately

- Volumes under 500 mL when applying the Kiosoft milk entry rule are not specified — flag if a visit needs that case; do not invent handling.
- Google Doc sync and inaccessible `shes-wired-in/certain-ventures` manual copy — not claimed synced here.
- Applying `0011`–`0014`, hosted `0016`, Netlify publish, Google/Drive, and live imports/sends stay on their own approvals.
