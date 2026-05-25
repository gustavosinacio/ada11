# Review v1 — 2026-05-24_2020_auto-fill-placeholder-on-check

Reviewing: the diff for the implementation against `design-v3.md` (final approved) and `validation-v3.md` (`go`, 5 polish minors).

Round: Implement↔Review **round 1 of 2**.

## Diff scope
- Diff command: `git diff 03d5f9da944f4fc307b4d589dc610e01894cc731 -- 'src/*' 'app/*' 'tests/*'`
- Files changed: 6 (3 edited, 3 new — new files are untracked, inspected directly).
- Lines (edited only): +84 / -24.
- New files:
  - `src/utils/auto-fill-set.ts` (89 lines)
  - `tests/unit/auto-fill-set.test.ts` (146 lines)
  - `tests/e2e/auto-fill-placeholder-on-check.spec.ts` (879 lines)

## Verification of implementation.md claims

| Claim | Verified? | Notes |
|---|---|---|
| BLK-1 mitigated: `<SetInput>` toggle thunk widens to forward `{weight, reps}` from local state; no cache read in the predicate | yes | `src/components/set-input.tsx:123` — `onPress={() => onToggleChecked?.(!isChecked, { weight, reps })}`. Strings come straight from local `useState` at L94-95. No `setQueryData` shim anywhere. |
| BLK-2 mitigated: `sessionId` prop NOT added to `<ExerciseBlock>` | yes | `src/components/exercise-block.tsx:11-58` shows the prop list — no `sessionId`. |
| History-edit caller at `history/[id].tsx:310-352` untouched | yes | Confirmed via direct read. The block neither passes `showCheckable` nor `onToggleSetChecked`, so the widened prop signature is invisible there. |
| Helper signature matches design verbatim | yes | `src/utils/auto-fill-set.ts:57-59` — `computeAutoFillPayload({ currentInput: { weight: string; reps: string }; previous: { weight: string|null; reps: number|null } | null | undefined }): AutoFillPayload \| null`. Empty AND zero trigger; previous=0 skipped. |
| Side-effect order: helper → updateSet (if non-null) → restTimer.start → checkSet, gated on `set_type === "working"` | yes | `app/(app)/workout/[sessionId].tsx:517-554`. Working-set gate at L521; payload computed L529-532; conditional `updateSet.mutateAsync` L533-535; `restTimer.start` L543-546 (same `isWorking` gate); `checkSet` L551. All inside one try/catch. |
| Bulk-check bypass: `useBulkCheckAllInSession` doesn't route through `onToggleSetChecked` | yes | `app/(app)/workout/[sessionId].tsx:340-350` — `handleCheckAllAndFinish` calls `bulkCheckAll.mutateAsync()` directly. No `onToggleSetChecked` invocation. |
| `Keyboard.dismiss()` kept as optional polish with documented rationale | yes | `app/(app)/workout/[sessionId].tsx:509-515`. Inline rationale "Not load-bearing for auto-fill correctness". |
| Unit test coverage: empty+previous, "0"+previous, typed+previous, partial fields, no previous, previous=0 | yes | All 8 design cases covered (test cases 1-8) + 4 design edges (9-12) + 3 extras (comma-decimal, no-explicit-null, whitespace). 15 tests total. |
| E2E enumerates 10 cases cleanly | yes | E1-E10 named in describe blocks. E2/E3 (typed value survives) explicitly assert the "never clobber" invariant with `if (row.weight != null) expect(parseFloat(row.weight)).toBeCloseTo(100, 1)` and similar for reps. |
| `npm run typecheck` clean | yes | Re-ran. Exit 0, no errors. |
| No new `any` / `@ts-ignore` / `console.log` | yes | The 8 grep hits for "any" in edited files are all the English word in comments; no `any` types added. No `@ts-ignore`. Only pre-existing `console.warn` in catch blocks. |

## Issues

### Blockers
None.

### Majors
None.

### Minors

- **[MIN-1]** `src/utils/auto-fill-set.ts:67` — the weight-input emptiness predicate calls `parseFloat(weightTrimmed.replace(",", "."))`, accepting comma-decimal as a non-empty typed value. Design v3 §"Predicate per field on `currentInput`" specifies `parseFloat(currentInput.weight) === 0` without the comma-substitution. The implementation matches the `parseFloat0` convention from `set-input.tsx:46-51` (which also does `.replace(",", ".")`), so behavior is internally consistent — but it's a soft callback the Implementer did not declare under "Soft callbacks made". Minor. No correctness regression; the reps predicate (`Number(repsTrimmed)`) does NOT do the swap, which matches `parseInt0` (reps don't accept decimals anyway). Acceptance: pin in test case "comma-decimal weight … honored as typed non-zero value" (line 113-120 already does). No fix required; flag for documentation completeness.

- **[MIN-2]** `src/utils/auto-fill-set.ts:81,84` — `patch.weight = previous!.weight as string` and `patch.reps = previous!.reps as number` use a non-null assertion + `as` cast where TS narrowing should be enough after the `previousHasWeight`/`previousHasReps` guards. Cleaner: refactor as `const w = previous?.weight; if (w != null && parseFloat(w) > 0) …` so the type narrows naturally and the `!`/`as` drop. Minor — current code is correct, just less idiomatic. No fix required.

