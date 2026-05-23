# Review v1 — 2026-05-23_1805_session-total-volume-header

Reviewing: the diff for the implementation against `design-v1.md` + corrections pinned in `validation-v1.md`.

Round: Implement↔Review **round 1 of 2**.

## Diff scope
- Diff command: `git diff 65ff20e107c35583cb3736cdf70581f394955aa2...HEAD -- '*.ts' '*.tsx'`
- Files changed: **2** code (`src/components/session-header.tsx`, `app/(app)/workout/[sessionId].tsx`) + **2** new test files (`tests/unit/session-header-total-volume.test.ts`, `tests/e2e/session-total-volume-header.spec.ts`)
- Lines on production code: **+58 / -6** (per `git diff --stat`).

## Verification of implementation.md claims

| Claim | Verified? | Notes |
|---|---|---|
| Both metric numerals render at `text-xl` (MAJ-1 fix, option a) | **yes** | `session-header.tsx:59` (Elapsed) and `session-header.tsx:68` (Volume) both use `text-xl`. Old `text-2xl` is gone from this component (`grep text-2xl src/components/session-header.tsx` → no hits). |
| One new import (`sumLiveVolume`) on the route, no re-imports (MIN-1) | **yes** | `app/(app)/workout/[sessionId].tsx:41` adds the single new import. `useMemo` still on the original line 3 (`import { useEffect, useMemo, useRef, useState }`); `useWeightUnit` still on the original line 21. `const unit` declared once at line 80. |
| `accessibilityLabel` + `accessibilityRole="text"` on inner `<Text>` (MIN-3 option a) | **yes** | `session-header.tsx:65-69` puts both props on the inner `<Text>`, mirroring `volume-target-slot.tsx:89-93`. The outer `<View>` carries no a11y props. |
| E2E uses `getByLabel(/^Session total volume: …$/)` instead of `getByText("X kg")` (MIN-2) | **yes** | `tests/e2e/session-total-volume-header.spec.ts:198, 230, 265, 273, 306, 320, 353, 361` — every volume assertion uses `getByLabel(/^Session total volume: …$/).first()`. No `getByText("X kg")` in the spec. |
| No "if not already present" hedge comments (MIN-4) | **yes** | `grep -n "if not already present\|already present"` over the two prod files returns no hits. |
| `sumLiveVolume` reused, no kernel fork | **yes** | Only consumer added: `app/(app)/workout/[sessionId].tsx:89-92` calls `sumLiveVolume(setsQ.data ?? [])`. The function in `src/utils/volume-target.ts:88-100` is untouched in the diff. |
| Locked `getByText("Elapsed", { exact: true })` selector preserved | **yes** | The literal `"Elapsed"` appears exactly once in `session-header.tsx:58`. The 5 existing e2e specs (`crud`, `end-of-session-verdict`, `remove-exercise`, `rest-timer-auto-start`, `soft-deleted-exercises-in-history`) still reference the same literal and were not modified in this diff (`git diff --stat` shows only the two production files + two new test files). |
| Cross-screen consistency live↔verdict (same kernel, same cache key) | **yes** | Live screen: `[sessionId].tsx:70` (`useSetsForSession`) + `:89` (`sumLiveVolume(setsQ.data ?? [])`). Verdict screen: `verdict/[sessionId].tsx:44` (same hook) + `:53-56` (same memo). Same `["sets", sessionId]` cache; identical memo signature; identical kernel — divergence impossible by construction. |
| Required (non-optional) new props on `<SessionHeader>` (design rationale: prevent silent `0 kg`) | **yes** | `session-header.tsx:16, 19` declare `volumeKg: number` and `unit: WeightUnit` as required. Typecheck (run below) catches any future call site that omits them. |
| `npm run typecheck` clean | **yes** | Re-ran in this review pass: `tsc --noEmit` → exit 0. |
| `npm run lint` clean (only pre-existing warning) | **yes** | Re-ran: 0 errors, 1 warning in `router.d.ts` (pre-existing, not touched by this diff). |
| `npm run test:unit` 284 passed, 0 regressions | **yes** | Re-ran: 17 files, 284 tests passed (16 new + 268 prior). |
| E2E spec syntactically valid (not executed) | **partial** | Spec file is syntactically valid and uses the correct selectors per MIN-2. Dynamic execution is the Tester's job — out of scope for static review. |

## Issues

### Blockers
None.

