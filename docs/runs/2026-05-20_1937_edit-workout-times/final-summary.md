# Final summary — 2026-05-20_1937_edit-workout-times

## Outcome
- **Feature**: Edit `started_at`/`ended_at` on the history detail screen. Tap-to-reveal Pencil → 4 TextInputs (date `YYYY-MM-DD` + time `HH:mm` per timestamp) → Save / Cancel. Inline advisory when sets fall outside the edited range. Cross-week edits move the session in the drill-down list but the weekly volume strip bar stays bucketed by `set.completed_at` (documented asymmetry).
- **Pipeline result**: **shipped** (typecheck/lint clean, 74/74 unit, e2e arms 2/2 + adjacent 29/29).
- **Baseline commit**: `9a3ac72`.

## Metrics

| Metric | Value |
|---|---|
| Feature works end-to-end? | yes (web; Playwright 2 new arms + adjacent green) |
| Human interventions | 0 |
| Total round-trips | 1 (1 D↔V respin) |
| Design ↔ Validate rounds | 2 (v1 `no-go`, v2 `go`) |
| Implement ↔ Review rounds | 1 (`pass`) |
| Implement ↔ Test rounds | 1 (`pass`) |
| Implementer soft-callbacks | 0 |
| Wall-clock duration | ~53 min (19:37 → 20:30 BRT) |

## What shipped (8 files)

**New:**
- `src/utils/session-times-form.ts` — `composeIso`, `decomposeIso`, `validateTimes`, `countSetsOutsideRange`. Uses `date-fns/parse` (BLK-2 fix); `TIME_RE = /^(2[0-3]|[01]\d):([0-5]\d)$/` (rejects invalid times pre-parse).
- `src/utils/format-session-times.ts` — extracted `formatDateTime`/`formatDuration` (MIN-NEW-3 fix); was inline in `history/[id].tsx`.
- `src/components/session-times-editor.tsx` — tap-to-reveal Pencil + 4 inputs + Save/Cancel. **No prop-sync `useEffect`** (BLK-1 fix): draft initialized via `useState(() => ...)` and re-derived imperatively in `openEdit()`. `Button` uses `label` prop (MIN-NEW-1); `Pencil` uses `color` prop with `useColorScheme()` (MIN-NEW-2).
- `tests/unit/session-times-form.test.ts` — 23 tests, host-TZ-independent via `fromZonedTime("America/Sao_Paulo")` (MAJ-NEW-1 fix, mirrors `scripts/import-strong.ts:57` precedent).

**Edited:**
- `src/api/sessions.ts` — `updateSessionTimes(id, { started_at, ended_at })` narrow helper.
- `src/hooks/use-sessions.ts` — `useUpdateSessionTimes()` with broad invalidation (`KEYS.all`, `KEYS.detail` via `setQueryData`, `KEYS.active`, `["stats"]`, `["progress"]`).
- `app/(app)/history/[id].tsx` — wired `<SessionTimesEditor>`; removed inline formatters; `onCancel={() => updateTimes.reset()}` (MAJ-2 fix).
- `tests/e2e/crud.spec.ts` — 2 new arms: backward-1h edit (golden) + cross-week asymmetry (proves the documented decision).

## Decisions

1. **Picker strategy** = 4 TextInputs (no new dep). Cheapest; matches measurements precedent.
2. **API surface** = narrow `updateSessionTimes`; mirrors `updateSessionName`.
3. **Hook invalidation** = full set `["sessions"]` + `["sessions", id]` + `["stats"]` + `["progress"]` (because `started_at` affects strip + drill-down + progress bucketing).
4. **Edit mode UX** = tap-to-reveal pencil → form → explicit Save/Cancel (matches measurements view→edit precedent).
5. **Validation** = `end >= start`, `end <= now()`, valid components via `date-fns/parse`. No max duration cap.
6. **Cross-week asymmetry** = accept and document (decision (i)). Strip stays bucketed by `set.completed_at`; drill-down list moves with `started_at`. Cascade-update of set times deferred as upgrade path.
7. **Draft initialization** = imperative `useState(() => ...)` + `openEdit()` re-derive (no prop-sync `useEffect`).
8. **TZ pinning in tests** = `date-fns-tz fromZonedTime("America/Sao_Paulo")` to make tests host-TZ-independent.

## Bugs caught by the pipeline (and fixed)
- **v1 BLK-1**: prop-sync `useEffect` would have raced post-save `setQueryData` and silently wiped in-flight drafts. Resolved by removing the effect entirely.
- **v1 BLK-2**: `composeIso` used raw `new Date(...)` which accepts `2026-13-99` / `2026-02-30` via rollover on some JS engines (the exact bug class the measurements MAJ-1 already paid to fix). Resolved by switching to `date-fns/parse`.
- **v1 MAJ-1**: Save button not gated on `isSubmitting` → double-submit risk. Fixed.
- **v1 MAJ-2**: Cancel didn't clear stale `submitError`. Fixed via `onCancel` callback + parent `mutation.reset()`.
- **v1 MAJ-3 / v2 MAJ-NEW-1**: `process.env.TZ` at top of file is unreliable in ESM Vitest. Replaced with `fromZonedTime` (existing project precedent).
- **v1 MAJ-4**: bounds check could mis-compare local-vs-UTC. Fixed with explicit UTC-vs-UTC `Date.getTime()` ms comparison.

## Known-debt (non-gating)
- 3 Reviewer minors: `+365d` sentinel inside `outsideCount` (Validator MIN-NEW-4 — Implementer chose to keep with explanatory comment); a TZ-correctness test only asserts validity (not TZ behavior); `endedAt!` non-null assertion at `history/[id].tsx:199`.
- **Cross-week asymmetry** is documented decision, not a bug — but if owner pushes back, the upgrade path is cascade-updating `sets.completed_at` by the same delta as `started_at`.
- Pre-existing unrelated `tests/e2e/crud.spec.ts > exercises: create custom exercise` flake (broken by `b51dd01` `MuscleGroupPicker` refactor; not caused by this run).

## Why we stopped
- Feature complete. All gates green. 1 D↔V respin (typical for a feature where the Validator catches a TZ-correctness wrinkle); I↔R + I↔T single-pass.

## Artifacts
- discovery.md, design-v1.md, validation-v1.md, design-v2.md, validation-v2.md
- implementation.md, review-v1.md, test-report-v1.md
- state.md, transcript.md, final-summary.md
- retro.md (post-run, owner)

## Notes for the owner
- **Working tree uncommitted.** Suggested split: `feat(history): edit workout start/end times` + `docs(pipeline): archive edit-workout-times run`.
- **No migration / no schema change**.
- **Backlog after this**: 1 item — F9 (soft-deleted exercises in history) is queued.

## Archive
- To archive: `cp -r docs/runs/2026-05-20_1937_edit-workout-times "$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-05-20_1937_edit-workout-times"` + vault README entry.
