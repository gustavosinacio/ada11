# Discovery — 2026-06-04_0905_secondary-muscle-attribution

## Feature prompt
Secondary-muscle volume attribution — fractional credit to secondary muscles (bench → partial Arms/Shoulders) instead of primary-only `muscles[0]`. (refines Phase 1)

## Scope summary
Phase 1 = the weekly per-muscle charts on the Progress page (`<WeeklyMuscleVolumeSection>`). Today both metrics — tonnage (`presentWeeklyVolumeByMuscle`) and the just-shipped hard-sets (`presentWeeklyHardSetsByMuscle`) — credit a set's ENTIRE contribution to the exercise's `muscles[0]` via the single shared scaffold `bucketByMuscleWeek` (`src/utils/weekly-muscle-volume.ts:139-171`). This feature wants to spread that contribution FRACTIONALLY across an exercise's muscles. The change is one ~3-line seam in `bucketByMuscleWeek`, inherited by both metrics — BUT the central blocker is upstream of the code: **the live catalog's `muscles[]` does not contain the secondaries the prompt's headline assumes** (Bench Press = `['Chest']`, full stop), so there is nowhere for fractional weights to come from without first populating secondary muscles + their fractions. This is a data-model feature, not a math feature.

## Affected files (verified)

### In-scope to CHANGE
- `src/utils/weekly-muscle-volume.ts:149-170` — **the single attribution seam.** `:149` `const primary = (ex.muscles ?? [])[0]`; `:150-151` maps `primary` → `MuscleGroup | "Other"`; `:165-170` accumulates `values[idx] += metric.contribute(...)` into ONE bucket. Fractional version: iterate an exercise's weighted-muscle list `(muscle, fraction)[]`, and for each do `values_of(muscle)[idx] += metric.contribute(...) * fraction`. SHARED by both metrics (the `metric` arg is orthogonal to attribution) — the change lands once and tonnage + hard-sets both inherit it (verified: the `for (const row …)` loop body `:139-171` is metric-agnostic except `metric.include`/`metric.contribute`/`metric.needsLoad`).
- `tests/unit/weekly-muscle-volume.test.ts:104-127,676-702` — the explicit `muscles[0]`-primary-only assertions (tonnage `:104` "attributes volume to the PRIMARY muscle", hard-sets `S-5` `:676`) CHANGE behavior under fractional attribution. New cases needed (see Tests section). The Invariant-T anchor `:484-540` and the windowed cases must still hold (attribution is orthogonal to windowing/axis).

### Likely-NEW (depends on the weights-source decision — see U1)
- A migration (e.g. `0022_*`) to populate secondary muscles and/or per-muscle fractions on canonical rows — IF the chosen option needs stored data (options b/c-middle). Latest migration is `0021_bodyweight_factor.sql` (verified — `ls supabase/migrations/`), so next is `0022`.
- A small pure helper (e.g. `weightedMusclesOf(ex): {muscle, fraction}[]`) co-located in `weekly-muscle-volume.ts` or a sibling — IF the weights are computed by a code heuristic (options c/c-middle/d). Mirrors `bodyweight.ts`'s "one arithmetic seam" pattern.
- Possibly `src/db/schema.ts:59` + `src/db/types.ts:172` (`ExerciseRow.muscles`/new column) — ONLY for option (b) (new structured column).

