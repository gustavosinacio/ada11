# Validation v2 — 2026-05-24_2233_sessions-list-on-progress-chart

Round: Design↔Validate round 2 of ≤3.
Reviewing: `design-v2.md`.

## Verified claims

| Claim | Verified? |
|---|---|
| `formatDisplayDate({includeTime: true})` supported | YES (`format-display-date.ts:103-107`) |
| `SECTION_HEADER` literal `"mt-4 mb-2 text-sm font-medium uppercase text-gray-500"` at `history/week/[isoWeek].tsx:20-21` | YES |
| `<SessionSummaryRow>` reads `session.name` + `session.ended_at` (blocks structural-subset reuse) | YES |
| `useFinishSession` invalidates `["progress"]` at `use-sessions.ts:63` | YES |
| `useExerciseProgress` queryKey `["progress", exerciseId]` at `use-progress.ts:7` | YES |
| TanStack default `exact: false` covers prefix-match | YES |
| `formatVolume(3200, "lbs")` → `"7,055 lbs"` (matches `(kg|lbs)` regex) | YES |
| `progress.tsx` ambient `px-6` at `:120` | YES |
| `sumPastVolume` currently private `function`; single-line export change | YES |
| 3 e2e empty-state assertions still pinned | YES |

## v1 issue closure

| ID | Status |
|---|---|
| BLK-1 (regex hardcodes `kg`) | RESOLVED — `(kg|lbs)` + explicit lbs e2e case |
| MAJ-1 (same-day a11y collision) | RESOLVED — `includeTime: true` on a11y label only |
| MAJ-2a (section header divergence) | RESOLVED — inlined `SECTION_HEADER` literal with comment pointing at precedent; consistent with project's `SECTION_HEADER`-per-file convention |
| MAJ-2b (horizontal alignment) | RESOLVED — row drops `px-4`; ambient `px-6` wins |
| MIN-1 (`Pick<SessionRow>` alt) | RESOLVED |
| MIN-2 (JSDoc on presenter) | RESOLVED |
| MIN-3 (long-page screenshot) | RESOLVED |
| MIN-5 (cache prefix-match) | RESOLVED |

## New findings

### Blockers
None.

### Majors
None.

### Minors

- **NEW-MIN-1 — doc accuracy on rejected alt**: design says `Pick<SessionRow>` synth would trigger "In progress" badge because `ended_at` is null. Verified false: if synthesizer sets `ended_at: started_at` (non-null string), `!session.ended_at` is `false` and the badge does NOT fire. The rejection still holds because the `"Workout"` title fallback and `"0m"` duration are independent failure modes. Doc-only; no design change.

- **NEW-MIN-2 — test-tooling translation**: design recommends `getAllByLabelText` (RNTL syntax). Project's e2e is Playwright (`page.getByLabel(/^Open session from /)`). Tester maps to Playwright API; no design change.

- **NEW-MIN-3 — `sessionsDesc` vs `e1rmData` asymmetry**: `e1rmData` only includes sessions with `sessionBestE1rm > 0`; `sessionsDesc` enumerates all `progressQ.data`. A session with only warmups would render in `sessionsDesc` with empty `volumeLabel` → date-only row. The presenter's `volumeLabel === "" → suppress line-2` rule handles gracefully (row still tappable, shows date). Cosmetic edge case.

## Decision

**go** — 0 blockers, 0 majors, 3 polish minors.

Counts: blockers=0, majors=0, minors=3.

Confidence: HIGH. Risk: LOW (additive change, no DB/RLS/migration, pinned e2e assertions still green inside `e1rmData.length > 0` truthy branch).

## Recommendation

**Invoke Implementer**. Hand-off notes:
- NEW-MIN-1: doc inaccuracy noted; Implementer can ignore the "In progress" rationale line in v2 Alt #2.
- NEW-MIN-2: Tester uses Playwright `getByLabel` + count assertions, not RNTL `getAllByLabelText`.
- NEW-MIN-3: warmup-only sessions render date-only row (acceptable).
