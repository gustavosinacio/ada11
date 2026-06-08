# Validation v2 — 2026-06-04_1700_routine-preview-start

Reviewing: `design-v2.md` (re-design after v1 NO-GO on 2 majors)

## Decision

**go**

0 blockers / 0 majors / 2 minors → **go** per the rule (`0 blockers and ≤1 major → go`).
Both v1 majors are RESOLVED and independently re-verified against source; all 3 v1 minors
are folded; the v1-sound production architecture is carried forward intact (spot-checked,
not re-litigated). No new blocker/major surfaced. The 2 minors below are carry-forward
must-fix notes for the Implementer/Tester, not blockers.

Round 2 of 3 (Design↔Validate). Budget healthy.

---

## MAJ-1 resolution — the a11y-LABEL close-set is now TRULY exhaustive — **RESOLVED**

I re-ran the exact grep the prompt demanded across `tests/ src/ app/`:

```
grep -rn "Start workout:|Edit routine:|aria-label^=\"Start workout|View routine:" tests/ src/ app/
```

The complete result (FACT, independently reproduced — not trusting the design's table):

| Label | Site | File:line | Form |
|---|---|---|---|
| `Start workout:` (def) | — | `routine-list-item.tsx:43` | `accessibilityLabel` |
| `Start workout:` query | S1 | `routine-strong-builder.spec.ts:212` | `getByLabel` (stale `.catch`-guarded, `slice(0,0)\|\|""`) |
| `Start workout:` query | S2 | `routine-strong-builder.spec.ts:217` | `[aria-label^="Start workout: Golden RSB"]` |
| `Start workout:` query | S3 | `routine-strong-builder.spec.ts:272` | `[aria-label^="Start workout: Dropset RSB"]` |
| `Start workout:` query | S4 | `routine-strong-builder.spec.ts:319` | `[aria-label^="Start workout: Idem RSB"]` |
| `Start workout:` query | S5 | `routine-strong-builder.spec.ts:420` | `[aria-label^="Start workout: Edit RSB"]` |
| `Start workout:` query | S6 | `routine-strong-builder.spec.ts:486` | `[aria-label^="Start workout: Fail RSB"]` |
| `Start workout:` query | S7 | `probe-strong-unify.spec.ts:217` | `getByLabel(\`Start workout: ${routineName}\`)` |
| `Edit routine:` (def) | — | `routine-list-item.tsx:62` | `accessibilityLabel` |
| `Edit routine:` query | E1 | `crud.spec.ts:113` | `getByLabel(\`Edit routine: ${name}\`)` |
| `Edit routine:` query | E2 | `probe-strong-unify.spec.ts:232` | `getByLabel(\`Edit routine: ${routineName}\`)` |

**Count: 7 `Start workout:` queries (6 in `routine-strong-builder` + 1 in `probe-strong-unify`)
+ 2 `Edit routine:` queries (1 `crud` + 1 `probe-strong-unify`) = 9 query sites across exactly
3 spec files.** This is BYTE-FOR-BYTE what design-v2 §"Close-the-set on the a11y LABELS" claims.

- **No N+1th, verified:** the two labels are produced ONLY at `routine-list-item.tsx:43,62`
  (grep of `Start workout|Edit routine` across `src/`+`app/` returns only those two lines + the
  doc-comment at `:21`). `RoutineListItem` is imported/rendered ONLY at `workout/index.tsx:13,143`.
  No dynamic/template label construction elsewhere, no second component, no app surface beyond the
  one row component. The close-set is exhaustive — this is the v1-NO-GO gap, now closed.
- **F5 covers all 3 specs** (`design-v2.md:90,206-210,564-650`): `routine-strong-builder` (S1–S6),
  `crud` (E1), `probe-strong-unify` (S7 + E2). Confirmed all three are named in F5 and each has a
  per-spec test-plan block.
- **The "Quick start workout" non-collision is real:** that string is `getByText` (VISIBLE TEXT,
  rendered by `workout/index.tsx:115,133` as a `<Button label="Quick start workout">`), queried in
  10+ specs but NEVER as an `aria-label` and NEVER as `Start workout: …`. It is a different string
  and untouched. Confirmed by the broad grep — no overlap.

### The two builder-open re-routes — each VERIFIED viable

- **E1 `crud.spec.ts:113` → row → preview → header `"Edit this routine"`.** I read the test body
  (`crud.spec.ts:88-129`): it is a create→list→delete flow with **NO active session** (no
  Quick-start before `:113`). So `disabled={hasActive}` is `false` → the row IS tappable → the
  preview path is reachable. The proposed re-route (`design-v2.md:606-616`) taps
  `getByLabel("View routine: ${name}")` → `waitForURL(/\/routines\/[0-9a-f-]+\/preview$/)` →
  `getByLabel("Edit this routine")` → `waitForURL(/\/routines\/[0-9a-f-]+$/)`. **The builder IS
  reached:** the preview-header Edit `Pressable` does `router.push(\`/(app)/routines/${id}\`)`
  (`design-v2.md:135`), which lands on the editor `routines/[id]/index.tsx`. The final
  `/\/routines\/[0-9a-f-]+$/` regex (ends with `$` after the id) correctly EXCLUDES `/preview`
  (which has `/preview` after the id), so it proves we are on the builder, not the preview — a
  genuine tightening over the original `:114` `/\/routines\/[0-9a-f-]+/` (no `$`, which matched
  both). The subsequent delete-flow assertions (`crud.spec.ts:116-125`) are untouched. VIABLE.

- **E2 `probe-strong-unify.spec.ts:232` → direct `page.goto('/routines/{id}')`.** I read the test
  body (`probe-strong-unify.spec.ts:188-243`). The reasoning the design gives — that the row is
  `disabled={hasActive}` here (a session is active, `:203-206`), the test ITSELF asserts the row tap
  is a no-op at `:226-228`, so the preview→header path is UNREACHABLE — is **CORRECT**. The
  preview can only be reached via a row tap, and the row is non-interactive while active. So the
  direct `goto` is the only viable path, exactly as for test 4. The id-read via
  `admin.from("routines").select("id").eq("user_id", userId).eq("name", routineName).single()`
  (`design-v2.md:642`) is necessary (the test holds only `routineName` at `:197`, never the id) and
  viable: `admin` is the service-role client in scope at `probe-strong-unify.spec.ts:28`, `userId`
  is local (`:190`), `routines` has columns `id`/`user_id`/`name` (`0000_schema.sql:30-32`), and
  `.single()` is safe (each test creates a fresh user + one uniquely-timestamped routine name, so
  the soft-delete `deleted_at` column never produces a duplicate within the run). VIABLE.

### The label-collision fix — VERIFIED

- The preview-header Edit label is renamed to **`"Edit this routine"`** (`design-v2.md:137`),
  visible text stays "Edit". This is NOT a prefix of, and does not contain, the old
  `"Edit routine: {name}"`. Confirmed by grep: there are **ZERO `[aria-label^="Edit routine"]`
  prefix selectors anywhere in the suite** — the only `aria-label^=` selectors are `Start workout:`
  (S2–S6). So the MIN-1 collision was always latent (would only bite a FUTURE prefix selector); the
  rename removes the trap by construction at zero cost. The affected tests use exact
  `getByLabel("Edit this routine")` (`design-v2.md:614,667`), which `getByLabel` matches exactly on
  accessible name — no substring ambiguity. RESOLVED.

---

## MAJ-2 resolution — the relabel preserves the active-session assertions — **RESOLVED**

The design re-pins S7 (`probe-strong-unify.spec.ts:217`) from `Start workout: {name}` →
`View routine: {name}` and PRESERVES the opacity-0.6 (`:218-220`) + no-op-tap (`:226-228`)
assertions. The load-bearing question: does the row STILL render `disabled` semantics after F4
collapses it to a single Pressable?

I traced design-v2 §"Row disabled-when-active verification" against the **actual** current
`routine-list-item.tsx` and the F4 edit:

- `:34` (current) `const effectivelyDisabled = disabled || pending;` → F4 changes to
  `const effectivelyDisabled = disabled;`. **`disabled` STILL flows** (it is `hasActive` from
  `workout/index.tsx:147`). Only the `|| pending` term is dropped. ✔
- `:35` `opacityClass = effectivelyDisabled ? "opacity-60" : ""` — **UNCHANGED by F4.** When
  `hasActive`, the outer `<View>` (`:37-38`) still gets `opacity-60` → computed opacity `0.6`. ✔
  matches `probe-strong-unify.spec.ts:219-220` (`expect(opacity).toBe("0.6")`).
- `:41` `onPress={effectivelyDisabled ? undefined : onPress}` — **UNCHANGED by F4.** When
  `hasActive`, `onPress` is `undefined` → tap is a no-op. ✔ matches `:226-228` (tap → still on
  `/workout$`).
- F4's relabel (`:43`) and Edit-pill removal (`:58-69` deleted) do NOT touch the `<View>`/opacity
  (`:37-38`) or the `onPress` gating (`:41`). The opacity lives on the OUTER `<View>` that wraps the
  single Pressable; the relabel only changes the Pressable's `accessibilityLabel`.

**Conclusion: the row's `disabled`/opacity-60/no-op-tap semantics are byte-for-byte intact under
v2.** S7 needs only its SELECTOR re-pinned; the behavioral assertions hold unchanged and are
PRESERVED, not deleted (`design-v2.md:627-632` explicitly says "Do NOT delete this test"). The
design did NOT accidentally drop `disabled`. RESOLVED.

---

## The 3 v1 minors — each folded — VERIFIED

- **MIN-1 (preview Edit label prefix collision)** → RESOLVED. Renamed to `"Edit this routine"`;
  no `^=` "Edit routine" selector exists or is added (grep-confirmed). See MAJ-1 §collision-fix.
- **MIN-2 (no Guard-A active-routing e2e)** → RESOLVED. **P5 added** (`design-v2.md:670-679`): open
  the preview before going active, create an active session via admin, reload, tap Start, assert
  the URL lands on the EXISTING session id with sessions `count === 1`. This is the only e2e proof
  of Guard A on the new surface. Teeth are real (specific session id + count). (See MIN-NEW-1 below
  for a small caveat on the seeding shape — does not block.)
- **MIN-3 (citation drift `history/[id].tsx:299-308`)** → RESOLVED to `:288-308`
  (`design-v2.md:77,146`). See MIN-NEW-2 below — the "Done arm `:300-307`" sub-label is itself
  slightly off, but harmless.

---

## Carry-forward integrity (spot-check, not re-litigated) — INTACT

| Carried decision | Verified at source |
|---|---|
| Moved handler reproduces all 3 guards | `workout/index.tsx:60-83`: Guard A `:61-63`, Guard B `:65-66,80-81`, Guard C `:73-79`. Design `onStart` (`design-v2.md:304-329`) matches byte-for-byte. ✔ |
| Success nav = `router.replace` | `workout/index.tsx:72`. ✔ |
| Row → `router.push(preview)` | F3 `design-v2.md:182-188`; `onPress` re-pointed to preview, drops `onEditPress`/`pending`. ✔ |
| `startFromRoutine`/`pendingRoutineId`/`startFromRoutineMut` deleted | Referenced only at `:60-83`/`:32,65-66,81,148`/`:28,68` — all leave with the handler. `useStartSession`/`useActiveSession`/`hasActive` STAY (ad-hoc path `:45,47-58`). ✔ |
| No migration/query/start-flow change | `useStartSessionFromRoutine` (`use-sessions.ts:73-99`), `seedSetsForSession`, the read queries all fenced out of scope (`design-v2.md:214-220`). New caller only. ✔ |
| Grouping ≡ editor | Editor reducer `routines/[id]/index.tsx:152-160` = design's verbatim grouping. ✔ |
| Read-only card types | `RoutineExerciseSetRow.target_weight: string\|null` (`db/types.ts:217`), `target_reps: number\|null` (`:216`); `displayWeight(string\|null, unit)` (`set-display.ts:41-50`), `displayReps(number\|null)` (`:57-60`) — exact type match. ✔ |
| New route registration | No existing `preview.tsx`; `routines/_layout.tsx` is a headerless `<Stack>` so the preview owns its own `<Stack.Screen headerShown:true>`. ✔ |

No carried decision was dropped or altered while editing. The production architecture is unchanged
from the v1-sound version.

---

## NEW issues

### Blockers
- none.

### Majors
- none.

### Minors

- **[MIN-NEW-1]** `design-v2.md:670-679` (P5 seeding shape). P5's deterministic recipe — "create an
  active session for the user via admin, reload the preview so `useActiveSession` sees it" — is
  sound, but the design leaves the admin-insert shape open ("via admin create an active session").
  The Implementer/Tester must seed a session row that `useActiveSession` actually treats as ACTIVE
  (the in-progress predicate: `ended_at`/`finished_at` null + `deleted_at` null — whatever the
  active-session query uses). If the seeded row doesn't match that predicate, Guard A's `active.data`
  is falsy and P5 false-greens (it would start a 2nd session and the assertion would need rework).
  This is the same "does the negative/guard assertion have teeth?" class from prior runs: P5 must be
  proven to FAIL if Guard A is removed (i.e. assert it routes to the EXISTING id, and confirm a
  no-guard variant would create a 2nd session). Coverage/teeth note, not a design flaw — the recipe
  is implementable; pin the active-session predicate when seeding. **Confidence HIGH / severity MINOR**
  (test-side, Implementer-recoverable; the design even flags it as "low priority").

- **[MIN-NEW-2]** `design-v2.md:77,146` (MIN-3 citation correction is itself slightly imprecise).
  The design now cites `history/[id].tsx:288-308` with "Done arm `:300-307`". I read that block:
  `:286-298` is the **Done** arm (`accessibilityLabel="Exit edit mode"`, text "Done"), and
  `:300-307` is the **Edit** arm (`accessibilityLabel="Edit workout"`, the Pencil). So "Done arm
  `:300-307`" mislabels the Edit arm. Purely cosmetic — the pattern (a `headerRight` `<Pressable>`
  that navigates) is real and the design's `headerRight` snippet (`design-v2.md:129-144`) is a
  correct structural mirror; the exact sub-line label doesn't affect the implementation. **Confidence
  HIGH / severity MINOR** (citation cosmetic; zero implementation impact).

