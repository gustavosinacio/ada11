# Feedback for Discovery

## Run 2026-05-26_0307_bottom-tab-home-link — 2026-05-26 04:42 BRT

Pipeline: feature
Final outcome: pass (with documented follow-up)
Score: 4/6

### Rubric
- Every section of `discovery.md` filled: pass — Scope, Affected files (Tabs root, per-tab stacks, hidden tabs, callsites), Conventions, Constraints, Precedents, Unknowns (8), Reusable patterns, Out-of-scope all populated (`discovery.md:8-185`).
- Concrete code references cite file:line: pass — every claim cites file:line (e.g. `app/(app)/_layout.tsx:1-74`, `app/(app)/exercises/[id]/progress.tsx:64-86`, `tests/e2e/auth.spec.ts:301-303`, `node_modules/expo-router/build/layouts/TabsClient.d.ts:14-22, 63-71`).
- `fact` vs `assumption` clearly distinguished: pass — "Verified fact"/"verified by grep"/"Verified" markers throughout (e.g. `discovery.md:19, 29, 42, 52, 75`); recommendations explicitly labelled "My recommendation" with confidence (e.g. `:97, :104, :117, :122`).
- `Unknowns` section populated: pass — 8 unknowns each with (a)/(b)/(c) shape (`discovery.md:92-138`); Designer adopted all 8 defaults in v1.
- Searched for precedent / sibling patterns: **fail** — Discovery `:90` claims "No prior 'tap to reset stack' pattern in the codebase — verified by grep returning zero matches across `app/` and `src/`. This feature is greenfield." This is correct as a project-code grep, but Discovery only grepped the **project** code and missed that **Expo Router's forked native-stack at `node_modules/expo-router/build/fork/native-stack/createNativeStackNavigator.js:54-67` ALREADY auto-pops on focused `tabPress`**. Validator caught this as MAJ-1 (`validation-v1.md:18, 48-51`) — the framework already implements the desired behavior, and Designer's v1 unconditional `e.preventDefault()` would have DISABLED the working built-in feature. For a feature explicitly described as "screen state on `<Tabs>` re-press", a search **inside `node_modules/expo-router`** for `tabPress` / `popToTop` was load-bearing and was skipped. Also missed the `PartialState` rehydration nuance (`@react-navigation/routers/src/types.tsx:5-10`) that ultimately produced the deep-link follow-up.
- Relative dates converted to absolute: pass — no relative dates in the prompt.
- Audit trail: n/a — no peer invocations attributable to this agent.
- Write boundaries: pass — only `discovery.md` attributed.