### Read-only VERIFIED — must NOT change
- `src/utils/progress-page-math.ts:522-544` `groupExercisesByPrimaryMuscle` — groups EXERCISES (not volume) by `muscles[0]` for the exercises-this-week LIST ordering. **Fractional attribution does NOT apply** — you can't place an exercise fractionally into a list section. Out of scope (U6).
- `src/hooks/use-progress-page.ts:329-334` `useExercisesThisWeek` — same `muscles[0]` pick, same purpose (assigns each exercise-row a single `group` for list sorting/sectioning). Out of scope (U6).
- `src/utils/set-display.ts:159-162` — `muscles.join(", ")` for a read-only subline. Display, not attribution.
- `src/components/weekly-muscle-volume-section.tsx:34-43,61-75` — the ONLY production consumer of both presenters (toggle kg↔sets). `MUSCLE_COLORS` (`:34-43`) already keys all 7 `MUSCLE_GROUPS` + "Other" — so fractional attribution lighting up MORE muscle lines does NOT overflow the palette (no `% length` wrap risk, unlike the e1RM top-N case). No change expected.
- `src/api/stats.ts` (`WeeklyVolumeRow`) — row already carries `exercise_id` + `set_type`; attribution reads the exercise lib (`exercises` arg), NOT the row. No SELECT widen needed (the lib flows in via `useAllExercises` → the section). Verified: scaffold gets `exercises: ExerciseRow[]` and looks up `libById.get(row.exercise_id)` (`:122-123,146`).

## The single attribution seam (FACT — verified by reading)
`bucketByMuscleWeek` (`weekly-muscle-volume.ts:139-171`), per row:
```
const primary = (ex.muscles ?? [])[0];                       // :149
const key = primary && validMuscles.has(primary)             // :150-151
  ? (primary as MuscleGroup) : "Other";
…
values[idx]! += metric.contribute(row, w, r);                // :170  (ONE bucket)
```
Fractional generalization (single site, both metrics inherit):
```
for (const { muscle, fraction } of weightedMusclesOf(ex)) {  // Σfraction = 1
  const key = validMuscles.has(muscle) ? muscle : "Other";   // non-canonical → "Other"
  const values = getOrInit(byMuscle, key, weeks.length);
  values[idx]! += metric.contribute(row, w, r) * fraction;   // fractional credit
}
```
The "Other" bucket, canonical `SERIES_ORDER` emit (`:174-180`), zero-fill (`:167`), and drop-all-zero (`:178`) all still work when a row contributes to MULTIPLE muscles — they operate on the per-key `values[]` arrays AFTER accumulation, unaffected by how many keys a single row touches. **Confidence: HIGH** this is the ONE place to change for both metrics (grep proved exactly 2 attribution sites for VOLUME — both inside this function: the read `:149` and the accumulate `:170`).

