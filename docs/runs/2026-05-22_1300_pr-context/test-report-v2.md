# Test report v2 — 2026-05-22_1300_pr-context

> v2 closure by Conductor after Tester returned `fail` on a single test-selector ambiguity. The recommended fix was test-only (`.first()` qualifier). Production code untouched. v1 had also confirmed dev-server prerequisite was missing — restarted before re-run.

## Quality gates

| Check | Command | Result |
|---|---|---|
| Unit | `npm run test:unit` | **214/214 pass** |
| Feature E2E | `npx playwright test tests/e2e/progress-page.spec.ts` | **exit 0** — 8/8 pass |
| Verdict regression (zero-behavior-change check) | `npx playwright test tests/e2e/end-of-session-verdict.spec.ts` | **exit 0** — 7/7 pass |

## v2 changes (test-only)

`tests/e2e/progress-page.spec.ts:382-384`: extended `page.getByText("PR! +900 kg (was 1,500 kg)", { exact: false })` with `.first()` qualifier. The celebratory copy now intentionally renders in both the hero accordion AND the per-muscle list (per design-v3 §"Mudanças por arquivo"). Playwright strict-mode forbids ambiguous selectors → use `.first()` to bind to either occurrence.

## What was failing in v1

Two failures:
1. Test 6 strict-mode collision (Tester report) — fixed by `.first()`.
2. All other tests failed cascade because dev server wasn't running (Tester had `pkill`-ed it earlier; the v2 conductor restarted it).

## What survived

- Verdict regression: 7/7 pass — confirms the `<PrListRow>` extraction is a true zero-behavior-change refactor.
- Test 8 (new accordion test): tap hero count → expand → tap row → routes to exercise progress.
- Test 6 (extended PR pill assertion): PR pill + celebratory `"PR! +X kg (was Y kg)"` substring assertion both pass.

## Decision

**`pass`**
