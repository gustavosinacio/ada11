# Fix plan — 2026-05-20_0012_dark-mode-icon-contrast

## Scope
Fix the 3 blocker instances. Defer the gray-tone minors to a separate cleanup task.

## Approach
Inline `useColorScheme()` per file. No new abstraction.

Per project convention: 3 occurrences is below the "three similar lines beats a premature abstraction" threshold from the global rules. If the pattern grows (5+ icon instances needing this), extract a `<ThemedIcon>` wrapper at that point.

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `app/(app)/exercises/index.tsx` | edited | Import `useColorScheme` from `react-native`; compute `iconColor = useColorScheme() === "dark" ? "#fff" : "#000"`; replace `color="#000"` → `color={iconColor}`. |
| `app/(app)/routines/index.tsx` | edited | Same pattern as above. |
| `app/(app)/routines/[id]/index.tsx` | edited | Same import; **inverted** mapping for the "Add" button (icon must contrast with the button background, which is `bg-black dark:bg-white`): `iconColor = useColorScheme() === "dark" ? "#000" : "#fff"`. Replace `color="#fff"` → `color={iconColor}`. |

## Contratos de I/O
- No prop/type changes.
- No DB or query changes.
- No new dependencies (`useColorScheme` is already used in `app/_layout.tsx`).

## Riscos
- **Data integrity**: none — no data layer touched.
- **UX regressions**:
  - **Light mode** — icons must still render correctly (black on light bg for header `+`, white on black button for routine "Add"). The new logic preserves the old behavior for the light scheme.
  - **Pressable affordance** — color change does not affect tap target or accessibility props.
- **Platform-specific**:
  - `useColorScheme()` from `react-native` works on iOS, Android, and Web. No additional platform handling needed.
- **Performance**:
  - `useColorScheme` causes the component to re-render on theme change. Acceptable — the change is rare and the component is small.

## Alternativas descartadas
1. **`<ThemedIcon>` wrapper component** — would centralize the pattern but adds an abstraction for 3 occurrences. Reconsider if the icon-themed list grows past 5 instances.
2. **Replace lucide-react-native icons with NativeWind-styled SVGs** — pure className theming, no `color` prop. Too invasive for a 3-icon bug; would touch every icon in the codebase.
3. **Fix the gray-tone icons in the same PR** — out of scope. They render acceptably in both themes; bundling them with this fix dilutes the bug report and inflates regression surface.

## Out of scope (track as follow-up)
- The mid-gray icons (`#6b7280`, `#9ca3af`) should eventually adapt to theme for visual consistency with the `dark:` Tailwind convention. Defer to a dedicated UI polish pass.

## Regression test plan (preview — will execute after Implement)
- `npm run typecheck` — confirm no type regressions.
- `npm run lint` — confirm no lint regressions.
- Manual / Playwright on `npm run web`:
  - Light mode + dark mode: open Exercises tab, confirm "+" visible.
  - Light mode + dark mode: open Routines tab, confirm "+" visible.
  - Light mode + dark mode: open a routine detail, confirm "Add" button + icon visible.
- Cross-platform smoke: web build only (PWA on iOS is the user-reported environment; iOS Simulator + native build are not strictly required for this CSS-equivalent fix, but should not regress).

## Confidence / Risk
- **Confidence**: ALTA — root cause confirmed via direct file:line evidence; fix is mechanical and reversible.
- **Risk**: BAIXO — additive logic only, no behavior change in the light-mode happy path that was already working.

## Awaiting
User approval to proceed to Implementation phase.
