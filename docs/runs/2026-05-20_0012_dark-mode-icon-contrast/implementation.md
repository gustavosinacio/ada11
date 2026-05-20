# Implementation — 2026-05-20_0012_dark-mode-icon-contrast

Based on `fix-plan.md`. Baseline commit: `43a19995`.

## Files changed
- `app/(app)/exercises/index.tsx` — added `useColorScheme` to react-native import; introduced `const colorScheme = useColorScheme();` in the component; replaced `<Plus color="#000" size={22} />` with `<Plus color={colorScheme === "dark" ? "#fff" : "#000"} size={22} />`.
- `app/(app)/routines/index.tsx` — same three-edit pattern as exercises/index.tsx.
- `app/(app)/routines/[id]/index.tsx` — same `useColorScheme` import + hook; the "Add" button icon (inside `bg-black dark:bg-white` button) uses the **inverted** mapping: `color={colorScheme === "dark" ? "#000" : "#fff"}`.

## Deviations from design
None. Fix matched the plan exactly.

## Soft callbacks made
None.

## Quality gates
- [x] `npm run typecheck` passed (no errors).
- [x] `npm run lint` passed (0 errors, 1 pre-existing warning in `router.d.ts` unrelated to this change).
- [x] `npm run test:unit` — 33/33 tests passed.
- [x] `npx expo export --platform web` — all 18 routes compiled successfully.
- [x] No new `any`.
- [x] No new `@ts-ignore`.
- [x] No stray `console.log`.

## Notes for regression testing
- Verify in **light mode**: header `+` icons in Exercises and Routines tabs remain visible (black on white background); "Add" button icon in Routine detail remains visible (white on black button).
- Verify in **dark mode**: same icons now visible (white on black for headers; black on white for the Routine "Add" button).
- The bug only surfaced in PWA standalone because that's where iOS applied system dark theme — verifying on the regular web build with browser color-scheme emulation is sufficient for the fix.
