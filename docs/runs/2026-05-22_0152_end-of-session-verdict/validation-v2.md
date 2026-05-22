# Validation v2 — 2026-05-22_0152_end-of-session-verdict

> Validator (subagent) tool whitelist excludes Write. Findings returned as text and persisted here by the Conductor.

## v1 issues — verification

| Issue | v2 fix | Verified |
|---|---|---|
| MAJ-1 (`formatDuration` duplication) | `session-summary-row.tsx` removed from file-change map; verdict imports public `formatDuration` from `~/utils/format-session-times`. | ✓ design-v2:34 + import at v2 hooks section. |
| MAJ-2 (sets cache race) | `useBulkCheckAllInSession.onSuccess` becomes `async` and `await`s `qc.refetchQueries({queryKey: KEYS.forSession(sessionId)})`. | ✓ design-v2:27, 121-145; pinned `src/hooks/use-sets.ts:115-123`. Sole caller `[sessionId].tsx:257-267` benefits transparently. |
| MIN-1 (`sumLiveVolume` reuse) | `export` keyword added to `volume-target.ts:78`. New helper reduces via shared kernel. | ✓ No name collision; file already exports `VolumeTargetState`, `ComputeVolumeTargetInput`, `computeVolumeTarget`. |
| MIN-2 (dialog handler) | E2E plan explicitly registers `page.on("dialog", d => d.accept())` in Case A step 4 + Case B step 3. | ✓ |
| MIN-3 (loading state) | Eager `+0 PRs` headline; skeleton only on PR-list slot. | ✓ design-v2:215. |
| MIN-4 (empty-state copy split) | Two distinct copies selected by `totalVolumeKg === 0`. | ✓ design-v2:184-188. |

**All v1 issues addressed.**

## New scrutiny — items resolved

1. `useBulkCheckAllInSession` caller audit: grep shows ONE consumer (`[sessionId].tsx:62`). No fire-and-forget callers; safe to change contract.
2. `sumLiveVolume` export: no name collision in module.
3. Eager `+0 PRs`: implemented via `useMemo` short-circuit on `lifetimeQ.data === undefined → prs = []` (verdict doesn't consume `usePrsThisWeek`). Internally consistent.
4. Empty-state threshold = strictly `totalVolumeKg === 0`. Low-volume sessions fall into "Solid session — keep it consistent." copy. Tradeoff explicit.
5. Test counts add up: required 21 unit + 2 e2e (A, B) + `crud.spec.ts` patch; optional +2 unit + 1 e2e (C).

## Issues found in v2

### Blockers / Majors
**None.**

### Minors (polish)

- **[MIN-1-v2]** Optional unit cases 22-23 framed wishy-washy. E2E Case A step 10's `600 kg` assertion IS the load-bearing MAJ-2 regression guard, so units 22-23 are defensible as optional. Implementer should commit or skip cleanly.
- **[MIN-2-v2]** E2E Case C (non-zero-volume no-PR copy) is optional. Unit tests cover the ternary; acceptable.
- **[MIN-3-v2]** Eager `+0 PRs` is briefly wrong for ~200ms when there IS a PR. Acknowledged tradeoff in design.
- **[MIN-4-v2]** Latency uptick in `handleCheckAllAndFinish` from awaited refetch (50-200ms). Hidden behind Finish spinner; acceptable.
- **[MIN-5-v2]** Verdict imports from 3 modules for math (`session-verdict-math`, `volume-target`, transitive `progress-page-math`). Minor surface; polish only.

## Decision

**`go`**

Reasoning:
- All v1 issues resolved with verified file:line references.
- The `await refetchQueries` contract change is correctly scoped (single hook, single caller).
- E2E Case A step 10's `600 kg` assertion is the load-bearing MAJ-2 regression guard.
- Round 2 of 3 D↔V; 1 round unused remaining.

## Counts

`{ blockers: 0, majors: 0, minors: 5 }`

## Recommendation to Conductor

`invoke Implementer`. Implementer should:
1. Apply `useBulkCheckAllInSession.onSuccess` change exactly as pinned (`async` + `await qc.refetchQueries`).
2. Add `export` to `sumLiveVolume` only — no other touch to `volume-target.ts`.
3. Skip `session-summary-row.tsx` entirely (drop from v1 plan).
4. Import `formatDuration` from `~/utils/format-session-times` in the verdict screen.
5. Decide upfront whether to include optional unit tests 22-23 and E2E Case C; commit or skip, don't stub.
