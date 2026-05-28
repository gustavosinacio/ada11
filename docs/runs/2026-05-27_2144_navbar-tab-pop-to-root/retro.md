# Retro — 2026-05-27_2144_navbar-tab-pop-to-root

## Outcome
- **Bug**: Re-tapping a focused bottom-tab (e.g. Exercises) did NOT pop to the tab root when the screen was reached via deep-link / page-refresh (Path B) or cross-tab from a live workout (Path C); only same-tab click-through (Path A) worked.
- **Pipeline result**: shipped (working tree; commit/deploy decision pending with user — "be ready to rollback")
- **Final commit**: <pending — fix in working tree on `app/(app)/_layout.tsx` + `tests/e2e/bottom-tab-home-link.spec.ts`; baseline 2d5e678>

## Metrics

| Metric | Value |
|---|---|
| Bug reproduces post-fix? | no (web — verified Paths B/C pop to `/exercises`, Path A unregressed; native = cannot-test-locally) |
| Bugs found post-merge (7 days) | <backfill> |
| Human interventions during run | 1 (the mandatory fix-plan approval gate) |
| Implement ↔ Regression rounds | 0 iterations (Regression passed on the first pass) |
| Diagnose redirects | 0 |
| Wall-clock duration | ~01:21 (21:44 → 23:05 BRT) |
| Token cost (if known) | n/a |

## What worked
- **Reproducer** turned a flat verbal report into a path-dependent matrix (A works / B,C fail), runtime-verified twice, AND refuted the suspected `backHref` cause with a controlled comparison — saving the Diagnostician from chasing a red herring.
- **Diagnostician** grounded the root cause in a *prior run's* runtime probe + the exact `expo-router` source line, reaching "CONFIRMED as fact" rather than inference.
- **Fix Designer's honest MEDIUM confidence + runtime-verify TODO** correctly anticipated that the `dismissAll`-on-PartialState behaviour was not statically provable — the hedge paid off when it failed at runtime.
- **Implementer** read its own prior feedback (probe-vs-spec divergence) and applied it: the probe exercised the exact spec flows AND the genuine at-root case, which is what surfaced the decisive `childState === undefined` ambiguity. Clean, fully-documented 3-deviation pivot to a `useSegments()` URL-gate.
- **Regression Tester** ran the `expo export` build gate the Implementer had skipped (backstop), and reported a clean run (zero environmental noise) with paced `workers:1` execution.

## What was friction
- The plan's PRIMARY (`dismissAll`/`canDismiss`) AND literal SECONDARY (`navigate` gated on child-Stack `routes`) **both failed at runtime**. Root reason: the focused tab's child-Stack state is `undefined` on Path C — identical to a genuine at-root cross-tab arrival — so any child-state-based gate is fundamentally undiscriminating. The diagnosis hinted at this ("PartialState, key undefined") but the Designer's mechanism was still built on that unreliable state.
- The externally-managed `npm run web` dev server crashed under the Implementer's heavy parallel Playwright load and had to be restarted before the Regression Tester ran.

## Prompt / schema adjustments to fold back
- **Fix Designer**: when proposing a fix gated on framework navigation state, add an explicit check — "can this state discriminate the must-act case from the no-op case on ALL failing paths?" Here the child-Stack state collapsed both Path C and at-root to `undefined`; only the URL (`useSegments`) could discriminate. This would have surfaced the URL-gate as the primary, not a third-order deviation.
- **Implementer / Regression Tester**: pace Playwright load against the single shared dev server (it's externally managed and crashes under heavy parallel runs); prefer sequential isolated specs over broad parallel sweeps.

## Was the pipeline overhead worth it for this fix?
Yes. The fix looked like a one-line guard relax, but the approved mechanism (and its documented fallback) were both wrong — only runtime probing across three arrival paths revealed that the framework state is undiscriminating and the URL is the sole reliable gate. Without the Reproducer's path matrix + the Implementer's mandated runtime verification, a plausible-but-broken `dismissAll` fix would have shipped green (the pre-existing test only covered the working path). The new cases 4/5 close that masking gap.

## Action items for the playbook
- [ ] Add to `.claude/agents/fix-designer.md`: a "state-discriminability check" prompt for navigation/state-gated fixes (see fold-back above).
- [ ] Add to `docs/playbook-fix.md` anti-patterns / or the Implementer+Tester prompts: a note to pace Playwright load against the single externally-managed dev server.
- [ ] No template changes needed.

## Archive
- Archived to vault: `$VAULT/AIground/multi-agent-pipeline/pipeline-runs/2026-05-27_2144_navbar-tab-pop-to-root/` on 2026-05-27 23:08 BRT.
