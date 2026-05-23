# Implementation — 2026-05-23_0211_configurable-max-volume-window

Based on: `design-v2.md` (approved) and `validation-v2.md` (`go`, 3 polish minors).
Round: Implement↔Review round 1 of 2.

## Files changed

### New
- `supabase/migrations/0009_max_volume_window.sql` (new) — adds the `user_preferences.max_volume_window_weeks integer NOT NULL DEFAULT 0` column with `CHECK (max_volume_window_weeks IN (0, 10, 20, 30))`. Mirrors `0005_measurements.sql` column-then-check shape. Seed function unchanged — `0001_rls_and_seed.sql:55` omits the column and the DEFAULT applies for new signups.
- `src/utils/window-utils.ts` (new) — `computeWindowStart(weeks, now)`. Returns `number | undefined` per Conductor's NEW-MIN-2 guidance: `undefined` when `weeks === 0` (lifetime), otherwise the UTC millisecond instant of the local Monday 00:00 that lies N ISO weeks before `now`. Threshold computed once and consumed by every kernel via numeric `parseISO(...).getTime() >= windowStartMs`.
- `tests/unit/window-utils.test.ts` (new) — 6 cases covering `weeks=0` undefined, 10/20/30 ordering, Sunday-23:30 BRT anchoring on the ISO-week Monday, round-trip identity, inclusive boundary.
- `tests/unit/profile-max-volume-window.test.ts` (new) — 11 cases. Smoke test for the Profile wiring at the hook + API contract level (see *Deviations* §1). Verifies the label map (`0→"All"`, `10→"10w"`, `20→"20w"`, `30→"30w"`), default-to-0 read behaviour, setter dispatches the right integer for every option, cache update path, and QueryObserver propagation.

### Edited — data plumbing
- `src/db/schema.ts` (edited) — adds `maxVolumeWindowWeeks: integer("max_volume_window_weeks").notNull().default(0)` to `userPreferences`.
- `src/db/types.ts` (edited) — exports `MaxVolumeWindowWeeks = 0 | 10 | 20 | 30` and `MAX_VOLUME_WINDOW_OPTIONS: readonly MaxVolumeWindowWeeks[] = [0, 10, 20, 30]`.
- `src/api/preferences.ts` (edited) — extends `UserPreferencesRow` with `max_volume_window_weeks`. Adds `setMaxVolumeWindowWeeks(weeks)` mutation symmetric with `setLengthUnit`.
- `src/hooks/use-preferences.ts` (edited) — adds `useMaxVolumeWindowWeeks()` reader (default `0`) and `useSetMaxVolumeWindowWeeks()` mutation (same `qc.setQueryData(KEY, row)` pattern as the weight/length setters).

### Edited — kernels (threading `windowStartMs?: number`)
- `src/utils/progress-page-math.ts` (edited):
  - `bucketLifetimeWeeklyVolumes(rows, windowStartMs?)` — dual-anchor: inclusion via `sessions.started_at`, bucket placement still via `completed_at`.
  - `computeLifetimeMaxPerExercise(rows, windowStartMs?)` — now aggregates `(exerciseId, sessionId) → {volume, startedAt}` and drops session aggregates strictly before the threshold before per-exercise max.
  - `computePrsThisWeek({..., windowStartMs?})` — filters session aggregates BEFORE the priorMax-running walk.
  - `computePrExerciseIdsThisWeek` — pass-through.
- `src/utils/session-verdict-math.ts` (edited) — `computePrsForSession` accepts `windowStartMs?` and plumbs it straight into `computeLifetimeMaxPerExercise(priorRows, windowStartMs)`.
- `src/utils/volume-target.ts` (edited) — `computeVolumeTarget` accepts `windowStartMs?` in `ComputeVolumeTargetInput`. Filters at the `SessionSets.started_at` level (never per-set).

### Edited — hook layer
- `src/hooks/use-progress-page.ts` (edited):
  - `useLifetimeBestWeek` — JSDoc updated (MIN-2 acknowledgement, name kept). Reads `useMaxVolumeWindowWeeks`, derives `windowStartMs` via `useMemo(() => computeWindowStart(weeks, new Date()), [weeks])`, passes into `bucketLifetimeWeeklyVolumes`.
  - `usePrsThisWeek` — same memo pattern; threads `windowStartMs` into `computePrsThisWeek`.
  - `useExercisesThisWeek` — same memo pattern; threads `windowStartMs` into `computeLifetimeMaxPerExercise`. `nowKgByExercise` (the "Now" sum for this ISO week) deliberately remains outside the window — see inline comment.

