# Test report v1 — 2026-05-22_1000_set-row-declutter

Testing: implementation against `design-v3.md`.

## Environment

- Commands used to run app: dev server `npm run web` already running on `http://localhost:8081` (HTTP 200, env injected).
- Test data: per-test fresh confirmed user (`e2e-set-menu-{rpe,notes,blk1}-{timestamp}@test.com`) created via Supabase admin client, deleted in `afterAll`. Same pattern as the existing CRUD/auth specs.
- Suites used:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run test:unit`
  - `npm run test:e2e -- tests/e2e/set-row-menu.spec.ts` (feature)
  - `npm run test:e2e -- tests/e2e/{volume-target,weekly-volume-strip,end-of-session-verdict,crud}.spec.ts` (adjacent regressions)

## Decision

**fail**

Reasoning:
- Static gates (typecheck / lint / unit) all clean. Unit suite is at the expected 198/198.
- The BLK-1 root-cause fix is **correct at the data layer** — verified by inspecting the Playwright trace's PostgREST PATCH bodies. After setting RPE via the menu and then blurring reps, the reps-update PATCH body is `{"reps":5,"weight":null}` (no `rpe` or `notes` keys), and the cache-refresh GET response confirms `rpe` survives as `9.0` in the DB row. The v2 footgun is closed.
- However, **all 3 new feature e2e tests in `tests/e2e/set-row-menu.spec.ts` fail** for two distinct reasons:
  1. The `toHaveAttribute("aria-selected", "true")` assertion is wrong for this stack. React Native Web 0.21 does **not** translate `accessibilityState={{ selected: isSelected }}` to an `aria-selected` HTML attribute. The selected chip *does* render with `bg-emerald-500` (verified via a fiber-walking probe), but `aria-selected` is absent. The implementer's `implementation.md:50` flagged this exact risk; the mapping is indeed broken.
  2. Race condition: the notes test fills the textarea, closes the menu 11 ms later, and reopens it 28 ms after that. The PATCH-then-GET cycle takes > 300 ms (Playwright trace), so the menu re-mounts with `initialNotes = null`. Because `useState` only seeds from props once, the textarea stays empty even after the GET completes. This is also visible in real life if a user closes-and-reopens the menu within ~1 frame after typing notes, though much less likely than the test triggers it.

Both reasons are inside the new code that this run added (test + impl). Adjacent suites are clean (1 pre-existing flake, 1 pre-existing failure flagged in the brief — neither caused by this run).

Recommendation to Conductor: **return to Implementer** (round 1 → round 2). Concrete fix candidates documented under "What the Implementer must change."

## Test commands

- [x] `npm run typecheck` — exit 0, no errors.
- [x] `npm run lint` — `ESLint: 0 errors, 1 warnings in 1 files` (`router.d.ts`, pre-existing generated-file warning).
- [x] `npm run test:unit` — `Test Files 13 passed (13); Tests 198 passed (198)` (1.38s). Matches the brief's expected 198 (179 prior + 7 + 7 + 5 new). The `tests/unit/api-sets.updateSet.test.ts` lands 7 cases (not 6 — design-v3 inconsistency, Implementer landed Test-plan-authoritative count).
- [x] `npm run test:e2e -- tests/e2e/set-row-menu.spec.ts` — **0/3 pass**.
- [x] Adjacent regression e2e — covered below.

## Golden path

**Spec** (design-v3:5-7): Move per-set RPE input and notes input off the live set row, behind a single `MoreHorizontal` trigger that opens a hand-rolled bottom-sheet menu. RPE chip taps commit immediately; notes commit on dismiss. Both flow through `updateSetMeta`, isolated from the reps/weight `updateSet` path so the two writers can't clobber each other.

**Steps run** (feature spec `tests/e2e/set-row-menu.spec.ts`):
1. Sign in as fresh user, Quick-start a workout, add Bench Press, log one Working Set.
2. Tap `Open set details` icon → `<SetRowMenu>` opens with the 12-chip RPE strip and notes textarea.
3. Tap `Set RPE to 9.0` chip → PATCH fires with body `{"rpe":"9.0"}` (verified in network trace, status 200).
4. Close → reopen → assert chip still selected.

**Result**: **fail** — the chip is selected visually (class includes `bg-emerald-500`, verified via probe), but the test's `toHaveAttribute("aria-selected","true")` assertion can never pass because RN-Web 0.21 doesn't emit that attribute. See evidence.

**Evidence**:

PATCH+GET network bodies from the failed run (test 1, "RPE chip selection persists across reopen"):

```
POST /rest/v1/sets?select=*
  body: {"...","reps":null,"weight":null,"rpe":null,"notes":null,...}   ← new set created
