# Eleven-tab migration rehearsal kit

**Not a live migration.** This kit rehearses CSV import locally. Fixture success does **not** prove real legacy Google Sheet data is correct. It does not write to hosted Supabase, send mail, touch Google auth, publish the app, or apply database migrations.

## What it covers

The eleven legacy **CV App** sheet tabs (exact `Code.gs` `HEADERS`):

1. SKUs  
2. Transactions  
3. Locations  
4. LocationSKUs  
5. KioskFlags  
6. People  
7. Config  
8. ServiceSessions  
9. ScheduleOverrides  
10. Payments  
11. Charges  

Canonical library: `app/src/lib/migrate/`. CLI: `npx tsx scripts/migrate/rehearse.ts`.

## Modes (fail closed)

| Mode | How | Behavior |
|---|---|---|
| `dry_run` (default) | unset or `KIOSKOPS_MIGRATE_MODE=dry_run` | Parse, map, count, detect conflicts. **No store mutation** from import rows. |
| `local_apply` | `KIOSKOPS_MIGRATE_MODE=local_apply` | Mutates an **in-memory** store only. Snapshots for rollback. |
| anything else / connection string present | e.g. `live`, `DATABASE_URL=…` | Forced back to dry-run with `live_mode_blocked`. |

There is no hidden automatic real import path.

## Operator steps (local)

1. Export each of the eleven tabs to CSV **privately** (not into this public repo). Filenames must match tab names: `SKUs.csv`, `People.csv`, …
2. Build an explicit mapping file outside the repo (person names → person ids, location ids → site ids, sku ids, checklist item keys). Unmapped values must stay unresolved.
3. Dry-run:

```bash
KIOSKOPS_MIGRATE_FIXTURES=/path/to/private/csvs npx tsx scripts/migrate/rehearse.ts
```

4. Optional local apply + replay + rollback simulation (still memory-only):

```bash
KIOSKOPS_MIGRATE_MODE=local_apply KIOSKOPS_MIGRATE_FIXTURES=/path/to/private/csvs npx tsx scripts/migrate/rehearse.ts
```

5. Read findings. Codes such as `unmapped_person`, `conflict_existing_visit`, `negative_stock_delta`, `fractional_stock_delta`, `unit_conversion_proposed`, `secret_config_held`, and `pin_not_migrated` mean **not ready**. Do not invent fixes for box/sleeve anomalies or clamp stock.

## Rules preserved

- Stable legacy ids (`id`, or derived keys for People/Config/LocationSKUs/ScheduleOverrides).
- Idempotent replay: second apply inserts **zero** duplicates when payloads match.
- Preexisting KioskOps visits and payments are never overwritten; conflicts stay explicit.
- People CSV may omit the `pin` column (PIN-less export). If a pin value is present it is cleared and flagged; PINs are never imported.
- `buildEvidenceMaps()` matches staff/kiosks/SKUs only from clear in-workbook evidence (exact names/ids; short kiosk codes only when consistently paired with an exact Locations name). Ambiguous rows stay unresolved.
- Legacy completion JSON may use `itemId`/`label` (older shape) or `key`/`itemKey`. Only exact checklist key overlaps map; everything else stays in `legacy_completions`.
- Blank source foreign keys are `missing_source_ref` (corrupt/incomplete export), distinct from `unmapped_*` (no target map).
- Sleeve→cup (×50) / sleeve→lid (×100) may be **proposed** only, never auto-applied as corrections.
- Reconciliation reports rowcounts, transaction delta sums, charge hours, payment presence counts, and charge amount totals — mismatches are surfaced, not forced equal.
- Live KioskOps comparison is **not** claimed unless a separate approved read of the hosted database is performed.

## Seed / migration history

This kit does **not** change `0003`, and does **not** touch pinned `0011`–`0014` or `0015`. Those stay on their own approvals.

## Public repo hygiene

Do not commit real personnel rows, phone numbers, emails, access codes, catalogue exports, PINs, or connection strings. Tests use `syntheticWorkbook()` only.
