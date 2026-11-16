# Servicing release readiness — Nov 8

**No hosted DB apply, no Google, no push/deploy/spend in the gate run.**

## Release candidate (unchanged)

| Item | Value |
|---|---|
| **Candidate SHA** | `41a495d6a1995754aed64ecd8c8a52b9672cedd2` |
| **Original branch** | `cursor/servicing-feedback-ad-cce7` (preserved) |
| **Gate prep branch** | `cursor/servicing-0015-local-pg-gate-cce7` (adds local verify script only) |
| **Live DB target** | Through **0010** only |
| **Needs 0011–0014?** | **No** for this servicing scope |
| **Needs Google/Drive?** | **No** |
| **Stamp** | `ui-2026-11-08-service` |

## Proposed DB SQL (NOT applied to hosted)

**File:** `supabase/migrations/0015_servicing_feedback.sql`  
**SHA-256:** `20715f66d77159e35873d443b848967f8aa2f1a279c6374542e93d74eb0c819c`  
**Path proof:** local PostgreSQL loaded **0001–0010** then **0015 alone** (0011–0014 not loaded).

## Local PostgreSQL safety gate — PASS

Engine: PostgreSQL 16 at `/var/run/postgresql`, database `kioskops_0015_gate`.  
Script: `scripts/verify-0015-on-0010.ts`.

Proven on exact 0010+0015 path:

- Intentional transaction rollback of 0015 left no stamp function/trigger; `start_session` stayed 4-arg
- Committed 0015: stamp trigger present; still exactly one 4-arg `start_session`
- Client start fallback (`photoAuditArgMissing` / `withoutPhotoArg` / `acceptStartResult`) correct for 0010-shaped servers
- `save_completion` auth/access/practice/milk-lock guards retained vs 0010; every-service Not needed reject added (not a weakening)
- `private.stamp_visit_not_needed` not executable by `authenticated`
- Template `arm_calibration` UPDATE contains authoritative 7-step Auto Calibrate + cup-sensor distinction
- Older open visit snapshot unchanged; Not needed still accepted; new visit stamped and rejects Not needed on `gloves`
- Seeded session + payment preserved through apply and backup/restore probes
- Function restore via re-applying `0007`; template + trigger backup restore; 0015 re-apply clean

**Limitation:** local PostgreSQL only. Hosted project untouched. Stronger than PGlite/mock; not a live production apply.

### Gate artifacts (retrieve individually)

- `/opt/cursor/artifacts/servicing-0015-local-pg-gate-2026-11-08/0015-LOCAL-PG-GATE.md`
- `/opt/cursor/artifacts/servicing-0015-local-pg-gate-2026-11-08/0015-local-pg-gate-machine.json`
- `/opt/cursor/artifacts/servicing-0015-local-pg-gate-2026-11-08/RUN-EVIDENCE.txt`
- `/opt/cursor/artifacts/servicing-0015-local-pg-gate-2026-11-08/0015_servicing_feedback.sql`
- `/opt/cursor/artifacts/servicing-0015-local-pg-gate-2026-11-08/0015_servicing_feedback.sha256`

## Exact next approvals (unchanged)

1. **Database:** apply **0015 only** on hosted project (hash above).
2. **Publishing / Netlify:** push/merge candidate `41a495d` when Free-credit constraint is resolved — gate prep branch is documentation/script only (`[skip netlify]`).
3. **Do not** approve 0011–0014 / Google as part of servicing-only release unless expanding scope.
