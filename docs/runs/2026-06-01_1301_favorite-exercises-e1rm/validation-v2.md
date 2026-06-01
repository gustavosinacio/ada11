# Validation v2 — 2026-06-01_1301_favorite-exercises-e1rm

Reviewing: `design-v2.md` (Design↔Validate round 2 of 3).
Round-1 verdict was **NO-GO** on MAJ-1 (union semantics) + 5 minors. This round confirms MAJ-1 resolution, re-verifies the 5 minors, and hunts for any new defect introduced by the v2 deltas. The v1-verified-SOUND content (Invariant F, `favoriteSet` memo, header-right gate, migration 0020/PK/RLS/FK, plain INSERT/DELETE API, hook) was NOT re-litigated except where v2 changed it.

## Verification of Designer's v2 claims (re-read against REAL source)

| Claim | Verified? | Evidence |
|---|---|---|
| `autoTopOverall = sorted.slice(0, topN)` is byte-for-byte today's selection | **yes** | Real code `e1rm-strength.ts:138-148` = `Array.from(byExercise.values()).sort(comparator).slice(0, topN)`. v2 (`design-v2.md:69,75`) splits the chained `.sort().slice()` into `const sorted = …sort(comparator)` then `autoTopOverall = sorted.slice(0,topN)`. Identical expression, same comparator (`:139-147` sessions DESC → lastActiveMs DESC → name ASC → id ASC). |
| Comparator UNCHANGED, only the slice replaced | **yes** | `e1rm-strength.ts:138-148`. v2's `sorted = …sort(comparator)` reuses the exact comparator; everything downstream (`ranked.map((agg,rank)=>…)` `:151`, LOCF `:151-181`) untouched. |
| `ranked.map((agg, rank) => …)` assigns rank = array index over the FINAL list (`:151`) | **yes** | `e1rm-strength.ts:151,180` — `rank` is the `.map` index; `{id,name,rank,values}` returned. v2 feeds `ranked = selected` (`:113`) into the same map → dense 0-based over the combined list. |
| First 8 `E1RM_PALETTE` hexes byte-for-byte unchanged | **yes** | `e1rm-strength-section.tsx:29-38` = `#ef4444,#3b82f6,#10b981,#f59e0b,#8b5cf6,#ec4899,#06b6d4,#84cc16`. v2 `:252-259` lists the SAME 8 in the SAME order, then appends 4. Existing rank-0..7 colors preserved. |
| `colorForRank(i) = PALETTE[i % len]`, comment assumes N≤8 | **yes** | `e1rm-strength-section.tsx:40-41`, comment `:28`. v2 extends `len` to 12 and ceiling to 12 → `i % 12` never wraps within the ceiling. |
| `E1RM_MAX_LINES` is a NEW const (not already defined) | **yes** | `grep -rn E1RM_MAX_LINES src/ tests/` → 0 hits. v2 adds it to `e1rm-strength.ts` (`:160`). No collision. |
| Pencil a11y label is `"Edit exercise"` (the e2e §D step-3 target) | **yes** | `progress.tsx:112` — literal `accessibilityLabel="Edit exercise"`. The Designer's "if it is not `Edit exercise`" residual is RESOLVED by source: it IS exactly that. |
| Legend chip label is `"Toggle <Name>"` — disjoint from the star's `"Favorite/Unfavorite <Name>"` | **yes** | `e1rm-strength-section.tsx:143` — `accessibilityLabel={\`Toggle ${s.name}\`}`. Star uses `"Favorite/Unfavorite <Name>"` (`design-v2.md:290-291`). No collision. |
| `screenHeader` is a plain `const` (rebuilds each render → optimistic flip applies) | **yes** | `progress.tsx:88` — plain `const screenHeader = (…)`, not memoized. `id`, `exercise.data?.name`, `colorScheme`, `router`, `canEdit` all in scope (`:51-87`). `Star` importable alongside `ChevronLeft`/`Pencil`. |
| `useMemo` model deps `[rows, exercises]` → add `favoriteSet` | **yes** | `e1rm-strength-section.tsx:48-51`. v2 `:236-239` adds `favoriteSet` as a 3rd dep. |
| Bodyweight-only exercise never enters `byExercise` (eligibility gate `:109`), excluded from `sorted` → from favorites | **yes** | `e1rm-strength.ts:107-109` — `const w = row.weight ? parseFloat : 0; if (!(w>0 && r>0)) continue`. A favorite id passed for a 0-weight exercise simply never appears in `byExercise` → `sorted` → `extraFavorites`. Favorite ROW persists in DB (toggle), chart line gated by Invariant D. Matches existing unit case `:222`. |
| `exercise-notes-api.test.ts` exists (the §B mirror) | **yes** | `tests/unit/exercise-notes-api.test.ts` present (10 KB). |
| e1rm unit factories `mkRow`/`mkExercise`, injected `NOW`; bodyweight case `:221-250`; top-N cap case `:274`; determinism `:425` | **yes** | `tests/unit/e1rm-strength.test.ts:65-66` (factories), `:222`, `:274`, `:426`. The §A new cases mirror these precedents. |
| Phase-2a bodyweight NEGATIVE e2e exists with the carry-in settle-gate | **yes** | `e1rm-strength.spec.ts` test "4. bodyweight-only … NO e1RM line" — uses the positive-anchor-then-`toHaveCount(0)` pattern (the CARRY-IN MAJ-1 lesson, comment in-file). v2 §D step 2/5/6 reuse the same settle-gate discipline. |
| Discovery's 1 production caller of the presenter = `e1rm-strength-section.tsx:50` | **yes** | `grep favoriteExerciseIds/exercise-favorites src/ tests/` → 0 (no pre-existing wiring); presenter imported only at `e1rm-strength-section.tsx:11,50`. `app/(app)/progress/index.tsx` mounts the section with no props. Closed set. |