- **[MIN-NEW-3 — polish]** `design-v2.md:656-658` (P1 weight-teeth anchoring). `getByText("60",
  { exact: true }).first()` will resolve (`displayWeight("60.00","kg")` → `parseFloat`=60 →
  `Number.isInteger` → `"60"`, verified at `set-display.ts:48-49`), and the design seeds reps 8 /
  set# 1 so "60" is unique in that card. But `.first()` + a bare two-digit string is mildly fragile
  if a future seed change introduces another "60" (e.g. a second set or reps=60). Tighter teeth:
  scope the `getByText` within the exercise card, or use a less collision-prone weight. Cosmetic
  robustness only; the assertion is correct as written for the pinned seed. **Confidence HIGH /
  severity MINOR.**

---

## Items assessed and found SOUND (no new issue)

- **The whole-suite close-set re-grep matched the design exactly** — 9 sites, 3 specs, no N+1th.
  This was the v1 NO-GO root and it is genuinely closed.
- **MAJ-2 row semantics trace** — verified line-by-line against the actual component; `disabled`
  is preserved, opacity/no-op gating untouched. Not just claimed — re-derived from source.
- **The E2 unreachability argument** — the design correctly recognized that the active-session row
  is non-interactive, forcing the `goto` (not the preview path); this is the harder, correct call,
  and it explicitly documents WHY so the Implementer doesn't attempt the unreachable preview tap.
