# Review v1 — 2026-05-20_1937_edit-workout-times

Reviewing: the diff for the implementation against `design-v2.md`.

## Diff scope
- Diff command: `git diff 9a3ac722bb6a39814b5530c037534dc333641458...HEAD` (baseline recorded in `state.md`).
- Files changed: 8 (4 new + 4 edited).
  - NEW `src/utils/session-times-form.ts`
  - NEW `src/utils/format-session-times.ts`
  - NEW `src/components/session-times-editor.tsx`
  - NEW `tests/unit/session-times-form.test.ts`
  - EDIT `src/api/sessions.ts`
  - EDIT `src/hooks/use-sessions.ts`
  - EDIT `app/(app)/history/[id].tsx`
  - EDIT `tests/e2e/crud.spec.ts`
- Lines (edit files only): +237 / -29. New files: 151 + 34 + 223 + 301 lines respectively (component + tests dominate).

## Quality gates run
- `npm run typecheck` — passed (no output, exit 0).
- `npm run lint` — not re-run; Implementer reports clean + pre-existing `router.d.ts` warning.
- `npm run test:unit` — not re-run; Implementer reports 74 passed (51 prior + 23 new).

## Verification of implementation.md claims + design-v2 checklist

| # | Claim / Check | Verified? | Evidence |
|---|---|---|---|
| 1 | BLK-1 fix — no prop-sync `useEffect`; draft init via `useState(() => …)` + re-derived in `openEdit()` | yes | `src/components/session-times-editor.tsx:59-68` — `useState<TimesDraft>(() => makeDraft(...))` + `openEdit()` calls `setDraft(makeDraft(...))`. No `useEffect` watching `props.startedAt`/`endedAt`. |
| 2 | BLK-2 fix — `composeIso` uses `parse(...,"yyyy-MM-dd HH:mm",...)` + `Number.isNaN(d.getTime())` guard; `TIME_RE = /^(2[0-3]\|[01]\d):([0-5]\d)$/` | yes | `src/utils/session-times-form.ts:21` (regex), `:48-58` (parse + NaN guard, throws `RangeError`). |
| 3 | MAJ-NEW-1 fix — no `process.env.TZ`; uses `fromZonedTime("America/Sao_Paulo")` | yes | `tests/unit/session-times-form.test.ts:1-17` header + `:79-82, 222-289` use `fromZonedTime`. Zero `process.env.TZ` occurrences. |
| 4 | MAJ-1 — Save receives `loading={isSubmitting}` | yes | `session-times-editor.tsx:202-209` — `<Button label="Save" loading={props.isSubmitting} ... />`. Cancel `disabled={props.isSubmitting}` at `:215`. |
| 5 | MAJ-2 — parent passes `onCancel={() => updateTimes.reset()}` | yes | `app/(app)/history/[id].tsx:212`. Child calls `props.onCancel?.()` before `setEditing(false)` at `session-times-editor.tsx:84-88`. |
| 6 | MAJ-4 — `countSetsOutsideRange` uses `Date.getTime()` ms comparison | yes | `session-times-form.ts:118-132` — `startMs` / `endMs` from `.getTime()`; null-filtered (`if (!c) continue`). |
| 7 | MIN-NEW-1 — `<Button label="..." />` not children | yes | `session-times-editor.tsx:204-205, 213-214`. Matches `src/components/ui/button.tsx:6-11` API. |
| 8 | MIN-NEW-2 — Pencil `color="..."` not className; `useColorScheme()` for dark variant | yes | `session-times-editor.tsx:13, 57, 113, 125` — `useColorScheme()` + `color={pencilColor}`. |
| 9 | MIN-NEW-3 — `formatDateTime` / `formatDuration` extracted to `src/utils/format-session-times.ts`; `history/[id].tsx` imports from there | yes | New `src/utils/format-session-times.ts` (34 lines, exact body lifted). `history/[id].tsx:33-54` removed (verified in diff: `-29` lines). Editor imports at `session-times-editor.tsx:18-20`. Note: `history/[id].tsx` itself no longer references `formatDateTime` / `formatDuration` directly — those calls moved into the editor — so no import needed in the parent. Single source of truth maintained. |
| 10 | Hook invalidation — `setQueryData(["sessions", id], row)` + invalidate `["sessions"]`, `["sessions","active"]`, `["stats"]`, `["progress"]` | yes | `src/hooks/use-sessions.ts:104-111`. Mirrors `useFinishSession` (`:58-65`) + `useSoftDeleteSession` (`:118-123`). |
| 11 | `updateSessionTimes` API mirrors `updateSessionName` — `.update({ started_at, ended_at }).eq("id", id).select().single()` | yes | `src/api/sessions.ts:101-113`. Identical shape to `:87-99` (`updateSessionName`). |
| 12 | E2E arms — backward-1h edit + cross-week asymmetry | yes | `tests/e2e/crud.spec.ts:204-280` (edit −1h, assert `Duration: 1h 30m`) and `:282-382` (cross-week, seed set with `completed_at=endedAt`, move session back 8d, assert "This week" + `500 kg` strip unchanged). |
| 13 | No new `any`, no `@ts-ignore`, no stray `console.log` | yes | `grep -n "any\b\|@ts-ignore\|console\.log"` on all three new files: zero matches (the two flagged hits in `session-times-form.ts:9, 115` are the words "many" and "any" inside JSDoc prose, not the type). |
| 14 | Documented deviation: explicit `setEditing(false)` in `onCancel` AND close-on-success effect | yes | `session-times-editor.tsx:84-88` (explicit) + `:90-97` (effect). Strict superset of design behaviour; consistent with `design-v2.md:282-287`. |
| 15 | Documented deviation: `<View className="flex-1">` wraps each `<Button>` for side-by-side layout | yes | `session-times-editor.tsx:202-219`. `Button` has no width prop; this is the only path to a 50/50 row. Pure styling concession, UX matches design. |
| 16 | Documented deviation: `submitError` falls back to `error.message` when `error instanceof Error` | yes | `app/(app)/history/[id].tsx:202-208`. Mirrors `updateName` error treatment at `:189-195`. |

