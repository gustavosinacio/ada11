# Final summary — 2026-06-03_1402_bodyweight-leverage-factors

## Outcome
- **Feature**: Per-exercise bodyweight leverage factor. A bodyweight exercise now contributes `(bodyweightKg × factor) + addedLoad` per rep instead of full bodyweight (e.g. push-up 0.64). Factor stored in a new nullable `exercises.bodyweight_factor numeric` column (migration 0021), backfilled on 7 canonical rows; the same migration reclassifies Pull Up / Chest Dip / Hanging Knee Raise from `equipment=null` to `bodyweight`. Backend-only (no UI); e1RM excluded; added load (belt/vest) never scaled.
- **Pipeline result**: **shipped** — migration applied to live DB (human-approved); code pending commit + deploy at close.
- **Branch / baseline**: `main`; baseline `3c85c23` (clean working tree at start).

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | **yes** (Tester live: Push-up 80kg×10 = **512 kg** leveraged, not 800; Pull Up **640 kg** where it was 0 pre-migration) |
| Human interventions during run | 2 (the 4-decision design batch; the migration-apply approval gate) |
| Total round-trips | 1 re-loop (Design↔Validate went to round 2 after a v1 NO-GO) |
| Design ↔ Validate rounds | 2 (v1 NO-GO → v2 GO) |
| Implement ↔ Review rounds | 1 (PASS) |
| Implement ↔ Test rounds | 1 (PASS) |
| Implementer soft-callbacks | 0 (budget 2/2 intact) |
| Wall-clock duration | ~01:25 (14:02 → 15:27 BRT) |
| Token cost | n/a |

## Quality gates (final)
- `npm run typecheck`: 0 errors. `npm run lint`: 0 errors / 1 pre-existing `router.d.ts` warning.
- `npx vitest run`: **505 / 505** (+20 over the 485 baseline) — incl. STRING-input teeth tests for the seam and a cross-surface (`"0.64"` end-to-end → 512) test.
- e2e regression: **52/52 across 12 specs, 0 flaky**.
- Live close-loop: migration 0021 applied + backfill verified (7 rows, exact factors); leveraged volume rendered correctly in the running app.

## Key decisions (human-locked)
- Storage = new nullable `bodyweight_factor numeric` column (NOT a code map); NULL ⇒ coalesce to 1.0 NEVER 0.
- Backend-only (no editable UI field this run).
- Reclassify the 3 mis-tagged movements to bodyweight (retroactive volume shift — locked U3).
- Values: Push-up 0.64; Dip/Chin-up/Pull Up/Chest Dip 1.0; Hanging Leg Raise/Hanging Knee Raise 0.50.
- Migration application to live DB: explicitly approved at the gate (the "deploy ALWAYS" authorization did not cover DB migrations).

## Design↔Validate story (the value the pipeline added)
v1 was NO-GO on 2 majors the Validator caught before any code was written:
- **MAJ-1**: v1's "only 2 `SetBodyweightInput` builders" closed-set proof was FALSE — there are 6 (4 un-wired feed the live workout header, end-of-session verdict + PR detection, and History detail). v2 wired all 6 with `factorByExerciseId` REQUIRED (compiler-enforced anti-desync).
- **MAJ-2**: PostgREST/`numeric` typing — every sibling numeric in the app is `string|null` + parseFloat, so v1's `number|null` factor typing risked silently no-op'ing the feature while number-literal tests stayed green. v2 committed to `string|null` + `effectiveWeightKg(factor?: number|string|null)` with internal parseFloat, and STRING-input teeth tests. (Live note: this instance actually returned a number; the seam handles both — defensive, not harmful.)
v2 was GO (1 minor: an incomplete fixture-update list, surfaced deterministically by `tsc`).

## Files changed (~29: 19 source edited, 8 test fixtures, 2 new)
Seam + kernels: `bodyweight.ts`, `volume-target.ts`, `progress-page-math.ts`, `weekly-muscle-volume.ts`, `weekly-volume-strip-math.ts`, `exercise-session-row-format.ts`, `session-verdict-math.ts`, `use-progress-page.ts`. The 6 `SetBodyweightInput` builders incl. `volume-target-slot.tsx`, `exercise-block.tsx`, `exercise-session-row.tsx`, `app/(app)/workout/[sessionId].tsx`, `app/(app)/workout/verdict/[sessionId].tsx`, `app/(app)/history/[id].tsx`. ROW-fed: `app/(app)/history/week/[isoWeek].tsx`, `app/(app)/exercises/[id]/progress.tsx`. Schema/types/query: `src/db/schema.ts`, `src/db/types.ts`, `src/api/stats.ts`. New: `supabase/migrations/0021_bodyweight_factor.sql`, `tests/unit/volume-target-factor.test.ts`. + 8 edited unit fixtures.

## Notes / follow-ups
- **Migration-history bookkeeping**: applied via the Supabase MCP `apply_migration` (records a timestamp version), not `supabase db push` (which was auto-blocked by the safety guardrail). The local `0021_bodyweight_factor.sql` is idempotent, so a future `db push` re-applying it is a harmless no-op. Reconcile the version label later if desired.
- **Doc nit (not a defect)**: the Tester observed the live client returning the factor as a JS number while the Conductor's MCP `execute_sql` showed a string. The seam handles both. `db/types.ts:93-95`'s "numeric reads back as string" comment may not be universally true on this instance — worth a one-line clarification someday.
- **Deferred (out of scope)**: editable per-exercise factor UI (no user-owned bodyweight exercises exist yet); CHECK constraint on the factor range; secondary-muscle attribution (open feature #2); dose-metric revisit (open feature #3, parked as a research memo).
- iOS/Android not exercised (web-only e2e harness); pure-arithmetic + column-read change, Risk LOW.

## Artifacts
- [`state.md`](./state.md) · [`discovery.md`](./discovery.md) · [`design-v1.md`](./design-v1.md) · [`validation-v1.md`](./validation-v1.md) · [`design-v2.md`](./design-v2.md) · [`validation-v2.md`](./validation-v2.md) · [`implementation.md`](./implementation.md) · [`review-v1.md`](./review-v1.md) · [`test-report-v1.md`](./test-report-v1.md) · [`transcript.md`](./transcript.md) · [`screenshots/`](./screenshots/) · `retro.md` (owner)

## Bugs found post-merge (backfill within 7 days)
- (none yet)

## Archive
- Archived to vault: `$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-06-03_1402_bodyweight-leverage-factors/` on 2026-06-03 15:27 BRT.
