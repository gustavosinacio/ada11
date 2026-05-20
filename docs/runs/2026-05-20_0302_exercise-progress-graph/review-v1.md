# Review v1 — 2026-05-20_0302_exercise-progress-graph

Reviewing: working-tree diff for the implementation against `design-v1.md`.

## Diff scope
- Baseline: `a93ca686d3d378c1086ca122e8386f9eeab25f7a`
- Files changed: 4 (code only). +43 / -22.
  - `app/(app)/exercises/index.tsx` (+1/-1)
  - `app/(app)/exercises/[id]/index.tsx` (+2/-13)
  - `app/(app)/exercises/[id]/progress.tsx` (+39/-7)
  - `src/hooks/use-sessions.ts` (+1/-0)

## Verification of implementation.md claims

| Claim | Verified? | Notes |
|---|---|---|
| Row tap target → `/progress` | yes | `app/(app)/exercises/index.tsx:64`. |
| `screenHeader` extracted as const, reused in both branches | yes | `progress.tsx:40-57` defines; `:103` (loading) + `:114` (loaded). |
| `headerRight` function form, Pencil size=20, `useColorScheme`, `accessibilityLabel="Edit exercise"` | yes | `progress.tsx:45-53`. Byte-for-byte equivalent to `measurements/[id]/index.tsx:148-156`. Design called for size 22; implementer chose 20 to match the cited precedent. Correct call. |
| Mid-page "View progress" CTA removed | yes | Block previously at L185-194 is gone. |
| Delete handler uses `router.replace("/(app)/exercises")` (MAJ-1 fold-in) | yes | `[id]/index.tsx:87`. |
| `useFinishSession.onSuccess` invalidates `["progress"]` | yes | `src/hooks/use-sessions.ts:62`. Umbrella prefix matches `["progress", exerciseId]`. |
| Dropped imports cleanup is benign | yes | `Link` + `Pressable` removed from `[id]/index.tsx`; no other usages. |
| No new `any` / `@ts-ignore` / `console.log` | yes | grep clean. |
| `progress-chart.tsx` and other unrelated files untouched | yes | git diff confirms. |

## Issues

### Blockers
None.

### Majors
None.

### Minors
- **[MIN-1]** Pencil tappable during loading window of progress screen. Design Open Q #3 accepted; theoretical edge only.
- **[MIN-2]** `screenHeader` JSX recomputed each render. Matches the measurements precedent; leaving alone for consistency.
- **[MIN-3]** `["progress"]` umbrella invalidation is slightly coarser than per-exercise. Design Risks section accepted; bounded cache.

## Security checklist
- [x] No new DB queries.
- [x] No service-role tokens.
- [x] No raw `.rpc()` or SQL.
- [x] No new `EXPO_PUBLIC_*` env vars.

## Style / convention checklist
- [x] No new `any`.
- [x] No new `// @ts-ignore`.
- [x] Imports clean and project-style.
- [x] No new files; edits in conventional folders.

## Quality gates (re-run)
- `npm run typecheck` — clean.
- `npm run lint` — 0 errors, 1 pre-existing `router.d.ts` warning.
- `npm run test:unit` — 51/51 pass.

## Decision

**pass**

Reasoning:
- 0 blockers, 0 majors, 3 minors (all design-acknowledged or precedent-matching).
- All 4 file changes verified against design + MAJ-1 fold-in.
- `screenHeader` extraction is cleaner than the design's fallback; Pencil size=20 reconciles design vs precedent in favor of precedent.