All 15 load-bearing v2 claims verify against real source. No false claims this round.

## 1. MAJ-1 — RESOLVED (explicit, with algorithm trace + cited source)

**RESOLVED.** v2 replaces the v1 `autoTop = nonFavorites.slice(0, topN)` (top-N of the NON-favorite pool) with `autoTopOverall = sorted.slice(0, topN)` (`design-v2.md:75`) — the top-N OVERALL, which is **byte-for-byte today's `e1rm-strength.ts:148` `.slice(0, topN)`** (verified: same `sorted` array, same comparator, same slice). The fix is the algorithm the v1 no-go recommended (option Y).

Trace of each required property against the v2 pseudo-code (`design-v2.md:75-113`) and real `e1rm-strength.ts`:

- **(a) `autoTopOverall` == today's selection — HOLDS.** `sorted = Array.from(byExercise.values()).sort(comparator)` (`:69`) then `.slice(0, topN)` (`:75`) is the literal current `e1rm-strength.ts:138-148` chain, just two statements instead of one. No behavior change for the auto pick.
- **(b) Favoriting a top-N exercise is a NO-OP (not promoted, count unchanged) — HOLDS.** `autoIds = new Set(autoTopOverall.map(a=>a.id))` (`:76`); `extraFavorites = sorted.filter(a => favSet.has(a.id) && !autoIds.has(a.id))` (`:82`) EXCLUDES any favorite already in the top-N. Trace (6 eligible `[A,B,C,D,E,F]`, topN=5, favorite C [top-3]): `autoTopOverall=[A,B,C,D,E]`, `autoIds={A,B,C,D,E}`, `extraFavorites=[]` (C filtered out — in autoIds), `selected=[A,B,C,D,E]` → **5 series, C once, count UNCHANGED.** The v1 contradiction (algorithm produced N+1 while §A case 2 asserted N) is gone: §A case 2 (`design-v2.md:460`) now asserts "count is exactly topN=5, byte-identical to no-favorites output" and **WOULD PASS** against this algorithm.
- **(c) Favoriting OUTSIDE the top-N adds exactly that line — HOLDS.** Favorite F (rank 6): `extraFavorites=[F]`, `selected=[A,B,C,D,E,F]` → **6 series**, F appended last. (§A case 1, `:459`.)
- **(d) No double-count — HOLDS.** `extraFavorites` excludes `autoIds` by construction → `[...autoTopOverall, ...extraFavorites]` has zero overlap. Structurally impossible to duplicate (a favorite is in exactly one partition).
- **(e) Ranks 0-based dense over the FINAL list — HOLDS.** `ranked = selected` (`:113`) → existing `ranked.map((agg, rank) => …)` (`e1rm-strength.ts:151`) assigns `rank` = index 0..M-1. No gaps, no duplicate index.
- **(f) Invariant F byte-for-byte for empty/absent favorites — HOLDS, more obviously than v1.** `favSet` empty → `extraFavorites = sorted.filter(false…) = []` → `selected = [...sorted.slice(0,topN), ...[]] = sorted.slice(0,topN)` — the literal `e1rm-strength.ts:148` expression. Cap branch never fires (`5 ≤ 12`). v1's empty path was `[...[], ...nonFavorites.slice(0,topN)]` and relied on `nonFavorites===sorted`; v2 is the direct slice. Pinned by §A case 8 (`:466`).

