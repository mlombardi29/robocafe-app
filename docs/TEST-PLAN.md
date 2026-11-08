# KioskOps test plan

## Automated (CI)

From `app/`:

- `npm run typecheck`
- `npm run lint`
- `npm test` — Vitest plus `scripts/rls-test.ts`

Vitest covers:

- PIN lockout at 5 failures / 15 minutes, the address limit, and 4–6 digit rules
- Practice/live read and write rules, including trainees and submitted times
- Start idempotency (same id five times is one visit) and completion replay
- Due engine: every visit, every N days, weekly / biweekly / monthly, thresholds, milk bag, puck bin, arm-sensor placeholder, UofT Monday flag off when opening time is blank

`scripts/rls-test.ts` loads the migrations into an in-process Postgres (no hosted database) and checks:

- `anon` cannot read tables
- `auth_pins` is not readable by a signed-in user
- a tech cannot see an unassigned live site
- a trainee cannot read live rows
- a tech in practice cannot write a live visit
- `start_session` five times inserts one row
- replaying a completion inserts one row
- a tech cannot change a submitted start time
- a tech cannot call `reset_sandbox`, `decide_correction`, `set_training_status`, or `void_session`
- public helpers (`is_admin`, `can_write`, and the rest) are not executable by `authenticated`
- a trainee cannot read or insert a live site row
- a fresh practice start keeps the old attempt, starts an empty visit, and does not change live or practice last-done dates
- live mode, another person, a trainee, and a finished or live visit cannot use that start to change the wrong row
- the arm sensor row is `pending_validation` and UofT `opening_time` is null
- migrations `0009` through `0014` apply on top of `0008`
- a visit with no `photo_audit` snapshot field completes without photo shots
- a visit whose snapshot says photo audit is required does not complete until seven shots are registered
- that grandfathering still rejects a visit with a required step open, and still requires a KC confirmation when a max is saved
- milk cleaning can start before prep is saved, and cannot be marked done before it starts
- Complete service rejects a visit with required steps still open
- a Dupont pickup with the same idempotency key takes stock once
- another person cannot replay that pickup key
- a person in practice cannot take live Dupont stock, complete a live visit, or confirm KC on a live visit
- replacing a photo clears its approval and Drive file; sending the same photo again keeps them
- a path or a made-up acknowledgement cannot mark a photo stored
- a voided visit with seven approved photos does not turn photo audit off for the next visit
- a reorder or pickup preview stays disabled when the caller asks to send, and a second save does not add a row
- reorder recipients stay empty until both configured slots are present, and are not every admin
- a new start that asks for photo audit has the requirement before that transaction returns
- repeating that start does not add the requirement to an older visit or remove it from a new one
- a changed photo's previous Drive acknowledgement cannot be stored again

## Manual, on a phone

Do these on the Netlify test site after migrations and functions are deployed. They are not run in CI.

1. iPhone Safari, current and previous version: open a practice visit and tap Complete service five times quickly. Result: one submitted visit.
2. Lock the phone for 30 minutes in the middle of a practice visit. Reopen KioskOps. The same visit is open on the same step, and earlier steps are still editable.
3. Turn on airplane mode, mark a few steps, turn airplane mode off. Each step syncs once. No duplicate rows.
4. Wrong PIN five times. That name is locked for about 15 minutes. An admin can unlock it sooner.
5. A trainee account never shows Mount Sinai or UofT live sites, only the PRACTICE sites, and the orange PRACTICE banner is on every screen.
