# Reproduction — 2026-05-21_2330_strong-import-setnumber

## Initial report

> Strong CSV importer assigns `set_number = 1` to every set whose "Ordem da série" column is missing/empty (`scripts/import-strong.ts:517-518`). 46 rows in current data violate the implied `(session_id, exercise_id, set_number)` unique key. Fix the importer to auto-increment within `(session, exercise)` ordered by row appearance + backfill existing duplicates (re-number by `completed_at, created_at`). Affects: set numbering on history detail / progress page, "Anterior" column. Does NOT affect volume math.

## Refinement

The "46 rows" figure from the prior bug-fix run was a trailing-8-weeks slice. A full-history scan via `scripts/debug-strong-setnumber.ts` (read-only) shows the bug is **~24× larger** than estimated. The pattern also extends beyond set_number=1 — Strong exports some non-empty Set Order values that still collide (likely dropsets / cluster sets sharing a parent's set_order).

Both classes (empty fallback + duplicated valid values) end up in the same DB symptom: multiple rows in one `(session_id, exercise_id)` group sharing the same `set_number`.

## Environment that triggers the bug

- Device / browser / build: server-side, `scripts/import-strong.ts` (Node.js + Supabase service role)
- Trigger: any Strong CSV bulk import. Existing data was inserted on **2026-05-20T19:09–19:11 UTC** (single import session across ~29 batches).
- Auth: `gsinacio94@gmail.com` (`user_id = 0b2dfe22-2d30-41eb-bede-d7a42bc3651c`)
- Data scope: 11,607 Strong-tagged sets (joined via `sessions.source = 'strong'`) in the user's DB.

## Affected screens (confirmed indirectly)

- `app/(app)/history/[id].tsx` — history detail set table, ordered by `set_number`.
- `app/(app)/exercises/[id]/progress.tsx` — progress chart bucketed by session.
- `src/components/set-input.tsx` — "Anterior" (previous-set placeholder) column derived from prior session's last set.
- No direct e2e captures yet (data-layer bug, no clean UI repro without seeding).

## Steps to reproduce (post-hoc, via DB)

1. Run `npx tsx scripts/debug-strong-setnumber.ts` against the user's prod DB (read-only, service role).
2. Output reveals collision summary.

**Observed (BRT 2026-05-21 23:30):**

| Metric                                       | Value           |
| -------------------------------------------- | --------------- |
| Strong-tagged rows in DB                     | **11 607**      |
| Collision groups `(session, exercise, set_number)` | **356** |
| Rows participating in a collision            | **1 118**       |
| Sessions affected                            | **235**         |
| Distinct `created_at` across collision rows  | 29 (all within the 2026-05-20 bulk import) |
| Collision groups by set_number               | `1 → 334 · 2 → 13 · 3 → 9` |

**Top collision group examples:**

- `session "Treino do meio-dia" / exercise / set_number=1` — 7 rows with weights 54/45/36/54/45/54/45 (distinct sets, all forced to set_number=1).
- `session "Armszes" / exercise / set_number=1` — 7 rows with weights 14/10/8/10/8/10/8 (dropset-like ladder, all set_number=1).
- `session "Costinha" / exercise / set_number=1` — 7 rows showing 66/52/39/66/52/66/52 (heavy descending sets, all set_number=1).

**Backfill simulation (first pass, naïve)**: re-numbering ALL Strong rows by `(session, exercise)` ordered by `completed_at NULLS LAST, created_at, id` would change **8 392 / 11 607 rows (72 %)** — but most of those changes are spurious: clean groups get re-ordered because all rows share the same `completed_at` (importer set `completed_at = startedAt` for every row) and tied `created_at` (batch insert), so the simulation falls back to UUID `id` ordering. Designer/Implementer should narrow the backfill to the **356 affected groups only** to leave the other ~10 500 clean rows untouched.

3. **Expected**: each `(session, exercise)` group has unique `set_number` values starting at 1 (no duplicates).
4. **Observed**: 356 groups violate the implied uniqueness.

## Visual evidence

None — data-layer bug. The DB diagnostic output is the canonical evidence.

## Status

- Repro determinístico: **yes** (diagnostic reproduces against prod data deterministically).
- Visual evidence obtained: **n/a** (no UI symptom captured directly).

## Open questions for the Diagnostician + Fix Designer

1. **Backfill scope**: surgical (only the 356 affected groups, ~1 118 rows) vs. full sweep (all 11 607 rows). Strongly favor surgical.
2. **Importer fix mechanism**: throw away Strong's "Ordem da série" column entirely and auto-increment by position within `(session, exercise)` in CSV row order — OR use it when valid and only fall back when missing/duplicated?
3. **Backfill execution path**: one-shot SQL migration vs. a Node script using service role.
4. **Idempotency**: must be safe to re-run (no-op on already-fixed data).
