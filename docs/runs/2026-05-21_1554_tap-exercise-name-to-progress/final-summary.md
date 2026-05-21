# Final summary — 2026-05-21_1554_tap-exercise-name-to-progress

## Outcome
- **Feature**: Tap an exercise's name in `<ExerciseBlock>` (live workout OR history detail) → navigate to `/(app)/exercises/{id}/progress`. Name has `active:opacity-70` press feedback. Subtitle (muscles/equipment) is non-interactive.
- **Pipeline result**: **shipped** (typecheck/lint clean, 87/87 unit, 20/20 e2e under `--repeat-each=5`, 37/39 adjacent pass with 2 pre-existing unrelated failures).
- **Baseline commit**: `34447db`.

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | yes (web; Playwright 5x stress + adjacent green) |
| Human interventions | 0 |
| Total round-trips | 1 (1 I↔T respin) |
| Design ↔ Validate rounds | 1 (`go` with 1 major absorbed in implementation) |
| Implement ↔ Review rounds | 1 (`pass`) |
| Implement ↔ Test rounds | 2 (v1 `fail` on back-stack regression + e2e regex; v2 `pass`) |
| Implementer soft-callbacks | 0 |
| Wall-clock duration | ~71 min (15:54 → 17:05 BRT) |

## What shipped (4 files + 1 routing-layer fix)

**Edited (production code):**
- `src/components/exercise-block.tsx` — `onPressName?: () => void` prop. When provided, wraps the name `<Text>` in a `<Pressable>` with `accessibilityRole="button"`, `accessibilityLabel="View progress for {name}"`, `className="active:opacity-70"`. Bare `<Text>` fallback when not provided (defensive default).
- `app/(app)/workout/[sessionId].tsx` — passes `onPressName={() => router.push(`/(app)/exercises/${ex.id}/progress`)}`.
- `app/(app)/history/[id].tsx` — passes same.
- `app/(app)/_layout.tsx` — `<Tabs backBehavior="history">` (Bug A fix).

**Edited (tests):**
- `tests/e2e/exercise-progress-ia.spec.ts` — relaxed URL regex to `/\/exercises\/[0-9a-f-]+\/progress(\?.*)?$/`. Added two new arms: live-workout name tap + history-detail name tap, both with back-navigation regression guards.

## Decisions

1. **Prop shape** = `onPressName?: () => void` callback (matches `onMoveUp`/`onRemove` precedent).
2. **History detail parity** = YES. Shared `<ExerciseBlock>` between live and history; both screens pass `onPressName`.
3. **Visual treatment** = text-only with `active:opacity-70` press feedback. No chevron / underline.
4. **Tap-target boundary** = `<Pressable>` wraps the name `<Text>` only; subtitle stays non-interactive.
5. **Tabs `backBehavior`** = `"history"` (was implicit `"firstRoute"`). Cross-tab back now walks tab history; required for the back-stack to work consistently.

## Bugs caught by the pipeline
- **v1 MAJ-1** Validator: missing `active:opacity-70` press feedback. Folded into implementation.
- **v1 MIN-1** Validator: stale "may need useRouter" hedge in design — `router` was already bound in `history/[id].tsx:36`. Removed.
- **I↔T v1 Bug A**: history-detail back-stack regression — `router.push` from `/history/[id]` to `/exercises/[id]/progress` behaved as REPLACE on web because Tabs `backBehavior='firstRoute'` made cross-tab delta = 0. Fixed via `backBehavior="history"`. Sister e2e arm guards permanently.
- **I↔T v1 Bug B**: new e2e arm's `$`-anchored URL regex missed `?id=...` query suffix from expo-router web. Relaxed regex.

## Known-debt (non-gating)
- 3 Reviewer advisory minors: e2e `goBack()` URL regex fragility, name `<Text>` duplicated across ternary branches, `.first()` on text selector in picker.
- **`backBehavior="history"` changes Android OS back-button semantics**: cross-tab back now walks the tab history instead of always returning to Workout. No tests assert the old behavior. Manual device smoke recommended before release.
- Pre-existing unrelated failures: `auth.spec.ts:152` (Supabase now rejects `@test.com` emails — environment-side) and `crud.spec.ts:131` (b51dd01 muscles-picker refactor).

## Why we stopped
- Feature complete. All gates green under stress. Routing-layer bug caught by Tester, fixed surgically.

## Artifacts
- discovery.md, design-v1.md, validation-v1.md
- implementation.md, review-v1.md, test-report-v1.md
- implementation-v2.md (fix), test-report-v2.md
- state.md, transcript.md, final-summary.md
- retro.md (post-run, owner)

## Notes for the owner
- **Working tree uncommitted.** Suggested split: `feat(workout): tap exercise name to see progress chart` + `docs(pipeline): archive tap-exercise-name run`.
- **Routing-layer change**: `backBehavior="history"` on `<Tabs>` is the load-bearing fix. Affects every tab navigation. Manual iOS/Android smoke recommended.
- **`docs/features.md` backlog cleared** after this run.

## Archive
- To archive: `cp -r docs/runs/2026-05-21_1554_tap-exercise-name-to-progress "$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-05-21_1554_tap-exercise-name-to-progress"` + vault README entry.
