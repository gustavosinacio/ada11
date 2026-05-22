# Design v2 — 2026-05-22_0030_progress-page

> v2 == v1 + answers to every blocker + major from `validation-v1.md`. Each section flags `[v1-carryover]` (untouched) or `[changed-v2]` / `[new-v2]` (where this revision differs).

## Resposta a issues do Validator [new-v2]

### Blockers

#### BLK-1 — Cache key collision. **Decision: option (a) namespace.**

Every Progress-only query key lives under the `["stats", "progress-page", …]` prefix so the existing `qc.invalidateQueries({ queryKey: ["stats"] })` cascade in `useFinishSession`, `useUpdateSessionTimes`, and `useSoftDeleteSession` catches them for free. Rationale: option (a) is strictly safer than (b) — every existing mutation that already touches stats invalidates the Progress reads with zero code change in `use-sessions.ts`, so a future contributor adding a fourth stats-touching mutation will not accidentally regress the Progress page by forgetting to add a `["progress-page"]` line. Option (b) would also have required tracking down `useStartSession` (which does NOT currently invalidate `["stats"]` — see `use-sessions.ts:43-52`), and starting a session shouldn't normally affect the Progress page anyway since drafts don't count at the week level (so option (a) actually has more correct invalidation semantics than (b) for that case).

Bonus: `useSoftDeleteSession` (`use-sessions.ts:114-123`) invalidates `["stats"]` but NOT `["progress"]`. Under option (a) the Progress page refreshes correctly after a session delete; under option (b) we'd have to remember to add another line.

