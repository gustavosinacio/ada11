# Validation v2 — 2026-05-22_1530_date-format-unification

> Validator (subagent) tool whitelist excludes Write. Findings returned as text and persisted here by the Conductor.

## v1 issues — verification

| Issue | v2 fix | Verified |
|---|---|---|
| BLK-1 phantom row | Dropped. | ✓ (grep confirms zero `formatDateTime` in `app/`). |
| MAJ-1 test-fixture year break | Two test files added to map with `vi.useFakeTimers + vi.setSystemTime` pattern. | ✓ |
| MAJ-2 a11y digit format | `formatShortDate` accepts `{yearFormat}` option; a11y passes `"numeric"`. | ✓ |
| MIN-4 e2e selector ambiguity | Body-header gets `accessibilityLabel="Week range: ..."`, test swaps to `getByLabel(/Week range:/)`. | ✓ |
| MIN-2 Invalid Date fallback | `safeDisplay` block returns ISO slice or "—". | ✓ |

## Lingering minors (cosmetic)

- **[MIN-1]** Carry: `"11/8/25"` width on 40pt bar — eyeball during Test.
- **[MIN-3]** Carry: `formatDisplayDate({includeTime})` locale-dependent. JSDoc note needed.
- **[MIN-5]** Test file imports need `beforeEach, afterEach, vi` (mechanical add).
- **[MIN-6]** Stutter typo in v2 doc ("a11y a11y label sourcing").
- **[MIN-7]** Migration-count drift in v2 prose ("9 (now 9)" vs actual 12 edited).

## Decision

**`go`**

Reasoning:
- 0 blockers + 0 majors → go.
- All v1 issues resolved with file:line evidence.
- 5 minors are cosmetic / JSDoc / Implementer-mechanical. None gate.

## Counts

`{ blockers: 0, majors: 0, minors: 5 }`

## Recommendation to Conductor

`invoke Implementer`. Pass MIN-1, MIN-3, MIN-5 as Implementer-facing notes.
