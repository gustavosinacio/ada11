# Final summary — 2026-05-24_1925_history-row-total-volume

## Outcome
- **Feature**: Total volume on each session row in the History list (and per-week drill-down). Inline on line 2 as `Sat, May 24 · 1h 23m · 12,345 kg`. Detail-screen header total also routes through canonical `sumLiveVolume` for cross-surface consistency.
- **Pipeline result**: **shipped**
- **Branch / baseline**: `main` / `6e444c199e12bc1f3a449169ecdfeb4a06303e5a`
- **Files**: 4 source + 2 new tests + 1 e2e comment refresh + new helper + new presenter = 9 total.

## Metrics
| Metric | Value |
|---|---|
| Feature works end-to-end? | yes (golden + 5 edges + regression sweep all green; 6 screenshots) |
| Human interventions | 0 |
| Total round-trips | 4 (2 D↔V + 1 I↔R + 1 I↔T) |
| D↔V rounds | 2 (round 2 → go) |
| I↔R rounds | 1 (pass) |
| I↔T rounds | 1 (pass) |
| Soft callbacks | 0 |
| Wall-clock | ~52 min (19:25 → 20:17 BRT) |

## Validator catches (load-bearing wins)

### Round 1 (no-go, 2 majors + 5 minors)
- **MAJ-1**: design's planned `.tsx` render test would be silently skipped — vitest config restricts `include` to `**/*.test.ts` and there's no RNTL in the repo. v2 replaced with a pure-presenter `.test.ts` pattern matching the `session-header-total-volume.test.ts` precedent.
- **MAJ-2**: detail-screen zero-volume branch was self-contradicting in v1 ("drop trailing word" vs "still hide when 0"). v2 pinned: keep `> 0 ? formatVolume(...) : "—"` ternary, swap helper only, drop the trailing `" volume"` word.

### Round 2 (go, 5 polish minors)
- **NEW-MIN-1**: detail-screen JSX had `{" "}` AFTER the ternary plus a literal `volume` word. Removing only one would leave a trailing space — Implementer must remove BOTH. Honored.
- **NEW-MIN-3**: `useLifetimeWeeklyVolume()` destructure had to be EXTENDED to expose `data` (was only `refetch`/`isRefetching`). Honored via `weeklyVolumeData` alias to avoid shadowing `useSessions().data`.

## Files touched (9 total)

### New
- `src/utils/session-row-format.ts` — pure presenter `presentSessionVolumeSlot(totalVolumeKg, unit): string | null`.
- `tests/unit/session-summary-row-format.test.ts` — 13 presenter tests.
- `tests/unit/group-session-volumes.test.ts` — 12 helper tests.

### Edited (source)
- `src/utils/volume-target.ts` — `sumLiveVolume` parameter widened to `Pick<SetRow, "completed_at" | "set_type" | "weight" | "reps">[]` (no `as unknown as` cast at callers).
- `src/utils/progress-page-math.ts` — added `groupSessionVolumes(rows): Map<string, number>` near `computeLifetimeMaxPerExercise`. Internally delegates to `sumLiveVolume` per session_id group.
- `src/components/session-summary-row.tsx` — consumes the new presenter; `formatWeight` block replaced.
- `app/(app)/history/index.tsx` — extended destructure with `data: weeklyVolumeData`; `useMemo(groupSessionVolumes)`; passes `totalVolumeKg` per row.
- `app/(app)/history/week/[isoWeek].tsx` — same wiring.
- `app/(app)/history/[id].tsx` — replaced ad-hoc reduction at `:124-136` with `sumLiveVolume(setsQ.data ?? [])`; at `:289-295` swapped `formatWeight → formatVolume` and dropped BOTH `{" "}` and `" volume"`.

### Edited (tests)
- `tests/e2e/exercise-progress-ia.spec.ts` — stale comment refresh only (the regex `/·\s*\d+m\b/` still passes against the new line shape).

**Diff size**: +93/-24 lines across 7 production files; +~470 lines new test files.

## Quality gates
- Typecheck: clean.
- Lint: 0 errors, 1 pre-existing warning (`router.d.ts` auto-gen).
- Unit tests: 332/332 pass (+25 new vs prior baseline 307).
- E2E regression sweep: time-edit pencil + history-list flow + per-exercise progress chart all green; 4 pre-existing baseline flakes confirmed not caused by this run (post-Finish verdict-redirect URL regex; same flakes as F3/F4).

## Cross-surface evidence
Tester confirmed the canonical kernel routes through all 3 surfaces:
- **History list row**: `Golden session — Thu, May 21 · 1h 23m · 1,960 kg`.
- **Detail header**: `Total: 2 sets · 1,960 kg` (same number, same kernel).
- **Strip**: same week reflects the same volume.
- **Warmup-heavy session**: detail header now reads `Total: 1 set · 960 kg` (was `Total: 2 sets · 1,860.0 kg` pre-fix — correctness improvement, MEDIUM-risk-for-surprise as flagged in Riscos).
- **Unit toggle**: kg ↔ lbs consistent across all 3 surfaces (`4,321 lbs`).
- **Empty session**: row volume slot correctly omitted; detail header reads `Total: 0 sets · —` (no trailing space, no `volume` word).

## Why we stopped
Not escalated. Budgets at end: D↔V 1/3, I↔R 1/2, I↔T 1/2, soft-callbacks 2/2.

## Artifacts
- [`state.md`](./state.md)
- [`discovery.md`](./discovery.md)
- [`design-v1.md`](./design-v1.md) → superseded
- [`validation-v1.md`](./validation-v1.md) → no-go (0/2/5)
- [`design-v2.md`](./design-v2.md) ← shipped
- [`validation-v2.md`](./validation-v2.md) → go (0/0/5 polish)
- [`implementation.md`](./implementation.md)
- (review-v1 — returned inline by Reviewer; verdict in transcript)
- [`test-report-v1.md`](./test-report-v1.md) → pass
- [`transcript.md`](./transcript.md)
- `screenshots/` — 6 visual evidence files

## Bugs found post-merge (backfill within 7 days)
- (none yet)

## Archive
- Archived to vault: `$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-05-24_1925_history-row-total-volume/` on 2026-05-24.