- **The `crud.spec.ts` URL-tightening** (`/preview$` vs `…+$`) correctly distinguishes builder from
  preview — a subtle improvement the design got right.
- **Start button DOM handle** — `<Button label="Start workout">` → `accessibilityRole="button"`
  → RN-Web `<button aria-label="Start workout">`, a regular queryable handle (not an SVG/never-
  queried surface — honors the prior-run e2e-target lesson). `getByLabel("Start workout")` resolves.
- **P1 weight teeth on a real `<Text>` node** with a deterministic value (`"60"`), not an SVG tick.

---

## Issues raised in previous validation (v1)

| v1 issue | Status in v2 |
|---|---|
| MAJ-1 (Edit-pill removal breaks `crud:113` + `probe:232`, not in F5) | **RESOLVED** — both folded into F5; both re-routes verified viable. |
| MAJ-2 (row relabel breaks `probe:217`; opacity/no-op assertions) | **RESOLVED** — S7 re-pinned; assertions preserved; `disabled` semantics verified intact. |
| MIN-1 (preview Edit label prefix collision) | **RESOLVED** — renamed to `"Edit this routine"`; no `^=` selector exists. |
| MIN-2 (no Guard-A e2e) | **RESOLVED** — P5 added (see MIN-NEW-1 for the seeding-teeth caveat). |
| MIN-3 (citation drift) | **RESOLVED** — corrected to `:288-308` (see MIN-NEW-2 for a residual sub-label nit). |

