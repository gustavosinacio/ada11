# Validation v3 — 2026-05-22_0030_progress-page (FINAL ROUND)

> Validator (subagent) tool whitelist excludes Write. Findings returned as text and persisted here by the Conductor.

## v2 issues — verification

| Issue | v3 fix | Verified at |
|---|---|---|
| BLK-3 (null `completed_at` crash) | `.not("completed_at", "is", null)` on both branches + post-fetch defensive assertion + TS narrow `completed_at: string` | design-v3.md:30-45, :294, :302-307, :262 |
| MAJ-4 (data source pinned) | Client-side derivation; `listSetsThisWeek` + `ThisWeekSetRow` dropped; 2 new helpers extracted | design-v3.md:83-179, :188-190, :438-458 |
| MIN-8 (file-ordering prose) | Rewritten: `measurements` is `href: null`; visible tab order is History → Progress → Profile | design-v3.md:198, :234 |
| MIN-9 (`staleTime: 60_000`) | Added to `useFinishedSessionStartedAts` | design-v3.md:373, :512 |

**All v2 issues are addressed in v3.**

## Source-code claim verification

Spot-checked claims against the repo:
- `SetRow.completed_at: string | null` — `src/db/types.ts:124` ✓
- `finishSession` only stamps `ended_at` — `src/api/sessions.ts:62-71` ✓
- `.gte("completed_at", sinceUtc)` implicitly excludes NULL — confirmed (`NULL >= x` is NULL → row dropped) ✓
- Crash path `weekKeyOf(parseISO(row.completed_at))` — `weekly-volume-strip.tsx:44`, `history/week/[isoWeek].tsx:96` ✓
- `useAllExercises` returns unfiltered library — `src/hooks/use-exercises.ts:42` ✓
- `measurements` tab is `href: null` — `app/(app)/_layout.tsx:54` ✓
- `["stats"]` cascade catches `["stats", "progress-page", *]` — `use-sessions.ts:62/108/121` ✓

## New scrutiny

### Narrowing `WeeklyVolumeRow.completed_at` to non-null
Only two consumers: `weekly-volume-strip.tsx:38-44` and `history/week/[isoWeek].tsx:96`. Neither uses `?.` or null-checks. Narrowing is safe and improves type safety.

### Post-fetch assertion (defense-in-depth)
`rows.some(r => r.completed_at === null)` is one O(N) scan on the lifetime read (~µs for 15k rows). Justified given BLK-3 history; flagged as MIN.

### Test-count integrity
v2 ended at #41 (35 legacy + BLK-2 #39/#40/#41 + MAJ-3 #23/#24 + MIN-2 #37). v3 adds 15 (#42-#56). Total = **56 unit + 7 e2e**. Carries every v2 test forward.

### Carryover from v2
Verified the "What did NOT change" block. BLK-1, BLK-2, MAJ-1, MAJ-2, MAJ-3, MIN-1..7, page composition, tab icon, hero/bars/list/streak component breakdown, muscle-grouping rule, soft-fallback streak, empty-state copy, e2e plan — all preserved.

### MAJ-4 vs BLK-3 documentation consistency
v3 documents the `.not("completed_at", "is", null)` filter for the dropped `listSetsThisWeek` as a "historical artifact" in case of future reintroduction. Deliberate documentation choice, not a contradiction.

## Issues found

### Blockers / Majors
**None.**

### Minors

- **[MIN-10]** `endOfWeek` used in derivation snippet (design-v3.md:109) without explicit import. Existing repo imports it in `src/utils/dates.ts:2`. Implementer must remember to import. Suggested: note "imports `endOfWeek` from `date-fns`" inline, or wrap behind a `dates.ts` helper.

- **[MIN-11]** Post-fetch `rows.some(...)` assertion is O(N) on potentially 15k rows on cold start. Negligible cost (~µs) but a third pass over the data. Defense-in-depth justified; acceptable.

- **[MIN-12]** v3 adds 11 tests for MAJ-4 surface (4 + 3 + 4 conditional), but tests #53-#56 are tagged "Implementer call on whether to test through the hook or directly-exported pure helper". Pin which are required vs deferred in `implementation.md`.

## Decision

**`go`**

Reasoning:
- All v2 blocker + major + minors resolved with verifiable evidence.
- No new blockers or majors introduced.
- v3 scope is tight delta from v2 — no scope creep.
- 3 minors are lingering polish, not implementation risk.

## Counts

`{ blockers: 0, majors: 0, minors: 3 }`

## Recommendation to Conductor

`invoke Implementer`. Implementation proceeds with design-v3.md as source of truth. Surface the 3 minor items in `implementation.md` as known notes.