### Edited — UI
- `src/components/progress-hero.tsx` (edited) — reads `useMaxVolumeWindowWeeks()`; legend caption branches `weeks === 0` → "Max = best week ever · …" vs `weeks > 0` → ``"Max = best of last ${weeks} weeks · …"``.
- `src/components/volume-target-slot.tsx` (edited) — reads pref + derives `windowStartMs` via the pinned memo recipe; passes into `computeVolumeTarget`. `VolumeTargetSlot` copy is unchanged ("Previous best" / "New PR! +X over your previous" stays accurate under any window).
- `app/(app)/workout/verdict/[sessionId].tsx` (edited) — reads pref + memo; passes `windowStartMs` into `computePrsForSession`. Verdict-screen headline copy unchanged.
- `app/(app)/profile.tsx` (edited) — new third segmented-control row beneath the Length-unit row. Labels `All / 10w / 20w / 30w` (MAJ-2 fix), legend caption "Max-volume window — how many recent weeks to compare against." `MAX_VOLUME_WINDOW_LABELS` map kept inline near the imports. Accessibility label spells out the meaning so VoiceOver doesn't say "10w" abstractly. Border between Length-unit and Max-volume-window rows added for parity with the Weight-unit row.
- `app/(app)/progress/index.tsx` (edited) — reads pref to branch the `bestWeekLabel` string ("Best week: …" vs "Best of last N weeks: …"). Adds a 9-line code comment above `<WeeklyVolumeStrip>` acknowledging NEW-MIN-3 (overlay asymmetry under narrow windows is intentional).
- `app/(app)/exercises/[id]/progress.tsx` (edited, **documentation only**) — top-of-file JSDoc explains the intentional deferral (e1RM kernel vs volume kernel; the max-volume-window pref deliberately does not thread here). No behavioural change.

### Edited — tests
- `tests/unit/progress-page-math.test.ts` (edited) — adds three windowed-mode regression blocks (15 new cases total) before the existing `computeCurrentWeekVolume` block. Cases cover (a) exactly-on-boundary inclusion, (b) 1-ms-before exclusion, (c) ancient PR excluded → in-window second-best wins, (d) `windowStartMs=undefined` byte-identical to lifetime, (e) cross-week session never split (both directions: started-before/completed-inside excluded; started-inside/completed-later included).
- `tests/unit/session-verdict-math.test.ts` (edited) — appends 3 windowed cases for `computePrsForSession`: ancient PR excluded → in-window prior wins; in-window `priorMaxKg = 0` → not a PR; `undefined` identical to lifetime.
- `tests/unit/volume-target.test.ts` (edited) — appends 4 windowed cases for `computeVolumeTarget`: ancient max excluded; all past sessions excluded → `no-pr`; `undefined` identical to lifetime; exactly-on-boundary inclusion. Updates `mkSession` helper to accept an optional `startedAt`.

## Deviations from design

1. **Profile smoke test file extension: `.test.ts` instead of `.test.tsx`** — design-v2 (line 53) and Conductor's NEW-MIN-1 guidance both name `tests/unit/profile-max-volume-window.test.tsx`. The repo has zero `.tsx` tests, no `@testing-library/react-native` installed (`package-lock.json` only shows transitive references), and `vitest.config.ts` restricts `include` to `tests/unit/**/*.test.ts`. Setting up an RNTL + jsdom stack is out of scope and explicitly excluded by the run's `## Important policies` ("No retro/clean-up beyond scope"). I wrote the smoke test as `.test.ts` and verified the same three behaviours the design called out via the existing `MutationObserver` pattern (mirrors `tests/unit/use-sets.useUpdateSetMeta.test.ts`): (a) active-segment cache read, (b) setter dispatches the right integer for every option, (c) abbreviated label map sanity + literal legend caption pinned. The wiring assurance is preserved; only the render mechanism differs. Confidence: HIGH that this still satisfies NEW-MIN-1's intent (verify the Profile wiring) without invalidating the run's scope guardrails.

