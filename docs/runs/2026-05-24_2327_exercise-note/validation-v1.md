# Validation v1 — 2026-05-24_2327_exercise-note

Round: Design↔Validate round 1 of ≤3.
Reviewing: `design-v1.md`.

## Verified claims

| Claim | Verified? |
|---|---|
| `0005_measurements.sql:72-96` is the cleaner 4-policy inline RLS precedent | YES |
| `touch_updated_at` exists since 0001 | YES |
| `measurement_entries_user_day_idx` is partial UNIQUE expression index in SQL source-of-truth | YES |
| `routine_exercises.exercise_id`/`sets.exercise_id` use `onDelete: "restrict"` | YES (`schema.ts:93,145`) |
| 4 UI mount points verified (progress 138-140, ExerciseBlock 215-217, ReadOnlyExerciseBlock 75-77) | YES |
| `tests/rls.test.ts` has measurement_entries arm at line 88-131 | YES |
| `<Textarea>` primitive at `src/components/ui/textarea.tsx` reusable | YES — but fixed `min-h-24 mb-3` (see MIN-1) |
| `supabase-js .upsert()` precedent exists in codebase | **NO — grep returns 0 matches in `src/`** |
| `measurements.ts` is `.upsert()` precedent | **NO — uses explicit INSERT+catch 23505/UPDATE by id, NOT .upsert()** |

## Findings

### Blockers

- **BLK-1 — `.upsert()` against partial unique index is a guaranteed runtime failure.** Design specifies `.upsert(..., { onConflict: "user_id,exercise_id" })` against UNIQUE partial index `(user_id, exercise_id) WHERE deleted_at IS NULL`. PostgreSQL `ON CONFLICT (cols)` cannot infer a partial unique index unless `WHERE` predicate is supplied; PostgREST's `onConflict` parameter accepts only a column list, no `WHERE` predicate forwarding. **Every upsert call will fail with `42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification`** — not a contingency, a deterministic failure. Zero in-codebase precedent for partial-index upsert. Design's "ship .upsert() first, fall back if integration tests show collision" framing is wrong. **Fix**: rewrite as read-then-write — SELECT active row by `(user_id, exercise_id, deleted_at IS NULL)`; if present UPDATE by `id`; if absent INSERT. Cite `src/api/measurements.ts:121-159` as the INSERT+SQLSTATE-23505-catch precedent (or use the cleaner SELECT-first approach).

### Majors

- **MAJ-1 — No body length cap at any layer.** Discovery U3 recommended 2000 chars. Existing zod caps: 500 (exercise.notes), 2000 (routine.notes). Without a cap, user can paste multi-MB string → row goes to server → re-read into every `<ExerciseBlock>` on every workout → renders inside `<Text>` with no truncation. Real UI hang risk on Android with very long text. **Fix**: pin 2000 chars; enforce in (i) zod schema inside `<ExerciseNoteSlot>` before mutate, (ii) `maxLength={2000}` on `<Textarea>`, (iii) optional DB CHECK `char_length(body) <= 2000`.

- **MAJ-2 — `exercise_id ON DELETE CASCADE` divergence has zero behavioral benefit today.** Sibling tables (`sets`, `routine_exercises`) use `restrict`. Justification "no hard-delete UI exists today" → produces no behavioral difference between cascade and restrict for the user-facing app. Cascade only matters in hypothetical future hard-delete, which would be silent data loss (notes the user wrote disappear with no recovery). **Fix**: switch to `ON DELETE RESTRICT` to match precedent. If hard-delete is later introduced, the migration that adds it decides what to do with notes (likely soft-delete them in same transaction).

### Minors

- **MIN-1 — Empty `<Textarea>` placeholder takes 96px × N blocks on live workout.** `numberOfLines={4}` + `min-h-24` + `mb-3` = ~120px per empty block → 600-960px just for empty placeholders. Fix: for `editable=true + empty` on `<ExerciseBlock>`, render a single-line tappable "+ Add note" that expands on tap. Keep full textarea on progress screen (vertical density not a constraint there).

- **MIN-2 — `keyboardShouldPersistTaps="handled"` missing on live workout `ScrollView`** (`app/(app)/workout/[sessionId].tsx:424`). Standard pre-existing behavior but worth calling out in test plan.

- **MIN-3 — Design misrepresents `measurements.ts` as `.upsert()` precedent.** Actually explicit INSERT+catch 23505. When fixing BLK-1, cite correctly.

- **MIN-4 — `tests/rls.test.ts` is `node:test` style, not vitest describe/it.** Design's "Add new arm after measurement_entries arm" is correct; just clarify the format (sequence of `await` blocks, mirror lines 88-131 verbatim).

- **MIN-5 — Hook-smoke test "if codebase has" phrasing**: vitest excludes `.tsx`. Just state "skipped — API unit + e2e cover it" deterministically.

- **MIN-6 — Empty commit stores `body: ""` forever.** Defensible but contradicts soft-delete idiom elsewhere. Document the `body === "" → display as no-note` rule once in `<ExerciseNoteSlot>`, not scattered.

- **MIN-7 — `<ExerciseNoteSlot>` on progress screen: independent query, doesn't block existing `isLoading` gate.** Confirm slot's own `isLoading` renders `null` so a slow note read doesn't reflow.

## Decision

**no-go**

Counts: blockers=1, majors=2, minors=7.

Confidence: HIGH on BLK-1 (verified against PostgreSQL docs, supabase-js docs, zero in-codebase precedent). Risk if shipped: HIGH (first write call fails deterministically).

## Recommendation

Invoke Designer v2:
1. **BLK-1**: rewrite `upsertMyExerciseNote` as read-then-write (no `.upsert()`). Cite `src/api/measurements.ts:121-159` correctly.
2. **MAJ-1**: pin body length cap = 2000 chars. Enforce zod + `maxLength` + optional DB CHECK.
3. **MAJ-2**: switch `exercise_id` FK to `ON DELETE RESTRICT` matching sibling tables.
4. **MIN-1**: collapsed "+ Add note" affordance for empty editable state on `<ExerciseBlock>` (keep full textarea on progress).
5. Address minors 2-7 as polish.
