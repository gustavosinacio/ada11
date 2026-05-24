# Validation v1 — 2026-05-24_1925_history-row-total-volume

Round: Design↔Validate round 1 of ≤3.
Reviewing: `design-v1.md`.

## Verified claims (sound)

1. `<SessionSummaryRow>` already declares `totalVolumeKg?: number` at line 11; conditional render at line 50-52. `formatWeight`→`formatVolume` swap correct.
2. `sumLiveVolume` reads only `completed_at`, `set_type`, `weight`, `reps`. `WeeklyVolumeRow` exposes all four (verified `src/api/stats.ts:18-26`). Cast `as unknown as SetRow` is structurally sound at runtime.
3. Server-side filters in `listWeeklyVolumeRows` confirmed (`stats.ts:53-83`): non-warmup, non-deleted, `completed_at IS NOT NULL`, `sessions.ended_at IS NOT NULL`.
4. `<SessionSummaryRow>` callers: only `history/index.tsx:50` + `history/week/[isoWeek].tsx:196`. No third consumer.
5. Detail screen at `history/[id].tsx:124-136` ad-hoc reduction has NO warmup filter, NO `completed_at` gate, NO `w>0`/`r>0` guard. Replacement with `sumLiveVolume(setsQ.data ?? [])` is correctness-improving. `setsQ.data` is `SetRow[]`, compatible.
6. e2e regex `/·\s*\d+m\b/` at `exercise-progress-ia.spec.ts:298` survives adding `· 12,345 kg`.
7. Cache invalidation on `["stats"]` confirmed in `use-sessions.ts:62, 114-121`.
8. No circular import risk.

## Findings

### Blockers
None.

### Majors

- **MAJ-1 — `.tsx` component-render test would not execute.** `vitest.config.ts:11` restricts `include: ["tests/unit/**/*.test.ts"]` — `.tsx` is silently excluded. No RNTL in repo (precedent at `tests/unit/session-header-total-volume.test.ts` and `read-only-history-display.test.ts` both explicitly note "no RNTL, no `.tsx`"). **Fix**: drop `.tsx` plan; replace with `session-summary-row-format.test.ts` exercising a pure presenter (e.g. `presentSessionVolumeSlot(totalVolumeKg, unit) → string | null`) extracted from the component, mirroring the `session-header-total-volume.test.ts` precedent.

- **MAJ-2 — Detail-screen header zero-volume branch is ambiguous.** Current code at `history/[id].tsx:289-295` reads `"Total: N sets · <X> volume"` or `"Total: N sets · — volume"`. Design says "drop the trailing `volume` and the `> 0 ? ... : "—"` branch" but ALSO says "still hide when `===0` to match the row behaviour" — self-contradicting. Hiding "just the volume half" of a single `<Text>` line would leave a dangling `· ` separator. **Fix**: pin one path. Recommended: keep the `> 0 ? formatVolume(...) : "—"` ternary, swap helper only, drop the trailing word `"volume"`. On zero → `"Total: 3 sets · —"`.

### Minors

- **MIN-1 — Visual-spec date example is fictional.** Design uses `"Tuesday, May 24, 2026 · 1h 23m · 12,345 kg"`. `formatDisplayDate(..., {includeWeekday: true})` returns short weekday + abbreviated month (`"Sat, May 24"`), no year on current-year. Fix: update example to `"Sat, May 24 · 1h 23m · 12,345 kg"`.

- **MIN-2 — Loading/error UX for `weeklyVolumeQ` not addressed.** Cold-cache first paint will render rows without volume, then re-render to add `· 12,345 kg` on `weeklyVolumeQ.data` resolve. Slot is optional/conditional so graceful — but worth documenting in Riscos.

- **MIN-3 — Max-volume window correctly NOT respected; design omission acceptable but should be explicit.** History-row total is a per-session historical fact, not a "Max" comparison. Add one line to Out of scope: "`useMaxVolumeWindowWeeks` does NOT apply — per-session totals are absolute historical facts."

- **MIN-4 — Off-by-one line citation** (`50-52` should be `51` for the kg-suffix line). Cosmetic.

- **MIN-5 — `Pick<>` widening might be cleaner than `as unknown as SetRow` cast.** Optional: widen `sumLiveVolume` to `Pick<SetRow, "completed_at" | "set_type" | "weight" | "reps">[]`. Single-file change; non-blocking.

## Decision

**no-go** — 2 majors.

Counts: blockers=0, majors=2, minors=5.

## Recommendation

Invoke Designer for v2:
1. Replace `.tsx` render-test plan with a pure-presenter `.test.ts` file (MAJ-1).
2. Pin one path for detail-screen zero branch — keep ternary, swap helper, drop word "volume" (MAJ-2).
3. Optional minors: fix date example, ack loading flicker, add window-agnostic out-of-scope note, consider `Pick<>` widening.

Confidence: HIGH (every claim verified file:line). Risk: LOW (feedback is mechanical).
