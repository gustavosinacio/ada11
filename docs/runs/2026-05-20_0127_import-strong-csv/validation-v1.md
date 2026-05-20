# Validation v1 — 2026-05-20_0127_import-strong-csv

Reviewing: `design-v1.md`

## Verification of Designer's claims

| Claim | Verified? | Notes |
|---|---|---|
| `sessions` table has the columns `user_id`, `started_at`, `name`, `notes`, `ended_at` and `started_at IS timestamp with time zone` | yes | `src/db/schema.ts:106-125` confirms. |
| `sets.exercise_id` has `onDelete: restrict` | yes | `src/db/schema.ts:139` confirms. Re-import wipe strategy correctly flagged as constrained. |
| `scripts/create-user.ts` uses service-role + `persistSession: false` | yes | `scripts/create-user.ts:18-25` confirms. |
| Migration 0005 is the latest; next is 0006 | yes | `supabase/migrations/` confirmed (0000…0005). |
| 12,381 rows, 156 unique exercise names, date range 2019→2026 | yes | Confirmed via the Conductor's own CSV sampling during Discovery. |
| Strong CSV has notes with commas — naïve parsing fails | yes | Confirmed by the `bicepenis` duration-column artifact in the Conductor's awk sample. |
| `sets` requires `set_type` IN `('warmup','working','dropset')` with parent invariant | yes | `src/db/schema.ts:161-169` confirms. Imported `'working'` with `parent_set_id=null` passes the check. |

All claims grounded in code; no hallucinated APIs.

## Issues found

### Blockers
- *(none)*

### Majors
- **[MAJ-1]** `design-v1.md → Riscos → Re-run safety`: the design acknowledges partial-failure orphans (session exists but sets failed) but defers the strategy to the Implementer. This is too loose for a 12k-row run. **Required**: the Implementer must specify ONE strategy in `implementation.md`: either (a) treat session+sets as a "complete it or skip it" unit — if session exists, query its set count vs CSV's expected set count, and if mismatched, **delete-and-reinsert that session** atomically, or (b) keep a small JSON checkpoint file (`<csv-dir>/strong-import-checkpoint.json`) listing successfully-completed `(started_at, name)` keys so the next run skips them entirely. The script must NOT silently leave orphans.
- **[MAJ-2]** `design-v1.md → Contratos → Mapping CSV schema` allows `action = drop`, but the design body doesn't say what happens to **sessions** where ALL rows mapped-to-drop (e.g. a workout that was 100% cardio). They'd produce a session with zero sets — which the app's history detail probably renders as an empty row. Specify: if a session has zero retained sets after the mapping pass, **skip the session entirely**, do not create it. Document this in `implementation.md`.

### Minors
- **[MIN-1]** The Drizzle `text("source")` column will type-infer as `string | null` in `SessionRow` and `ExerciseRow`. Components currently passing those rows around won't break (no consumer dereferences `source` today). Note in `implementation.md` to confirm via typecheck.
- **[MIN-2]** Date parsing: Strong's `Data` is naïve datetime (no TZ). Per user, BRT. Conversion to UTC for storage needs an explicit `America/Sao_Paulo` zone, not the host's local TZ (the script might run on a CI box with a different TZ). Use a TZ-aware library (`date-fns-tz`, `luxon`) or build the UTC offset manually (-03:00 year-round; BRT does not observe DST since 2019). Specify the chosen approach in `implementation.md`.
- **[MIN-3]** Duration "143h 49min" should be CLAMPED to a sensible upper bound (e.g. 6 hours) before computing `ended_at`. Otherwise the session card will read "143h workout" forever. Specify the clamp threshold + behavior in `implementation.md`.
- **[MIN-4]** The mapping CSV's `confidence` field (`high`/`medium`/`low`) is qualitative; the `fuzzy_score` is numeric. Pick one or define how they relate. Suggest: drop `confidence`, keep `fuzzy_score` (0..1) with thresholds documented in the script (≥0.85 auto-suggest `map`, 0.5..0.85 auto-suggest `map` but flag for review, <0.5 auto-suggest `create-new`).

## Issues raised in previous validation (N=1 first round — table omitted)

## Decision

**go**

Reasoning:
- 0 blockers; 2 majors that must be addressed in `implementation.md` but do not require a Design re-spin (Designer's intent is clear, just under-specified on those two points).
- The 4 minors are quality-of-implementation notes; the Implementer can resolve them inline.
- Confidence in the design is high enough to proceed. Re-running Design ↔ Validate for these gaps would waste a round budget on what is fundamentally Implementer-domain detail.

**Implementer must address before reporting `done`**:
- MAJ-1: pick a partial-failure-recovery strategy and document it.
- MAJ-2: skip sessions whose retained-set count is zero after mapping.
- MIN-1..MIN-4: address inline.