## WHERE the fractional weights come from (THE central decision — all viable options)
**Load-bearing data finding (FACT — live catalog query, project `ykrbgpctbfvndxjnpzrg`, anon client, `user_id IS NULL AND deleted_at IS NULL`, 95 rows):**
- `muscles[]` length distribution: **`{1: 81, 2: 12, 6: 2}`** — 85% of canonical exercises have a SINGLE muscle.
- **The prompt's headline case is FALSE against the data: `Bench Press → ['Chest']` only** (also `Overhead Press → ['Shoulders']`, `Push-up → ['Chest']`, every row → single `['Upper back']`, every curl → `['Arms']`, `Dip → ['Chest']`). There is NO bench-press row listing Arms/Shoulders. The secondaries the prompt wants to credit **do not exist in the array today.**
- The 14 multi-muscle rows: `Chest Dip ['Chest','Arms']`, `Pull Up ['Upper back','Arms']`, `Pullover ['Chest','Upper back']`, `Reverse Fly ['Shoulders','Upper back']`, the Deadlift family, `Squat (Barbell) ['Lower back','Legs']`, `Good Morning ['Lower back','Legs']`.
- **`muscles[0]` is NOT reliably the primary**: `Squat (Barbell)` lists `Lower back` before `Legs` (Legs is a squat's primary); `Deadlift ['Legs','Upper back','Lower back','Shoulders','Arms','Core']` reads as an unordered full-recruitment list, not ordered primary→secondary intent. 0014 (`supabase/migrations/0014_backfill_exercise_muscles.sql:35-141`) wrote these tuples by gym knowledge with NO documented primary-first rule.
- Vocabulary is clean: every token ∈ the 7 `MUSCLE_GROUPS` (zero "Other" among canonical rows). Zero user-owned exercises visible (RLS, `content-range: */0`).

Options (ranked, with the data feasibility each requires):

- **(a) Derive from existing `muscles[]` order** — primary `[0]` gets weight W, the rest split `(1-W)`. **NOT VIABLE for the prompt's intent as-is**: 81/95 exercises have only `[0]`, so this yields NO secondary credit for bench/press/rows/curls — the exact movements the prompt names. It would only fractionate the 14 multi-muscle rows AND would mis-attribute where `[0]` isn't primary (Squat → Lower back gets W). Confidence it satisfies the prompt: LOW. Needs option-b/c work FIRST to mean anything.
- **(b) New structured per-exercise column** (e.g. `muscle_weights jsonb` mapping muscle→fraction), backfilled on canonical rows by a migration mirroring 0014/0021. Most explicit/flexible; encodes BOTH which secondaries AND how much. Biggest blast radius (schema + types + a 95-row backfill + hand-kept sum-to-1). Confidence it satisfies the prompt: HIGH. Cost: HIGH.
- **(c) Hardcoded weighting map in code**, keyed per-exercise-name or per-primary-muscle-pattern (e.g. `Chest → {Chest:0.6, Arms:0.2, Shoulders:0.2}`). No migration; lives next to the seam as a pure constant; trivially unit-testable + revertible. Can express the bench→Arms/Shoulders split the DATA cannot. Confidence it satisfies the prompt: HIGH. Cost: LOW-MEDIUM. **Tradeoff vs (b): owner-tunable in code (a PR) vs a DB write; avoids a 95-row hand-summing migration; downside is user-owned exercises (none today, U5) can't be per-row-tuned.**
- **(c-middle) Migration POPULATES secondaries in `muscles[]` (data only), THEN a global fraction heuristic in code** applies the split over the now-richer array. Splits the work: the DATA decision (which muscles a movement hits, ordered primary-first) lives in a migration (mirrors 0014, the team's established pattern); the FRACTION VALUES (the split rule) live in one code constant. Cheapest path that (1) reuses the existing `muscles[]` column (no schema change), (2) puts the muscle-list decision where 0014 already put it, (3) keeps fraction values in one tunable seam. Requires re-asserting primary-first ordering on the 14 existing multi-muscle rows (e.g. fix Squat → `['Legs','Lower back']`). Confidence: MEDIUM-HIGH. Cost: MEDIUM. **This is the "middle option" my standing feedback says to surface — neither pure-code (c) nor pure-new-column (b).**
- **(d) Global heuristic over `muscles[]` with NO new data** — primary X%, listed secondaries split the rest. Same viability problem as (a): 81/95 single-muscle rows → no secondaries for the headline movements. Meaningful only AFTER muscles are populated → collapses into (c-middle). Standalone confidence: LOW.

**Recommendation (MEDIUM confidence — fundamentally a product/data decision, see U1+U2):** the realistic feasible set is **(b)**, **(c)**, or **(c-middle)** — NOT (a)/(d) standalone, because the source array lacks the secondaries the prompt wants. Lean: **(c-middle)** if the owner wants the muscle-list decision in the same place as 0014 (migration) and accepts re-ordering the 14 multi-muscle rows; **(c)** if the owner wants the fastest, fully-revertible, no-DB-write path and accepts a code-resident table. **FLAG: the fraction VALUES themselves (bench 0.6/0.2/0.2? 0.7/0.15/0.15?) are a human/product decision — Discovery cannot invent them; the hypertrophy literature has no single consensus split.** Mirrors the bodyweight-factor run where the factor values were owner-locked.

## Sum-to-1 invariant + back-compat (FACT-grounded)
- For "same numbers unless changed," per-exercise weights **must sum to 1.0** so TOTAL volume across all muscles is conserved per set. An exercise with a single muscle at weight 1.0 == today's behavior exactly (the identity case) — the back-compat anchor (mirror of Phase-0/leverage's NULL⇒1.0⇒byte-for-byte invariant). Confidence: HIGH.
- **This is a RETROACTIVE redistribution** (same class as Phase 0 / bodyweight leverage / hard-sets, `features.md:11,21,23`): once shipped, Chest goes DOWN and Arms/Shoulders go UP on every historical week for every multi-muscle movement. Every per-muscle number shifts. Must be called out as a deliberate retroactive shift.
- **Feature flag: almost certainly NOT — the prompt says "instead of primary-only," i.e. just on.** No `max_volume_window`-style pref implied. The kg↔sets toggle stays orthogonal (both metrics get fractional attribution). Confidence: MEDIUM (U7 — confirm unconditional with owner).

## Fractional HARD SETS — semantic flag (FACT + open question)
The shared scaffold means the fraction multiplies BOTH `metric.contribute` outputs identically:
- Tonnage: `(w*r) * fraction` — splits cleanly (0.6 of 1100 kg = 660 kg to Chest). Semantically fine.
- Hard sets: `1 * fraction` — a working set credits **0.6 of a hard set** to Chest, 0.2 to Arms, 0.2 to Shoulders. **Semantically odd**: the hard-sets metric exists BECAUSE the literature counts hard sets as discrete dose units (Schoenfeld/Krieger ~+0.37%/set, 10+ sets/wk — `features.md:9`). "0.4 of a set" has no clear meaning in that framework; the metric's whole point is integer set-counting per muscle. **FLAG (U3 — top open question): fractional attribution may be RIGHT for tonnage but WRONG for hard sets.** Plausible resolutions: (i) fractions on BOTH (uniform, simplest, breaks integer-set semantics + the `S-5` test); (ii) fractions on TONNAGE only, hard-sets stay primary-only `muscles[0]` — needs the scaffold to take a per-metric `attribution: 'fractional' | 'primary'` flag; (iii) credit a FULL hard set (1, not a fraction) to every muscle whose fraction exceeds a threshold (e.g. ≥0.25 → counts as a stimulating set for that muscle — closer to how the literature treats secondary involvement). Product decision distinct from the tonnage split. Confidence the scaffold CAN support any of the three: HIGH (the `metric` arg can carry the attribution mode); confidence on WHICH is correct: LOW — owner call.

## Close-the-set: all primary-muscle attribution sites (exhaustive — grep `\.muscles` + `muscles[` across `app/`+`src/`)
| Site | file:line | What it attributes | In scope? |
|---|---|---|---|
| Volume bucket (tonnage + hard-sets) | `weekly-muscle-volume.ts:149-170` | a SET's volume/count → muscle | **YES** — the seam |
| Exercises-this-week list grouping | `progress-page-math.ts:522-544` | an EXERCISE → one list section | NO — can't fractionally section a list (U6) |
| Exercises-this-week row group | `use-progress-page.ts:329-334` | an EXERCISE → one `group` field | NO — same reason (U6) |
| Read-only subline | `set-display.ts:159-162` | muscle NAMES → display string | NO — display only |
| Picker search / chips | `exercise-picker.tsx:43,111`, `exercise-list-item.tsx:13`, `exercise-block.tsx:117`, `routine-exercise-card.tsx:96` | muscle names → UI chips/search | NO — display only |
| Create/edit exercise form | `exercises/new.tsx:46`, `exercises/[id]/index.tsx:73,87,160` | muscles input (write path) | NO — but see U5 (where secondaries get EDITED) |
| Write API | `api/exercises.ts:70,88` | persists `muscles` array | NO (unless option b adds a column to persist) |

**Verdict (HIGH confidence): exactly ONE volume-attribution site** (`bucketByMuscleWeek`), and it is the documented shared seam for both metrics (`features.md:9`: "Same `muscles[0]` attribution for both → feature #2 lands in one place"; scaffold doc-comment `weekly-muscle-volume.ts:71-74`). The two other `muscles[0]` sites group EXERCISES, not volume — fractional attribution is meaningless there. No N+1th volume-attribution site exists.

## "Other" + MuscleGroup mapping with fractions (edge specified)
Today a row maps to ONE `MuscleGroup` or "Other" (`:150-151`). With fractions, one exercise's weighted-muscle list could mix canonical + non-canonical muscles. Rule (preserves the existing semantic): per `(muscle, fraction)`, `key = validMuscles.has(muscle) ? muscle : "Other"`; multiple non-canonical muscles on one exercise all fold into the SAME "Other" bucket (their fractions SUM into Other). Canonical-data note: today ZERO canonical muscles fall outside `MUSCLE_GROUPS` (all 7 tokens in-vocab), so "Other" only fires for empty-`muscles[]` exercises or future user-owned rows. Edge: an exercise with `muscles: []` (empty) must still get weight 1.0 → "Other" (the identity case for unclassified exercises — matches today's `primary` undefined → "Other" at `:151`).