PATCH /rest/v1/sets?id=eq.df7648d6-...&select=*
  body: {"rpe":"9.0"}                                                   ← chip tap, only rpe key
  resp: 200, returned row has "rpe":9.0
GET /rest/v1/sets?select=*&session_id=eq....
  resp: [{... "rpe":9.0 ...}]                                           ← cache refresh OK
```

Diagnostic probe written by Tester (and then removed) walked the React fiber upward from the chip and dumped the `<SetRowMenu>` component's hook state on reopen:

```
matches: [{
  depth: 43,
  propSummary: {
    setNumber: "1 (number)",
    exerciseName: "Bench Press (string)",
    initialRpe: "9 (number)",   ← arrives as numeric 9, not string "9.0"
    initialNotes: "null (object)",
    previousRpe: "null (object)",
    ...
  },
  hooks: [
    "9 (number)",   ← useState rpe = 9 (number)
    " (string)"     ← useState notes = ""
  ]
}]
```

`normalizeRpe(9)` evaluates correctly in the browser console (probe ran the function inline and got `"9.0"` (string) and `"9.0" === "9.0" === true`). When the cache had time to settle (probe inserts `waitForResponse` before Close), the chip's runtime `className` is:

```
css-view-g5y9jx ... rounded-full px-3 py-2 bg-emerald-500    ← SELECTED
innerHTML: <div ...class="...text-white font-semibold">9.0</div>
```

…but the DOM attribute `aria-selected` is still `null` (absent). React Native Web 0.21's `Pressable` does not pipe `accessibilityState.selected` to an `aria-selected` HTML attribute. The implementer's own `implementation.md:50` foresaw this: *"If that mapping has shifted in a recent RN Web release, the fallback is to check chip text + the `bg-emerald-500` class on the selected chip."* The mapping is indeed not in effect on this RN-Web version (cross-checked: no other test in the repo asserts on `aria-selected`; `aria-selected` does not appear in this codebase's test suite outside `set-row-menu.spec.ts:122,184`).

Raw failure (test 1):

```
Error: expect(locator).toHaveAttribute(expected) failed
Locator:  getByLabel('Set RPE to 9.0')
Expected: "true"
Received: ""
  - 9 × locator resolved to <button ... class="...border border-gray-300 dark:border-gray-700">
    - unexpected value "null"
```

In some of the failed runs, the chip is *not even visually selected* on re-open (default border, no emerald). That's the race-condition path — see edge case 2.

## Edge cases

### Edge 1: BLK-1 root-cause regression — editing reps after setting RPE preserves RPE in the DB
**Steps**: Open menu, tap `Set RPE to 9.0` chip, close. Then blur the reps input with value `5`.
**Expected**: DB row has `reps:5` AND `rpe:9.0`. PATCH for the reps blur sends **only** `reps`/`weight` keys, **not** `rpe`/`notes`.
**Actual**: ✓ — verified directly from the Playwright trace's PATCH body:

```
PATCH /rest/v1/sets?id=eq.cf2adda9-...
  body: {"reps":5,"weight":null}    ← NO rpe, NO notes key (BLK-1 fix landed)
