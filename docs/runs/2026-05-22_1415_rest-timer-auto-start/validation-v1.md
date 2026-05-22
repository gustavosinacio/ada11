# Validation v1 — 2026-05-22_1415_rest-timer-auto-start

> Validator (subagent) tool whitelist excludes Write. Findings returned as text and persisted here by the Conductor.

## All Designer claims verified against source

- Handler at `[sessionId].tsx:411-421` ✓
- `restTimer` at `:69`; `restByExercise` Map at `:91-99`; `setsByExercise` Map at `:183-191` ✓
- `useRestTimer.start(seconds)` overwrites unconditionally → re-call IS the reset ✓
- `SetRow.set_type` = `'warmup' | 'working' | 'dropset'` ✓
- `useBulkCheckAllInSession` does a single SQL UPDATE; bypasses `onToggleSetChecked` (no special-case needed for bulk-check)
- Add-set precedent at `:373-376` uses `!== "warmup"`; new check trigger uses `=== "working"` (intentional divergence — dropset chains have no inter-drop rest)
- No tests exist for `useRestTimer`; Tester will be first to cover

## Verify checklist

- Optimistic timing acceptable: if mutation fails, timer expires harmlessly (~rest seconds).
- AsyncStorage hydration covers nav-away/back scenarios (`use-rest-timer.ts:29-51`).

## Minors (polish)

- **[MIN-1]** Add e2e scenario: timer running → nav away → nav back → countdown still showing (proves AsyncStorage persistence under the auto-start path).
- **[MIN-2]** Tighten test §4 timing threshold (`>=59` not `~60` due to 250ms tick interval).
- **[MIN-3]** `.find((s) => s.id === id)` O(n). Acceptable; not worth blocking.
- **[MIN-4]** Mutation-failure toast (out of scope; cosmetic surface).
- **[MIN-5]** Optional supplementary scenario §8b: timer running on A + warmup check on A → no-op.

## Decision

**`go`**

Reasoning: 0 blockers + 0 majors. Implementation is trivial (~7 added lines, single file). The three Designer-flagged Open Risks (optimistic phantom-start, dropset asymmetry, stale cross-exercise timer) are conscious UX trade-offs with documented mitigations (Skip button).

## Counts

`{ blockers: 0, majors: 0, minors: 5 }`

## Recommendation to Conductor

`invoke Implementer`. Pass MIN-1, MIN-2 to surface in implementation.md as optional polish.