## Tests & conventions
- `tests/unit/weekly-muscle-volume.test.ts` (~517 unit tests project-wide per `features.md:9`). New cases fractional attribution needs:
  1. **Multi-muscle split** — `muscles: ['Chest','Arms','Shoulders']` weighted → Chest `0.6*v`, Arms `0.2*v`, Shoulders `0.2*v` in the SAME week (tonnage).
  2. **Conservation** — Σ over all muscle series for a single set == the un-fractioned contribution.
  3. **Single-muscle == today (identity)** — `muscles: ['Chest']` at 1.0 reproduces `:104` byte-for-byte (back-compat anchor).
  4. **Non-canonical / empty secondary → "Other"** — fraction routed to Other; multiple non-canonical fold into one Other bucket.
  5. **Hard-sets divergence (depends on U3)** — if hard-sets stay primary-only, a `S-5`-style test pins that the sets metric does NOT fractionate while tonnage does.
  6. The Invariant-T anchor `:484-540` and windowed `W-*`/`S-8*` cases stay GREEN (attribution is orthogonal to axis/window) — except where they assert primary-only and must be updated for fractional behavior.
- e2e: `tests/e2e/weekly-muscle-volume.spec.ts` exists. If fractional attribution adds lines to a previously-single-line chart, the spec's expected-series assertions may need updating (U8). No NEW e2e likely unless the owner wants a live "bench shows Chest+Arms+Shoulders lines" assertion.
- Convention: pure-presenter discipline (no React/I/O in `weekly-muscle-volume.ts`), injectable `now` for deterministic tests, columns already on the row, NULL/identity-coalesce-to-byte-for-byte (the Phase-0/leverage/hard-sets house style).

