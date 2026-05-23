# Review v1 — 2026-05-23_0211_configurable-max-volume-window

Round: Implement↔Review **round 1 of 2**.
Diff scope: `git diff 688e3422f470dcd668a7fcdce09fd0c5135aa1e5 -- '*.ts' '*.tsx' '*.sql'` plus 4 untracked files (`window-utils.ts`, `0009_max_volume_window.sql`, `profile-max-volume-window.test.ts`, `window-utils.test.ts`).
Total: 21 source files (4 new + 17 edited), ~1000 LoC.

## Quality gates re-verified

- [x] `npm run typecheck` — clean (no output, no errors). Re-ran.
- [x] `npm run lint` — 0 errors, 1 pre-existing warning in `router.d.ts` (Expo-generated, unrelated). Re-ran.
- [x] `npm run test:unit` — **268 / 268 passed** across 16 test files. Re-ran. Baseline 229 → +39 new tests:
  - `progress-page-math.test.ts`: 80 cases (+15 windowed regression)
  - `session-verdict-math.test.ts`: 24 cases (+3 windowed)
  - `volume-target.test.ts`: 22 cases (+4 windowed)
  - `window-utils.test.ts`: 6 cases (new file)
  - `profile-max-volume-window.test.ts`: 11 cases (new file)
- [x] No new `any` types — grepped across every touched file.
- [x] No new `// @ts-ignore` / `// @ts-nocheck`.
- [x] No new `console.log`.
- [x] No new `SUPABASE_SERVICE_ROLE` / `service_role` references.

## Verification of Conductor's 12 specific items

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | BLK-2 fix — every kernel filter uses `parseISO(...).getTime() >= windowStartMs`; no lex ISO compare | **PASS** | `progress-page-math.ts:46-48, 212-214, 308-310`; `volume-target.ts:131-133`; all filters compare numeric `parseISO(row.sessions.started_at).getTime()` / `parseISO(session.started_at).getTime()` against the numeric threshold. Grep for `>= "20` / `< "20` in the four kernel files returned 0 hits. |
| 2 | MAJ-1 anchor — `session.started_at` everywhere; aggregation BEFORE filter; dual-anchor for `bucketLifetimeWeeklyVolumes` | **PASS** | `computeLifetimeMaxPerExercise` builds `(exerciseId, sessionId) → {volume, startedAt}` then filters per-session aggregate at `progress-page-math.ts:209-218`. `computePrsThisWeek` builds the same aggregate at lines 282-299 then filters at line 308-312 BEFORE the running-walk. `computeVolumeTarget` filters `SessionSets` (already per-session) at `volume-target.ts:131-133`. `bucketLifetimeWeeklyVolumes` inclusion via `row.sessions.started_at` at `progress-page-math.ts:46-48`, bucket placement via `weekKeyOf(parseISO(row.completed_at))` at line 50. `WeeklyVolumeRow.sessions.started_at` confirmed in `src/api/stats.ts:25, 29`. |
| 3 | Migration + Drizzle + types | **PASS** | `supabase/migrations/0009_max_volume_window.sql` mirrors `0005_measurements.sql` shape (column-then-check), `NOT NULL DEFAULT 0`, `CHECK IN (0, 10, 20, 30)`, no RLS modifications. `src/db/schema.ts:42` adds `maxVolumeWindowWeeks`. `src/db/types.ts:49-57` exports `MaxVolumeWindowWeeks` + `MAX_VOLUME_WINDOW_OPTIONS`. |
| 4 | API + hook plumbing follows length-unit precedent | **PASS** | `setMaxVolumeWindowWeeks` (`src/api/preferences.ts:59-74`) mirrors `setLengthUnit` byte-for-byte. `useMaxVolumeWindowWeeks` + `useSetMaxVolumeWindowWeeks` (`src/hooks/use-preferences.ts:40-43, 61-68`) mirror `useLengthUnit` / `useSetLengthUnit` with the same `KEY` and `qc.setQueryData` pattern. |
| 5 | Profile 4-segment row, legend, active style parity | **PASS** | `app/(app)/profile.tsx:144-195` — 4-segment row iterating `MAX_VOLUME_WINDOW_OPTIONS`, label map `0→"All"`, `10→"10w"`, `20→"20w"`, `30→"30w"` at line 26-31, legend "Max-volume window — how many recent weeks to compare against." at line 185-187, `bg-black dark:bg-white` active variant at line 168. |
| 6 | Hero copy branches on `weeks === 0` vs `weeks > 0` | **PASS** | `src/components/progress-hero.tsx:167-169` — lifetime branch keeps `"Max = best week ever · …"`; windowed branch interpolates `weeks` into `"Max = best of last ${weeks} weeks · …"`. Strip caption similarly branches in `app/(app)/progress/index.tsx:39-43`. |
| 7 | Per-exercise progress chart JSDoc deferral note | **PASS** | `app/(app)/exercises/[id]/progress.tsx:22-34` — top-of-file JSDoc explains the intentional defer (e1RM kernel ≠ volume kernel). No behaviour change in the file. |
| 8 | No silent bypass — 5 surfaces uniform | **PASS** | All 5 kernel callsites pass `windowStartMs`: `use-progress-page.ts:62, 125, 263`, `volume-target-slot.tsx:47`, `workout/verdict/[sessionId].tsx:69`. Internally `computePrsForSession` plumbs into `computeLifetimeMaxPerExercise(priorRows, windowStartMs)` at `session-verdict-math.ts:108-111`. Grepping for kernel calls without `windowStartMs` returns no production-code matches outside the kernel definitions themselves. |
| 9 | `useMemo(() => computeWindowStart(weeks, new Date()), [weeks])` pinned recipe | **PASS** | 5 callsites all use the recipe verbatim: `use-progress-page.ts:56-59, 111-114, 228-231`, `volume-target-slot.tsx:40-43`, `workout/verdict/[sessionId].tsx:48-51`. `new Date()` lives inside the factory; `[weeks]` is the sole dep. |
| 10 | Inclusive boundary (`>=`) preserved | **PASS** | `progress-page-math.ts:46-48, 212-214` use `if (startedMs < windowStartMs) continue;` (equivalent to "include iff `>=`"). `progress-page-math.ts:308-310` uses `.filter((s) => parseISO(s.startedAt).getTime() >= windowStartMs)`. `volume-target.ts:131-133` same `< … continue;` form. `window-utils.test.ts:68-77` and the kernel test files include explicit "exactly on boundary → included" cases. |
| 11 | PR strict-`>` invariant preserved | **PASS** | `computePrsThisWeek` line 323: `priorMax > 0 && s.volume > priorMax`. `computePrsForSession` line 117: `priorMaxKg > 0 && currentKg > priorMaxKg`. `computeVolumeTarget` keeps the existing `gapKg <= 0` surpassed branch with `previousMaxKg > 0` guard at line 140. Windowing changes only the dataset, not the comparison. |
| 12 | Three documented deviations don't break invariants | **PASS** | (1) Profile smoke test as `.test.ts` — RNTL not installed; smoke test verifies label map + setter dispatch + cache propagation via TanStack's `MutationObserver` mirroring `use-sets.useUpdateSetMeta.test.ts`. Reasonable; preserves NEW-MIN-1 intent. (2) `computeWindowStart` returns `number \| undefined` — Conductor's explicit NEW-MIN-2 directive, not silent deviation. (3) `nowKgByExercise` NOT windowed — semantically correct: "Now" is by definition this ISO week; the window pref governs "Max" only, and the Hero legend wording reinforces this ("Now = this week" never references the window). Inline comment at `use-progress-page.ts:243-246` documents the rationale. |