- **[MIN-3]** `tests/e2e/auto-fill-placeholder-on-check.spec.ts:369` — `page.getByPlaceholder("120").first()` selects the weight input by its placeholder text, which equals the prior session's weight. That works for E1-E10 with the chosen seed (120 × 8), but creates a brittle coupling: if another seeded element on the screen ever renders a placeholder of "120" (e.g. a future "Target weight" field), the selector becomes ambiguous. The fallback `.first()` masks that. Suggested fix: anchor on `getByLabel` if a labelled selector exists, or pin via test-id. Tester discretion — not a correctness regression in the current screen.

- **[MIN-4]** `app/(app)/workout/[sessionId].tsx:551` — comment "Two PostgREST round-trips on the auto-fill path (updateSet, checkSet); a single round-trip on the no-fill path." narrates *what*, not *why*. The why-comment is already on L523-527 above. This footer can be dropped or merged. Style nit only.

- **[MIN-5]** `tests/e2e/auto-fill-placeholder-on-check.spec.ts:807` — E9 anchors lbs-mode confirmation on `page.getByPlaceholder("264.6")`. If the actual `kgToLbs(120).toFixed(1)` produces anything other than `"264.6"` on the test runner (rounding edge), the spec fails before reaching the load-bearing assertion. Implementation comment at L26-28 already pins the math (`120 / 0.45359237 ≈ 264.5547` → `"264.6"`), but a defensive fallback (regex `getByPlaceholder(/^26[45]\.[5-7]$/)` or computing the expected string from `kgToLbs` at runtime) would be more robust. Tester discretion.

## Security checklist
- [x] **RLS**: no new `from('table').*` calls in production code. The e2e spec uses `admin` (service-role) directly, which is correct for test seeding. The new helper has no DB access at all.
- [x] **No `SUPABASE_SERVICE_ROLE_KEY` in client-bundled code**: `SERVICE_ROLE` is referenced only in `tests/e2e/auto-fill-placeholder-on-check.spec.ts:39`, which is test-only and not bundled to the client. Same pattern as `rest-timer-auto-start.spec.ts`.
- [x] **No raw SQL `rpc` with user-typed input**: feature uses the existing `updateSet` / `checkSet` mutations (parameterized via PostgREST). Auto-fill payload values come from `previous.weight`/`previous.reps` which are canonical row values, not user input through the helper path.
- [x] **`EXPO_PUBLIC_*` env vars**: no new envs introduced.

## Style / convention checklist
- [x] No new `any` (the 8 grep hits are English-word "any" in comments).
- [x] No new `// @ts-ignore`.
- [x] Comments narrate *why*: the screen handler's step 1/2/3 comments explain ordering rationale (F10 invariant, abort-on-failed-updateSet, stale-responder safety net). The helper's JSDoc explains *why* the structural shape over `SetRow` (test stub friction) and *why* gating lives at the caller. MIN-4 above flags one *what*-comment for cleanup.
- [x] Imports follow project style: package imports first (`lucide-react-native`, `react-native`, `react`); then `~/`-prefixed relatives. `Keyboard` added inline in the alphabetized `react-native` block at L4-13 — well-placed.
- [x] New files placed in conventional folders: `src/utils/` for the pure helper, `tests/unit/` for vitest, `tests/e2e/` for playwright. Matches `src/utils/volume-target.ts` and the existing test-suite layout.

## Decision

**pass**

Reasoning:
- 0 blockers, 0 majors, 5 minors — well below the pass threshold (≤1 major).
- All three v2 blockers (BLK-1 mid-typing race, BLK-2 sessionId prop break, MAJ-1/2 shim collisions) closed architecturally with file:line verification. The widened-callback path passes typed strings synchronously on the same call stack — no cache read, no blur dance, no race window.
- Manual-commit path byte-identical to today (no `setQueryData` shim). F10 "checked = committed" invariant preserved by the `updateSet → checkSet` write order.
- History-edit caller invariant verified directly (line 310 mounts `<ExerciseBlock>` without `showCheckable` / `onToggleSetChecked`; signature widening is type-invisible).
- Helper is pure, has no React/network coupling, and the 15 unit tests cover the design's 8 canonical cases + 4 edge cases + 3 implementation-driven extras.
- `Keyboard.dismiss()` polish kept as documented non-load-bearing; trivially removable if the Tester reports dual-mutation network noise during E2.
- Typecheck clean (re-verified). No new `any` / `@ts-ignore` / `console.log`.

Hand-off: invoke Tester. The 5 minors above are polish-only and do not block Tester execution. Tester should pay specific attention to:
- E2/E3 (typed-value-survives invariant — BLK-1 regression guard);
- E10 (rest-timer no-extra-await sanity, no byte-identical regression);
- E9 lbs-string pin (MIN-5 — pin to actual conversion output on first run);
- E7 (no spurious second auto-fill after uncheck → re-check);
- E8 (bulk path bypass — auto-fill must NOT fire).
