# Validation v2 — 2026-05-24_1925_history-row-total-volume

Round: Design↔Validate round 2 of ≤3.
Reviewing: `design-v2.md` vs `validation-v1.md` + repo.

## v1 issue resolution

| v1 Issue | v2 Resolution | Verified? |
|---|---|---|
| MAJ-1 `.tsx` test skipped | Pure presenter `presentSessionVolumeSlot` in new file `src/utils/session-row-format.ts`; `.test.ts` plan mirrors `session-header-total-volume.test.ts` precedent | YES |
| MAJ-2 detail-screen zero branch ambiguous | Pinned: keep ternary, swap helper, drop trailing word `volume`. Positive: `"Total: 3 sets · 12,345 kg"`; zero: `"Total: 3 sets · —"` | YES |
| MIN-1 visual spec example | Corrected to `"Sat, May 24 · 1h 23m · 12,345 kg"` (verified against `format-display-date.ts:94-108`) | YES |
| MIN-2 cold-cache flicker | Riscos bullet added | YES |
| MIN-3 window-agnostic | Out of scope bullet added | YES |
| MIN-5 `Pick<>` widening | `sumLiveVolume` widened to `Pick<SetRow, "completed_at" \| "set_type" \| "weight" \| "reps">[]`. All existing `SetRow[]` callers remain structurally assignable. | YES |

## New findings

### Blockers
None.

### Majors
None.

### Minors

- **NEW-MIN-1 — Detail-screen JSX whitespace shape.** Current `history/[id].tsx:289-295` has `{" "}` AFTER the ternary plus a literal `volume` word. Implementer must remove BOTH the `{" "}` and the literal `volume` token (not just `volume`) to avoid trailing space `"Total: 3 sets · 12,345 kg "`. Recommend pinning the full new JSX block.

- **NEW-MIN-2 — Presenter return composition with `totalSets`.** Design's `presentSessionVolumeSlot` returns `" · ${formatVolume(...)}"`. Caller passes only `totalVolumeKg`; no caller passes both `totalSets` AND `totalVolumeKg` in the diff. If a future caller does, the rendered order is `... · N sets · 12,345 kg` (verdict-screen convention). Worth pinning in the design for future-proofing.

- **NEW-MIN-3 — `useLifetimeWeeklyVolume()` destructure extension.** `history/index.tsx:14-17` currently destructures only `refetch` and `isRefetching`. The diff must EXTEND it to expose `data` — Implementer-scope, but worth a line in the Mudanças table.

- **NEW-MIN-4 — Memoization key on Map identity.** New Map on every `data` change → re-render rows. Primitive `number` values compare equal so React's prop diffing absorbs it. No real perf risk.

- **NEW-MIN-5 — Out of scope: explicit window-agnostic statement.** Design covers indirectly. Acceptable, but could state once: "no setting reachable from Profile gates this number; raw historical fact."

## Decision

**go** — 0 blockers, 0 majors, 5 polish minors.

Counts: `{blockers: 0, majors: 0, minors: 5}`.

Confidence: HIGH — every load-bearing claim verified file:line.
Risk: LOW — design is mechanically implementable. One MEDIUM-risk visible-number change (detail-header total decreases for warmup-heavy sessions) is correctness-improving and documented for Tester.

## Recommendation

**Invoke Implementer.** Hand-off notes:
- NEW-MIN-1: remove both `{" "}` and the literal `volume` word when editing `history/[id].tsx:289-295`.
- NEW-MIN-3: extend `useLifetimeWeeklyVolume()` destructure to include `data`.
- Other minors are cosmetic/future-proofing.
