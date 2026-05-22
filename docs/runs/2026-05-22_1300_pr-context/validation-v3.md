# Validation v3 — 2026-05-22_1300_pr-context (FINAL)

> Validator (subagent) tool whitelist excludes Write. Findings returned as text and persisted here by the Conductor.

## v2 issues — verification

| Issue | v3 fix | Verified |
|---|---|---|
| MAJ-A (`PR!` prefix dropped) | Restored: `\`PR! +${formatVolume(overflowKg, unit)} (was ${formatVolume(priorMaxKg, unit)})\`` matches existing verdict at `verdict/[sessionId].tsx:193` byte-for-byte. | ✓ |
| MAJ-B (kernel signature mismatch) | `computePrsThisWeek(opts: {rows, currentWeekStartIso, currentWeekEndIso})` matches existing wrapper. | ✓ |
| MIN-A (`currentMaxKg` dead prop) | Dropped from `<PrListRow>` props. | ✓ |
| MIN-B ("Show all (N)" behavior) | Inline expansion (no modal), single `showAll: useState<boolean>` toggle. | ✓ |
| MIN-C (hook wiring) | `useExercisesThisWeek` calls `usePrsThisWeek()` explicitly. | ✓ |
| MIN-D (test hedge) | Test (d) reworded without parenthetical. | ✓ |
| MIN-E (`ExerciseThisWeekRow` type extension) | Optional `priorMaxKg?` + `overflowKg?` in I/O contracts. | ✓ |
| MIN-F (verdict callsite mapping) | Documented — `priorMaxKg + overflowKg` from `SessionPr`; `currentKg` dropped. | ✓ |

**All v2 issues fixed.**

## NEW minor (v3)

- **[MIN-G]** `progress-hero.tsx:41` consumer reads `prsQ.data` but v3 contract returns `{count, prIds, prsByExerciseId, isLoading}` — needs callsite rename `prsQ.data` → `prsQ.count`. Also v3 silently drops `isError` from the return (callsite doesn't read it; safe). Not in §Mudanças but mechanical 1-line fix.

## Decision

**`go`**

Reasoning:
- 0 blockers + 0 majors + 1 minor → go per decision rule.
- D↔V budget closed at 3/3 (1 `go` after 2 `no-go`s).

## Counts

`{ blockers: 0, majors: 0, minors: 1 }`

## Recommendation to Conductor

`invoke Implementer`. Implementer must also do MIN-G: update `progress-hero.tsx:41` `prsQ.data` → `prsQ.count`. Mechanical; record in commit message.