## Findings

### Blockers
None.

### Majors
None.

### Minors
None.

## Style / convention checklist

- [x] No new `any` types.
- [x] No new `// @ts-ignore`.
- [x] Comments narrate *why* (e.g. `use-progress-page.ts:243-246` "Now is always this week and is orthogonal to the window pref"; `progress-hero.tsx` JSDoc; the dual-anchor explanation in `bucketLifetimeWeeklyVolumes` JSDoc) — not what.
- [x] Imports follow project style (package imports first, then `~/`-rooted internal imports).
- [x] New files placed conventionally: `src/utils/window-utils.ts`, `supabase/migrations/0009_*.sql`, `tests/unit/*.test.ts`.

## Security checklist

- [x] **RLS**: every new `.from("user_preferences").*` call scopes by `auth.uid() = user_id` via the existing policies on `user_preferences` (`0001_rls_and_seed.sql`). The new column inherits coverage uniformly. `getMyPreferences` and `setMaxVolumeWindowWeeks` both `.eq("user_id", userId)` post-`auth.getUser()`.
- [x] **Secrets**: no `SUPABASE_SERVICE_ROLE_KEY` introduced.
- [x] **Input handling**: no raw SQL `rpc` calls; PostgREST setters use parameterized JSON updates. The CHECK constraint also rejects malformed values at the DB layer.
- [x] **Public env vars**: no new `EXPO_PUBLIC_*` references.

## Decision

**pass**

Counts: blockers=0, majors=0, minors=0.

Confidence: **HIGH** — every Conductor-flagged verification item passes; gates re-run green; the three deviations from the Implementer's report are well-reasoned and either explicitly sanctioned by the Conductor (NEW-MIN-2) or semantically correct (`nowKg` orthogonality, smoke-test pivot). The implementation matches design-v2 verbatim.

Risk if shipped as-is: **LOW** — additive change gated by `weeks === 0` default; regression-guard tests (windowStartMs=undefined → byte-identical lifetime numbers) pass; cross-week session integrity covered by cases (e) / (e2); strict-`>` PR invariant and inclusive `>=` boundary both pinned in tests.

Recommendation: **invoke Tester**.