## Issues

### Blockers
None.

### Majors
None.

### Minors

- **[MIN-1]** `src/components/session-times-editor.tsx:101-110` — `outsideCount` uses a `Date.now() + 365d` sentinel to bypass the `end-in-future` rule inside `validateTimes`. Validator's MIN-NEW-4 flagged this as "unobvious; optional cleanup", and Implementer chose to keep it with the inline comment. The comment helps, but a dedicated `validateShape(draft): { ok; started_at; ended_at }` (no cross-field rules) would be cleaner. Not a regression; reviewer-noted technical debt only.

- **[MIN-2]** `tests/unit/session-times-form.test.ts:69-91` — the test titled "composeIso in São Paulo TZ matches fromZonedTime equivalent" only asserts that `composeIso` returns *some* valid Date when the host TZ is unknown (`expect(new Date(hostIso).toString()).not.toBe("Invalid Date")`). It does not actually verify TZ-correct behaviour. The round-trip test on `:54-67` is the real correctness anchor. Consider tightening this test (e.g., skip when `Intl.DateTimeFormat().resolvedOptions().timeZone !== "America/Sao_Paulo"`, otherwise compare against `spIso`) or drop it; current form is documentation-as-test, not a correctness check.

- **[MIN-3]** `app/(app)/history/[id].tsx:199` — `endedAt={session.data.ended_at!}` uses a non-null assertion. Sound under the `:64-68` redirect invariant (which sends in-progress sessions to `/workout/<id>` before this branch renders), but the assertion is silent about the precondition. A `if (!session.data.ended_at) return null;` guard above the JSX would document the invariant in the type system rather than relying on screen-reader reasoning. Cosmetic — does not change runtime behaviour.

## Security checklist
- [x] RLS: `updateSessionTimes` writes to `public.sessions` only, covered by the existing `auth.uid() = user_id` policy installed by `supabase/migrations/0001_rls_and_seed.sql` (loop creates `<table>_update` policies on all per-user tables incl. sessions). No new tables introduced; no migration needed. Verified `0006_add_source_flag.sql:35` comment "No RLS policy changes — existing policies gate on auth.uid() = user_id" as project convention.
- [x] No `SUPABASE_SERVICE_ROLE_KEY` or other service-role token referenced anywhere under `src/` or `app/`. The e2e test imports `admin` from the existing test helper module (server-side seeding), which is the established pattern for the e2e suite.
- [x] No raw SQL `rpc` calls introduced. All writes go through `supabase.from("sessions").update(...).eq(...)`, parameterized by the supabase-js builder.
- [x] No new `EXPO_PUBLIC_*` env vars; nothing secret bundled.

## Style / convention checklist
- [x] No new `any`. The two grep hits in `session-times-form.ts` are the English words "many"/"any" inside JSDoc, not the `any` type.
- [x] No new `// @ts-ignore`.
- [x] Comments narrate *why*, not *what*: the file headers explain the BLK-1/BLK-2 motivations, the `countSetsOutsideRange` doc explains the UTC-vs-UTC ms-comparison rationale, and the `outsideCount` sentinel has a reason-stating comment. No "this is a useState" noise.
- [x] Imports follow project style: package imports first (`lucide-react-native`, `react`, `react-native`, `date-fns`), then `~/...` relative-via-alias. Matches existing files in `src/components/`.
- [x] New files placed in conventional folders: `src/utils/` for pure helpers (matches `measurements-form.ts`, `units.ts`), `src/components/` for the editor.

## Decision

**pass**

Reasoning:
- 0 blockers, 0 majors, 3 minors — all advisory.
- All five v1 blockers/majors (BLK-1, BLK-2, MAJ-1, MAJ-2, MAJ-4) and the v2 MAJ-NEW-1 are verifiably resolved at the line level. The Validator's four minors (MIN-NEW-1..4) are all addressed; MIN-NEW-4 (sentinel) was kept-with-comment per the Validator's "optional cleanup" allowance, and re-flagged here as MIN-1 for the record.
- Three documented deviations in `implementation.md` are all strict supersets of design behaviour (explicit Cancel close, `flex-1` button wrapping, richer submit error text). None introduce regressions; none change the contract surfaced to the parent screen.
- Security checklist clean: RLS coverage via existing policy, no service-role-token leakage into the client bundle, no raw SQL, no new public env vars.
- Style checklist clean: no `any`, no `@ts-ignore`, no stray `console.log`, comments narrate intent, imports + file placement match project conventions.

Recommendation: invoke Tester.
