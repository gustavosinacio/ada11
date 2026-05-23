# Validation v2 — 2026-05-23_0211_configurable-max-volume-window

Round: Design↔Validate **round 2 of 3**.
Reviewing: `design-v2.md` against `validation-v1.md` and the codebase.

## Verification of validator checks

| Check | Result | Evidence |
|---|---|---|
| BLK-1 — migration filename `0009_max_volume_window.sql` everywhere actionable | **PASS** | Lines 34, 174, 209 use `0009`. The only `0008_max_volume_window` reference is the diff-from-v1 table (line 9) explaining the rename. `0009` is the next free index. |
| BLK-2 — `parseISO(...).getTime() >= windowStartMs` everywhere; threshold precomputed once per kernel call; no surviving lex compare | **PASS** | Contracts lines 102/107/114/121/129/136 all use `windowStartMs?: number`. Consistency rule table 147-151 uses `parseISO(...).getTime()`. Performance lines 230-231 describe per-call precompute. No surviving lex-compare — only mentioned in discarded alternatives (line 287) and BLK-2 fix narrative (line 214). |
| MAJ-1 — single `session.started_at` anchor; aggregate BEFORE filter; dual-anchor exception for `bucketLifetimeWeeklyVolumes` spelled out; `computeVolumeTarget` filters on `started_at` | **PASS** | Line 40 spells out the dual-anchor rule. Lines 141-155 are the Consistency rule table with per-kernel anchor pinning. `WeeklyVolumeRow.sessions.started_at` confirmed at `src/api/stats.ts:25`. `SessionSets.started_at` confirmed at `src/api/progress.ts:6`. |
| MAJ-2 — labels `All / 10w / 20w / 30w`; legend caption | **PASS** | Line 197 labels; line 199 caption. |
| MIN-3 — `useMemo(() => computeWindowStart(weeks, new Date()), [weeks])` pinned | **PASS** | Lines 13, 236-248. |
| `WeeklyVolumeRow.sessions.started_at` exists | **PASS** | `src/api/stats.ts:25`. |
| Single visible Consistency rule section | **PASS** | One section at line 141 (`### Consistency rule (cross-kernel)`). |
| `computeWindowStart` location named | **PASS** | `src/utils/window-utils.ts` (file-table row 39 + import at 237). |
| Cross-week-session test case (e) listed | **PASS** | Line 49: cross-week session — entire session excluded, not split. |

## New issues found in v2

### Blockers
None.

### Majors
None.

### Minors (new, not previously raised)

- **[NEW-MIN-1] `tests/component/` directory does not exist in this repo.** Design proposes `tests/component/profile-max-volume-window.test.tsx` (line 53), but only `tests/unit/`, `tests/e2e/`, and `tests/` root exist. Implementer should either (a) place at `tests/unit/profile-max-volume-window.test.tsx` to match the convention, or (b) introduce `tests/component/` explicitly. Not blocking.

- **[NEW-MIN-2] `windowStartIso` return field is essentially dead data.** `computeWindowStart` returns `{ windowStartIso, windowStartMs }` (line 87-90), but every consumer only uses `windowStartMs`. The "for display/debug" rationale (line 306) is not wired anywhere. Either drop `windowStartIso` from the return or wire it into the hero/strip caption to justify keeping it. Non-blocking.

- **[NEW-MIN-3] Dotted-overlay vs strip-bar visual asymmetry under narrow windows.** With window=10w and a lifetime peak outside the window, the strip shows a tall historical bar towering above the windowed "Best of last 10w" overlay — visually confusing because the overlay sits *below* a visible peak. The design (line 298) leaves the strip's per-bucket bar-height denom out of scope, which is correct, but Riscos → UX regressions doesn't acknowledge this trade-off. Suggest a one-line ack so Implementer doesn't try to "fix" it during component review.

## Decision

**go**

Counts: blockers=0, majors=0, minors=3 (all new, all non-blocking).

Confidence: **HIGH** — every claim in design-v2 verified against the codebase. The 3 new minors are polish-level concerns; none compromise correctness or break invariants.

Risk if shipped as-is: **LOW** — additive change gated by `weeks === 0` default; comprehensive test coverage including the cross-week regression (case e); numeric `parseISO(...).getTime()` mirrors the codebase's existing convention.

Recommendation: **invoke Implementer**.
