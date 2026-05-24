# Review v1 — 2026-05-24_1925_history-row-total-volume

Reviewing: the diff for the implementation against `design-v2.md` (final approved) + `validation-v2.md` findings (NEW-MIN-1..5).

Round: Implement↔Review **1 of 2**.

## Diff scope
- Diff command: `git diff 6e444c199e12bc1f3a449169ecdfeb4a06303e5a -- 'src/*' 'app/*' 'tests/*'`
- Files changed: 10 total — 7 edited (visible in `--stat`) + 3 new untracked (`src/utils/session-row-format.ts`, `tests/unit/session-summary-row-format.test.ts`, `tests/unit/group-session-volumes.test.ts`).
- Lines (tracked only): +93 / −24. Net +~245 with the 3 new files included.

## Verification of implementation.md claims

| Claim | Verified? | Notes |
|---|---|---|
| NEW-MIN-1 honored: `[id].tsx:289-293` drops `{" "}` AND the literal `volume`; positive → `"Total: 3 sets · 12,345 kg"`, zero → `"Total: 3 sets · —"` | yes | `app/(app)/history/[id].tsx:288-293` — the JSX block is exactly the pinned form from design-v2 Contratos de I/O. The `·{" "}` between sets and the ternary is preserved (single space between `·` and value); after the ternary, the `</Text>` closes immediately on the next line. No trailing token. |
| NEW-MIN-3 honored: single `useLifetimeWeeklyVolume()` call with `data` destructured (alias OK) | yes | `app/(app)/history/index.tsx:15-19` — destructure exposes `data: weeklyVolumeData` aliased (justified in `implementation.md` to avoid shadowing `useSessions().data`). One call site (`:19`). `week/[isoWeek].tsx:53` likewise has one call assigning to `weeklyVolumeQ`. |
| `sumLiveVolume` widened to `Pick<SetRow, "completed_at" \| "set_type" \| "weight" \| "reps">[]` | yes | `src/utils/volume-target.ts:94-96` — exact signature. No `as unknown as` cast surfaces in any production call site (`grep` confirms; only one cast remains, inside the test fixture in `tests/unit/group-session-volumes.test.ts:94`, justified by the kernel-guard test). |
| `groupSessionVolumes` correctness — groups by `session_id`, calls `sumLiveVolume` per group, returns `Map<string, number>` | yes | `src/utils/progress-page-math.ts:246-260` — first pass collects rows into `bySession: Map<string, WeeklyVolumeRow[]>`, second pass reduces each via `sumLiveVolume`. Map-of-Map shape is correct. JSDoc accurate. |
| `presentSessionVolumeSlot` pure presenter | yes | `src/utils/session-row-format.ts:21-28` — pure function, no React, no hooks, no side-effects. Returns `null` for `null`/`undefined`/`<= 0`; returns `" · ${formatVolume(...)}"` otherwise. Matches design contract verbatim. |
| `<SessionSummaryRow>` consumes the presenter, replaces `formatWeight` block | yes | `src/components/session-summary-row.tsx:6` imports `presentSessionVolumeSlot`; `:50` calls `presentSessionVolumeSlot(totalVolumeKg, unit) ?? ""`; old `formatWeight` import + literal `" volume"` suffix removed. |
| Detail-screen ad-hoc kernel replaced with `sumLiveVolume(setsQ.data ?? [])` | yes | `app/(app)/history/[id].tsx:126-134` — `totalSets` filter + `totalVolumeKg = sumLiveVolume(rows)`. The previous "no warmup filter / no `completed_at` gate / no `w>0 && r>0` guard / `formatWeight(aggregate)`" reduction is gone. |
| No regression in tests — 332/332 | yes | Independently ran `npm run test:unit`: 20 files, 332/332 passed. New tests visible: `session-summary-row-format.test.ts` (13) + `group-session-volumes.test.ts` (12) = 25 new, matching the +25 claim. |
| Quality gates — typecheck + lint + unit | yes | Re-ran independently. `tsc --noEmit` exits 0. `npm run lint` reports 0 errors, 1 pre-existing warning in `router.d.ts` (auto-generated Expo Router file, not touched by this diff). |
| Out of scope discipline — verdict, live header, per-exercise chart untouched | yes | `git diff --name-only` returns only the 7 expected files; no edits to `workout/verdict/[sessionId].tsx`, `session-header.tsx`, `exercises/[id]/progress.tsx`. |
| No new `any` / `@ts-ignore` / `console.log` | yes | `grep` over the 9 changed/new code+test files matches 0. The single `as unknown as string` cast at `group-session-volumes.test.ts:94` is documented in `implementation.md` and is scoped to a test fixture deliberately producing an off-type `null` to exercise the kernel guard — acceptable. |

## Issues

### Blockers
- None.