## Coupling note (FACT)
The just-shipped hard-sets run REFACTORED tonnage into the shared `bucketByMuscleWeek` scaffold specifically so feature #2 lands once (`features.md:9`; scaffold doc-comment `weekly-muscle-volume.ts:71-74`: "SHARED by both metrics (U6) so feature #2's secondary-muscle attribution lands once"). CONFIRMED: the attribution code (`:149-170`) is metric-agnostic — ONE change covers both tonnage AND hard-sets. The ONLY wrinkle is whether the SAME fraction should apply to the `+1` hard-set contribution (U3 — see fractional-hard-sets flag); the prior run anticipated the seam but did NOT pre-decide the hard-sets semantics.

## Relevant conventions (verified by reading code)
- `exercises.muscles` is `text[] NOT NULL DEFAULT '{}'` (`schema.ts:59`); reads back as `string[]` via PostgREST (`db/types.ts:172`, `ExerciseRow.muscles: string[]`). Ordered array, but order carries NO enforced primary-first semantic today (FACT — Squat/Deadlift counterexamples).
- Canonical-row backfill pattern: idempotent `UPDATE … WHERE user_id IS NULL AND deleted_at IS NULL AND <already-empty guard>`, matched by exact `name` (`0014:35-141`, `0021:23-43`). The established "populate canonical catalog" idiom — directly reusable for option (b)/(c-middle).
- New-numeric-column + NULL⇒identity pattern: `0021_bodyweight_factor.sql` (nullable, no default, NULL coalesces to 1.0 ⇒ byte-for-byte) — the structural precedent for any new per-exercise weight column (option b).
- `MUSCLE_GROUPS` / `MuscleSeriesKey = MuscleGroup | "Other"` / `SERIES_ORDER = [...MUSCLE_GROUPS, "Other"]` (`db/types.ts:143-160`, `weekly-muscle-volume.ts:13,29`) — canonical emit order, unchanged by fractional attribution.
- Single presenter consumer: `<WeeklyMuscleVolumeSection>` (`weekly-muscle-volume-section.tsx:61-75`); `MUSCLE_COLORS` covers all 7 + "Other" (`:34-43`).