The "What is NOT" clause (`design-v2.md:403`) adds an explicit prohibition on slicing from a non-favorite pool, locking the v1 bug out for future readers. **MAJ-1 is genuinely fixed — the central design decision now matches Discovery's default, the test, and the stated UX intent.**

## 2. Cap math against the NEW (overall) selection — VERIFIED

Cap code (`design-v2.md:96-111`), hand-traced:

```
if (selected.length > 12) {
  keptAuto = autoTopOverall.slice(0, max(0, 12 - extraFavorites.length));
  selected = [...keptAuto, ...extraFavorites];
  if (extraFavorites.length > 12) selected = extraFavorites.slice(0, 12);
}
```

- **Fires only when `topN + extraFavorites.length > 12` — HOLDS.** `selected.length = topN + extraFavorites.length` (a favorite inside top-N adds 0). So `>12 ⟺ extraFavorites.length > 7` (≥8 outside-top-N favorites). Below that, no trim — confirmed in §"cap/palette" (`:126`).
- **Drops lowest-ranked NON-favorites first; never a favorite (unless >12 favorites) — HOLDS.** `keptAuto = autoTopOverall.slice(0, max(0, 12-extraFavorites.length))` trims `autoTopOverall`'s TAIL (the lowest-comparator auto picks), keeps all `extraFavorites`. Favorites only trimmed in the degenerate `extraFavorites.length > 12` branch.
- **§A case 9 (exactly AT ceiling, no trim) — CORRECT.** 12 exercises, favorite 7 outside-top-5: `autoTopOverall=[A,B,C,D,E]`, `extraFavorites=[F..L]` (7), `selected.length=12` → `12 > 12` is FALSE (strict `>`) → no trim, all 12 plotted, ranks `[0..11]`. The strict `>` correctly keeps exactly-12 whole.
- **§A case 10 (one over, single non-favorite dropped) — CORRECT.** 13 exercises, favorite 8 outside-top-5 (F..M): `selected.length=13 > 12` → `keptAuto = autoTopOverall.slice(0, 12-8) = [A,B,C,D]` (E, the lowest auto pick, dropped), `selected=[A,B,C,D,F..M]` = 12, all 8 favorites kept. Correct.
- **§A case 11 (favorites > ceiling, favorites themselves trimmed) — CORRECT.** Seed 5 high-session non-favorites A..E + 13 outside-top-5 favorites: `autoTopOverall=[A,B,C,D,E]`, `extraFavorites`=13. `selected.length=18 > 12` → `keptAuto = slice(0, max(0,12-13)) = slice(0,0) = []`, `selected=13 favs`, then `13 > 12` → `selected = extraFavorites.slice(0,12)` = 12 favorites, zero auto. Correct. **Adversarial edge I added: `extraFavorites.length === 12` with non-empty auto** (5 auto + 12 favs = 17 > 12): `keptAuto = slice(0, max(0,0)) = []`, `selected = 12 favs`, `12 > 12` FALSE → no double-trim → 12 favorites. Correct — the boundary between the two sub-branches is clean (no off-by-one, no double-slice).

Cap arithmetic is sound on every branch and boundary.

## 3. The 5 minors — each adequately folded