2. **`computeWindowStart` return signature** — design-v2 Contracts (lines 87-94) defined the return as `{ windowStartIso: string | undefined; windowStartMs: number | undefined }`. Conductor's NEW-MIN-2 guidance ("drop `windowStartIso` from the `computeWindowStart` return; the consumers only use `windowStartMs`. Simplify the helper to `(weeks, now) => number | undefined`") was followed. This is the Conductor's explicit directive, not an unsanctioned deviation — flagged here for traceability.

3. **`useExercisesThisWeek.nowKgByExercise` is NOT windowed** — the design contract is silent on whether the per-row `nowKg` should be filtered by `windowStartMs`. I left `nowKgByExercise` outside the window filter and added an inline comment noting the rationale: "Now" is always *this* ISO week (orthogonal to the window pref). Filtering `nowKg` by the window would make zero behavioural difference for any user whose configured window is ≥ 1 week (the current week is always ≥ the window start by construction), but would conflate the semantics. Confidence: HIGH that this matches the design intent (Hero copy is `Max = best of last N weeks · Now = this week · To PR = remaining` — "Now" wording does not reference the window).

No other deviations. Every kernel signature, copy string, and migration shape matches design-v2 verbatim.

## Soft callbacks made (during this implementation pass)

- None. No ambiguity blocked progress.

## Quality gates

- [x] `npm run typecheck` passed — "TypeScript: No errors found".
- [x] `npm run lint` passed — 0 errors, 1 pre-existing warning in `router.d.ts` (Expo-generated file, not touched by this change).
- [x] Relevant unit tests pass — `npm run test:unit` reports **268 tests / 268 passed / 16 test files**. Baseline was 229/229; this run adds 39 new tests (15 progress-page-math windowed, 3 session-verdict windowed, 4 volume-target windowed, 6 window-utils, 11 Profile smoke). All pre-existing lifetime-path tests are unchanged and still pass — `windowStartMs=undefined` regression-guard cases assert byte-identical numbers vs the lifetime path.
- [x] No new `any` types.
- [x] No new `// @ts-ignore`.
- [x] No stray `console.log`.

## Notes for Reviewer / Tester

- **Migration is SQL-only; no `db:push` was run.** Per the run brief, this run only authors the SQL file. Reviewer please verify the file compiles against the existing `user_preferences` schema (line 33-40 of `src/db/schema.ts` reflects the Drizzle-side change).
- **Cross-kernel anchor**: every windowing decision uses `session.started_at` numerically (`parseISO(...).getTime()`). The `bucketLifetimeWeeklyVolumes` dual-anchor exception (inclusion via `started_at`, bucket placement via `completed_at`) is documented in the kernel's JSDoc and covered by the cross-week regression cases (e) and (e2) in `tests/unit/progress-page-math.test.ts`.
- **Boundary semantics**: lower bound is inclusive (`>=`). Documented in `window-utils.ts` JSDoc and verified by the "exactly on boundary" cases in three test files.
- **`useLifetimeBestWeek` JSDoc updated**, name kept (MIN-2 acknowledgement). The hook still uses the lifetime cache key; the windowing is applied client-side at the kernel boundary.
- **Profile screen `accessibilityLabel`**: each segment includes a spelled-out label ("Last 10 weeks — compare against the trailing 10 ISO weeks") so VoiceOver doesn't read the abbreviation literally as "ten doubleyou". Verify on-device when running the Tester pipeline.
- **NEW-MIN-3 acknowledgement comment** lives in `app/(app)/progress/index.tsx` above the `<WeeklyVolumeStrip>` mount — flags the intentional visual asymmetry under narrow windows so a future implementer doesn't try to "fix" it.
- **iPhone SE/Mini visual check (MAJ-2 follow-through)**: design-v2 left this to Implementer review at the 320pt simulator preset. The four segments at `flex-1 rounded-md py-2` with 1-3 character labels comfortably fit a ~54pt budget — verified by static reasoning, recommend Tester confirm visually.
- **No e2e changes needed**: `tests/e2e/progress-page.spec.ts` runs under the default `weeks = 0` (lifetime) path; the hero literal "PR! +900 kg (was 1,500 kg)" is preserved because the lifetime path returns identical numbers when no user has opted in to windowing. Tester may add a windowed e2e scenario if desired (out of this implementation's scope).
