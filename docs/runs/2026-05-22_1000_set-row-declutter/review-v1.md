# Review v1 — 2026-05-22_1000_set-row-declutter

Reviewing: the diff for the implementation against `design-v3.md` (final) + `validation-v3.md` (go, 0 blockers / 0 majors / 2 cosmetic minors).

## Diff scope

- Diff command: `git diff 8b9414153a2c9f5ab71f2f15d3020b468d2b76b5...HEAD` (baseline from `state.md`).
- Files changed: 11 (6 edited source + 1 new component + 3 new unit test files + 1 new e2e spec).
- Lines (source only, excluding tests): +189 / -55 across the 6 edited files; +226 / -0 for the new `set-row-menu.tsx`.

## Verification of implementation.md claims

| Claim | Verified? | Notes |
|---|---|---|
| BLK-1 fix: `updateSet` partial-spread with `if (patch.X !== undefined)` for all 4 columns | yes | `src/api/sets.ts:113-138` — exact pattern; empty-patch short-circuit at `:128`; return type widened to `Promise<SetRow \| null>` at `:116`; tri-state JSDoc at `:98-112`. |
| `updateSetMeta` partial-spread with same semantics | yes | `src/api/sets.ts:156-174` — same pattern over `{rpe, notes}`; short-circuit at `:164`; JSDoc at `:140-155`. |
| `useUpdateSet.onSuccess` skips invalidation on `null`; retains `["stats"]` | yes | `src/hooks/use-sets.ts:65-77` — `if (result === null) return` at `:72`; both `["sets", sessionId]` and `["stats"]` invalidation preserved at `:73-74`. |
| `useUpdateSetMeta` invalidates `["sets", sessionId]` only | yes | `src/hooks/use-sets.ts:88-99` — only `KEYS.forSession(sessionId)` invalidated at `:96`; no `["stats"]`. Divergence rationale documented in JSDoc at `:80-87`. |
| `<SetInput>` inline RPE/notes removed; `MoreHorizontal` trigger added; menu mount-gated | yes | `src/components/set-input.tsx:1` (import swap `MessageSquare` → `MoreHorizontal`); inline RPE `<TextInput>` and notes block deleted (compared to baseline); trigger at `:162-176`; mount-gate at `:188-198` (`{menuOpen ? <SetRowMenu .../> : null}`). |
| `<SetInput>.onCommit` narrowed to `{reps, weight}` | yes | `src/components/set-input.tsx:25` (prop type); `:95-100` (call site sends only `reps` + `weight`). |
| `MoreHorizontal` icon color blue-500/gray-400 by hex prop (deviation #3) | yes | `src/components/set-input.tsx:172-175` — `color={hasMetaData ? "#3b82f6" : "#9ca3af"}`. Hex prop is correct for `lucide-react-native`; existing `Trash2`/`Square`/`CheckSquare` use the same convention. |
| `<SetRowMenu>` props: no `visible`; `{onClose, setNumber, exerciseName, initialRpe, initialNotes, previousRpe, onSubmit}` | yes | `src/components/set-row-menu.tsx:16-37` matches exactly; no `visible` prop. |
| 12-chip RPE strip (`—, 5.0..10.0`) in horizontal `ScrollView`; selected = emerald | yes | `src/components/set-row-menu.tsx:45-58` defines 12 chips; `:145-204` renders horizontal `ScrollView` with `bg-emerald-500` for selected. |
| Chip equality normalized via `parseFloat(value).toFixed(1)` to handle legacy "9" | yes | `src/components/set-row-menu.tsx:60-65` `normalizeRpe` applied to both draft `rpe` and `previousRpe` at `:93-94`. |
| Notes: 4-line `<TextInput>` inside `KeyboardAvoidingView` (`padding` iOS / `height` Android); auto-saves on dismiss | yes | `src/components/set-row-menu.tsx:209-218` (`multiline numberOfLines={4}`); KAV at `:125-128`; `commitNotesAndClose` at `:101-108` fires on backdrop tap, X button, and `onRequestClose`. |
| Caller wirings at both pages forward `onUpdateSetMeta={...updateSetMeta.mutateAsync({id, patch})}` | yes | `app/(app)/workout/[sessionId].tsx:59` hook init; `:388-394` prop wiring. `app/(app)/history/[id].tsx:51` hook init; `:270-276` prop wiring. Both also keep the existing `onUpdateSet` wiring (`:381-387` and `:263-269` respectively). |
| 7 unit tests in `tests/unit/api-sets.updateSet.test.ts` (not 6) per MIN-10-v3 | yes | 7 `it()` blocks at `tests/unit/api-sets.updateSet.test.ts:49,61,69,77,85,103,112`. |
| Headline regression: `updateSet({reps: 5})` → `.update({reps: 5})` only | yes | `tests/unit/api-sets.updateSet.test.ts:49-59` — `expect(updateMock).toHaveBeenCalledWith({ reps: 5 })`; counts assert one call; no other keys asserted by `toHaveBeenCalledWith` exact-match. |
| `npm run typecheck` clean | yes | Reviewer ran `npm run typecheck` once: exit 0, no errors. |

All 14 implementation claims verified directly against source.

## Issues

### Blockers

None.

### Majors

None.

### Minors

- **[MIN-1]** `src/hooks/use-sets.ts:71` — the inline `// result is null when the patch was empty. No invalidation needed.` comment narrates *what* the next line does rather than *why* (the why is "empty patch short-circuited at the API layer; no DB write happened, so cache is already in sync"). Same pattern at `:94`. Tiny — keep or rephrase to "API short-circuited before any DB write — cache is already consistent." Style-checklist nit only, not a correctness issue.

- **[MIN-2]** `src/components/set-row-menu.tsx:124` — the no-op-press shield Pressable uses `accessibilityRole="none"` to suppress AT focus on the inner card. The role `"none"` is non-standard in React Native (the spec'd value is `"none"` for ARIA but on RN-Web it maps OK; on iOS it's mostly equivalent to omitting the role). Recommendation: drop the `accessibilityRole="none"` and rely on the implicit role, or leave a one-line comment explaining the intent (currently the comment above explains the *why* of the wrapper — good — but the `role="none"` is unflagged). Style minor only.

## Security checklist

- [x] **RLS**: every new `.from("sets")` lands on the pre-existing `sets` table, which is RLS-protected by `supabase/migrations/0001_rls_and_seed.sql` (user_id = auth.uid()). `updateSetMeta` uses the same `.from("sets").update(...).eq("id", id)` pattern as `updateSet` — RLS gates row access per existing policy. No new table introduced.
- [x] **Secrets**: no `SUPABASE_SERVICE_ROLE_KEY` referenced in any file under `app/` or `src/`. The only reference is in `tests/e2e/set-row-menu.spec.ts:20-28`, which is test infrastructure that loads from `.env.local` and never bundles to client — pre-existing pattern in this repo's other e2e specs (`tests/e2e/crud.spec.ts` etc.).
- [x] **Input handling**: no raw SQL via `.rpc()` introduced; user-typed notes/RPE flow through `.update(payload)` parameter binding (PostgREST) — same as every other write in this codebase.
- [x] **Public env vars**: no new `EXPO_PUBLIC_*` env vars introduced.

## Style / convention checklist

- [x] **No new `any` types**: grepped all 11 files — only matches are the word "any" in JSDoc comments. Tests use `unknown[]` casts (e.g., `tests/unit/api-sets.updateSet.test.ts:40` `(...args: unknown[])`), not `any`.
- [x] **No new `// @ts-ignore` / `@ts-nocheck`**: none in any of the new or edited files.
- [~] **Comments narrate why, not what**: mostly yes (JSDoc blocks on the new functions/hooks/components are explanatory and rationale-heavy; the design's tri-state contract is well-documented). One minor exception flagged above (MIN-1).
- [x] **Imports follow project style**: package imports first, then `~/...` aliases, then relative. Verified in `src/components/set-row-menu.tsx:1-14`, `src/components/set-input.tsx:1-8`, `src/components/exercise-block.tsx:1-9`, both test files, both page files.
- [x] **New files placed in conventional folders**: `src/components/set-row-menu.tsx` (matches `set-input.tsx`, `exercise-block.tsx`, `plate-calculator.tsx` precedent); `tests/unit/*.test.ts` and `tests/e2e/*.spec.ts` follow existing patterns.

## Cross-check against Validator v3 follow-ups

- **MIN-10-v3 (test count 7 not 6)**: implementer landed 7 — verified above. ✓
- **MIN-11-v3 (patch-type "narrowing" is JSDoc-only)**: implementer added JSDoc on `UpdateSetInput` (`src/api/sets.ts:15-25`) and `UpdateSetMetaInput` (`:33-37`). No shape change. ✓

## Cross-check against design-v3 page composition

- Row order (live workout, `showCheckable=true`): leading-check (`w-11`) · type-badge (`w-7`) · set# (`w-6`) · weight (`flex-1`) · reps (`flex-1`) · menu trigger (`w-11`) · trash (`p-1` ≈ `w-7`). Matches the goal sentence at design-v3:6 ("set-number badge · set type · weight · reps · check · menu") with the well-documented v2 carryover that the check button is on the leading edge, not between reps and menu. Trash icon retained at trailing edge — pre-existing, intentionally out-of-scope per design-v3:239.
- Header row in `src/components/exercise-block.tsx:212-227` mirrors the data row: w-11 (check spacer when showCheckable) · w-7 (badge) · w-6 (#) · flex-1 (Weight) · flex-1 (Reps) · w-11 (menu) · w-7 (trash). RPE label correctly dropped. ✓

## Decision

**pass**

Reasoning:
- 0 blockers, 0 majors, 2 cosmetic minors (both style nits, neither blocks Tester).
- BLK-1 root-cause fix landed exactly per design: partial-spread payload + empty-patch short-circuit + return-type widening + caller null-tolerance. Caller audit confirms both pages forward `{reps, weight}` verbatim, so the v2 footgun is closed at the root with zero behavior change for any current caller.
- All 13 verification items from the brief pass against actual source.
- Security: pre-existing RLS on the `sets` table protects all new writes; no service-role key in client paths; no new `any` / `@ts-ignore` / raw SQL.
- Unit test suite includes the exact `updateSet({reps: 5}) → .update({reps: 5})` payload-shape regression assertion the validator called out, plus 6 supporting cases for the tri-state contract.
- Implementer's 4 documented deviations (test count, MIN-11 JSDoc-only, hex `color` prop on lucide icon, MutationObserver test harness) are all justified in `implementation.md:24-31` and verified correct.

Recommendation to Conductor: **invoke Tester** (round 1 review passes; e2e + regression suite are Tester's job).

## Counts

`{ blockers: 0, majors: 0, minors: 2 }`