- **MIN-1 (misleading dedup comment) — RESOLVED.** `design-v2.md:84-89` rewrites the comment to describe the actual invariant: "extraFavorites EXCLUDES autoIds, so the concat is dedup-by-construction … this is NOT 'dedup of an overlap' — it is 'the overlap was never built' … we do NOT slice from a non-favorite pool." Matches the corrected algorithm; no stale wording.
- **MIN-2 (palette hue spacing) — RESOLVED.** `design-v2.md:260-263` replaces the v1 yellow/orange/purple with deep-green `#15803d`, slate `#64748b`, rose `#e11d48`, brown `#92400e`. Per-hue rationale at `:267`. None adjacent to amber (`#f59e0b`, rank 3) or violet (`#8b5cf6`, rank 4). First 8 byte-for-byte preserved (verified). Adequate. (See MIN-NEW-1 below — a small residual on one of the new hues, non-blocking.)
- **MIN-3 (canonical-vs-Pencil e2e assertion) — RESOLVED.** §D step 3 (`:505`) asserts, on the CANONICAL target "Lat Pulldown (Cable)": `getByLabel("Favorite Lat Pulldown (Cable)")` visible AND `getByLabel("Edit exercise")` count-0 — proving the star is OUTSIDE the `canEdit` gate. The Pencil label is verified `"Edit exercise"` (`progress.tsx:112`), so the assertion targets the right string. The bracketed "confirm against progress.tsx:108-122" caveat is now moot — it IS `"Edit exercise"`.
- **MIN-4 (e2e seed names enumerated) — RESOLVED (with a verify-at-implement caveat the design itself states).** §D (`:492-500`) enumerates 5 top (Bench Press, Squat (Barbell), Deadlift (Barbell), Overhead Press (Barbell), Barbell Row) + 1 outside-top-N target (Lat Pulldown (Cable)), all canonical, with explicit "Implementer/Tester MUST live-verify each via `pickCanonicalExercise` (throws on miss → fails fast, not false-green)". `pickCanonicalExercise` throw-on-unknown verified (`canonical-exercise.ts:49-54`, prior run). The names 3-6 are NOT yet live-verified — correctly flagged as a downstream residual (see §4). Adequate for go.
- **MIN-5 (cap-boundary + promotion unit cases) — RESOLVED.** §A pins promotion via case 1 (outside→+1) and case 2 (inside→same), plus case 9 (at-ceiling no-trim), case 10 (one-over single-trim), case 11 (favorites>ceiling). All five new cases trace correctly (§2 above). The cap branch's two sub-branches (untested in v1) are now both pinned.

## 4. The 2 residuals the Designer flagged — genuinely downstream-resolvable

- **Pencil a11y label — NOT actually a residual; resolved here.** The design's §D step-3 note ("if it is not `Edit exercise`, assert on whatever label the Pencil exposes") hedges, but I confirmed `progress.tsx:112` IS `accessibilityLabel="Edit exercise"`. The e2e target string is correct as written; no implement-time decision needed. **High-leverage corollary (see MIN-NEW-2):** two EXISTING specs already assert on this exact label/header slot, so the v2 header change must preserve it — verified it does.
- **e2e seed names 3-6 live-verify — genuinely downstream, no design gap.** Names 3-6 (Deadlift (Barbell), Overhead Press (Barbell), Barbell Row, Lat Pulldown (Cable)) are plausible canonical weighted names but were not live-catalog-verified in this validation (no live catalog access at design time). The design correctly routes this to the Implementer/Tester with a fail-fast guard (`pickCanonicalExercise` throws on a missing name → loud failure, not a false-green). This hides NO design gap: the algorithm, the union semantics, and the assertions don't depend on WHICH weighted names are used, only that 5 sit in the top-5 by distinct sessions and 1 sits outside. Downstream-resolvable.

## 5. New issues introduced by the v2 deltas

### Ordering choice (top-N-overall first, then extras) — keeps ranks/colors stable: CONFIRMED
The chosen order (`design-v2.md:133`) is top-N-overall first (comparator order), then extra favorites (comparator order). Adding an outside-top-N favorite appends it at rank `topN` (a NEW color slot) WITHOUT shifting ranks 0..topN-1 of the existing lines → `colorForRank(0..4)` unchanged for the established lines. This is the design's stated benefit and it holds: the first partition is always `sorted.slice(0,topN)` in comparator order regardless of `favSet`, so existing lines never recolor on a favorite add. The rejected "favorites-first" ordering (`:140`) WOULD have shifted every rank — correctly descartada. Determinism: both partitions derive from the same comparator-sorted `sorted` (final tiebreak `id ASC`, a total order), so the output is independent of `favSet` iteration order — pinned by §A case 7.

### Palette first-8 byte-for-byte: CONFIRMED (verified above).

### Blockers
None.

### Majors
None.

