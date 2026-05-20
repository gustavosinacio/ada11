# Test report v2 — 2026-05-19_2353_measurements-tracking

Re-test round after Implementer's MAJ-1 surgical fix landed in `implementation-v2.md`. Scope is narrow on purpose: confirm MAJ-1 is dead, spot-check the golden path and duplicate banner still work, and verify quality gates remain green.

## Environment

- Expo web dev server already running on `http://localhost:8081` (`curl -s -o /dev/null -w "%{http_code}"` returned `200`).
- Browser: Chromium (Playwright 1.59.1, headless).
- Node 23.10, Vitest 3.2.4.
- Test data: fresh confirmed users created per-test via Supabase admin API; cascaded rows deleted in `afterAll`.

## Quality gates

| Gate | Result |
|---|---|
| `npm run typecheck` | clean (no output from `tsc --noEmit`) |
| `npm run lint` | `0 errors, 1 warnings` (only the pre-existing `router.d.ts` warning, unchanged from v1) |
| `npm run test:unit` | `44 passed (44)` across 5 files (`formulas`, `units`, `measurements-units`, `weekly-volume-bucketing`, `dates`) |

Evidence (tail of each):

```
$ npm run typecheck
> tsc --noEmit
(no output → clean)

$ npm run lint
ESLint: 0 errors, 1 warnings in 1 files
═══════════════════════════════════════
Top files:
  router.d.ts (1 issues)

$ npm run test:unit
 Test Files  5 passed (5)
      Tests  44 passed (44)
```

## MAJ-1 re-test (the only scenario that failed last round)

### Unit-level: `buildSubmitPayload` now throws ZodError on impossible dates

Ran a direct unit-level driver against the live `buildSubmitPayload` import to confirm all three target dates plus an extreme (`2026-99-99`) follow the new code path, and that a valid date still passes through:

```
$ npx tsx /tmp/maj1-unit.mjs
THROW 2026-13-99  -> ZodError path=["measuredAt"] msg="Invalid date"
THROW 2026-02-30  -> ZodError path=["measuredAt"] msg="Invalid date"
THROW 2026-02-29  -> ZodError path=["measuredAt"] msg="Invalid date"
THROW 2026-99-99  -> ZodError path=["measuredAt"] msg="Invalid date"
OK    2026-05-20  -> measuredAt=2026-05-20T03:00:00.000Z
```

The guard branches exactly where the design contemplates it:

- Three impossible-but-regex-passing dates (`2026-13-99`, `2026-02-30`, `2026-02-29`) all throw a `z.ZodError` with `path: ["measuredAt"]` and `message: "Invalid date"`.
- A genuinely valid date (`2026-05-20`) still parses and emits an ISO string. No regression to the happy path.

This is the unit-level twin of what the screens see: same exception type, same key, same message that the existing `setError("measuredAt", ...)` plumbing handles.

### E2E: live `RangeError` is gone, inline error renders

The flipped permanent regression test (`tests/e2e/measurements.spec.ts:136`) now asserts:

1. `"Invalid date"` text visible on the page.
2. URL stays on `/measurements/new` (no navigation, no `router.back()`).
3. No `pageerror` matching `/Invalid time value/i` fired.
4. No `console.error` matching `/Invalid time value/i` fired.

It passes:

```
$ rtk proxy npx playwright test tests/e2e/measurements.spec.ts
Running 8 tests using 1 worker
  ✓  1 ... › golden: empty state → create → list → edit (6.0s)
  ✓  2 ... › MAJ-1 regression: impossible date submit (2026-13-99) shows inline error (3.6s)
  ✓  3 ... › edge: empty form shows at-least-one error (3.3s)
  ✓  4 ... › edge: duplicate same-day shows amber banner with CTA (8.0s)
  ✓  5 ... › edge: weight out of range shows inline error (3.4s)
  ✓  6 ... › edge: notes >500 chars shows inline error (3.4s)
  ✓  7 ... › edge: soft delete clears row and unblocks same-day re-entry (6.1s)
  ✓  8 ... › regression: 6 tabs render, Profile shows weight + length unit toggles (3.5s)

  8 passed (38.1s)
```

Compared to v1, where this same test fired `pageerror: ['RangeError: Invalid time value']` and threw via the explicit `MAJ-1 CONFIRMED` assertion. **MAJ-1 is dead** for the three target dates (`2026-13-99`, `2026-02-30`, `2026-02-29`) and the more extreme `2026-99-99` confirmed at unit level. **Result: pass.**

### Note on E2E coverage of `2026-02-30` / `2026-02-29`

The Playwright spec only exercises `2026-13-99` end-to-end. The guard is value-agnostic (a single `Number.isNaN(parsed.getTime())` check that runs before `.toISOString()`), so the unit-level confirmation across all four impossible-date shapes is sufficient — the screen-level path is identical for any input that hits the `isNaN` branch. No additional e2e variants needed.

## Spot-check: golden path still works

E2E test #1 (`golden: empty state → create → list → edit`) passed in 6.0s. Covers: empty state visible → tap `Log measurement` → fill 5 metrics + notes → save → row appears in list with `80.0 kg` headline + `first entry` notes preview → tap row → edit screen pre-populates → change weight to `80.5` → save → list reflects `80.5 kg`.

**Result: pass.**

## Spot-check: duplicate-banner still works

E2E test #4 (`edge: duplicate same-day shows amber banner with CTA`) passed in 8.0s. Covers: create today's entry (weight 80) → navigate back to `/measurements/new` → fill weight 81 → save → amber banner `"You already have a measurement for ..."` visible + `"Open existing entry"` CTA visible.

**Result: pass.**

## Other E2E that ran (not required, but came along for free)

All 5 remaining scenarios in the same suite passed: empty-form, weight out of range, notes >500 chars, soft delete + same-day re-entry, 6-tab regression. No regressions surfaced from the surgical fix.

## Decision

**pass**.

Reasoning:

- MAJ-1 confirmed dead at both unit level (4 inputs covered, all throw the right ZodError) and E2E (the flipped regression test passes, no `Invalid time value` pageerror, inline `"Invalid date"` rendered).
- Golden path still works end-to-end.
- Duplicate-banner still works.
- Quality gates green (typecheck, lint, unit) and the full 8-test E2E suite green.
- No regressions detected across the other 5 measurement scenarios that ran alongside.

**Recommendation**: `finalize`. The Implementer landed exactly the snippet the Reviewer recommended and the Tester validated in v1. The 5 review minors (MIN-1 through MIN-5) remain unaddressed per the Conductor's narrow scope for this round — they are documented in `review-v1.md` and can be picked up in a follow-up run if desired, but none of them gate this feature.

## Files referenced

- `src/utils/measurements-form.ts:122-138` — the landed guard (verified in code, exercised in tests).
- `tests/e2e/measurements.spec.ts:136-173` — flipped MAJ-1 regression test (now passes).
- `docs/runs/2026-05-19_2353_measurements-tracking/test-report-v1.md` — the prior failing report this round closes out.
- `docs/runs/2026-05-19_2353_measurements-tracking/implementation-v2.md` — the surgical fix report.