---

## Reasoning (decision)

- Rule: `0 blockers and ≤1 major → go`. 0 blockers, 0 majors → **go**.
- Both v1 majors are resolved AND independently re-verified at source (the close-set re-grep
  matched exactly; the row-semantics trace was re-derived against the actual component). All 3 v1
  minors are folded. No carry-forward decision was dropped. No new blocker or major appeared.
- The 3 new minors are all test-side / cosmetic and Implementer-recoverable: MIN-NEW-1 (pin the
  active-session predicate when seeding P5, and prove P5 has teeth), MIN-NEW-2 (a residual citation
  sub-label, zero implementation impact), MIN-NEW-3 (tighten P1's weight-text anchor). None forces a
  product-semantics guess; none warrants a NO-GO override.
- Budget: round 2 of 3 — one round would remain, but it is not needed.

### Implementer must-fix notes (carry the 3 minors forward)
1. **MIN-NEW-1** — when seeding the active session in P5, match the exact in-progress predicate
   `useActiveSession` uses (null `ended_at`/`finished_at` + null `deleted_at`); the Tester must
   confirm P5 FAILS (creates a 2nd session) if Guard A is removed, so the assertion has teeth.
2. **MIN-NEW-3** — anchor P1's `getByText("60")` weight assertion within the exercise card (or use
   a less collision-prone seed weight) so it can't false-match a future seed.
3. **MIN-NEW-2** — optional: the `history/[id].tsx` "Done arm `:300-307`" sub-label is actually the
   Edit arm; harmless, fix only if touching that prose.

No peer invocations — all claims settled by direct source + test verification.
