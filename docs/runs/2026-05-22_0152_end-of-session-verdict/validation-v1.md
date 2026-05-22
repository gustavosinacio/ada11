# Validation v1 — 2026-05-22_0152_end-of-session-verdict

> Validator (subagent) tool whitelist excludes Write. Findings returned as text and persisted here by the Conductor.

## Summary

Core PR-detection plan (option c + `priorMax > 0` strict-`>` guard) is sound; routing/insertion plumbing verified at correct file:line. Two majors prevent `go`: Designer missed an existing public `formatDuration` export and proposes to ship a second copy; and the bulk-check-all Finish branch has a sets-cache race that under-counts total volume on the verdict.

## Issues

### Blockers
**None.**

### Majors

- **[MAJ-1]** `formatDuration` already exists publicly at `src/utils/format-session-times.ts:23` with the same `(startIso, endIso)` signature and same `"Xh Ym"` / `"Ym"` format (the only diff is null-end case: public returns `"—"`, the private copy returns `"in progress"`). Designer planned to `export` the private duplicate in `session-summary-row.tsx:34-42` — ships two functions across two modules.
  - **Suggested fix**: drop the in-place export. Import from `~/utils/format-session-times` in the verdict screen (session.ended_at is non-null at verdict mount, so the `"—"` vs `"in progress"` divergence is irrelevant). Optionally: replace the private copy in `session-summary-row.tsx` with the imported one, mapping `"—"` → `"in progress"` at the call site.

- **[MAJ-2]** `useBulkCheckAllInSession.onSuccess` (`src/hooks/use-sets.ts:115-123`) invalidates `KEYS.forSession(sessionId)` but does NOT await the refetch. The bulk-check-all Finish branch (`[sessionId].tsx:257-267`) runs `await bulkCheckAll.mutateAsync()` then `await finishAfterMutation()`. By the time `router.replace("/workout/verdict/<id>")` runs, the in-flight refetch may not have resolved. The verdict mounts with the **pre-bulk-check** `setsQ.data` (many sets still `completed_at = null`), and `computeCurrentSessionVolumeByExercise` filters them out → total volume + PR list under-count. User just told the app "check everything and finish" and the verdict reads cold.
  - **Suggested fix (recommend, smallest blast radius)**: change `useBulkCheckAllInSession.onSuccess` to `await qc.refetchQueries({ queryKey: KEYS.forSession(sessionId) })`. Callers can then rely on the cache being fresh by the time `mutateAsync` resolves. Also benefits the live screen's transient render between bulk-check and finish. Alternative: gate verdict render on `!setsQ.isFetching` in addition to `setsQ.data` presence.

### Minors

- **[MIN-1]** Kernel duplication. `computeCurrentSessionVolumeByExercise` re-implements `sumLiveVolume`'s per-set predicate instead of reusing it. Fix: export `sumLiveVolume` from `volume-target.ts` (one keyword) and reduce per-(exercise_id) group via it. Keeps the predicate in one place.

- **[MIN-2]** E2E case B's `confirmDelete` dialog handler: design says "accept confirm dialog" without naming `page.on("dialog", d => d.accept())`. Implementer will likely copy from `crud.spec.ts:184` but worth explicit.

- **[MIN-3]** Headline skeleton `+? PRs` next to real volume + duration reads as broken on fast networks. Alternative: render `+0 PRs` eagerly and update when lifetime resolves (briefly wrong for ~200ms, less broken-looking). Polish call.

- **[MIN-4]** Empty-state copy "Solid session — keep it consistent" feels off on a zero-set Finish. Consider a separate copy for `totalVolumeKg === 0` ("No sets logged — your next session counts.").

- **[MIN-5]** Cold deep-link race on `useActiveSession.isLoading` is benign (banner renders nothing for ~200ms). Documenting for completeness.

## Decision

**`no-go`**

Reasoning:
- 0 blockers + 2 majors → no-go per decision rule.
- MAJ-1 is a code-cleanliness issue (low risk to ship but ugly).
- MAJ-2 is a real correctness bug for the most-common Finish branch (bulk-check-all). Verdict will visibly under-count total volume when the user just promoted many sets to checked.

Round 1 of 3 D↔V; 2 rounds remaining.

## Counts

`{ blockers: 0, majors: 2, minors: 5 }`

## Recommendation to Conductor

`invoke Designer for re-design (v2)`. Required v2 fixes:
1. **MAJ-1** — drop the in-place export from `session-summary-row.tsx`; import the existing public `formatDuration` from `src/utils/format-session-times.ts:23`.
2. **MAJ-2** — make `useBulkCheckAllInSession.onSuccess` await `qc.refetchQueries` (or equivalent). Pin the exact lines.
3. **MIN-1** — optionally export `sumLiveVolume` and reduce duplication; small win.
4. **MIN-2/3/4** — copy/UX polish absorbed in v2 wording.

## Verified facts referenced
- `formatDuration` already public at `src/utils/format-session-times.ts:23` ✓
- `useBulkCheckAllInSession.onSuccess` does NOT await refetch — `src/hooks/use-sets.ts:115-123` ✓
- `finishAfterMutation` is single funnel — `[sessionId].tsx:225-233` ✓
- `onCancel` bypasses funnel — `[sessionId].tsx:269-293` ✓
- `WeeklyVolumeRow` includes `session_id` — `src/api/stats.ts:24` ✓
- `computeLifetimeMaxPerExercise` / `computePrExerciseIdsThisWeek` semantics — `src/utils/progress-page-math.ts:160-253` ✓
- `crud.spec.ts:162-202` test affected — line 185 = Finish click, line 188 = `waitForURL(/\/workout$/)` ✓
