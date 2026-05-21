# Review v1 — 2026-05-21_1554_tap-exercise-name-to-progress

Reviewing: the diff for the implementation against `design-v1.md` (final approved) and `validation-v1.md` (`go`, 1 major + 3 minors).

## Diff scope
- Diff command: `git diff HEAD` (no commits since baseline; all changes are working tree only — same set the Implementer produced)
- Files changed (in-scope): 4
- Lines (in-scope): +78 / -7
  - `src/components/exercise-block.tsx`: +30 / -7
  - `app/(app)/workout/[sessionId].tsx`: +3 / -0
  - `app/(app)/history/[id].tsx`: +3 / -0
  - `tests/e2e/exercise-progress-ia.spec.ts`: +42 / -0

## Verification of implementation.md claims
| Claim | Verified? | Notes |
|---|---|---|
| `onPressName?: () => void` added to `Props` next to `onRemove?` | yes | `src/components/exercise-block.tsx:29-32`; destructured at `:57` |
| Wraps name `<Text>` in `<Pressable>` when prop is set; bare `<Text>` otherwise (defensive default) | yes | `src/components/exercise-block.tsx:107-128` — ternary on `onPressName`, both branches render identical `<Text>` markup |
| `active:opacity-70` on the `<Pressable>` (validator MAJ-1 fix) | yes | `src/components/exercise-block.tsx:112` |
| `accessibilityRole="button"` + `accessibilityLabel` template literal | yes | `src/components/exercise-block.tsx:110-111` — `View progress for ${exercise.name}` |
| No chevron, no underline, no color shift, no spacing change | yes | Markup identical to prior bare `<Text>` apart from the `<Pressable>` wrapper |
| Subtitle stays non-interactive | yes | `src/components/exercise-block.tsx:129-140` — outside the `<Pressable>` |
| Action cluster (move up/down, remove) untouched | yes | `src/components/exercise-block.tsx:142-178` — diff shows no edits in this range |
| `(deleted)` suffix renders inside the `<Pressable>` so tap still works for soft-deleted | yes | `src/components/exercise-block.tsx:115-118` — suffix nested inside the wrapped `<Text>` |
| Live workout callsite wires `onPressName` | yes | `app/(app)/workout/[sessionId].tsx:324-326`, route literal `/(app)/exercises/${ex.id}/progress` |
| History detail callsite wires `onPressName`, `router` already bound | yes | `app/(app)/history/[id].tsx:245-247`; `router = useRouter()` at `:36` |
| Route literal matches existing usage | yes | Identical string to `app/(app)/exercises/index.tsx:64` precedent (verified by Validator) |
| No new `useRouter()` calls, no new imports in callsite files | yes | Diff for both files shows zero changes outside the prop insertion |
| New e2e arm asserts tap → `/exercises/{uuid}/progress` → back → workout URL | yes | `tests/e2e/exercise-progress-ia.spec.ts:205-245`; uses `page.getByLabel("View progress for Bench Press")` |
| `npm run typecheck` clean | yes | Re-ran during review — `tsc --noEmit` exits 0 with no output |

## Issues

### Blockers
- None.

### Majors
- None.

### Minors
- **[MIN-1]** `tests/e2e/exercise-progress-ia.spec.ts:239`: the post-`goBack()` URL regex is built by string-escaping the captured `workoutUrl` and only escaping `/`, while the source URL already contains a `-` and uuid hex chars — works in practice but is fragile if the workout URL ever picks up a regex meta-char (e.g. a query string with `?` from a routing change). Fix (optional): replace the `replace(/[/]/g, "\\/")` with a proper regex-escape helper (or compare with `expect(page).toHaveURL(workoutUrl)`). Severity: minor; the spec works as written today.
- **[MIN-2]** `src/components/exercise-block.tsx:107-128`: the design noted the Implementer could factor the inner `<Text>` into a local variable to avoid duplication. Implementer deliberately kept it duplicated (4 lines × 2) and documented the trade-off in `implementation.md`. Acceptable; flagging only because future edits to the name `<Text>` markup must touch both branches in lockstep — a small maintenance footgun.
- **[MIN-3]** `tests/e2e/exercise-progress-ia.spec.ts:226`: `getByText("Bench Press", { exact: true }).first()` may now match the live block's name pressable as well as the picker list item (since both render the text "Bench Press" once the exercise is added). The `expect(... "Pick exercise").not.toBeVisible(...)` assertion at `:227` runs before the new label-based tap, so timing-wise this is fine, but the `.first()` selector inside the picker (line 226) executes *while* the picker is open and is therefore safe. No change required; flagging for Tester awareness if this spec is reused as a template.

## Security checklist
- [x] RLS: no new `from('table').*` calls in this diff. Navigation-only change.
- [x] No `SUPABASE_SERVICE_ROLE_KEY` or other service-role token in client-bundled code. The test file (under `tests/e2e/`) is the only place referencing `SUPABASE_SERVICE_ROLE_KEY` and that's pre-existing test infra, not shipped to the client.
- [x] No raw SQL via `rpc` introduced.
- [x] No new `EXPO_PUBLIC_*` env vars added.

## Style / convention checklist
- [x] No new `any` types introduced in the touched files.
- [x] No new `// @ts-ignore` introduced.
- [x] Comments narrate *why*, not *what*. JSDoc on `onPressName` at `exercise-block.tsx:29-32` explains intent and the defensive-default contract.
- [x] Imports follow project style (no new imports needed — `Pressable`/`Text`/`View` already in scope at `exercise-block.tsx:3`; `router` already bound in both callsite files).
- [x] New files: none. All edits land in conventional folders (`src/components/`, `app/(app)/...`, `tests/e2e/`).

## Decision

**pass**

Reasoning:
- 0 blockers, 0 majors, 3 minors — all advisory.
- All 9 review checklist items confirmed in the diff.
- Validator's MAJ-1 (`active:opacity-70`) and MIN-1 (drop the stale `useRouter` hedge) are both folded correctly. MIN-2 / MIN-3 were FYI per validator and were intentionally not applied — consistent with the implementation note.
- Defensive default (bare `<Text>` when `onPressName` is undefined) preserves existing behavior for any future caller that mounts `<ExerciseBlock>` without the prop.
- `npm run typecheck` clean. Implementer also reported clean lint + 87/87 unit tests; not re-run per review tool budget.
- Recommendation to Conductor: invoke Tester.
