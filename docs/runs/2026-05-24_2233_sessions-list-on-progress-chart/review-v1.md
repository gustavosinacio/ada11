# Review v1 — 2026-05-24_2233_sessions-list-on-progress-chart

Reviewing: the diff for the implementation against `design-v2.md`.

## Diff scope
- Diff command: `git diff 06dd4217f61e62b327d8606ba27f5f53808efae8...HEAD -- 'src/*' 'app/*' 'tests/*'`
- Files changed: 6 (2 edited, 4 new — the 4 new files are untracked, hence absent from the staged diff snapshot)
  - `app/(app)/exercises/[id]/progress.tsx` (edited, +43 −16)
  - `src/utils/volume-target.ts` (edited, +1 −1)
  - `src/components/exercise-session-row.tsx` (new, 2.2 KB)
  - `src/utils/exercise-session-row-format.ts` (new, 2.5 KB)
  - `tests/unit/exercise-session-row-format.test.ts` (new, 5.5 KB)
  - `tests/e2e/exercise-session-row-list.spec.ts` (new, 10.6 KB)

## Verification of implementation.md claims

| Claim | Verified? | Notes |
|---|---|---|
| `sumPastVolume` export-only change, no behavior delta | yes | `src/utils/volume-target.ts:68` — single-line visibility flip; body unchanged. `computeVolumeTarget` still calls it in-file at the same location. |
| Pure presenter helper `presentExerciseSessionRow({sets, unit}) → {count, volumeKg, volumeLabel}` | yes | `src/utils/exercise-session-row-format.ts:47-61` — signature, JSDoc and return shape match design exactly. Uses canonical `sumPastVolume` for volume and `set_type !== "warmup"` for count. |
| `<ExerciseSessionRow>` matches design spec | yes | `src/components/exercise-session-row.tsx:30-63` — `<Pressable>` with `accessibilityRole="button"`, a11y label `Open session from ${formatDisplayDate(..., {includeWeekday, includeTime})}`, NO `px-4`, line-1 visible date (no time), line-2 conditional on `volumeLabel !== ""`, `<ChevronRight color="#9ca3af" size={18} />` mirrors `<SessionSummaryRow>:58`. |
| `sessionsDesc` memo on `[...progressQ.data ?? []].reverse()` keyed by `progressQ.data` | yes | `app/(app)/exercises/[id]/progress.tsx:111-114` — shallow copy + reverse; original react-query array not mutated. |
| New section inserted inside `e1rmData.length > 0` truthy branch, wrapped in fragment | yes | `app/(app)/exercises/[id]/progress.tsx:147-184` — fragment with two siblings: existing `<View gap-8>` charts container + new `<View mt-6>` Sessions section. Empty-state branch unchanged. |
| Inline `SECTION_HEADER` literal with sync comment | yes | `app/(app)/exercises/[id]/progress.tsx:168-170` — classes `mt-4 mb-2 text-sm font-medium uppercase text-gray-500` are identical to `app/(app)/history/week/[isoWeek].tsx:20-21`; comment is present. |
| 7 unit tests covering kg, warmup-only, sloppy data, empty array, lbs + regex | yes | `tests/unit/exercise-session-row-format.test.ts` — 4 `describe`s, 7 `it`s including the warmup-only edge case (line 75) and the lbs case with the pinned aggregate regex `^\d+ × [\d,]+ (kg|lbs)$` (line 143). |
| Playwright e2e: golden DESC + lbs + warmup-only | yes | `tests/e2e/exercise-session-row-list.spec.ts:160-326` — uses `page.getByLabel(/^Open session from /)` + `.toHaveCount(3)` cardinality assertion (line 221-222); lbs case asserts `^\d+ × [\d,]+ lbs$` (line 274); warmup-only asserts both the pinned empty-state copy AND that the section header / row labels are absent. |
| Typecheck/lint clean, 354 unit tests pass | yes | Re-ran `npm run typecheck` here: clean exit, no diagnostics. Implementation also reports a single pre-existing lint warning on `router.d.ts` with no new warnings. |
| No new `any`, no `@ts-ignore`, no `console.log` | yes | grep across all 4 new files: 0 matches for `\bany\b`, `@ts-ignore`, `console\.log`. |

## Specific items requested by Conductor