## Constraints
- **Data**: `exercises` table; canonical rows are `user_id IS NULL` (app-immutable via RLS — only the service-role migration can write them, per `0011`). A backfill migration (option b/c-middle) writes canonical rows only; the live-DB write needs owner approval (the established gate — 0021 was owner-approved). No FK/RLS change for option (c) (code-only).
- **UI**: NativeWind; chart is `<MultiSeriesChart>` SVG; no new screen. Fractional attribution can surface MORE muscle lines (bench → Chest+Arms+Shoulders) — `MUSCLE_COLORS` covers it, no palette overflow.
- **Platform**: none — pure presenter + (maybe) a migration. No iOS/Android/web divergence.
- **Auth**: read path uses the authenticated user's sessions + the shared canonical catalog (`useAllExercises`). Unchanged.
- **Performance**: the seam adds an inner loop over an exercise's muscle list (≤6 today) per row — negligible vs existing per-row work. No new query.

## Existing precedents
- **Phase-0 / bodyweight leverage (`0021`, `docs/runs/2026-06-03_1402_bodyweight-leverage-factors/`)** — the exact "retroactive redistribution + NULL/identity⇒byte-for-byte + owner-locked numeric values + canonical-only idempotent backfill" template. Closest sibling to this feature's shape.
- **Hard-sets per muscle (`features.md:9`, `docs/runs/2026-06-03_2217_hard-sets-per-muscle/`)** — built the shared `bucketByMuscleWeek` scaffold THIS feature plugs into; the `metric` parameterization is the precedent for a per-metric `attribution` mode (U3 resolution ii/iii).
- **0014 muscle backfill** — the by-name canonical-UPDATE idiom for populating secondaries (option c-middle).

## Unknowns (ranked by design impact — require Designer judgment or human decision)

