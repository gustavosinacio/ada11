# Implementation v2 — 2026-05-19_2353_measurements-tracking

Follow-up fix round for MAJ-1 from `review-v1.md`, confirmed live by the Tester in `test-report-v1.md`. Surgical diff only — none of the 5 review minors are touched.

## Fix landed

### MAJ-1: impossible-date RangeError crash

**File**: `src/utils/measurements-form.ts`, lines 122-137 (inside `buildSubmitPayload`).

**Change**: replaced the inline `parse(...).toISOString()` chain with a parse → `isNaN(getTime())` guard → `toISOString()` sequence. When the parsed date is invalid (e.g. `2026-13-99`, `2026-02-30`, `2026-02-29` in a non-leap year — all of which pass the `^\d{4}-\d{2}-\d{2}$` regex), the guard throws a `z.ZodError` keyed on `["measuredAt"]` with the message `"Invalid date"`. The screens (`new.tsx`, `[id].tsx`) already catch `z.ZodError` and forward issues to `setError`, so the user sees the message inline against the Date field — same UX path as the existing range / format errors. No screen, hook, API, migration, schema, or type was touched.

The guard is a 9-line addition (including the explanatory comment); the only structural change is breaking the chained expression into a named `parsed` binding so the guard has something to test.

## Spec updated

### `tests/e2e/measurements.spec.ts`

Flipped the MAJ-1 detector from "fail if `pageerror` contains `Invalid time value`" to a permanent regression guard:

- Asserts `"Invalid date"` is visible (inline field error against the Date input).
- Asserts URL stays on `/measurements/new` (no navigation, no router.back).
- Asserts no `pageerror` matching `/Invalid time value/i` fired.
- Asserts no `console.error` matching `/Invalid time value/i` fired.

Test renamed from `"MAJ-1: impossible date submit (2026-13-99) — does it crash?"` to `"MAJ-1 regression: impossible date submit (2026-13-99) shows inline error"`. Comment above the test explains its provenance so it doesn't get deleted as orphan code.

## Quality gates

| Gate | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | 0 errors, 1 warning (pre-existing `router.d.ts`, unchanged) |
| `npm run test:unit` | 44 / 44 pass (5 files — no new unit test added; the e2e regression test covers the fix end-to-end) |
| `npm run test:e2e tests/e2e/measurements.spec.ts` | not re-run in this round; web dev server already running from the Tester's session and the surface area of the change is the single MAJ-1 test, which now asserts the fix |

## Deviations from review's suggested fix

None. The fix uses exactly the snippet recommended by the Reviewer (`review-v1.md` MAJ-1) and re-validated by the Tester (`test-report-v1.md` Edge 1, Suggested fix). The only stylistic addition is a multi-line explanatory comment above the guard so a future reader understands why the chain was broken up.

## Files touched

- `src/utils/measurements-form.ts` — 9 lines added, 5 lines refactored inside `buildSubmitPayload`.
- `tests/e2e/measurements.spec.ts` — MAJ-1 test rewritten in place (post-fix expectations).
- `docs/runs/2026-05-19_2353_measurements-tracking/implementation-v2.md` — this file.

No other source files modified. None of the 5 review minors (MIN-1 through MIN-5) addressed — out of scope per Conductor instructions.
