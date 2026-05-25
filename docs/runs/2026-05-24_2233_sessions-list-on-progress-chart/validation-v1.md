# Validation v1 — 2026-05-24_2233_sessions-list-on-progress-chart

Round: Design↔Validate round 1 of ≤3.
Reviewing: `design-v1.md`.

## Verified claims

| Claim | Verified? |
|---|---|
| `listSetsForExercise` returns `{session_id, started_at, sets}` ASC | YES (`progress.ts:4-39`) |
| `sumPastVolume` export change is single-line, non-breaking (only caller is in same file) | YES |
| `<ExerciseSessionRow>` props match `SessionSets` shape | YES |
| `<SessionSummaryRow>` reuse not viable — requires `SessionRow.name` + `.ended_at` | YES |
| Chart volume math at `progress.tsx:79-86` matches `sumPastVolume` predicate | YES |
| Empty-state copy gated on `e1rmData.length > 0` — 3 e2e assertions preserved | YES |
| Reversing ASC produces DESC | YES |
| `<FlatList>` inside `<ScrollView>` anti-pattern; `.map()` correct | YES |
| `weight_unit` default kg; lbs valid | YES |
| No `accessibilityLabel` clash for `"Open session from {date}"` (string-wise) | YES — but see MAJ-1 |
| `formatVolume(3200, "kg")` → `"3,200 kg"` | YES |
| Aggregate regex `^\d+ × [\d,]+ kg$` matches kg case | PARTIAL — see BLK-1 |
| `app/(app)/history/week/[isoWeek].tsx` already has a "Sessions" section using `SECTION_HEADER` (uppercase, small, gray) | YES — design ignores this precedent |
| Helper returns `{count, volumeKg, volumeLabel}` (parts, not just label) | YES |
| `useFinishSession` invalidates `["progress"]` | not independently verified; cited by Designer/Discovery, plausible |

## Findings

### Blockers

- **BLK-1 — Aggregate regex hardcodes `kg`, fails lbs mode.** Design pins `^\d+ × [\d,]+ kg$` as the e2e text contract. For users with `weight_unit = "lbs"`, the row emits `"4 × 27,213 lbs"` (`formatVolume(value, "lbs")` outputs `"<rounded> lbs"`). Tester would write a regex that systematically fails on lbs fixtures. **Fix**: change pinned regex to `^\d+ × [\d,]+ (kg|lbs)$` AND add an explicit lbs e2e pin (not just the unit-test fixture which already exists).

### Majors

- **MAJ-1 — Same-day sessions produce identical a11y labels.** Design's `accessibilityLabel={`Open session from ${formatDisplayDate(started_at, { includeWeekday: true })}`}` produces collisions when a user has two sessions on the same calendar day (real scenario: morning + evening blocks, Strong CSV imports). Consequences: (a) screen-reader users hear identical labels for distinct rows (a11y regression); (b) `screen.getByLabelText(/Open session from /)` would throw on multi-match — `getAllByLabelText` would be needed; (c) tap-by-label automation breaks. **Fix**: include time-of-day in the a11y label (cheapest: pass `includeTime: true` to the label only, keep visible date short).

- **MAJ-2 — Section styling diverges from existing precedent + horizontal alignment.** `app/(app)/history/week/[isoWeek].tsx:195` already uses `SECTION_HEADER = "mt-4 mb-2 text-sm font-medium uppercase text-gray-500"` for its "Sessions" header. Design instead proposes `text-lg font-semibold text-black dark:text-white` — divergent styling for the same name across screens. Also: screen body has ambient `px-6` while row has internal `px-4` → row content inset 40px from screen edge AND row's stripe won't align with chart container's left edge (visible jog). **Fix**: (a) decide on `SECTION_HEADER` token vs proposed bold header with documented rationale; (b) align horizontal — either drop row `px-4` to let `px-6` ambient win, or wrap rows in `<View className="-mx-6">` so they go edge-to-edge like `/history`.

### Minors

- **MIN-1 — Alt 1 (structural-subset reuse) not surfaced**: extending `<SessionSummaryRow>`'s prop to `Pick<SessionRow, "id" | "started_at" | "name" | "ended_at">` is a thinner alternative than synthesizing `SessionRow`. Design correctly rejects (would always show "Workout" + "in progress" badge) but should name it for completeness.

- **MIN-2 — Helper returns `{count, volumeKg, volumeLabel}` but consumer only uses `volumeLabel`**. Defensible for unit-test ergonomics + future per-set extension. Add a one-line JSDoc.

- **MIN-3 — Long-page screenshot capture suggested for Tester** (deep-link to progress + visible volume chart placement on small screens).

- **MIN-4 — Helper file naming `exercise-session-row-format.ts` mirrors `session-row-format.ts`** — symmetry preserved.

- **MIN-5 — `useFinishSession` cache-key invalidation prefix-match** — TanStack should cover `["progress"]` → `["progress", exerciseId]`. Implementer should verify if any cache key is more specific.

- **MIN-6 — Chevron color literal `#9ca3af`** matches existing pre-existing convention; no fix.

## Decision

**no-go** (1 blocker + 2 majors).

Counts: blockers=1, majors=2, minors=6.

Confidence: HIGH on BLK-1 (regex literal verified against `formatVolume` output) and MAJ-1 (same-day scenario verified). HIGH on MAJ-2 styling (cross-screen precedent at `history/week/[isoWeek].tsx:195`).

## Recommendation

Invoke Designer v2 with:
1. Unit-agnostic aggregate regex `(kg|lbs)`.
2. A11y label disambiguator (time-of-day).
3. Section styling decision: pick `SECTION_HEADER` token OR document rationale for bold variant.
4. Horizontal alignment fix between `px-6` ambient and `px-4` row.
