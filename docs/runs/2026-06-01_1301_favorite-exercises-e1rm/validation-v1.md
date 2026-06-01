# Validation v1 — 2026-06-01_1301_favorite-exercises-e1rm

Reviewing: `design-v1.md`

## Verification of Designer's claims
| Claim | Verified? | Evidence |
|---|---|---|
| Current selection gate is `.slice(0, topN)` at `e1rm-strength.ts:138-148` | yes | `e1rm-strength.ts:138-148` — `Array.from(byExercise.values()).sort(comparator).slice(0, topN)`. Comparator at `:139-147` = sessions DESC → lastActiveMs DESC → name ASC → id ASC. |
| `ranked.map((agg, rank) => …)` assigns rank = array index (`:151`) | yes | `e1rm-strength.ts:151,180` — `rank` is the `.map` index; `{ id, name, rank, values }` returned. |
| `E1RM_PALETTE` has 8 hexes, `colorForRank(i)=PALETTE[i % len]`, comment assumes N=5≤8 | yes | `e1rm-strength-section.tsx:26-41` — exactly 8 hexes; `colorForRank` at `:40-41`; comment `:28` "N=5 ≤ 8 so `% length` never wraps". |
| Model memo at `:48-51` with deps `[rows, exercises]` | yes | `e1rm-strength-section.tsx:48-51`. |
| `seriesKeysSig` re-seed of visible set at `:66-70` | yes | `e1rm-strength-section.tsx:59,66-70` — re-seeds `new Set(seriesKeys)` on signature change. |
| react-query returns stable `data` ref between renders unless changed | yes | TanStack structural sharing; the existing `model` memo at `:48-51` already relies on stable `rows`/`exercises` refs. Same mechanism for `favoriteIds`. |
| progress.tsx headerRight at `:108-122` is `canEdit ? () => <Pencil/> : undefined` | yes | `progress.tsx:108-122`. `canEdit` at `:85-87` (undefined data → true). `exercise.data?.name` (`:91`), `colorScheme` (`:56`), `router` (`:55`), `id` (`:51`) all in scope at the header closure. `Pencil`/`ChevronLeft` imported `:2`; `Star` available same import. |
| `screenHeader` recomputes each render so optimistic star flip applies | yes | `progress.tsx:88` is a plain `const` (not memoized); rebuilds on every render incl. when `favoriteIds` changes. |
| 0010 RLS shape = enable RLS + 4 policies gated `auth.uid()=user_id`; favorites needs only 3 (no UPDATE) | yes | `0010_exercise_notes.sql:49-67`. Favorites has no mutable column → SELECT/INSERT/DELETE correct. |
| Notes FK: `user_id → auth.users CASCADE`, `exercise_id → exercises RESTRICT` | yes | `0010:29-30`. |
| App soft-deletes exercises (`exercises.ts:99-105`), so FK ON DELETE never fires today | yes | `exercises.ts:99-105` — `softDeleteExercise` sets `deleted_at`, no hard DELETE. CASCADE-vs-RESTRICT divergence is moot in practice. |
| Next free migration = 0020 (latest 0019) | yes | `ls supabase/migrations/` → last is `0019_session_exercise_order.sql`. |
| `primaryKey` NOT imported in `schema.ts:2-13`; `timestamp`/`uuid` ARE | yes | `schema.ts:2-13` imports `check, foreignKey, index, integer, numeric, pgSchema, pgTable, text, timestamp, uuid` — no `primaryKey`. |
| `exerciseNotes` Drizzle table ends at `:304`; add favorites after | yes | `schema.ts:277-304`. |
| `ExerciseNote`/`NewExerciseNote` types at `:37-38`; `ExerciseNoteRow` ends `:262` | yes | `db/types.ts:37-38`, `:254-262`. |
| Notes API auth-gate returns null when unauth (`:14-16`) | yes | `exercise-notes.ts:14-16`. |
| `measurements.ts:121-159` is the INSERT + SQLSTATE-discriminator precedent | yes | `measurements.ts:121-140` — insert, discriminate error, conditional throw. |
| 23505 is the correct SQLSTATE for a composite-PK duplicate | yes (fact) | PostgreSQL `23505 unique_violation` covers PK conflicts. No `42P10` (PK is non-partial; design uses `.insert()` not `.upsert()`). |
| RLS arm template `exercise_notes` at `:133-192`; insert favorites arm after `:398` before `console.log` | yes | `rls.test.ts:133-192` (notes arm), `:384-398` (routine_exercise_sets spoof), `:400-402` (console.log). Cleanup `deleteUser` in `finally` `:403-406`. |
| Notes RLS arm filters `.eq("id", aNote.id)`; favorites must filter on the composite pair | yes (design adapts correctly) | `rls.test.ts:153` uses `.eq("id", …)`; favorites has no `id` surrogate → design §C correctly says "B SELECT/DELETE on that pair". |
| e1rm unit factories `mkRow`/`mkExercise` at `:23-63`, injected `NOW` `:21` | yes | `e1rm-strength.test.ts:21-63`. |
| Bodyweight-only exclusion case (#7) at `:221-250`; determinism case (#13) at `:425-460` | yes | `e1rm-strength.test.ts:221-250`, `:425-460`. |
| e2e harness `signInViaUi`/`gotoProgress`/`pickCanonicalExercise`/`getByLabel("Toggle <Name>")` | yes | `e1rm-strength.spec.ts:140-154,164,193`. `gotoProgress` waits `networkidle` `:153` (the settle concern). |
| `pickCanonicalExercise` throws on unknown name (no silent fallback) | yes | `_helpers/canonical-exercise.ts:49-54`. |
| MultiSeriesChart y-domain/x-axis auto-derive; no hard line-count cap | yes | `multi-series-chart.tsx:53-61` (maxV over visible), `:65,84-87` (x from xLabels), `:134` maps `visibleSeries`. Polyline React key = `line-${s.label}` (`:139`) — keyed by NAME (pre-existing duplicate-name residual). |
| Design test §A case 2 "favoriting a top-N exercise → SAME series count" | **NO — contradicted by the design's own algorithm** | See MAJ-1. `autoTop = nonFavorites.slice(0, topN)` pulls a NEW non-favorite into the freed slot → count grows from N to N+1 whenever >N eligible exist (and §A seeds ≥6). |
| Invariant F byte-for-byte for empty/absent favorites | yes | Traced: `favSet` empty → `favorites=[]`, `nonFavorites===sorted`, `selected = sorted.slice(0,topN)`, cap branch never fires (`5 < 12`). Identical to current `:148`. |

## Scrutiny of the 4 flagged items + Invariant F

1. **Cap arithmetic (union-then-cap).** Verified by hand-trace against the pseudo-code (`design-v1.md:45-77`):
   - **(a) Never drops a favorite while a non-favorite survives — HOLDS.** When `selected.length > 12` and `favorites.length ≤ 12`: `keptAuto = autoTop.slice(0, 12 - favorites.length)` keeps all favorites, trims non-favorites. When `favorites.length > 12`: favorites trimmed to 12, zero non-favorites survive. No counterexample.
   - **(b) Ranks stay 0-based dense — HOLDS.** `ranked = selected` feeds `ranked.map((agg, rank) => …)` (`:151`) unchanged → rank = index 0..M-1.
   - **No favorite-in-autoTop double-count — HOLDS.** `autoTop` is sliced from `nonFavorites = sorted.filter(!favSet.has)` → contains zero favorites by construction → `[...favorites, ...autoTop]` has no duplicate. The design's "deduped by id" framing (`:59-61`) is misleading (it describes an impossible overlap) but the code is correct on dedup.
   - **Off-by-one in the cap — NONE.** `12 - favorites.length` with `Math.max(0, …)` is correct; `> E1RM_MAX_LINES` is a strict `>` so exactly-12 is kept whole.
   - **BUT the pool change is the headline defect — see MAJ-1.** `autoTop = nonFavorites.slice(0, topN)` is top-N of the NON-favorite pool, not top-N overall. This diverges from Discovery's recommended Unknown-#1 default (`topN ∪ favorites`, dedup) and produces a surprising side-effect, and it contradicts the design's own test §A case 2.

2. **`favoriteSet` useMemo dependency — CONFIRMED CORRECT.** `useMemo(() => new Set(favoriteIds ?? []), [favoriteIds])` is gated by the react-query `data` identity. No infinite render: the Set is NOT created unconditionally inline — it is memoized on `[favoriteIds]`, and `favoriteIds` is referentially stable between renders (TanStack structural sharing) until the cache changes. On toggle, `setQueryData` produces a NEW array → `favoriteIds` ref changes → `favoriteSet` recomputes → model memo (`[rows, exercises, favoriteSet]`) recomputes → chart re-renders. Identical mechanism to the existing `[rows, exercises]` memo. **Sound.**

3. **Header-right star outside `canEdit` — CONFIRMED CORRECT.** The rewrite renders the star unconditionally and keeps `{canEdit ? <Pencil/> : null}` inside the same `headerRight` closure — Pencil still hides for canonical/non-owned exercises. All referenced identifiers (`id`, `exercise.data?.name`, `colorScheme`, `router`, `canEdit`) are in scope at `progress.tsx:88-125`. The a11y label `"Favorite/Unfavorite <Name>"` is disjoint from the chip's `"Toggle <Name>"` (`e1rm-strength-section.tsx:143`). **Sound.** (One nit — MIN-3.)

4. **FK CASCADE divergence — ACCEPTABLE.** Confirmed notes use RESTRICT (`0010:30`), app soft-deletes (`exercises.ts:99-105`), so neither fires today. CASCADE on a pointer table breaks no contract (no authored content lost; the favorite is regenerable). No RLS/data-integrity issue. The Drizzle mirror (`onDelete: "cascade"`) matches the SQL. **Acceptable.**

**Invariant F — CONFIRMED byte-for-byte for empty/absent favorites.** Trace above. The empty-favorites path equals the current `sorted.slice(0, topN)`. The Phase-2a NEGATIVE e2e (`e1rm-strength.spec.ts` bodyweight → `model.series.length===0` → null) still holds (no favorite can resurrect a non-eligible exercise — eligibility gate `:109` is upstream of the union). This part of the design is solid.

## Issues found

### Blockers
None.

### Majors
- **[MAJ-1]** `design-v1.md:55-57,63` (the merged-list algorithm) **vs** `:376` (test §A case 2): the algorithm computes `autoTop = nonFavorites.slice(0, topN)` — the top-N of the **non-favorite pool**, NOT the top-N overall. Consequence: **favoriting an exercise that is already in the natural top-N reveals an additional, previously-hidden non-favorite line.** Trace (6 eligible, sorted by sessions [A,B,C,D,E,F], topN=5): favorite C (a top-3) → `favorites=[C]`, `nonFavorites=[A,B,D,E,F]`, `autoTop=[A,B,D,E,F]`, `selected=[C,A,B,D,E,F]` → **6 series, not 5**. The design's test §A case 2 asserts "favoriting a top-3 exercise yields the SAME series count" — which would **FAIL** against the design's own algorithm under the §A seed (≥6 eligible, `:374`). This is both (i) an internal design contradiction (algorithm vs pinned test) guaranteed to fail in implementation, and (ii) a likely-unintended UX behavior (favoriting a shown exercise pops in an unrelated line) that diverges from Discovery's recommended Unknown-#1 default (`topN_overall ∪ favorites`, dedup — Discovery `:181`).
  Suggested fix (pick one, then make the test pin it):
  - **(Y) Discovery's default** — compute `autoTop` from the **overall** top-N (`sorted.slice(0, topN)`), then union with favorites deduped by id, then cap. Favoriting an already-shown exercise is a true no-op when uncapped; the count stays N. This matches Discovery and the test's stated intent. (Recommended — least surprising.)
  - **(X) Keep the current pseudo-code** (top-N of non-favorites) but then **rewrite test §A case 2** to assert the count is N+1 (favoriting a top-N exercise promotes the next non-favorite) and add a sentence to the "What is NOT" / cap section documenting the promotion behavior as intentional. (Acceptable only if the owner wants "always show 5 non-favorites + your favorites" semantics.)
  Either way: state the chosen semantics explicitly and pin it with a test whose assertion matches the algorithm.

### Minors
- **[MIN-1]** `design-v1.md:59-61` — the algorithm comment claims the union is "deduped by id (a favorite already in autoTop is NOT duplicated)". Under the pseudo-code a favorite can NEVER be in `autoTop` (autoTop is drawn from `nonFavorites`), so the "dedup" wording describes an impossible case and obscures the real effect (the favorite is *removed* from the auto pool, promoting a non-favorite). Suggested fix: replace the misleading dedup comment with the actual invariant ("autoTop excludes favorites by construction; favoriting removes an exercise from the auto pool") — and reconcile with whatever MAJ-1 resolution is chosen.
- **[MIN-2]** `design-v1.md:191` — the 4 appended palette hexes are not as high-contrast as claimed. `#eab308` (yellow) + `#f97316` (orange) sit adjacent to the existing `#f59e0b` (amber, rank 4); `#a855f7` (purple) is adjacent to the existing `#8b5cf6` (violet, rank 5). They are *distinct* hexes (so "no two lines share a color" is literally true and the byte-for-byte-first-8 claim holds), but the readability rationale is weaker than stated when 8–12 lines plot simultaneously. Suggested fix: pick replacement hues farther from amber/violet (e.g. a brown `#92400e`, a slate `#64748b`, a rose `#e11d48`, a deep-green `#15803d`) OR downgrade the "high-contrast" prose to "distinct, best-effort-spaced." Cosmetic; LOW.
- **[MIN-3]** `design-v1.md:204-229` — the star is mounted in `headerRight` always-on, but the existing `headerLeft` custom-back only renders when `backHref` is present (`progress.tsx:93-107`); the design doesn't address whether adding a second header-right icon (star + Pencil) crowds the title on narrow widths or when the title is a long canonical name. The design notes the risk (§Riscos, MEDIUM/LOW) and defers to an e2e screenshot. Acceptable, but the e2e §D does NOT explicitly assert the star is visible AND the Pencil is hidden on a CANONICAL exercise (the load-bearing "star outside canEdit" guarantee). Suggested fix: add one e2e assertion that on a canonical target the star renders (`getByLabel("Favorite <canonical>")`) while `getByLabel("Edit exercise")` is absent — proving the gate split. (The current §D favorites a low-session exercise but doesn't pin the canonical-vs-Pencil split.)
- **[MIN-4]** `design-v1.md:403` (test §D) — the e2e needs ≥6 distinct WEIGHTED live-catalog names but only enumerates 2 verified ones ("Bench Press", "Squat (Barbell)"); the other 3 are "+ 3 more live-catalog weighted names" unspecified. The carry-in lesson is explicit that names must be live-catalog-verified, not migration-inferred (the `0001`/`0004` names like "Back Squat"/"Pull-up" are the dropped per-user trigger seed, NOT the live `user_id IS NULL` catalog). Risk is LOW because `pickCanonicalExercise` throws loudly on a missing name (`canonical-exercise.ts:52-54`) → fails fast, not false-green. Suggested fix: name the 3+ extra weighted catalog candidates explicitly (e.g. from the live catalog: "Hip Thrust (Barbell)", "Lat Pulldown (Machine)", "Overhead Press (Dumbbell)", "Preacher Curl (Barbell)" — all appear as `user_id IS NULL` rows in `0014`'s WHERE-IN backfill, but the Implementer must still verify them against the live catalog at seed time).
- **[MIN-5]** `design-v1.md:374-382` (test §A) — none of the new unit cases pins the **promotion/no-promotion** behavior of MAJ-1 directly (case 2 is the contradictory one). Whichever semantics MAJ-1 resolves to, add an explicit case: "favoriting a top-N exercise → series count is N (option Y) / N+1 with the next non-favorite promoted (option X)" so the chosen rule is regression-locked. Also recommend a case for the **exactly-at-ceiling** boundary (favorites=12, autoTop dropped to 0) and the **favorites>12** degenerate trim, since the cap branch (`:68-73`) has two sub-branches currently untested.

## Decision

**no-go**

Reasoning:
- 0 blockers, **1 major** (MAJ-1), 5 minors. By the decision rule (0 blockers and ≤1 major → go) this would normally be a **go-with-must-fix**. I am returning **no-go** for one specific reason: MAJ-1 is not a peripheral defect — it is THE central design decision (the union/cap rule, Crux #1 of the design) AND it carries an internal contradiction that guarantees a test failure during implementation (the algorithm produces N+1 series where the pinned test §A case 2 asserts N). Shipping this to the Implementer would force either a wrong-behavior implementation that passes a contradictory test, or an Implementer-side guess at the intended semantics — exactly the ambiguity the soft-callback exists to prevent. The semantics question (does favoriting an already-shown exercise reveal a new line?) is an owner-facing product decision the Designer should resolve explicitly in v2, not the Implementer at code time.
- This is round 1 of 3 (Design↔Validate); a v2 round is cheap and the fix is well-scoped.

Exact items for v2:
1. **[MAJ-1]** Resolve the union semantics: choose (Y) `topN_overall ∪ favorites` dedup (recommended, matches Discovery + the test's stated intent) or (X) keep top-N-of-non-favorites and document the promotion behavior. State it explicitly, fix the pseudo-code OR the test so they agree, and pin the chosen rule with a test (MIN-5).
2. **[MIN-1]** Fix the misleading "deduped by id" comment to describe the actual pool behavior.
3. **[MIN-3]** Add the canonical-target e2e assertion (star visible + Pencil absent) proving the `canEdit` gate split.
4. **[MIN-4]** Enumerate the ≥6 weighted live-catalog names for the e2e seed (or instruct the Implementer/Tester to live-verify).
5. **[MIN-5]** Add the cap-boundary + promotion/no-promotion unit cases.
6. **[MIN-2]** (optional polish) Re-space the 4 new palette hexes or soften the "high-contrast" prose.

Note: items 2, 3, and 4 of the flagged-item scrutiny (favoriteSet memo, header-right gate split, FK CASCADE) and Invariant F all verified SOUND — only the union/cap rule (item 1) needs rework.