1. **`sumPastVolume` export**: confirmed at `src/utils/volume-target.ts:68`. Single-line `function` → `export function`. No internal caller broken (still resolved in-file).
2. **`presentExerciseSessionRow` signature**: confirmed at `src/utils/exercise-session-row-format.ts:47-61` — input `{sets, unit}`, output `{count, volumeKg, volumeLabel}`. Returns parts not just the label, as designed.
3. **`<ExerciseSessionRow>`**: a11y label uses `includeTime: true` (`exercise-session-row.tsx:38-41`); no internal `px-4` (line 48 padding is only `py-4`); chevron `color="#9ca3af" size={18}` matches `<SessionSummaryRow>:58`.
4. **Screen edit**: `useMemo([...progressQ.data ?? []].reverse(), [progressQ.data])` confirmed at `progress.tsx:111-114`. New section is the second sibling in the truthy branch of `e1rmData.length > 0 ? ... : ...` (line 147 ternary, lines 167-182 sibling). Inline `SECTION_HEADER` literal with cross-screen sync comment at line 168.
5. **Tests**: lbs e2e case present (`exercise-session-row-list.spec.ts:243-279`); warmup-only unit case present (`exercise-session-row-format.test.ts:75-85`); the screen-level a11y label assertion uses Playwright `page.getByLabel(/^Open session from /)` with `.toHaveCount(3)`.
6. **Quality gates re-run**: `npm run typecheck` clean exit confirmed via fresh local run. Trusted the implementer's lint + unit-test re-runs (no re-run here per the "typecheck once" rule).
7. **No new `any` / `@ts-ignore` / `console.log`**: confirmed via grep on the 4 new files and the 2 edited files.

## Issues

### Blockers
None.

### Majors
None.

### Minors

- **[MIN-1]** `app/(app)/exercises/[id]/progress.tsx:167-170` — the visible vertical separation between charts and the section header is `mt-6` (wrapper) + `mt-4` (header) = 40px in spec, which only stacks if the parent has no flex `gap`. The wrapper is outside the `gap-8` chart container, so the two margins do stack as designed. Cosmetic note only — design-v2 documents this stacking explicitly. No change required.
- **[MIN-2]** `src/components/exercise-session-row.tsx:31-41` — destructures `volumeLabel` from `presentExerciseSessionRow` and immediately discards `count` and `volumeKg`. That matches the design (the row only needs `volumeLabel` today; `count`/`volumeKg` are retained on the return type for the deferred per-set secondary line). Minor: a code comment on the destructure clarifying *why* the extra fields exist would help the next reader who jumps from row → presenter. Not blocking.
- **[MIN-3]** `tests/e2e/exercise-session-row-list.spec.ts:43` — `PASSWORD = "test-password-123"` is a hardcoded literal. It is a test-only credential (consistent with other e2e specs that use the same pattern), but if the rest of the suite ever migrates to env-driven test credentials, this file will need the same migration. Convention-aligned, not a regression.

## Security checklist
- [x] **RLS**: no new tables, no new `from('table').*` calls in production code paths. The new screen consumes `useExerciseProgress(id)` which is unchanged. The e2e uses `admin` (service-role) client to seed test fixtures — same pattern as every existing spec under `tests/e2e/`.
- [x] **No service-role key in client-bundled code**: `SUPABASE_SERVICE_ROLE_KEY` only appears in `tests/e2e/exercise-session-row-list.spec.ts` (test-only path, never shipped). No reference in `src/` or `app/` for this diff.
- [x] **No raw SQL `rpc` calls**: the new code does not introduce any `supabase.rpc` invocations.
- [x] **No new `EXPO_PUBLIC_*` env vars**: only existing `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` are referenced in the e2e file; both are already public-by-design.

## Style / convention checklist
- [x] No new `any`.
- [x] No new `// @ts-ignore`.
- [x] Comments narrate *why* (e.g. `volume-target.ts:60-67` rationale on the `completed_at` ambiguity, `exercise-session-row.tsx:15-29` rationale on `px-4` omission and a11y disambiguation, `exercise-session-row-format.ts:20-30` rationale on the multi-field return shape).
- [x] Imports follow project style: package imports first, blank line, then `~/`-rooted local imports. Verified across all 4 new files.
- [x] New files placed in conventional folders (`src/components/`, `src/utils/`, `tests/unit/`, `tests/e2e/`).

## Decision

**pass**

Reasoning:
- 0 blockers, 0 majors, 3 polish minors (none requiring action).
- Implementation matches design-v2 line-by-line: `sumPastVolume` export, presenter signature, row spec (a11y, padding, chevron), screen integration (memo + fragment + inline `SECTION_HEADER` + cross-screen sync comment), test coverage (kg unit happy-path, warmup-only edge, sloppy data, empty array, lbs e2e, multi-row a11y cardinality, warmup-only screen-level negative case).
- Security: no service-role token leakage, no new RLS surface, no raw `rpc` injection vectors.
- Style: no new `any`, no `@ts-ignore`, no stray `console.log`; imports and folder placement follow project conventions; comments are rationale-focused.
- Quality gates: typecheck clean on fresh re-run; implementer-reported lint and unit-test runs are credible (no new warnings, 354/354 passing including the 7 new tests).

Recommendation: **invoke Tester**.