```

Final cache row after the GET refresh:

```
[{... "reps":5, "weight":null, "rpe":9.0, "notes":null, ...}]
```

**Result**: **pass** (at the data layer). The v3 partial-spread `updateSet` does exactly what the design demanded. The test that wraps this assertion still fails on the same `aria-selected` issue as Edge 2, but the underlying behavior is correct.

**Evidence**: see PATCH/GET bodies above.

### Edge 2: Race condition — reopening the menu before cache refresh leaves textarea/chip stale
**Steps** (notes test): Open menu, type `"Felt heavy"`, click Close 11 ms later, reopen 28 ms after that (Playwright timeline). Cache GET completes ~300 ms after PATCH.
**Expected**: textarea on reopen shows `"Felt heavy"` (because PATCH succeeded and `notes` survives in DB).
**Actual**: textarea is `""`. DB has `notes:"Felt heavy"` (verified in GET response), but the menu re-mounted before the GET landed in cache. `useState(initialNotes ?? "")` seeded on the *stale* (`null`) prop, and props-to-state isn't re-synced (intentional design choice — mount-gating).

**Result**: **fail**.

**Evidence**:

```
[trace timeline, notes test]
10956 ms  Fill "Felt heavy" notes textarea
10967 ms  Click Close (11 ms after fill)
11291 ms  Modal gone (animation done)
11296 ms  Click Open (reopen)
11325 ms  Assert toHaveValue("Felt heavy") starts → 5000 ms timeout

[network]
PATCH /sets {"notes":"Felt heavy"}  ← fired on Close
GET   /sets  → returns notes:"Felt heavy"  (round-trip > 28 ms, menu already re-mounted)
```

Practical impact in real usage: the user would have to close-and-reopen the menu within ~1 frame of typing the last character. Possible but unusual. The risk surface is bigger for the RPE test because chip-tap → close → reopen can happen in well under 300 ms on a fast device.

### Edge 3: numeric vs string RPE storage
**Steps**: Inspect the GET response after a PATCH `{"rpe":"9.0"}`.
**Expected**: per `SetRow.rpe: string | null` (`src/db/types.ts:120`), the cache row should carry `"rpe":"9.0"` (string).
**Actual**: the cache row carries `"rpe":9.0` (JSON number). The pre-existing `SetRow.rpe: string | null` type is a runtime lie because the DB column is `numeric(3,1)` (`src/db/schema.ts`) and PostgREST emits numerics as JSON numbers. The new menu code is robust to this — `normalizeRpe(value)` calls `parseFloat(value)` which coerces both `9` and `"9.0"` to `"9.0"` on `toFixed(1)` — so the in-memory comparison works. But: this means `initialRpe` arrives at `<SetRowMenu>` as `number` despite the `string | null` prop type. Not a regression for THIS run (the same numeric pours into the old v1 `<TextInput value={row.rpe ?? ""}>` too and gets coerced to string by RN), but worth flagging.

**Result**: **observed, not a blocker** — the implementation handles the numeric case correctly through `parseFloat → toFixed(1)`. Type-vs-runtime mismatch is pre-existing tech debt.

**Evidence**: GET body
```
{"id":"...","reps":null,"weight":null,"rpe":9.0,...,"notes":null}
```
and fiber dump `initialRpe: "9 (number)"`.

### Edge 4: iPhone 375 viewport / KeyboardAvoidingView
**Result**: **not tested** — Playwright config defaults to the desktop viewport (`playwright.config.ts` doesn't override), and the dev server is web-only here. The brief lists this as an edge case but it isn't in the new e2e spec. Out of scope to extend the spec per the brief ("Don't add new tests").

## Regression check

- **`tests/e2e/volume-target.spec.ts`**: 6/7 pass on first run, 7/7 pass on isolated re-run of the failing case. The failing case (`checked-only running volume: toggling a set's check updates Now, gap, and reps in lockstep`) is a pre-existing flake — `git diff 8b9414153a2c9f5ab71f2f15d3020b468d2b76b5...HEAD -- tests/e2e/volume-target.spec.ts` returns empty, the test was not touched in this run, and it passes when run alone. **No regression from this run.**
- **`tests/e2e/weekly-volume-strip.spec.ts`**: 4/4 pass. **No regression.**
- **`tests/e2e/end-of-session-verdict.spec.ts`**: 2/2 pass. **No regression.**
- **`tests/e2e/crud.spec.ts`**: 5/6 pass. The failing case (`exercises: create custom exercise (alongside seeded library)` at line 131, assertion line 150 — `getByPlaceholder("e.g. Chest").fill(...)` 60 s timeout) is the pre-existing failure flagged explicitly in the brief: *"line 131 has a pre-existing failure unrelated to this run."* **No regression.**