### Lessons for next run
- **For framework-touching features, grep the framework's source too.** "Greenfield in `app/` + `src/`" is necessary but not sufficient when the feature is "intercept a framework event". Discovery should have run `grep -rn "tabPress\|popToTop" node_modules/expo-router/build` and `node_modules/@react-navigation/*/src` — that one search would have surfaced the fork's auto-pop listener at `createNativeStackNavigator.js:54-67` and re-framed the whole problem (the feature is partially built-in, the user's "it doesn't work" is platform-specific, not greenfield). Make this part of the contract: "when the feature is an event-handler on a framework primitive, grep the framework for the same event before declaring greenfield."
- **Surface state-rehydration shapes when the feature touches navigator state.** The `PartialState<NavigationState>` distinction (where `type`/`key`/`index` may be absent) is documented at `@react-navigation/routers/src/types.tsx:5-10`. Discovery enumerated the listener types but did not call out that `route.state` can be `NavigationState | PartialState<NavigationState>` and the two have different shapes. That gap propagated through Designer → Implementer → Tester before being surfaced as the deep-link follow-up. For any feature that reads `navigation.getState()` or `route.state`, Discovery should include a section on the rehydration shapes (click-through state vs URL-deep-link state vs persisted-state restore).
- **The "(a) what / (b) why / (c) recommended default" Unknown shape continues to pay off.** Designer adopted all 8 defaults wholesale. Sustain.
- **The web-specific `backBehavior="history"` annotation** (`discovery.md:75-78`) was extraordinarily useful — Designer and Validator both used it to scope risks. Sustain the discipline of surfacing load-bearing project-specific invariants up front.

### Recurring pattern check
- **Framework-internals literacy** is the recurring shape worth tracking: in routine-strong-builder (prior run), Discovery surfaced the relevant precedents at `:170-178` with a 7-pattern appendix; in canonical-exercises before that, the precedents block also delivered. This run's `(none found)` framing on the precedents line was technically correct but framework-incomplete. Pattern emerging: when the feature lives on a framework boundary, "no precedent in our code" is the wrong answer — the right answer is "framework already does X, here's the line, here's why our user reports it as broken." Track as a watch-item for the next framework-boundary feature.

## Run 2026-05-26_0101_routine-strong-builder — 2026-05-26 02:58 BRT

Pipeline: feature
Final outcome: pass
Score: 6/6

### Rubric
- Every section of `discovery.md` filled: pass — Scope, Affected files (Schema/migration, API, Hooks, Session-create flow, UI, Tests, Docs), Relevant conventions, Constraints, Existing precedents, Unknowns (7), Reusable patterns, Out-of-scope all populated (`discovery.md:17-378`).
- Concrete code references cite file:line: pass — every claim cites file:line (e.g. `src/db/schema.ts:88-115`, `src/api/sets.ts:58-96`, `app/(app)/workout/[sessionId].tsx:118-127`, the 4-policy RLS precedent at `0010_exercise_notes.sql:49-67`, partial-unique precedent triple at `0008:15-17 / 0010:45-47 / 0012:22-24`, the `pickingId` race precedent at `src/components/exercise-picker.tsx`).
- `fact` vs `assumption` clearly distinguished: pass — "Verified fact" / "Verified by grep" markers throughout (e.g. `discovery.md:29-30, 68, 82, 104, 116, 122-123`); recommendations explicitly labelled "My recommendation" vs "Verified" (e.g. `discovery.md:147, 211-213`).
- `Unknowns` section populated: pass — 7 unknowns each with (a)/(b)/(c) shape (`discovery.md:183-241`); Designer adopted all 7 defaults as-is in v1 (`design-v1.md:13-22`), signaling exceptionally well-calibrated defaults.
- Searched for precedent / sibling patterns: pass — 7 precedents enumerated (`discovery.md:170-178`); reusable verbatim copy-paste snippets included as a separate section (`discovery.md:244-364`) — migration boilerplate, RLS 4-policy block, partial-unique idx, touch_updated_at trigger, two-step reorder swap, compute-next set_number, hook template.
- Relative dates converted to absolute: pass — no relative dates in the prompt; references to "recent commit 77029d4" / "Decision 9" anchored to specific commit/file references.
- Audit trail: n/a — no peer invocations attributable to this agent.
- Write boundaries: pass — only `discovery.md` attributed.

### Lessons for next run
- **The reusable-patterns appendix** (`discovery.md:242-364`, 7 verbatim code/SQL blocks) was extraordinarily high-leverage — Designer's v1 SQL block at `design-v1.md:67-155` reused them verbatim, and Validator's v1 verification table (`validation-v1.md:9-13`) could cross-check by name. Sustain that "verbatim copy-paste material" section whenever the feature spans migration + API + hook layers.
- **The "(a) what / (b) why / (c) recommended default" Unknown shape** continues to pay off — Designer adopted all 7 v1 defaults wholesale (`design-v1.md:13-22`), zero round trips on Unknowns. Keep that as the contract.
- **The Session-create flow trace** (`discovery.md:58-71`, 5 numbered steps from `<RoutineListItem>` press → `startSession` API → live screen mount) handed Designer a zero-grep map for where to thread the seed step. Apply that "trace the existing call path end-to-end with file:line at each hop" discipline whenever a feature adds a step into an existing flow.
- **The "verified by grep" pattern surfaced load-bearing one-line facts** — e.g. `discovery.md:82` "exactly two production sites consume `target_rest_seconds`" determined the entire "keep the column" decision. Sustain.

### Recurring pattern check
- none — only one prior entry exists for Discovery on this project (canonical-exercises run, 6/6). No recurring fail to flag.

## Run 2026-05-25_1921_canonical-exercises — 2026-05-26 00:35 BRT

Pipeline: feature
Final outcome: pass
Score: 6/6

### Rubric
- Every section of `discovery.md` filled: pass — Scope, Affected files (Schema/API/Hook/UI/Test), Conventions, Constraints, Precedents, Unknowns, Out-of-scope, Index analysis all populated (`discovery.md:15-226`).
- Concrete code references cite file:line: pass — every claim cites file:line (e.g. `src/db/schema.ts:46-63`, `supabase/migrations/0004_exercise_muscles_array.sql:43-90`, `src/api/exercises.ts:60-78`, the 17 e2e sites enumerated by line `discovery.md:103-121`).
- `fact` vs `assumption` clearly distinguished: pass — "Verified fact" + "verified by grep" markers (e.g. `discovery.md:124-126, 165, 220-225`); recommendations explicitly labelled "My recommendation" vs "verified".
- `Unknowns` section populated: pass — 6 unknowns each with (a) what / (b) why / (c) Conductor check + recommended default (`discovery.md:154-202`); Conductor accepted all 6 defaults wholesale per `transcript.md:27`, signaling well-calibrated defaults.
- Searched for precedent / sibling patterns: pass — 6 precedents enumerated (`discovery.md:144-152`), including `pr-list-row.tsx:48-52` (chip), `0005_measurements.sql:72-96` (RLS replacement), `0004_exercise_muscles_array.sql` (function rewrite), `read-only-exercise-block.tsx` (read-only sibling).
- Relative dates converted to absolute: pass — no relative dates in the prompt; the dated artifacts (Decision 9, recent migration cadence) are all anchored to specific commit/file references.
- Audit trail: n/a — no peer invocations attributable to this agent.
- Write boundaries: pass — only `discovery.md` attributed.

### Lessons for next run
- Sustain the "recommended default" pattern on every Unknown. Conductor accepted all 6 defaults this run because each had a clear (a)/(b)/(c) shape — keep that as the contract.
- The `schema.ts` drift call-out + Decision-9 cache-buster link inside Discovery's `Relevant conventions` section saved a Designer round trip — keep surfacing project-wide invariants proactively even when the prompt does not mention them.
- The 17-e2e-site enumeration with per-file `:line` references gave Designer/Implementer a zero-grep starting point — apply that "enumerate every blast-radius site at file:line" discipline whenever a migration changes a column read pattern.

### Recurring pattern check
- none — first feedback entry for Discovery on this project.