### Majors
- None.

### Minors
- **[MIN-1]** `app/(app)/history/[id].tsx:289` — the line reads `Total: {totals.totalSets} {totals.totalSets === 1 ? "set" : "sets"} ·{" "}`. The `·{" "}` form is the pinned design contract, but it emits exactly one space after `·` and then the ternary starts on the next JSX line. That next line begins with `{totals.totalVolumeKg > 0 ...`. JSX interprets newlines between text/expression children as whitespace removed; this is correct in practice (no double space). Calling it out only because the design-v2 verbatim block shows the ternary on the same logical line; verified in renderer behaviour, no fix needed.
- **[MIN-2]** `src/utils/progress-page-math.ts:240-244` — the new `groupSessionVolumes` JSDoc references "the cross-surface consistency rule documented in `volume-target.ts:53-67`". The line range citation in `volume-target.ts` for the doctrine block is correct as of this diff but is brittle to future edits. Suggest changing to a symbolic citation ("see the kernel doctrine comment above `sumPastVolume`") on the next pass. Not a fix-now item.
- **[MIN-3]** `tests/unit/group-session-volumes.test.ts:94` — `completed_at: null as unknown as string` is the only `as unknown as` cast surviving in the diff. The test-fixture rationale is sound (the kernel must skip `null` even though the server pre-filters), but the comment at `:30-31` already explains why; adding `// eslint-disable-next-line` would be heavier than the cast it would silence. Acceptable as-is. Surfaced for future cleanup.
- **[MIN-4]** `app/(app)/history/week/[isoWeek].tsx:79-93` — the headline `weekVolumeKg` reduce still inlines the `w * r` kernel (`:88-91`) rather than calling `sumLiveVolume`. The design only requires `groupSessionVolumes` to use the kernel, and the headline reduce predates this run, so this is out-of-scope. Noted because the cross-surface consistency rule arguably implies this reduce should also route through `sumLiveVolume` — separate refactor.
- **[MIN-5]** `tests/e2e/exercise-progress-ia.spec.ts:291-300` — comment update is accurate. The regex `/·\s*\d+m\b/` does indeed anchor on the duration token and is unaffected by the appended volume slot. Verified.

## Security checklist
- [x] RLS: no new `from('table')` calls in this diff — only client-side reductions over the already-RLS-protected `useLifetimeWeeklyVolume` cache. No new tables, no new policies needed.
- [x] No `SUPABASE_SERVICE_ROLE_KEY` reference anywhere in the diff. Confirmed.
- [x] No new `rpc()` calls; no SQL string-concat surface. Pure client math.
- [x] No new `EXPO_PUBLIC_*` env vars introduced.

## Style / convention checklist
- [x] No new `any` — verified by grep over all 9 changed/new files.
- [x] No new `// @ts-ignore` — verified.
- [x] Comments narrate *why*, not *what* — JSDoc blocks on `groupSessionVolumes`, `presentSessionVolumeSlot`, and the kernel widening doc all explain the load-bearing rationale (server-filter no-op, cross-surface consistency, structural compatibility). The single inline comment in `history/[id].tsx:128-131` ("Canonical kernel — matches the live session header...") cites the consistency rule, not the mechanic.
- [x] Imports follow project style — `~/` aliases consistently used; package imports first in every file; new helpers placed in `src/utils/`; new tests placed in `tests/unit/` matching the vitest config glob.
- [x] New files placed in conventional folder — `src/utils/session-row-format.ts` mirrors the pattern of `src/utils/format-display-date.ts`; the two test files match the `tests/unit/**/*.test.ts` convention.

## Decision

**pass**

Reasoning:
- 0 blockers, 0 majors, 5 minors (4 informational, 1 cosmetic). Below the pass threshold (≤1 major).
- Every Validator finding (NEW-MIN-1 through NEW-MIN-5) is honored in the diff with file:line evidence.
- All 11 specific items in the Reviewer prompt are independently verified — including the two highest-risk ones (NEW-MIN-1 whitespace shape, NEW-MIN-3 single-hook destructure extension).
- Quality gates re-run independently and clean: typecheck 0 errors; lint 0 errors (1 pre-existing warning in auto-gen file); unit tests 332/332.
- Cross-surface consistency claim (list, drill-down, detail header, verdict, live header, per-exercise chart all route through `sumLiveVolume`) holds — only out-of-scope tangent is the `weekVolumeKg` headline reduce in `week/[isoWeek].tsx:79-93` which still inlines the kernel; flagged as MIN-4 for a future pass, not blocking.
- One MEDIUM-risk behavioural change documented by Designer + Implementer (detail-header total decreases for warmup-heavy sessions due to canonical kernel replacing ad-hoc reduce) is correctness-improving; Tester should regression-check.

Recommendation: **invoke Tester**.