**Exact cache keys** (each pinned to file:line where it's read):

| Hook | Key | Read at |
|---|---|---|
| `useWeeklyVolume()` (existing 8-week strip) | `["stats", "weekly-volume", sinceUtc.slice(0,10)]` | `src/hooks/use-stats.ts:23` (unchanged) |
| `useLifetimeWeeklyVolume()` [new] | `["stats", "weekly-volume", "lifetime"]` | new — `src/hooks/use-stats.ts` |
| `useLifetimeBestWeek()` [new — `useMemo` over the row hook] | (no new key — derives from the lifetime hook above) | new — `src/hooks/use-progress-page.ts` |
| `usePrsThisWeek()` [new — `useMemo`] | (no new key — derives from lifetime rows + current ISO week range) | new — `src/hooks/use-progress-page.ts` |
| `useExercisesThisWeek()` [new — `useMemo`] | (no new key — derives from lifetime rows + `useAllExercises`) | new — `src/hooks/use-progress-page.ts` |
| `useFinishedSessionStartedAts()` [new] | `["stats", "progress-page", "session-started-ats"]` | new — `src/hooks/use-progress-page.ts` |
| `useStreaks()` [new — `useMemo` over `useFinishedSessionStartedAts`] | (no new key — derives) | new — `src/hooks/use-progress-page.ts` |

Note: every Progress-page raw fetch key starts with `["stats", …]`. `useStreaks` does NOT live under `["sessions"]` even though "sessions" is the source table — because the streak query is a derived view of progress data and we want the same single-prefix invalidation contract. The existing `["sessions"]` cascade in `useFinishSession`/`useStartSession` is irrelevant to streak math because: (a) the streak counts FINISHED sessions only, so `useStartSession` shouldn't refresh it; (b) `useFinishSession` already invalidates `["stats"]`, which covers `["stats", "progress-page", "session-started-ats"]`. This drops MIN-4's suggested `["sessions", "started-ats", "lifetime"]` in favour of `["stats", "progress-page", "session-started-ats"]` — same single-prefix discipline.

**Exact existing call sites that already cover the new keys (verified):**

- `src/hooks/use-sessions.ts:62` — `useFinishSession` → `qc.invalidateQueries({ queryKey: ["stats"] })`. Covers `["stats", "weekly-volume", "lifetime"]` and `["stats", "progress-page", "session-started-ats"]`.
- `src/hooks/use-sessions.ts:108` — `useUpdateSessionTimes` → `qc.invalidateQueries({ queryKey: ["stats"] })`. Same coverage.
- `src/hooks/use-sessions.ts:121` — `useSoftDeleteSession` → `qc.invalidateQueries({ queryKey: ["stats"] })`. Same coverage.
- `useStartSession` (`use-sessions.ts:43-52`) does NOT invalidate `["stats"]`. This is correct — starting a session creates a draft that does not appear in any Progress block. No change needed.

No edits to `use-sessions.ts`.

#### BLK-2 — Chart y-axis denominator. **Decision: max-aware denominator.**

Old (broken) formula at `weekly-volume-strip.tsx:114-117`:

```ts
const h = model.maxKg === 0
  ? MIN_BAR_HEIGHT
  : Math.max(MIN_BAR_HEIGHT, Math.round((b.totalKg / model.maxKg) * PLOT_HEIGHT));
```

New formula (applies only when `bestWeekKg` is passed, i.e. on Progress; History mount unchanged):

```ts
const denom = Math.max(model.maxKg, bestWeekKg ?? 0);
const h = denom === 0
  ? MIN_BAR_HEIGHT
  : Math.max(MIN_BAR_HEIGHT, Math.round((b.totalKg / denom) * PLOT_HEIGHT));
```

Overlay-line y-position (the dotted line) lives in the same plot box:

```ts
// y is measured from the TOP of the plot box. PLOT_HEIGHT = 96.
const overlayY = denom === 0
  ? PLOT_HEIGHT
  : PLOT_HEIGHT - Math.round(((bestWeekKg ?? 0) / denom) * PLOT_HEIGHT);
```

Properties of this formula:

- When `bestWeekKg <= model.maxKg` (lifetime best is inside the visible 8-week window): `denom = model.maxKg`, bars look identical to the History mount, overlay sits ON TOP of the tallest bar (at `y = 0` if the tallest visible week IS the lifetime best, else partway up).
- When `bestWeekKg > model.maxKg` (the common Progress case — lifetime best predates the 8-week window): `denom = bestWeekKg`, bars are scaled DOWN proportionally (so the user can read "this week is short of my all-time high"), overlay sits at the very top edge (`y = 0`).
- When `bestWeekKg` is undefined or 0 (the History mount): `denom = model.maxKg`, formula degrades to the EXACT existing height formula. Byte-identical to today's behaviour. No History regression possible.

New unit test added (test #36 in the plan): "bars shrink proportionally when bestWeekKg > 8-week max" — see Test plan section.

### Majors

#### MAJ-1 — Pagination pseudocode (inline, no dangling pointer).

Removed the `scripts/import-strong.ts:38-58` pointer (file deleted in `2026-05-21_2330_strong-import-setnumber`). Algorithm is now inline in this design. Implementer copies this block into the `else` branch of `listWeeklyVolumeRows`:

```ts
// src/api/stats.ts — inside listWeeklyVolumeRows, when sinceUtc is omitted
// (lifetime read). PostgREST silently truncates at 1000 rows unless the
// client paginates explicitly via `.range()`; this loop walks through every
// page until a short page (or empty page) signals end-of-data.
const PAGE = 1000;
let from = 0;
const all: WeeklyVolumeRow[] = [];
while (true) {
  const { data, error } = await supabase
    .from("sets")
    .select(
      "completed_at, weight, reps, set_type, exercise_id, session_id, sessions!inner(started_at, ended_at)",
    )
    .is("deleted_at", null)
    .not("sessions.ended_at", "is", null)
    .neq("set_type", "warmup")
    .order("completed_at", { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) throw error;
  const page = (data ?? []) as unknown as WeeklyVolumeRow[];
  all.push(...page);
  if (page.length < PAGE) break;
  from += PAGE;
}
return all;
```

The `sinceUtc`-provided branch keeps a single-shot query (no pagination) because callers only use that branch for ≤8 weeks of data — well under 1000 rows even for a high-volume user.

Doc precedent updated: this design now cites `docs/runs/2026-05-20_0127_import-strong-csv/regression-report.md` instead of the removed script. The Implementer can read that report for prose context on the silent-truncation behaviour PostgREST exhibits; the pseudocode above is the load-bearing artifact, not the doc.

#### MAJ-2 — Replace embedded-resource filter with `completed_at` filter on the sets table.

Old (unverified) v1 plan for `listSetsThisWeek`:

```ts
.gte("sessions.started_at", weekStartIso)
.lte("sessions.started_at", weekEndIso)
```

New v2 query for `listSetsThisWeek`:

```ts
supabase
  .from("sets")
  .select(
    "*, sessions!inner(id, started_at, ended_at), exercises!inner(id, name, muscles, deleted_at)",
  )
  .is("deleted_at", null)
  .not("sessions.ended_at", "is", null)
  .neq("set_type", "warmup")
  .gte("completed_at", opts.weekStartIso)
  .lte("completed_at", opts.weekEndIso)
  .order("completed_at", { ascending: true });
```

**Why this is semantically equivalent** for the Progress page's purpose:

- For any finished session, `started_at <= set.completed_at <= ended_at`. Sessions in this app are almost always ≤24h (the UI guides a single workout, and there's no "long-running" use case — verified by `update-session-times` semantics in `use-sessions.ts:92-112` and the in-product UX). So for ≥99% of sessions, "session.started_at falls in the week" ⇔ "every set's completed_at falls in the week".
- The pattern `.gte("completed_at", since).lte("completed_at", until)` is the **verified PostgREST idiom** used by the existing 8-week strip's `listWeeklyVolumeRows` (`src/api/stats.ts:29`). That's a known-working pattern, not a guess.
- The Implementer never has to debug embedded-resource filter syntax (which Supabase JS typically requires via `{ referencedTable: "sessions" }` or URL-fragment syntax — neither documented elsewhere in this codebase).

**Edge case — session crosses midnight on a week boundary**:
- A session that starts Sunday 23:30 BRT and finishes Monday 00:15 BRT has its earlier sets in ISO week W (Sun belongs to W) and its later sets in ISO week W+1 (Mon belongs to W+1).
- The Progress page would credit each set to the ISO week its `completed_at` falls in. That's the SAME convention as the existing `weekly-volume-strip.tsx:43-51` bucketing (`weekKeyOf(parseISO(row.completed_at))`).
- This is a feature, not a bug. A user who finishes a back-extension set at 00:15 Monday legitimately did training in the new ISO week. The History strip already operates this way, so the Progress page just inherits the same convention.
- For the per-exercise list ("exercises trained this week"), if the cross-midnight session straddles weeks, the same exercise can appear in two consecutive weeks' Progress pages. This is correct — they trained that exercise in both weeks.

#### MAJ-3 — Add single-prior-session PR boundary tests.

Added to the test plan (see Test plan section, tests #36b and #36c — re-numbered alongside the BLK-2 max-aware test #36a):

- **Test "One prior session at 500 kg, current-week session at 600 kg → 1 PR"**: exercise has exactly one prior finished session contributing 500 kg per-session-volume (started_at BEFORE the current ISO week). Current week has one session contributing 600 kg per-session-volume. Expected `countPrsThisWeek(...) === 1`.
- **Test "One prior session at 500 kg, current-week session at 400 kg → 0 PRs"**: same setup but current week's session contributes only 400 kg per-session-volume. Expected `countPrsThisWeek(...) === 0`.

These tests sit alongside the existing #16 (two prior, beat) and #17 (two prior, no beat), and they pin the off-by-one ("does priorMax compare > or >=?") for the single-prior case explicitly. The algorithm uses `volume > priorMax` (strict), so 400 vs 500 doesn't trip and 600 vs 500 does.

### Minors (brief acknowledgement)

- **MIN-1** — `weekly-volume-bucketing.test.ts` does NOT have a `mkRow` factory (verified: the file uses an inline narrow `Row` type at line 14-18 that omits `exercise_id`/`session_id`). The augmentation to `WeeklyVolumeRow` is additive, and the existing test's inline `Row` is structurally a subset, so the test continues to compile and pass without edits. v1's "edit the test factory" instruction is dropped from v2's file list.
- **MIN-2** — `computeStreaks` test #34 gains a docstring locking the rule: "current streak does NOT reset while the current ISO week is in progress with no sessions — only resets when the next ISO week begins. The Sunday-night → Monday-morning boundary is the point of recalculation." A new test #34b verifies "Sunday 23:59 of an empty current week, last week empty too → current = 0" (the rule still produces 0 because last week didn't qualify either — confirming the soft-fallback is not unbounded).
- **MIN-3** — Cold-start latency claim (~2.5s for a 3-year user) is documented as unmeasured. Implementer instruction: benchmark `useLifetimeWeeklyVolume` cold-start on a real production account during Implement. Document the measurement in `implementation.md`. Fallback trigger: if measured P95 > 5s on the test device, surface back to Designer (soft-callback to Designer round-2 budget) for Option B swap.
- **MIN-4** — `["sessions", "started-ats", "lifetime"]` from the Validator's suggestion is REPLACED by `["stats", "progress-page", "session-started-ats"]` to match BLK-1's single-prefix discipline. See BLK-1 table.
- **MIN-5** — Per-block skeletons during loading. Each Progress block (`<ProgressHero>`, `<WeeklyVolumeStrip>`, `<ExercisesThisWeekList>`, `<StreakCard>`) MUST render its own skeleton matching the `<WeeklyVolumeStrip>:81-89` precedent (gray-100/gray-900 `<View>` blocks at the same dimensions as the loaded chrome). Spec'd inline in the file list below.
- **MIN-6** — Documented: the existing 8-week `<WeeklyVolumeStrip>` query (`useWeeklyVolume`, key `["stats", "weekly-volume", <since-date>]`) still runs IN PARALLEL with the new lifetime read on the Progress page, because the strip component owns its own data fetch. Implementer must NOT refactor the strip to take rows as a prop — the parallel queries are intentional (cache reuse: History tab keeps the 8-week query warm, Progress mount adds the lifetime query, both share TanStack cache so navigating between tabs is instant after first paint). Total Progress cold-start parallel queries: 4 (lifetime weekly, 8-week weekly, finished-session started_ats, full exercises library).
- **MIN-7** — `findBestWeek` tie behaviour: **oldest week wins on ties**. Justification: server-side `.order("completed_at", { ascending: true })` (`stats.ts:30`) means the paginated lifetime read returns rows in ascending order; `bucketWeeklyVolumes` iterates in insertion order; `findBestWeek` iterates the Map in insertion order and uses strict `>` (not `>=`), so the FIRST max value seen wins, i.e. the OLDEST week. Test #12 updated in the plan: instead of "callers shouldn't depend on tie behaviour", lock it as "oldest week (first by insertion order) wins on ties".

---

## Goal (1 sentence) [v1-carryover]

Ship a new bottom-tab "Progress" screen that aggregates four blocks (hero with PRs-this-week + weekly volume `Max · Now · To PR`, a richer 8-bar weekly histogram with a lifetime-best overlay, a per-muscle list of exercises trained this ISO week with per-row `Max · Now · To PR`, and a streak card) — all anchored to lifetime bests, with no schema change.

## Approach [partial-change-v2]

Treat this as a **read-only dashboard composed of four independent kernels that all share a single lifetime-volume dataset**. The architecturally interesting choice is how to obtain the lifetime view of `WeeklyVolumeRow`s without tripping PostgREST's silent 1000-row truncation; everything else (PR count, streak math, muscle grouping) is downstream arithmetic on data the app already has.

Decisions across the seven Conductor calls — all v1 calls carried over verbatim except where BLK/MAJ forced a change:

1. **Lifetime-best week kernel — option (A) paginated** [v1-carryover, **MAJ-1 changed pseudocode source**]. Extend `listWeeklyVolumeRows` to accept `sinceUtc?: string` (now optional) and add an internal pagination loop using `.range(from, from + PAGE - 1)`. v1 cited `scripts/import-strong.ts:38-58` for the precedent loop — that file no longer exists; v2 spells the loop INLINE in MAJ-1 above (and again in Contratos de I/O). No schema artifact, no migration, no RPC. Cache key `["stats", "weekly-volume", "lifetime"]` sits under the `["stats"]` prefix so existing invalidations cascade (BLK-1).

2. **Muscle-grouping rule — (a) `muscles[0]` as grouping key** [v1-carryover]. One row per exercise, lives in the user's first-listed muscle. Empty `muscles` → group label `"Other"`. Soft-deleted exercises with sets in the current week still appear.

3. **PR-this-week count semantics** [v1-carryover]:
   - PR = a (session, exercise) pair whose `sumPastVolume(session.sets)` strictly exceeds the maximum `sumPastVolume` of every prior finished session for that same exercise.
   - First-ever session for an exercise: NOT a PR (no prior baseline). Matches `volume-target.ts:124-126`'s `no-pr` semantic.
   - Per-exercise dedupe within the current ISO week: count as 1 even if multiple sessions beat the prior best.
   - Warmups excluded.
   - Soft-deleted exercises whose set hits a PR this week still count.

4. **Chart richness — same 8-bar histogram + dotted lifetime-best overlay** [partial-change-v2]:
   - **[changed-v2 per BLK-2]** Bar heights and overlay y-position use `denom = Math.max(model.maxKg, bestWeekKg ?? 0)`, not `model.maxKg` alone. When `bestWeekKg > model.maxKg`, all bars rescale DOWN and the overlay sits at the top edge. When `bestWeekKg <= model.maxKg`, the layout is identical to the History mount.
   - [v1-carryover] Two optional props on the existing `<WeeklyVolumeStrip>`: `bestWeekKg?: number; bestWeekLabel?: string`. History mount passes neither — byte-identical render.
   - [v1-carryover] We do NOT widen the window beyond 8 weeks.

5. **Streak math** [v1-carryover]:
   - Trained week = ISO week with ≥1 finished session.
   - Current streak: soft-fallback. If the current week is empty AND last week qualified, `current` = the count ending at last week.
   - Best streak: longest such run across full history.
   - Display logic per v1 Decision #5.

6. **Empty / early-week copy** [v1-carryover]: per v1 — Hero/list/streak each have their own empty-state copy.

7. **Tab icon — `TrendingUp`** [v1-carryover].

The "outlier peak week" tradeoff is accepted per prompt. The softening swap to trailing-12 max is left as a TODO comment in the kernel for future-Designer.

## Decisions on unknowns [v1-carryover with one revision]

| # | Unknown | Decision | Rationale | Change vs v1 |
|---|---|---|---|---|
| 1 | Multi-muscle exercise → which group? | `muscles[0]` only | Conductor lean | v1-carryover |
| 2 | Empty `muscles` array → group label? | `"Other"` | Neutral | v1-carryover |
| 3 | Multiple PRs same exercise same week → count? | 1 per exercise per week | Conductor lean | v1-carryover |
| 4 | First-ever session for an exercise → PR? | NOT a PR | Matches `volume-target.ts:124-126` | v1-carryover |
| 5 | Lifetime-best vs trailing-12 anchor | Lifetime-best | Per prompt | v1-carryover |
| 6 | Lifetime weekly volume — extend query or new RPC? | Extend, paginated reads | Conductor lean; loop now inline (MAJ-1) | partial-change-v2 (pseudocode source) |
| 7 | Chart richness | 8-bar histogram + dotted overlay | Conductor lean; **denominator is now `max(model.maxKg, bestWeekKg)`** (BLK-2) | partial-change-v2 (formula fixed) |
| 8 | Streak render when both = 0 | Inline CTA in card | Discoverable | v1-carryover |
| 9 | Tab icon | `TrendingUp` | Conductor | v1-carryover |
| 10 | Drafts in weekly hero | Never count (server-side filter) | Discovery #10 | v1-carryover |
| 11 | **[new-v2]** Cache key namespace | `["stats", "progress-page", …]` for raw fetches; derived hooks reuse parent keys via `useMemo` | BLK-1 option (a) | new-v2 |
| 12 | **[new-v2]** `findBestWeek` tie behaviour | Oldest week wins | Server-side ASC + insertion-order Map + strict `>` | new-v2 (MIN-7) |

## Mudanças por arquivo [partial-change-v2 — file list, BLK/MAJ-level revisions inside each entry]

| File | Type | Change |
|---|---|---|
| `app/(app)/_layout.tsx` | edited | [v1-carryover] Add a 5th `<Tabs.Screen name="progress" options={{ title: "Progress", tabBarIcon: ({color, size}) => <TrendingUp color={color} size={size} /> }} />` between `history` and `measurements`. Add `TrendingUp` to the `lucide-react-native` import. No other changes. |
| `app/(app)/progress/_layout.tsx` | new | [v1-carryover] One-line `<Stack screenOptions={{ headerShown: false }} />`. |
| `app/(app)/progress/index.tsx` | new | [v1-carryover] Page body composing `<ProgressHero>`, `<WeeklyVolumeStrip bestWeekKg=… bestWeekLabel=…>`, `<ExercisesThisWeekList>`, `<StreakCard>` inside a `<ScrollView refreshControl=…>`. |
| `src/api/stats.ts` | edited | [changed-v2 per MAJ-1] Make `sinceUtc` optional. When provided, behaviour unchanged. When omitted, run the paginated loop spelled out in MAJ-1 above (PAGE=1000, `while (true) { range(from, from+PAGE-1); if (page.length < PAGE) break; from += PAGE; }`). [changed-v2 per single-lifetime-kernel design carryover] `select(...)` gains `exercise_id, session_id`. |
| `src/hooks/use-stats.ts` | edited | [v1-carryover, **MIN-4 key pinned**] Add `useLifetimeWeeklyVolume()` with cache key `["stats", "weekly-volume", "lifetime"]`. `staleTime: 60_000`. |
| `src/api/progress-page.ts` | new | [partial-change-v2 per MAJ-2] (a) `listSetsThisWeek({ weekStartIso, weekEndIso })` — uses `.gte("completed_at", weekStartIso).lte("completed_at", weekEndIso)` on the sets table directly (NOT embedded-resource filter on sessions). (b) `listFinishedSessionStartedAts()` — minimal projection, paginated for safety. Both queries enumerated under Contratos de I/O. |
| `src/hooks/use-progress-page.ts` | new | [partial-change-v2 per BLK-1 + MIN-4] Six exports: `useLifetimeBestWeek()`, `usePrsThisWeek()`, `useStreaks()`, `useExercisesThisWeek()`, `useFinishedSessionStartedAts()`, `useProgressPageRefresh()`. Cache keys per BLK-1 table. Derived hooks (`useLifetimeBestWeek`, `usePrsThisWeek`, `useExercisesThisWeek`, `useStreaks`) are pure `useMemo`s on top of `useLifetimeWeeklyVolume` / `useFinishedSessionStartedAts` / `useAllExercises`. |
| `src/utils/progress-page-math.ts` | new | [v1-carryover] Pure helpers — `bucketWeeklyVolumes`, `findBestWeek`, `countPrsThisWeek`, `groupExercisesByPrimaryMuscle`, `computeStreaks`. [new-v2] `findBestWeek` returns the OLDEST tied week (Map insertion order + strict `>`). |
| `src/components/weekly-volume-strip.tsx` | edited | [changed-v2 per BLK-2] Add two optional props `bestWeekKg?: number; bestWeekLabel?: string`. Bar-height formula becomes `denom = Math.max(model.maxKg, bestWeekKg ?? 0); h = denom === 0 ? MIN : Math.max(MIN, Math.round((b.totalKg / denom) * PLOT_HEIGHT))`. Overlay y-position: `overlayY = denom === 0 ? PLOT_HEIGHT : PLOT_HEIGHT - Math.round(((bestWeekKg ?? 0) / denom) * PLOT_HEIGHT)`. Overlay renders as an `absolute`-positioned `<View>` with `borderBottomWidth: 1`, `borderStyle: "dashed"`, full width across the plot area, plus a `<Text>` label below the date-label row. When `bestWeekKg` is undefined or 0 (History mount), `denom === model.maxKg` and the layout is byte-identical to current. |
| `src/components/progress-hero.tsx` | new | [v1-carryover] Hero block — eyebrow + PR count + divider + `Max · Now · To PR` row. [new-v2 per MIN-5] When `useLifetimeWeeklyVolume().isLoading`, render a per-block skeleton (matches `weekly-volume-strip.tsx:82-89` idiom: gray-100/gray-900 `<View>` blocks at the same dimensions). |
| `src/components/exercises-this-week-list.tsx` | new | [v1-carryover] Per-muscle list, section headers per `history/week/[isoWeek].tsx:23-24`, rows via `<MaxNowToPrLine>`. [new-v2 per MIN-5] Loading skeleton: 4 gray rectangle rows. |
| `src/components/streak-card.tsx` | new | [v1-carryover] Border card with streak math output. [new-v2 per MIN-5] Loading skeleton: card chrome + 2 gray text-block placeholders. |
| `src/components/max-now-to-pr-line.tsx` | new | [v1-carryover] Shared display helper (props: `{ maxKg, nowKg, gapKg, unit, a11yPrefix }`). Not used to refactor `<VolumeTargetSlot>` (out of scope). |
| `tests/unit/progress-page-math.test.ts` | new | [partial-change-v2 per BLK-2 + MAJ-3 + MIN-2 + MIN-7] All v1 tests + 3 new BLK-2/MAJ-3 tests + 1 new MIN-2 streak test + 1 strengthened MIN-7 tie test. Full list in Test plan. |
| `tests/e2e/progress-page.spec.ts` | new | [v1-carryover] Empty user, populated user golden path, per-row navigation, early-week empty states, PR badge smoke, 5-tab regression. |
| `tests/unit/weekly-volume-bucketing.test.ts` | NO EDIT [partial-change-v2 per MIN-1] | v1 said "add `exercise_id` + `session_id` to `mkRow` factory and add a sanity test". v2 corrects: there is no `mkRow` factory; the file uses an inline narrow `Row` type at line 14-18 that omits the new columns. The augmented `WeeklyVolumeRow` is a strict superset, so existing rows are structurally compatible. **No edit needed.** |
| `docs/features.md` | edited (Conductor concern, post-merge) | [v1-carryover] Move bullet from "[ ]" to "## Done" after shipping. Not touched by Implementer. |

No changes to: `src/api/progress.ts`, `src/utils/volume-target.ts`, `src/utils/dates.ts`, `src/utils/units.ts`, `src/db/schema.ts`, RLS policies, the active-session banner, `useSessions`/`useStartSession`/`useFinishSession`/`useSoftDeleteSession`/`useUpdateSessionTimes` cache-invalidation wiring (BLK-1 explicitly relies on the existing `["stats"]` cascade at `use-sessions.ts:62, 108, 121`).

## Contratos de I/O [partial-change-v2]

### `src/api/stats.ts` (edited) — [changed-v2 per MAJ-1 + single-lifetime-kernel carryover]

```ts
export type WeeklyVolumeRow = {
  completed_at: string;
  weight: string | null;
  reps: number | null;
  set_type: SetType;
  exercise_id: string;   // [v1-carryover] needed for PR + per-exercise math
  session_id: string;    // [v1-carryover] needed for "best single-session volume per exercise"
  sessions: { started_at: string; ended_at: string };
};

/**
 * Reads finished, non-warmup, non-deleted sets.
 *
 * When `sinceUtc` is provided, filters `completed_at >= sinceUtc` and issues
 * a single-shot read (existing 8-week strip behaviour; ≤1000 rows expected).
 *
 * When `sinceUtc` is omitted, iterates paginated `.range(from, from + PAGE - 1)`
 * until a short page returns. Required because PostgREST silently truncates at
 * 1000 rows. Pseudocode locked in design-v2 MAJ-1; precedent doc at
 * `docs/runs/2026-05-20_0127_import-strong-csv/regression-report.md`.
 */
export async function listWeeklyVolumeRows(opts: {
  sinceUtc?: string;
}): Promise<WeeklyVolumeRow[]>;
```

The select string is `"completed_at, weight, reps, set_type, exercise_id, session_id, sessions!inner(started_at, ended_at)"` in BOTH branches. The order clause `.order("completed_at", { ascending: true })` applies in both branches (and is the basis for MIN-7's tie behaviour).

### `src/hooks/use-stats.ts` (edited) — [v1-carryover, MIN-4 key pinned]

```ts
export function useWeeklyVolume(): UseQueryResult<WeeklyVolumeRow[], Error>;
//  ^^^ unchanged signature, unchanged key, unchanged behaviour

export function useLifetimeWeeklyVolume(): UseQueryResult<WeeklyVolumeRow[], Error>;
//  cache key: ["stats", "weekly-volume", "lifetime"]
//  staleTime: 60_000
//  queryFn:   () => listWeeklyVolumeRows({}) // sinceUtc omitted → paginated
```

Both keys sit under the `["stats"]` prefix; the existing invalidation cascade in `useFinishSession` (`use-sessions.ts:62`) covers both.

### `src/api/progress-page.ts` (new) — [partial-change-v2 per MAJ-2]

```ts
import type { ExerciseRow, SetRow } from "~/db/types";

/**
 * Joined row shape for "exercises trained this ISO week". Includes the
 * exercise's library row so the list can render name + muscles even for
 * soft-deleted exercises (matches `history/[id].tsx` convention).
 */
export type ThisWeekSetRow = SetRow & {
  sessions: { id: string; started_at: string; ended_at: string };
  exercises: Pick<ExerciseRow, "id" | "name" | "muscles" | "deleted_at">;
};

/**
 * Reads all finished, non-deleted, non-warmup sets whose `completed_at`
 * falls inside the given ISO-week window. Window bounds are local Monday
 * 00:00:00.000 and Sunday 23:59:59.999 (from `isoWeekStart` / `endOfWeek`).
 * Pagination not needed at week granularity (worst-case ~150 sets/week).
 *
 * v2 NOTE: per MAJ-2, we filter on the sets table's own `completed_at`
 * column, not on the embedded `sessions.started_at` resource. Semantically
 * equivalent for finished sessions (every set's completed_at lies inside
 * its session's started_at→ended_at window, which is itself ≤24h for
 * almost every workout), and uses the verified PostgREST idiom from
 * `stats.ts:29`.
 */
export async function listSetsThisWeek(opts: {
  weekStartIso: string; // ISO string of local Monday 00:00:00.000
  weekEndIso: string;   // ISO string of local Sunday 23:59:59.999
}): Promise<ThisWeekSetRow[]>;

/**
 * Minimal projection for streak math: every finished, non-deleted session's
 * `started_at`. Lifetime scope; paginated read via `.range()` for safety
 * (a 3-year user has ~500 sessions, well under 1000, but the loop costs
 * nothing if data ever grows beyond).
 */
export async function listFinishedSessionStartedAts(): Promise<
  { started_at: string }[]
>;
```

Underlying queries:

```ts
// listSetsThisWeek — v2 query [changed-v2 per MAJ-2]:
supabase
  .from("sets")
  .select(
    "*, sessions!inner(id, started_at, ended_at), exercises!inner(id, name, muscles, deleted_at)",
  )
  .is("deleted_at", null)
  .not("sessions.ended_at", "is", null)
  .neq("set_type", "warmup")
  .gte("completed_at", opts.weekStartIso)
  .lte("completed_at", opts.weekEndIso)
  .order("completed_at", { ascending: true });
// NOTE: exercises!inner NOT filtered by deleted_at — soft-deleted exercises
// still appear in this week's history (precedent: history/[id].tsx:45).

// listFinishedSessionStartedAts — paginated read [v1-carryover]:
const PAGE = 1000;
let from = 0;
const all: { started_at: string }[] = [];
while (true) {
  const { data, error } = await supabase
    .from("sessions")
    .select("started_at")
    .is("deleted_at", null)
    .not("ended_at", "is", null)
    .order("started_at", { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) throw error;
  const page = (data ?? []) as { started_at: string }[];
  all.push(...page);
  if (page.length < PAGE) break;
  from += PAGE;
}
return all;
```

RLS: both queries scope by `auth.uid() = user_id` via existing policies. No new policy.

### `src/hooks/use-progress-page.ts` (new) — [partial-change-v2 per BLK-1 + MIN-4]

```ts
import type { UseQueryResult } from "@tanstack/react-query";
import type { MuscleGroup, ExerciseRow } from "~/db/types";

/** Lifetime-best ISO week. `null` for empty history. */
export function useLifetimeBestWeek(): {
  data: { isoWeekKey: string; weekStartLabel: string; totalKg: number } | null;
  isLoading: boolean;
  isError: boolean;
};
// Implementation: `useMemo` over `useLifetimeWeeklyVolume()`. No new cache key.

/**
 * Count of distinct exercises that hit a new lifetime-best per-session volume
 * during the current ISO week. Returns `0` while loading or on empty history.
 * Implementation: `useMemo` over `useLifetimeWeeklyVolume()` rows + current
 * ISO week range from `dates.ts`'s helpers. No new cache key.
 */
export function usePrsThisWeek(): { data: number; isLoading: boolean; isError: boolean };

/**
 * Lifetime read of every finished, non-deleted session's `started_at`.
 * Cache key: ["stats", "progress-page", "session-started-ats"]
 * staleTime: 60_000
 */
export function useFinishedSessionStartedAts():
  UseQueryResult<{ started_at: string }[], Error>;

/**
 * Current + best consecutive-ISO-week streak. Soft-fallback per v1 Decision
 * #5: if current ISO week is empty but last week qualified, `current` ==
 * last-week-ending count.
 * Implementation: `useMemo` over `useFinishedSessionStartedAts()`. No new key.
 */
export function useStreaks(): { data: { current: number; best: number }; isLoading: boolean; isError: boolean };

/**
 * Exercises trained this ISO week, grouped by `muscles[0]` (or "Other"), with
 * per-row Max·Now·To PR pre-computed. Now = sum across all this week's
 * sessions. Max = lifetime best single-session volume for that exercise. Gap
 * = max(Max - Now, 0). isPrThisWeek = the per-exercise PR flag.
 * Implementation: `useMemo` over `useLifetimeWeeklyVolume()` + `useAllExercises()`.
 * No new cache key — derives from existing.
 */
export type ExerciseThisWeekRow = {
  exerciseId: string;
  exerciseName: string;
  muscles: string[];
  group: MuscleGroup | "Other";
  maxKg: number;
  nowKg: number;
  gapKg: number;
  isPrThisWeek: boolean;
};

export function useExercisesThisWeek(): { data: ExerciseThisWeekRow[]; isLoading: boolean; isError: boolean };

/**
 * Pull-to-refresh fan-out. Invalidates ["stats"] + ["exercises"] (covers every
 * underlying query under BLK-1's namespace decision — every Progress-page key
 * lives under ["stats", "progress-page", …] or ["stats", "weekly-volume", …]
 * or is a useMemo derivation that follows its parent).
 */
export function useProgressPageRefresh(): {
  refreshing: boolean;
  onRefresh: () => Promise<void>;
};
```

**Implementation note — single lifetime kernel** [v1-carryover]: to avoid two parallel lifetime reads, `WeeklyVolumeRow` is augmented to include `exercise_id` and `session_id`. The single lifetime dataset feeds `useLifetimeWeeklyVolume()` (chart + hero), `usePrsThisWeek()` (PR count), and `useExercisesThisWeek()` (per-exercise list's lifetime maxes). Network: 1 paginated lifetime query (`useLifetimeWeeklyVolume`) + 1 paginated lifetime sessions query (`useFinishedSessionStartedAts`) + 1 weekly-window query (`useExercisesThisWeek` indirectly via the lifetime rows filtered client-side OR via `listSetsThisWeek` — Implementer call; default = derive from lifetime rows to save a round-trip) + library reads via `useAllExercises` + the existing 8-week query from the embedded `<WeeklyVolumeStrip>`. All queries fire in parallel.

Cache invalidation [changed-v2 per BLK-1]: `["stats"]` prefix on `useFinishSession`/`useUpdateSessionTimes`/`useSoftDeleteSession` invalidates all four Progress-page raw fetches because every key sits under `["stats", …]`. `["exercises"]` (already invalidated by existing exercise mutations) covers the library read.

### `src/utils/progress-page-math.ts` (new) — [v1-carryover, MIN-7 strengthened]

```ts
import type { MuscleGroup, ExerciseRow } from "~/db/types";
import type { WeeklyVolumeRow } from "~/api/stats";

export function bucketWeeklyVolumes(
  rows: WeeklyVolumeRow[],
): Map<string, number>;
// Buckets `rows` into `weekKeyOf(parseISO(completed_at))` using the canonical
// `volume = parseFloat(weight) * reps` kernel with `w > 0 && r > 0` guard.
// Warmups assumed already filtered server-side.

export function findBestWeek(
  buckets: Map<string, number>,
): { isoWeekKey: string; weekStartLabel: string; totalKg: number } | null;
// Returns (key, kg, label) of the highest-volume bucket. Label = "M/d" of
// the local Monday. Returns `null` for empty input OR all-zero buckets.
// TIE BEHAVIOUR (MIN-7): iterate buckets in insertion order using strict `>`.
// Server-side .order("completed_at", { ascending: true }) means insertion
// order is oldest→newest, so the OLDEST tied week wins.

export function countPrsThisWeek(opts: {
  rows: WeeklyVolumeRow[]; // lifetime; carries exercise_id, session_id, sessions.started_at
  currentWeekStartIso: string;
  currentWeekEndIso: string;
}): number;
// Algorithm:
// 1. Group rows by (exercise_id, session_id), reduce to a single volume.
// 2. For each exercise, sort sessions ASC by started_at. Compute running
//    priorMax per session (= max of all earlier sessions' volumes; starts at 0).
// 3. A session "is a PR" iff volume > priorMax. The first-ever session has
//    priorMax = 0 and is NOT a PR (volume > 0 would be true but we explicitly
//    require a non-zero priorMax — matches volume-target.ts:124-126).
// 4. Dedupe to one PR per exercise per week: if exercise has ≥1 PR session
//    in [currentWeekStartIso, currentWeekEndIso], count it as 1.

export function groupExercisesByPrimaryMuscle(
  exercises: ExerciseRow[],
): Map<MuscleGroup | "Other", ExerciseRow[]>;

export function computeStreaks(
  sessions: { started_at: string }[],
  now: Date,
): { current: number; best: number };
// Decision #5:
// - If the current ISO week has ≥1 session, `current` includes it.
// - If empty AND last week qualified, `current` = last-week-ending count
//   (soft-fallback; current streak does NOT reset until the empty week ENDS,
//   i.e. until the next ISO week begins — MIN-2 docstring lock).
// - If empty AND last week didn't qualify, `current = 0`.
// - `best` is the longest run across all history (current run can be best).
```

### UI prop shapes — [partial-change-v2 per BLK-2]

`<WeeklyVolumeStrip>` (edited):

```ts
type Props = {
  /** Lifetime-best-week kg. When > 0 AND provided:
   *  - The bar-height denominator becomes `Math.max(model.maxKg, bestWeekKg)`.
   *  - A dotted overlay line is drawn at the bestWeekKg level.
   *  When undefined or 0, the strip renders BYTE-IDENTICALLY to today's
   *  behaviour (History mount). [changed-v2 per BLK-2] */
  bestWeekKg?: number;
  /** "Best week: <kg> (5/13)" — assembled by caller so the strip stays
   *  unit-agnostic. */
  bestWeekLabel?: string;
};
```

`<MaxNowToPrLine>` (new):

```ts
type Props = {
  maxKg: number;
  nowKg: number;
  gapKg: number;
  a11yPrefix?: string;
};
```

`<ProgressHero>` (new): no props; reads via `useLifetimeBestWeek` + `useLifetimeWeeklyVolume` + `usePrsThisWeek`.
`<ExercisesThisWeekList>` (new): no props; reads via `useExercisesThisWeek`.
`<StreakCard>` (new): no props; reads via `useStreaks`.

### DB columns / queries

No new columns, no new indexes, no new policies. The existing `sets_exercise_completed_idx (exercise_id, completed_at)` covers per-exercise lifetime scans; the existing `sessions_user_started_idx (user_id, started_at)` covers session-only queries. The only schema-adjacent change is adding `exercise_id` + `session_id` to `listWeeklyVolumeRows`'s `select` clause; RLS is unaffected.

## Page composition [v1-carryover]

```
app/(app)/progress/index.tsx
  <Stack.Screen options={{ title: "Progress", headerShown: true }} />
  <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
              contentContainerClassName="pb-12"
              className="flex-1 bg-white dark:bg-black">
    <ProgressHero />
    <WeeklyVolumeStrip
      bestWeekKg={bestWeek?.totalKg}
      bestWeekLabel={bestWeek ? `Best week: ${formatVolume(bestWeek.totalKg, unit)} (${bestWeek.weekStartLabel})` : undefined}
    />
    <ExercisesThisWeekList />
    <StreakCard />
  </ScrollView>
```

[v1-carryover] ASCII mockups for populated mid-week / early Tuesday / day-zero are unchanged from v1 (see design-v1.md §"ASCII mockup").

## Hooks + API additions (summary signatures) [partial-change-v2]

```ts
// src/api/stats.ts
export async function listWeeklyVolumeRows(opts: { sinceUtc?: string }): Promise<WeeklyVolumeRow[]>;
// WeeklyVolumeRow now carries exercise_id, session_id

// src/api/progress-page.ts
export async function listSetsThisWeek(opts: { weekStartIso: string; weekEndIso: string }): Promise<ThisWeekSetRow[]>;
export async function listFinishedSessionStartedAts(): Promise<{ started_at: string }[]>;

// src/hooks/use-stats.ts
export function useLifetimeWeeklyVolume(): UseQueryResult<WeeklyVolumeRow[], Error>;
//   cache key ["stats", "weekly-volume", "lifetime"]

// src/hooks/use-progress-page.ts
export function useLifetimeBestWeek(): { data: BestWeek | null; isLoading: boolean; isError: boolean };
export function usePrsThisWeek(): { data: number; isLoading: boolean; isError: boolean };
export function useFinishedSessionStartedAts(): UseQueryResult<{ started_at: string }[], Error>;
//   cache key ["stats", "progress-page", "session-started-ats"]
export function useStreaks(): { data: { current: number; best: number }; isLoading: boolean; isError: boolean };
export function useExercisesThisWeek(): { data: ExerciseThisWeekRow[]; isLoading: boolean; isError: boolean };
export function useProgressPageRefresh(): { refreshing: boolean; onRefresh: () => Promise<void> };
```

## Test plan [partial-change-v2]

### Unit — `tests/unit/progress-page-math.test.ts` (new)

`bucketWeeklyVolumes(rows)` [v1-carryover]:
1. Empty input → empty Map.
2. Single row in week W → Map size 1 with the row's `w*r`.
3. Two rows same week → summed.
4. Two rows different weeks → two entries.
5. Row with `weight = null` → not counted.
6. Row with `reps = 0` → not counted.
7. Row with `reps = null` → not counted.
8. Row with negative weight → not counted.
9. Sunday 23:30 BRT row → its own ISO week (TZ correctness).

`findBestWeek(buckets)` [v1-carryover with MIN-7 strengthening]:
10. Empty map → `null`.
11. Three buckets `100, 500, 250` → returns the `500` entry.
12. **[strengthened-v2 per MIN-7]** Tie at top → returns the FIRST-inserted entry. Test docstring: "server-side ASC sort means insertion order is oldest→newest, so the oldest tied week wins on ties. Strict `>` not `>=` in the reducer guarantees this."
13. All-zero buckets → returns `null`.

`countPrsThisWeek({ rows, currentWeekStartIso, currentWeekEndIso })` [v1-carryover + new MAJ-3 boundary tests]:
14. Empty rows → 0.
15. One exercise, three prior sessions ascending in volume, no this-week → 0.
16. One exercise, two prior sessions (500, 800), one this-week session (900) → 1.
17. One exercise, two prior sessions (500, 800), one this-week session (700) → 0.
18. One exercise, two prior sessions, TWO this-week sessions both beating prior → 1 (dedupe).
19. Two exercises, both beating PR this week → 2.
20. First-ever session for an exercise (no prior) → 0.
21. PR session whose started_at is in last week → 0.
22. Warmup row (pre-filtered server-side; helper documents assumption) → not counted.
**[new-v2 per MAJ-3]** 23. **One prior session at 500 kg (started_at BEFORE current week), current-week session at 600 kg → 1 PR.** Pins the single-prior boundary.
**[new-v2 per MAJ-3]** 24. **One prior session at 500 kg, current-week session at 400 kg → 0 PRs.** Pins the strict-greater comparator.

`groupExercisesByPrimaryMuscle(exercises)` [v1-carryover]:
25. Empty → empty map.
26. Exercise with `muscles: ["Chest", "Shoulders"]` → goes to "Chest" only.
27. Exercise with `muscles: []` → goes to "Other".
28. Exercise with `muscles: ["Bogus"]` → goes to "Other" (malformed-data graceful degradation).
29. Insertion order matches `MUSCLE_GROUPS` then "Other".

`computeStreaks(sessions, now)` [v1-carryover + MIN-2 strengthening]:
30. Empty sessions → `{ current: 0, best: 0 }`.
31. One finished session this week → `{ current: 1, best: 1 }`.
32. One finished session last week, none this week, `now` is Tuesday → `{ current: 1, best: 1 }` (soft-fallback).
33. One finished session two weeks ago, none last or this → `{ current: 0, best: 1 }`.
34. Sessions in W-3, W-2, W-1, W → `{ current: 4, best: 4 }`.
35. Sessions in W-7..W-5 (3 weeks), gap, then W-1, W → `{ current: 2, best: 3 }`.
**[strengthened-v2 per MIN-2]** 36. Docstring: "current streak resets when the empty week ENDS, not while it's in progress". Multiple finished sessions in same ISO week → counted once for streak purposes.
**[new-v2 per MIN-2]** 37. Sunday 23:59 of an empty current week, last week also empty (no qualifying session in W-1) → `{ current: 0, best: max-prior-best }`. Confirms the soft-fallback is NOT unbounded — it only carries from the immediately-preceding week.
38. TZ correctness: Sunday 23:30 BRT session, `now = next Monday 00:30 BRT` → that session is in its own ISO week, not the next.

### Unit — strip height + overlay [new-v2 per BLK-2]

A new lightweight test (can live in `tests/unit/progress-page-math.test.ts` under a `describe("strip height with bestWeekKg overlay")` block, or be split out into `tests/unit/weekly-volume-strip-overlay.test.ts` — Implementer call):

**Test #39 — "bars shrink proportionally when bestWeekKg > 8-week max"**:
- Setup: `model.maxKg = 1000` (heaviest visible bar = 1000 kg). `bestWeekKg = 2000` (lifetime best is outside visible window, 2× the visible max).
- Expected `denom = max(1000, 2000) = 2000`.
- Expected heaviest visible bar height = `round((1000 / 2000) * 96) = 48` (half the plot box).
- Expected overlay y-position = `96 - round((2000 / 2000) * 96) = 0` (top edge of plot).

**Test #40 — "bars unaffected when bestWeekKg ≤ 8-week max"**:
- Setup: `model.maxKg = 1000`. `bestWeekKg = 800`.
- Expected `denom = max(1000, 800) = 1000`.
- Expected heaviest visible bar height = `96` (unchanged from existing behaviour).
- Expected overlay y-position = `96 - round((800 / 1000) * 96) = 96 - 77 = 19`.

**Test #41 — "History mount (bestWeekKg undefined) renders identically"**:
- Setup: same rows as the existing height test in `weekly-volume-bucketing.test.ts:83-115`.
- `bestWeekKg = undefined`.
- Expected heights MATCH the existing test exactly: heaviest bar at PLOT_HEIGHT, light bar at 24.
- Guards against accidental regression in the History mount.

### Unit — `tests/unit/weekly-volume-bucketing.test.ts` (existing) [unchanged, MIN-1]

No edits. The file uses an inline narrow `Row` type at line 14-18 that omits `exercise_id`/`session_id`. The augmented `WeeklyVolumeRow` is a structural superset; existing rows that lack the new columns still satisfy the test's narrow type. v1's "edit the mkRow factory" instruction is dropped (the factory doesn't exist).

### E2E — `tests/e2e/progress-page.spec.ts` (new) [v1-carryover]

7 tests per v1 plan (tab visibility, empty user, populated user mid-week, per-row navigation, empty-this-week-with-history, PR badge smoke, 5-tab regression). See design-v1.md §"E2E" for full text — unchanged.

### Manual smoke (Tester scope) [v1-carryover]

8 items per v1 plan (fresh user, mid-session banner, pull-to-refresh, dark-mode contrast, iPhone SE width, platform parity, soft-deleted exercise, multi-muscle exercise). [new-v2 per MIN-3] Add item 9: **benchmark cold-start `useLifetimeWeeklyVolume` on a real production account; record measured P50/P95 in `implementation.md`; if P95 > 5s, escalate to Designer round 2 for Option B swap.**

## Riscos [partial-change-v2]

- **Data integrity (RLS, migrations)**: zero. No schema change, no new policy, no new index. The augmented `WeeklyVolumeRow` selects two extra columns from `sets` — both NOT NULL columns already protected by existing RLS. No migration.

- **PostgREST silent truncation** [partial-change-v2 per MAJ-1]: headline risk. The paginated loop spelled out in MAJ-1 (PAGE=1000, while-true with `range(from, from+PAGE-1)`, break-on-short-page, advance `from += PAGE`) is the mitigation. Unit test recommended (mock supabase to return 1500 rows in two pages, assert function issues two `.range()` calls and the result has 1500 rows) — Implementer call whether to add.

- **UX regression — existing 8-week strip on History** [partial-change-v2 per BLK-2]: `<WeeklyVolumeStrip>` is mounted by `history/index.tsx:48` with no props. The new `bestWeekKg` / `bestWeekLabel` props are optional. When undefined, `denom = Math.max(model.maxKg, 0) = model.maxKg`, the height formula degrades to `Math.round((b.totalKg / model.maxKg) * PLOT_HEIGHT)` — IDENTICAL to the existing formula at `weekly-volume-strip.tsx:114-117`. Test #41 explicitly guards this. Validator should confirm by reading the diff.

- **UX regression — cache key collision** [partial-change-v2 per BLK-1]: every Progress-page raw fetch key sits under `["stats", "progress-page", …]` or `["stats", "weekly-volume", …]`. Both are strict tuple prefixes of `["stats"]`, so the existing `useFinishSession`/`useUpdateSessionTimes`/`useSoftDeleteSession` cascades cover them. Validator should grep `invalidateQueries` for any place that uses an EXACT key match (not a prefix) — `use-sessions.ts:62, 108, 109, 121` all use prefix matching, confirmed in v2 verification reads.

- **UX regression — TZ correctness** [v1-carryover]: every ISO-week-boundary computation goes through `weekKeyOf` / `isoWeekStart` from `dates.ts`. Unit tests #9 + #38 explicitly guard the Sunday-23:30-BRT boundary.

- **Platform divergence (iOS / Android / web)**: zero functional. Dotted overlay = `<View>` with `borderBottomWidth: 1` and `borderStyle: "dashed"` (RN-supported on all three; "dotted" on Android falls back to dashed but is visually equivalent at 1px). Label position is `absolute` over the plot; Validator should sanity-check that the label doesn't clip the date-label row on Android.

- **Performance — lifetime read on cold start** [partial-change-v2 per MIN-3]: a 3-year user has ~15k rows × 7 columns (6 + 2 nested) ≈ ~80-110 KB per page, ~15 pages = ~1.5-1.7 MB total. On gym wifi (5 Mbps real-world), ~2.5-3s of network. `staleTime: 60_000` means subsequent navigations within a minute are instant. **[changed-v2 per MIN-3]** This estimate is unmeasured. Implementer benchmarks on a real account during Implement (Manual smoke item #9); if measured P95 > 5s, soft-callback to Designer for Option B swap. Empty-state and onboarding unaffected.

- **Performance — render cost** [v1-carryover]: the list renders 5-20 rows × `<MaxNowToPrLine>`. Single layout pass. `<ScrollView>` (not `FlatList`) is correct because the four blocks are heterogeneous.

- **PR-count edge case — pre-existing data quirks**: defensive ordering by `started_at` ASC handles any session-time anomaly.

- **PR-count edge case — bulk Strong import "spike"**: imports land in their original `completed_at` weeks, so they don't pollute the current week's PR count.

- **Refresh fan-out** [partial-change-v2 per BLK-1]: `useProgressPageRefresh` invalidates `["stats"]` + `["exercises"]` only (under option (a) namespace, two prefixes cover everything). Each prefix has 1-3 active queries on Progress; total ~5 parallel refetches. Total wall-clock ≈ the slowest (the lifetime read).

- **Active-session interaction** [v1-carryover]: drafts never appear in any Progress block (server-side filter `ended_at IS NOT NULL`). After Finish, `useFinishSession` invalidates `["stats"]` and Progress re-derives.

- **iPhone SE tab width** [v1-carryover]: 5 tabs × 64 px = 320 px on iPhone SE. "Progress" (8 chars) fits in the envelope of existing "Exercises" (9 chars). LOW risk.

- **Lifetime peak outlier** [v1-carryover]: per prompt, accepted. TODO comment in the kernel for the future trailing-12 swap.

- **[new-v2 per BLK-2] Bar visual regression on Progress when lifetime best is huge**: when `bestWeekKg >> model.maxKg`, all visible bars shrink. This is INTENTIONAL — it communicates "you're far below your peak". The user reads the absolute `Now` value from the `<ProgressHero>` block above the chart, so the chart's relative-shrinkage is purely for visual context. Validator should confirm this is the right UX choice (Implementer should NOT try to "fix" the small bars by, e.g., switching to log-scale or clipping the overlay).

## Alternativas descartadas [v1-carryover + new-v2 additions]

1. [v1] Option B — new Postgres aggregate function. Descartada: introduces SQL artifact (migration + Drizzle awareness) for one screen.

2. [v1] Option C — paginated lifetime read across N `useQuery` instances with rolling `since`. Descartada: cache fragmentation, complex invalidation.

3. [v1] Display multi-muscle exercise in EVERY tagged group. Descartada: duplicates the row visually.

4. [v1] Synthetic "Multi-muscle" group. Descartada: noisy 8th category.

5. [v1] Count each PR-beat separately. Descartada: per-exercise dedupe is the truthful unit.

6. [v1] Drop the chart from Progress. Descartada: it's the visual heartbeat.

7. [v1] Widen the chart to 12-26 bars. Descartada: visually competes with History strip.

8. [v1] SVG line chart. Descartada: bars are right for discrete weekly events.

9. [v1] Strict streak (drop to 0 the moment current week is empty). Descartada: punishes Monday-morning glances.

10. [v1] Hide chart and list when current week is empty. Descartada: chart shows bigger picture.

11. [v1] `Activity` icon. Descartada: overlaps with `History` + `Workout`.

12. [v1] "+X kg over previous best" per-row callout. Descartada: that's the live-session signal; on Progress, the hero count + `To PR = 0` row state suffice.

13. [v1] Fold lifetime hooks into `use-stats.ts`. Descartada: Progress-page hooks are page-specific orchestration.

14. [v1] Refactor `<VolumeTargetSlot>` to consume `<MaxNowToPrLine>`. Descartada: adjacent cleanup, out of scope.

15. **[new-v2 per BLK-1]** Option (b) for cache invalidation: add explicit `invalidateQueries({ queryKey: ["progress-page"] })` lines to `useFinishSession`/`useUpdateSessionTimes`/`useSoftDeleteSession`/`useStartSession`. **Descartada** in favour of option (a) namespacing because: (i) it requires editing 4 separate hooks with the same line, which is bug-prone if a 5th stats-touching mutation is added later; (ii) `useStartSession` shouldn't invalidate Progress data (drafts don't contribute) but starting a session COULD become a Progress-touching event in the future; (iii) option (a) is strictly fewer lines of code; (iv) the namespace is self-documenting (`["stats", "progress-page", …]` reads as "stats data for the Progress page"). Option (b) is the right move if we ever split the stats namespace, but the current architecture has one stats domain.

16. **[new-v2 per BLK-2]** Alternative max-aware denominator: switch the entire chart to log-scale when `bestWeekKg > 10 × model.maxKg`. **Descartada** because: (i) log-scale on a bar chart is hard to read at a glance (defeats the chart's purpose); (ii) introduces visual divergence between the History strip (linear) and the Progress strip (sometimes-log) — confusing; (iii) the "small bars below a big overlay" visualization IS the right communication for "you're far below your peak". The user is supposed to feel the gap; that's the prompt's accepted tradeoff.

17. **[new-v2 per BLK-2]** Alternative max-aware denominator: clip `bestWeekKg` at `2 × model.maxKg` so bars never shrink more than 50%. **Descartada** because: (i) clipping the overlay position lies about the lifetime best ("the dotted line isn't where my real best is"); (ii) the linear denominator already conveys the gap; the user reads the exact lifetime best from the label text below the chart. No need to clip.

18. **[new-v2 per MAJ-2]** Use Supabase's URL-fragment embedded-resource filter syntax (`.gte("sessions.started_at", x, { referencedTable: "sessions" })`) for the original v1 query. **Descartada** because: (i) no in-codebase precedent for the option-bag form on Supabase JS v2.40; (ii) the codebase already uses the verified `completed_at` filter idiom in `stats.ts:29`; (iii) using two different filtering patterns for the same logical operation increases cognitive load.

## Out of scope [v1-carryover]

- Refactoring `<VolumeTargetSlot>` to consume `<MaxNowToPrLine>`.
- Postgres aggregate function / RPC.
- Trailing-12-weeks max anchor.
- End-of-session verdict screen.
- PR-table denormalization.
- Notifications / haptics on PR achievement.
- Interactivity on the chart beyond tap-to-drill-down.
- Reordering / customising muscle groups.
- Surfacing Progress page from inside an active session.
- Cross-week comparison metrics.
- Multi-user / shared progress.
- Doc cleanup of stale `docs/data-model.md:67` line.
- Updating `docs/features.md` (Conductor step).
- Batched `useExerciseMaxVolumes(ids[])` hook (superseded by single lifetime kernel).
- **[new-v2]** Switching streak math to track training days within the current week (the "weekday dots" UX). Pure week-granularity per prompt.

---

## Self-check vs Validator findings

- **BLK-1**: addressed. Option (a) chosen, all keys pinned to file/line, all existing invalidation call sites enumerated.
- **BLK-2**: addressed. Formula rewritten with `denom = Math.max(model.maxKg, bestWeekKg ?? 0)`, overlay y-position formula stated, 3 new unit tests added (#39, #40, #41).
- **MAJ-1**: addressed. Loop pseudocode inlined twice (Resposta section + Contratos), removed dead pointer to `scripts/import-strong.ts`, cited `docs/runs/2026-05-20_0127_import-strong-csv/regression-report.md`.
- **MAJ-2**: addressed. Query rewritten to `.gte("completed_at", weekStartIso).lte("completed_at", weekEndIso)` on the sets table; cross-midnight edge case documented.
- **MAJ-3**: addressed. Tests #23 and #24 added for the single-prior-session boundary.
- **MIN-1**: addressed. `weekly-volume-bucketing.test.ts` removed from edit list; rationale documented.
- **MIN-2**: addressed. Streak test docstring locked; new test #37 for Sunday-23:59-empty-week edge case.
- **MIN-3**: addressed. Documented as known-debt; benchmark instruction added to Manual smoke item #9.
- **MIN-4**: addressed. Key pinned to `["stats", "progress-page", "session-started-ats"]`.
- **MIN-5**: addressed. Per-block skeleton spec added to each new component's row in the file table.
- **MIN-6**: addressed. Documented that the 8-week `<WeeklyVolumeStrip>` query runs in parallel with the lifetime read on Progress.
- **MIN-7**: addressed. Tie behaviour pinned (oldest week wins, strict `>`, insertion order); test #12 strengthened.
