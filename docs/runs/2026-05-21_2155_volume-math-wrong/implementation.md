# Implementation — 2026-05-21_2155_volume-math-wrong

Based on: `fix-plan.md` (spec approved by user via AskUserQuestion on 2026-05-21 21:59 BRT — "show the number properly, no abbreviation"). Baseline commit: `4e30d1561a2877ae14b435e627590a99594780b8`.

## Files changed

- `src/utils/units.ts` (edited) — `formatVolume` drops the k-shorthand branch. Now: `Math.round(value).toLocaleString("en-US") + " " + unit`. Doc comment rewritten to match the new contract (locale-fixed en-US; rationale recorded against pt-BR period-separator gotcha).
- `tests/unit/units.test.ts` (edited) — Updated assertions for the new format. Renamed two tests (`applies k-shorthand …` → `renders thousands with a comma separator (en-US)`; `MIN-3 boundary …` → `rounds before grouping at the 1000 boundary`). Added a 26,210-kg case mirroring the user's real "THIS WEEK" value.
- `tests/e2e/week-drill-down.spec.ts` (edited) — Three sites updated: visible-text check (line 196), comment (line 217), regex `^Total volume2\.5k kg$` → `^Total volume2,500 kg$` (line 225).
- `tests/e2e/weekly-volume-strip.spec.ts` (edited) — Two sites updated (lines 189-190 and 337-338), comments + assertions.
- `tests/e2e/volume-target.spec.ts` (edited) — Four sites updated: docblock (lines 14-15), `1.3k kg` → `1,300 kg` (line 241), `1.8k kg` → `1,800 kg` (lines 345, 352).

## Deviations from plan

None. Implementation matched plan exactly.

## Soft callbacks made

None.

## Quality gates

- [x] `npm run typecheck` — pass (clean, no output from `tsc --noEmit`)
- [x] `npm run lint` — pass (0 errors, 1 unrelated pre-existing warning in `router.d.ts`)
- [x] `npm run test:unit` — 87/87 pass (8 in `tests/unit/units.test.ts`)
- [ ] `npm run test:e2e` — not run from this Conductor session (live Supabase + headed browser; user can run before deploy)
- [x] No new `any`
- [x] No new `// @ts-ignore`
- [x] No stray `console.log`

## Process notes (for retro)

- Approval flow shortened: user's spec choice in AskUserQuestion ("show the number properly, no abbreviation") was treated as the approval signal for the fix-plan. The fix-plan was still written and persisted as an artifact, but a second explicit "go" was not requested. Per playbook this is a fast-path; should be documented in retro.
- The "k" shorthand was referenced in 3 e2e files plus the unit test — found cleanly via a single regex grep before editing, no surprises.
- `formatWeight` (per-set displays) intentionally unchanged — it never used k-shorthand. Confirmed via the existing "does NOT affect existing formatWeight (regression check)" unit test continuing to pass.

## Notes for Regression Tester

- Replay both Symptoms A and B from `repro.md`. Expect:
  - History "THIS WEEK" headline → `"26,210 kg"` (not `"26.2k kg"`).
  - Live workout Bench Press strip → `"Volume to PR: 4,900 kg"` (or similar — exact number depends on user's best bench session; assert format only).
- Adjacent screens to smoke-check:
  - `app/(app)/history/week/[isoWeek].tsx` — Total volume + Avg per session rows.
  - `src/components/weekly-volume-strip.tsx` — bar accessibility labels.
- Limitation: e2e suite needs a real Supabase + browser; recommend running locally before next deploy.