## Cross-platform

- Web: **fail** — feature e2e suite fails as documented.
- iOS: **not tested** — change touches RN cross-platform UI primitives, but no iOS test harness in this repo. The implementer's deviation #3 (hex `color` prop on lucide icons) is platform-neutral. KAV `behavior` is `padding` (iOS) / `height` (Android) and was implemented per design. No native-only code paths added.
- Android: **not tested** — same reason.

## What the Implementer must change (round 2 brief)

Two minimal, surgical fixes that should land in one pass:

1. **Make the chip selection assertable without `aria-selected`.** Two viable options:
   - **Test-only fix (preferred, smallest surface)**: in `tests/e2e/set-row-menu.spec.ts:121-124` and `:183-186`, swap `toHaveAttribute("aria-selected", "true")` for a class-based assertion the implementer's own implementation.md:50 already foresaw — e.g. `await expect(page.getByLabel("Set RPE to 9.0")).toHaveClass(/bg-emerald-500/)`. The `bg-emerald-500` class is the source of truth for "selected" in `<SetRowMenu>` (`src/components/set-row-menu.tsx:183-184`), and the probe confirmed it is present when the cache is fresh.
   - **Source-side fix**: in `src/components/set-row-menu.tsx:181`, replace `accessibilityState={{ selected: isSelected }}` with an explicit `aria-selected={isSelected}` prop (React Native Web passes unknown DOM attributes through to the underlying element). This restores the contract the test was banking on. Slightly more code change, more honest to the assertion.

   I lean toward the test-only fix because the `bg-emerald-500` class is a stable, visible signal that's already part of the design. But either works.

2. **Close the race so the menu re-opens with fresh state.** Three options, in increasing intrusiveness:
   - **Test-only fix**: in the notes test (`set-row-menu.spec.ts:142-149`), await the notes PATCH+GET round-trip *before* clicking Open. Same pattern that fixed my Tester probe:
     ```ts
     await page.getByLabel("Close").click();
     await page.waitForResponse(r => /\/rest\/v1\/sets\?id=eq\./.test(r.url()) && r.request().method() === "PATCH");
     await page.waitForResponse(r => /\/rest\/v1\/sets\?select=\*&session_id=eq\./.test(r.url()) && r.request().method() === "GET");
     // then reopen…
     ```
     Trivial; matches what real users experience (network completes faster than they re-tap).
   - **Source-side fix**: in `<SetRowMenu>`, sync local draft state from props with a `useEffect`:
     ```ts
     useEffect(() => { setRpe(initialRpe); }, [initialRpe]);
     useEffect(() => { setNotes(initialNotes ?? ""); }, [initialNotes]);
     ```
     This re-introduces the v2-design alternative that was rejected (race window when the user is mid-edit and the cache refreshes underneath them). **Not recommended** — fights mount-gating, complicates the data flow.
   - **Hybrid**: just for notes (where the race is genuine because the PATCH fires on close, not on chip tap), keep the notes commit but also stamp the local cache optimistically in `useUpdateSetMeta.onMutate` so the GET round-trip isn't on the critical path. More work, also out of scope for this minor.

   I recommend the test-only fix. The race only triggers under bot-speed click cadence; real users hit the natural debounce.

Both fixes are local to `tests/e2e/set-row-menu.spec.ts` (preferred) or, if the Implementer chooses option 1's source-side variant, also `src/components/set-row-menu.tsx:181`. No design re-open needed.

## Notes for the Conductor

- BLK-1 fix is real and shipping. The data-layer evidence is unambiguous. Whatever Round 2 lands, the underlying `updateSet`/`updateSetMeta` split + partial-spread is correct.
- This is round 1 of the Implement↔Test loop. Round budget remaining: 1.
- No production source code modified by Tester. One diagnostic spec was added and removed (`tests/e2e/_probe-set-row-menu.spec.ts`) — git status should be clean.