- **U1 — WHERE do fractional weights come from? (a)/(b)/(c)/(c-middle)/(d).** (a) what: the storage+source mechanism. (b) why: defines blast radius (migration + schema vs code-only) and whether the headline bench→Arms/Shoulders split is even expressible. (c) recommended default: **(c) hardcoded code table OR (c-middle) migration-populates-secondaries + code-fractions** — NOT (a)/(d), which the live data (81/95 single-muscle) makes inert. MEDIUM confidence — HUMAN decision on b-vs-c-vs-c-middle.
- **U2 — the fraction VALUES (which muscles, what split).** (a) what: e.g. bench = {Chest:0.6, Arms:0.2, Shoulders:0.2}? for every multi-muscle movement. (b) why: the feature's actual content; Discovery cannot invent them; the literature has no single consensus split. (c) recommended default: **HUMAN/owner decision** (mirror the bodyweight-factor owner-lock). Must sum to 1.0; single-muscle stays 1.0 (identity). LOW confidence on values — owner call.
- **U3 — fractional hard SETS semantics.** (a) what: does a working set credit 0.4 of a hard set to a secondary, or stay integer? (b) why: the hard-sets metric is built on integer set-counting; "0.4 of a set" may be meaningless. (c) recommended default: **fractions on TONNAGE only, hard-sets primary-only** (resolution ii) — OR threshold full-set credit (iii); needs a per-metric `attribution` flag on the scaffold. HUMAN decision. MEDIUM confidence it's distinct from U2; LOW on which resolution.
- **U4 — `muscles[0]` is not reliably primary (Squat/Deadlift).** (a) what: the 14 multi-muscle rows have inconsistent ordering. (b) why: any option that DERIVES from `muscles[]` order (a/c-middle/d) mis-attributes where `[0]` isn't primary. (c) recommended: if (c-middle), the migration must RE-ASSERT primary-first ordering on those 14 rows (Squat → `['Legs','Lower back']`); if (c), the code table sidesteps `muscles[]` entirely. MEDIUM confidence.
- **U5 — where do secondaries + fractions get EDITED for user-owned exercises?** (a) what: today the create/edit form (`exercises/[id]/index.tsx`) edits a flat `muscles` array, no fractions. (b) why: if option (b)'s column exists, user-owned exercises need an edit UI or a sensible default. (c) recommended: **out of scope for v1** — zero user-owned exercises exist (verified `content-range */0`); user-owned rows default to `muscles[0]` at 1.0 (identity, no fractional credit) until an edit UI is built. Same call as the bodyweight-factor run (no editable-factor UI shipped). HIGH confidence deferrable.
- **U6 — does fractional attribution touch the exercises-this-week list grouping?** (a) what: `groupExercisesByPrimaryMuscle` / `useExercisesThisWeek` group exercises by `muscles[0]`. (b) why: scope boundary. (c) recommended: **NO** — you can't fractionally place an exercise into a list section; the list keeps single-primary grouping. HIGH confidence (the prompt says "volume attribution," and a list isn't volume).
- **U7 — feature flag / unconditional?** (a) what: is the redistribution just on, or behind a pref? (b) why: it's a retroactive shift to every per-muscle number. (c) recommended: **just on** (prompt says "instead of primary-only"; mirrors Phase-0/leverage shipping unconditionally with a retroactive-shift call-out). MEDIUM confidence.
- **U8 — does the e2e `weekly-muscle-volume.spec.ts` need expected-series updates?** (a) what: fractional attribution may add lines to a previously-single-line chart. (b) why: the spec may assert specific present series. (c) recommended: Tester re-runs; update expected series if the seeded exercise is multi-muscle. LOW design impact.
- **U9 — should a fraction below some epsilon be dropped (avoid a near-zero ghost line)?** (a) what: a 0.05 secondary fraction adds a barely-visible muscle line. (b) why: chart clutter vs honesty. (c) recommended: keep all non-zero fractions (the drop-all-zero emit `:178` already removes truly-zero series); revisit only if a tiny fraction creates a noisy line. LOW confidence — owner cosmetic call.

## Out-of-scope flags
- Editable per-exercise secondary-muscle / fraction UI (defer — zero user-owned exercises today; U5).
- Applying fractional attribution to the exercises-this-week LIST grouping (it groups exercises, not volume; U6).
- Changing tonnage↔hard-sets toggle behavior beyond the attribution split (the toggle stays orthogonal).
- Per-set RPE-gated / effective-reps weighting (a different dose refinement, flagged out-of-scope in the hard-sets run).
- Inventing the fraction VALUES — a product/owner decision (U2), not a Designer/Implementer one.
- Reclassifying which muscles a movement hits beyond what the chosen option's data step explicitly populates (don't silently re-tag — mirror the 0021 "don't silently reclassify" discipline).
