# Validation v2 — 2026-05-20_0133_measurements-view-and-chart

Reviewing: `design-v2.md` (round 2 of max 3)

## Issues raised in previous validation

| Issue | Severity (v1) | Addressed? | Note (v2 section / file:line cite) |
|---|---|---|---|
| **MAJ-1** — `headerRight` must be function form, not raw JSX element | major | **yes** | `design-v2.md:143-171` (Edit affordance contract) + `design-v2.md:237-255` (pseudo-code) both show the verbatim function form `headerRight: () => (<Pressable .../>)`. Mirrors `app/(app)/measurements/index.tsx:30-39` byte-for-byte. `useColorScheme()` import is correctly noted. |
| **MAJ-2** — Playwright `getByText("Edit", { exact: false }).last()` broken for icon-only headerRight | major | **yes** | `design-v2.md:46-48` specifies `page.getByText("Edit measurement", { exact: true }).click()` for inline CTA. Header-button coverage uses `page.getByLabel("Edit measurement")`. |
| **MIN-1** — `WeightUnit = "kg" \| "lbs"` (not `"lb"`) | minor | **yes** | `design-v2.md:101,363,457` all read `"lbs"`. |
| **MIN-2** — `new.tsx` missing from Mudanças table | minor | **yes** | `design-v2.md:42` adds a dedicated row for `new.tsx:103`. Total raised to "4 edited". |
| **MIN-3** — chart title rendering (empty `<Text>` adds padding) | minor | **partial** | Design v2 says "pass `title={\`Weight (${unit})\`}` directly", but `ProgressChart`'s `title` is already `title: string` (required) — no prop change is needed. The v1 concern is moot because the title is now always non-empty. Behavior is correct; description language slightly misleading. |
| **MIN-4** — manual DESC re-sort is redundant | minor | **yes** | `design-v2.md:335-341` uses `(data ?? []).find(...)` on the DESC list. |
| **MIN-5** — drop "row was inserted somehow" hedge | minor | **yes** | `design-v2.md:222` reads "Entries with no metrics cannot exist (zod-guarded at create/edit via `buildSubmitPayload`)". |
| **MIN-6** — elevate duplicate-banner e2e to required | minor | **yes** | `design-v2.md:48` adds a Mudanças row for `measurements.spec.ts:191-214` requiring `await page.waitForURL(/\/measurements\/[0-9a-f-]+\/edit$/);`. |
| **MIN-7** — note pull-to-refresh / cache-invalidation reliance | minor | **yes** | `design-v2.md:388` adds the one-line note; Pull-to-refresh added to Out of scope. |
| **MIN-8** — `<Stack.Screen>` must render inside every branch | minor | **yes** | `design-v2.md:238-255` extracts `const screenHeader` and mounts it in loading / error / happy-path branches. Mirrors `[id].tsx:151,163,178`. |

## Verification of v2-new claims

| Claim | Verified? | Evidence |
|---|---|---|
| `headerRight` function-form block matches `measurements/index.tsx:30-39` precedent | yes | Mirror byte-for-byte except icon (`Pencil` vs `Plus`), label, onPress target. |
| `useColorScheme()` import path | yes | `react-native` per existing precedent. |
| `screenHeader` const reuse across loading/error/happy branches | yes | `Stack.Screen` is a config component; idempotent setOptions. Precedent at `[id].tsx:151,163,178`. |
| `title?: string` prop change to `ProgressChart` | not needed | `progress-chart.tsx:14` is already `title: string` (required); no signature change. Call site always passes non-empty value. Existing caller `exercises/[id]/progress.tsx:108,115` unaffected. |
| E2e selector `getByText("Edit measurement", { exact: true })` disambiguates | yes | View screen title is `"Measurement"` (not "Edit measurement"); headerRight is icon-only Pencil with `accessibilityLabel` (which `getByText` doesn't match). Only the inline CTA has visible "Edit measurement" text. |
| `getByLabel("Edit measurement")` matches headerRight Pressable | yes | React Native Web maps `accessibilityLabel` to `aria-label`; Playwright `getByLabel` reads `aria-label`. Same shape proven by existing `Plus` button. |
| `waitForURL` regex `/\/measurements\/[0-9a-f-]+\/edit$/` matches UUID + `/edit` | yes | `[0-9a-f-]+` matches UUID hex+dashes; `$` anchors end. |
| `new.tsx:103` deep-link is a 1-line change | yes | Verified. |
| `[id].tsx:145` (now `[id]/edit.tsx`) deep-link is the other call site | yes | grep returned exactly 2 occurrences. |

## Issues found

### Blockers
None.

### Majors
None.

### Minors

- **[MIN-1-v2]** `design-v2.md:227-285` — `onPress` arrow inside `headerRight: () => (...)` is recreated per render, causing a no-op `setOptions` per render. Negligible perf cost; matches existing precedent exactly. **No fix required**; flagging so the Implementer doesn't wrap in `useCallback` (which would diverge from precedent).

- **[MIN-2-v2]** `design-v2.md:32,353,426` — The "drop the manual `<Text>` headline" instruction is correct; no `ProgressChart` prop signature change is needed. Implementer should leave `progress-chart.tsx` untouched.

- **[MIN-3-v2]** `design-v2.md:46` — Post-tap view-screen `waitForURL` could match the (unwanted) `/edit` URL if tests race. **Suggested fix**: anchor with `$` — `/\/measurements\/[0-9a-f-]+$/` for view, `/\/measurements\/[0-9a-f-]+\/edit$/` for edit.

- **[MIN-4-v2]** — Test count delta is undocumented. The Implementer should be told: "Test count stays at 8; the optional `getByLabel('Edit measurement')` step is an inline assertion inside the existing golden-path test."

- **[MIN-5-v2]** `design-v2.md:101,353,363` — `"Weight (lbs)"` reads slightly awkward; matches existing codebase convention (`exercises/[id]/progress.tsx:108,115`). **No fix needed**.

- **[MIN-6-v2]** `design-v2.md:46-47` — Soft-delete e2e: dialog listener (`page.on("dialog", ...)` at `:271`) must stay above the edit click. Order matters. **Suggested fix**: design language should note this for the Implementer.

## Decision

**go**

Reasoning:
- 0 blockers, 0 majors, 6 minors. Satisfies the decision rule.
- All 2 v1 majors fully resolved; all 8 v1 minors addressed.
- v2 minors are localized test-robustness / implementer-guidance / cosmetic items. None warrant a redesign round.

Implementer-facing notes to include in next handoff:
1. Anchor view-screen `waitForURL` to `/\/measurements\/[0-9a-f-]+$/` (add `$`).
2. Do NOT modify `src/components/progress-chart.tsx`; only the new caller and existing caller pass `title`.
3. Test count stays at 8; optional `getByLabel("Edit measurement")` step is an inline addition inside the existing golden-path test, not a new `test()` block.
4. Keep the `page.on("dialog", ...)` listener above the edit click in the soft-delete test.
5. Do NOT wrap `headerRight`'s `onPress` in `useCallback` — match the precedent at `measurements/index.tsx:30-39` literally.