### Minors
- **[MIN-NEW-1]** `design-v2.md:262` — rose `#e11d48` (rank 10) vs the existing pink-500 `#ec4899` (rank 5). These are 5 ranks apart, so they are never *adjacent* by rank, but both are warm magenta-reds; on a 200px multi-line chart with 11+ lines plotted they are the closest pair in the extended palette (both reddish, alongside red-500 `#ef4444` rank 0). The design's own rationale (`:267`) calls rose "distinct from red-500 (lighter) and pink-500 (more magenta)" — true at the hex level, but the perceptual gap is the tightest of the 4 new hues. This only matters in the ≥11-line regime (≥6 outside-top-N favorites simultaneously visible), which for a sole user is rare. **Suggested fix (optional):** swap rose for a clearly cooler/distinct hue (e.g. teal `#0d9488` or indigo `#4338ca`) if the Implementer wants maximum separation; OR leave as-is and accept the LOW/LOW residual (the design's "distinct hexes, no two lines share a color within the ceiling" guarantee still holds literally). Cosmetic; LOW. Not a go-blocker.
- **[MIN-NEW-2]** `design-v2.md:271-308` (header-right rewrite) — the v2 change moves the Pencil from `headerRight: canEdit ? () => <Pencil/> : undefined` (a top-level conditional returning `undefined`) to `headerRight: () => <View>…<Star/>{canEdit ? <Pencil/> : null}</View>` (always-present function, Pencil conditional inside). The design does NOT call out that **two existing e2e specs assert on this exact slot**: `canonical-exercise-gating.spec.ts:171-189` (canonical → `getByLabel("Edit exercise")` count-0; user-owned → visible) and `exercise-progress-ia.spec.ts:118-120,146,223` (Pencil visible + clickable). I verified the v2 change preserves both: the Pencil stays gated by `canEdit` and keeps its `"Edit exercise"` label, the star uses a disjoint `"Favorite/Unfavorite <Name>"` label, so `getByLabel("Edit exercise")` count is unchanged in every branch. **No regression** — but the design should EXPLICITLY name these two specs as a regression surface (it currently lists only the new spec and adjacent-locator pre-audit in §Riscos). **Suggested fix:** add `canonical-exercise-gating.spec.ts` + `exercise-progress-ia.spec.ts` to the "regression surface to re-run" note so the Tester re-runs them after the header edit. Documentation-only; LOW. Not a go-blocker (the behavior is correct; only the callout is missing).

## Decision

**go**

Reasoning:
- 0 blockers, 0 majors, 2 minors (both NEW, both LOW/LOW: one cosmetic palette nit, one missing-regression-callout). By the decision rule (0 blockers and ≤1 major → go; only minors → go), this is a clean **go**.
- **MAJ-1 is RESOLVED** — the central union/cap rule now computes top-N-OVERALL ∪ favorites (byte-for-byte today's `.slice(0,topN)` for the auto pick), favoriting a top-N exercise is a verified no-op (§A case 2 now passes against the algorithm), favoriting outside adds exactly one line, no double-count, dense ranks, and Invariant F is the literal current expression. All five v1 minors are adequately folded; the cap arithmetic is sound on every branch and boundary.
- The 2 Designer-flagged residuals are genuinely downstream (e2e seed names 3-6 live-verify; the Pencil label is in fact resolved to `"Edit exercise"` here) and hide no design gap.
- This is round 2 of 3; no need for a round 3.

### Non-blocking notes for the Implementer
1. **[MIN-NEW-1]** (optional) consider a cooler hue for rank 10 (rose `#e11d48` is the closest perceptual pair to pink/red in the extended palette); only matters in the ≥11-line regime. Leave-as-is is acceptable.
2. **[MIN-NEW-2]** when editing `progress.tsx` headerRight, re-run `canonical-exercise-gating.spec.ts` and `exercise-progress-ia.spec.ts` — both assert on `getByLabel("Edit exercise")` in that slot. The v2 design preserves the Pencil gate + label (verified), so they should stay green; confirm.
3. **Residual A (resolved, just confirm):** the Pencil's a11y label is `"Edit exercise"` (`progress.tsx:112`) — the §D step-3 assertion `getByLabel("Edit exercise").toHaveCount(0)` on the canonical target is correct as written; drop the "if it is not" hedge.
4. **Residual B (downstream):** live-verify §D seed names 3-6 (Deadlift (Barbell), Overhead Press (Barbell), Barbell Row, Lat Pulldown (Cable)) via `pickCanonicalExercise` at seed time; substitute any missing name with another live-catalog WEIGHTED canonical (do NOT use "Pull-up"; do NOT favorite a bodyweight-only exercise — it can't plot, vacuous). `pickCanonicalExercise` throws on a miss → fails fast, not false-green.
5. The favorite ROW persists in the DB even for a bodyweight-only exercise that can't plot (verified: eligibility gate `e1rm-strength.ts:109` is upstream of the union; the toggle still inserts the row). Don't add a "favoritable only if plottable" guard — the design intentionally allows favoriting any exercise.
