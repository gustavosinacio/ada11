# Regression report v1 — 2026-05-20_0127_import-strong-csv

## Environment
- Build verified: `npx expo export --platform web` (static export, all routes compiled).
- Live import verified: real run executed against production Supabase from this Conductor session (user authorized).

## Automated checks
| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | pass |
| Lint | `npm run lint` | pass (1 pre-existing warning in `router.d.ts`) |
| Unit tests | `npm run test:unit` | 51/51 pass |
| Web export | `npx expo export --platform web` | pass — 21+ routes |

## Real-run replay
The Tester step normally delegates dynamic execution to the user; for this run the Conductor executed the import directly because the user authorized service-role usage and the script is read-mostly with explicit dedup + recovery. The execution surfaced 4 bugs that the static gates could not have caught (see Real-run discoveries below).

**Final state, confirmed via post-import dry-run**:
```
Parsed 12381 rows; dropped 774 cardio rows; 11607 remaining.
[dry-run] would create 96 exercises
Built 642 session candidates; 0 skipped (zero retained sets); 642 remain.
Dedup: 0 new sessions, 0 partial sessions (will delete and reinsert), 642 already complete (skipped).
[dry-run] would insert ~0 sets across 0 sessions.
```

- **Sessions**: 642, all with the expected set counts.
- **Sets**: 11,607.
- **Exercises**: 96 with `source='strong'`.

## Real-run discoveries (bugs caught only by live execution)

The static gates passed but live execution surfaced 4 distinct bugs that were patched mid-run. All four are in `scripts/import-strong.ts`; commit `49aac97` consolidates them.

1. **Timestamp key mismatch.** Sessions looked up by `(started_at, name)` after insert; JS `Date.toISOString()` returns `...Z` while PostgREST returns `...+00:00`. Plain string equality failed for every lookup. Fix: `tsKey()` collapses both via `new Date(s).getTime()`.
2. **Phase 1 idempotency.** Re-running after a failure would insert 96 duplicate exercises (no unique constraint on `(user_id, name)`). Fix: bulk-select existing strong-tagged exercises by name and reuse.
3. **PostgREST URL length on DELETE.** `.delete().in("id", ids)` with 642 UUIDs (~24KB URL) returned "Bad Request". Fix: batch the DELETE at 100 ids/call.
4. **Supabase 1000-row default clip on set-count query.** `select("session_id").in("session_id", slice)` returns up to 1000 rows per response. A batch of 100 sessions × ~18 sets each = ~1800 expected; ~800 silently clipped. The undercount propagated as false-positive `partial` flags, causing repeated delete+reinsert cycles. Fix: batch=20 sessions and paginate via `.range()` until page < pageSize.

## Adjacent regression checks

| Surface | Verified | Result |
|---|---|---|
| `app/(app)/exercises/index.tsx` library list | Web export builds; reads via existing `useExercises()`; new `source` column nullable so existing rows unaffected | pass (static) |
| `app/(app)/history/[id].tsx` session detail | Web export builds; will now also render imported sessions (642 new) — pending user visual confirmation in app | pass (static) + pending visual |
| `app/(app)/workout/[sessionId].tsx` live workout | Untouched | pass |
| Routine builder | Untouched | pass |
| Exercise picker | Untouched | pass |
| Weekly volume strip + history aggregates | Will now reflect the 7-year imported dataset (pre-2026 weeks were 0; now populated) — pending user visual confirmation | pending visual |
| Pre-existing native sessions / sets | The 642 inserted sessions have `source='strong'` and live alongside any native sessions the user had. No native rows modified. | pass |
| RLS | `source` column inherits the table's existing RLS (auth.uid() = user_id) — no policy change needed | pass |

## Test commands
- [x] `npm run typecheck` — pass.
- [x] `npm run lint` — pass.
- [x] `npm run test:unit` — 51/51 pass.
- [x] `npx expo export --platform web` — pass.
- [x] Live import dry-run after real run — 0 partial, 642 already complete.

## Manual verification checklist (delegated to user)

The data is now in production. Please verify visually:

1. Open the app. Navigate to **History**.
2. Scroll back through dates. Sessions from 2019-11-08 through 2026-05-18 should now be present (~642 sessions over 7 years).
3. Open a sample old session. Confirm the exercises and set details render correctly (no `Cannot read property X of undefined` style errors). Note that the `muscles` array is empty for the 96 strong-imported exercises — `ExerciseBlock`'s subtitle line falls back to `exercise.equipment` if both are empty (no subtitle rendered, which is fine).
4. Open a recent native session (pre-import, if any). Confirm unchanged.
5. Open the **Exercises** tab. Library should now list ~30 seeded + 96 imported = ~126 exercises. The 96 imported have `source='strong'` (no UI badge yet — that's a planned follow-up).
6. **Weekly volume strip** (History tab): the 8-week window should still show recent weeks. Drill into a week that has imported sessions (if recent enough) and confirm session count + volume looks right.

## Out-of-scope confirmation

- UI badge "Imported from Strong" on session header / exercise detail — **deferred follow-up** (the `source` column is in place; UI just doesn't read it yet).
- Cardio modeling — deferred per Decision 8.
- Strong English-header CSV support — `--lang pt` only.
- API-edge Zod validation — separate hardening pass.

## Decision

**pass** — automated gates green, real-run executed end-to-end, final dry-run confirms steady state. 4 real-run bugs caught and patched. Pending user visual confirmation per checklist above.

## Post-deploy manual verification (filled in after user confirms)

- Verified by user: <pending>
- Confirmation timestamp (BRT): <pending>
- User statement: "<verbatim>"