### Majors
None. MAJ-1 from `validation-v1.md` was honored verbatim (option a: both blocks at `text-xl` from the start, with a code comment at `session-header.tsx:50-55` explicitly citing the validator's MAJ-1 and the 320pt rationale).

### Minors
None of substance. Two cosmetic observations (NOT issues, do not block):

- **OBS-1 (informational)** `app/(app)/workout/[sessionId].tsx:82-88`: the new comment block is long (7 lines). It does narrate *why* (F10 invariant, cross-screen parity, clock-tick decoupling), so it passes the global rule. Just noting it is denser than typical inline comments in this file; future refactors may want to lift the rationale into a top-of-file doc-comment.
- **OBS-2 (informational)** `tests/unit/session-header-total-volume.test.ts`: unit suite is kernel-level (no React render) because the repo has no RNTL and `vitest.config.ts` restricts `include` to `tests/unit/**/*.test.ts`. The Implementer documented this deviation in `implementation.md` lines 22-23 with justification (no design-level behavior left unverified; the four pinned behaviors a/b/c/d all have at least one assertion each). This is the same pattern used by `profile-max-volume-window.test.ts` in the prior run — consistent with project precedent.

## Security checklist
- [x] **RLS**: no new `from('table').*` calls in the diff. The new logic is a pure UI consumer of the existing `useSetsForSession` cache (already RLS-protected via `sets` policies). No new table; no migration; no schema change.
- [x] **Service-role key**: no `SUPABASE_SERVICE_ROLE_KEY` reference in any code under `src/` or `app/`. The e2e spec at `tests/e2e/session-total-volume-header.spec.ts:42` reads it via `process.env.SUPABASE_SERVICE_ROLE_KEY` — that file is a Playwright spec, **not** shipped to the client bundle, and matches the precedent of `end-of-session-verdict.spec.ts` / `volume-target.spec.ts`. Acceptable.
- [x] **Raw SQL via `rpc`**: no `rpc(` calls in the diff. The set-insert seed in the e2e spec uses the typed query builder, not raw SQL.
- [x] **`EXPO_PUBLIC_*` env vars**: no new public env vars introduced.

## Style / convention checklist
- [x] **No new `any`** (`grep -n ": any\|<any>\| as any" src/components/session-header.tsx app/(app)/workout/[sessionId].tsx tests/unit/session-header-total-volume.test.ts tests/e2e/session-total-volume-header.spec.ts` → 0 hits in the diff'd regions).
- [x] **No new `// @ts-ignore`** (grep over the four files → 0 hits).
- [x] **Comments narrate *why*, not *what*.** The new comment at `session-header.tsx:50-55` explains the `text-xl` choice (320pt overflow rationale, validator cross-reference). The new comment at `[sessionId].tsx:82-88` explains the F10 invariant and clock-tick decoupling. Both are *why*, not *what*. ✓
- [x] **Imports follow project style.** New imports use the existing `~/` path alias (`~/utils/volume-target`, `~/db/types`, `~/utils/units`) — consistent with the rest of the repo. Package imports at the top, then internal aliases — matches existing ordering.
- [x] **New files placed in conventional folder.** `tests/unit/session-header-total-volume.test.ts` and `tests/e2e/session-total-volume-header.spec.ts` follow the existing naming + folder convention. `<SessionHeader>` was edited in place (`src/components/`), not relocated.

## Decision

**pass**

Reasoning:
- 0 blockers, 0 majors, 0 minors of substance. Two informational observations that do not warrant a fail.
- MAJ-1 (font size for 320pt fit) honored verbatim via option (a) with rationale comment in source.
- MIN-1 (no re-imports / no re-declared `unit`) honored — verified by grep over the route file.
- MIN-2 (a11y label selector in e2e, not numeral) honored on every assertion (8/8).
- MIN-3 (a11y on inner `<Text>`) honored — pattern matches `volume-target-slot.tsx:89-93`.
- MIN-4 (no hedging) honored — no "if not already present" in source.
- Cross-screen consistency live↔verdict is mechanical: same hook, same memo signature, same kernel, same cache key. Numbers cannot diverge by construction (test pinned this contract).
- Quality gates re-run (typecheck, lint, unit) — green. The Implementer's report matches reality.
- The locked-in `getByText("Elapsed", { exact: true })` selector is preserved verbatim in the only render site, so the 5 dependent specs are safe.

## Recommendation

**Invoke Tester.**

Tester's outstanding deliverables (already flagged by Implementer):
1. Pin a 320pt iPhone SE screenshot at `docs/runs/2026-05-23_1805_session-total-volume-header/screenshots/320pt-worst-case.png` showing `~1:00:00` elapsed + ~`22,046 lbs` volume + Finish, no wrap / no h-scroll. If wrapping occurs, MAJ-1 reopens.
2. Execute the 5 new e2e cases in `tests/e2e/session-total-volume-header.spec.ts` against the live dev server.
3. Re-run the 5 e2e specs that depend on `getByText("Elapsed", { exact: true })` to confirm no regression — they are: `crud`, `end-of-session-verdict`, `remove-exercise`, `rest-timer-auto-start`, `soft-deleted-exercises-in-history`.

Counts: blockers=0, majors=0, minors=0.
Confidence: HIGH on static correctness; MEDIUM on 320pt layout (back-of-envelope passes with `text-xl`; only a real-device screenshot can deterministically confirm — Tester's gate).
Risk if shipped without the Tester gate: LOW for typical kg users; LOW-MEDIUM for lbs power users until the 320pt screenshot is taken.
