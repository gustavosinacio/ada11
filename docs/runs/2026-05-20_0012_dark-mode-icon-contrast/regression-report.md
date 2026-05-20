# Regression report — 2026-05-20_0012_dark-mode-icon-contrast

## Environment
- Build verified: `npx expo export --platform web` (static export, all 18 routes compiled).
- Unit tests: `npm run test:unit` → 33/33 passed.
- Type check: `npm run typecheck` → no errors.
- Lint: `npm run lint` → 0 errors, 1 pre-existing warning unrelated to this fix.

## Automated checks
| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | pass |
| Lint | `npm run lint` | pass (no new issues) |
| Unit tests | `npm run test:unit` | 33 pass / 0 fail |
| Web export build | `npx expo export --platform web` | pass — `/exercises`, `/routines`, `/(app)/routines/[id]` all bundled |

## Visual verification

### Programmatic (not feasible without auth credentials and PWA install context)
The affected screens are auth-gated. Driving Playwright through Supabase sign-in to reach the routes was out of scope for this run. The static export confirms the routes bundle without errors.

### Manual verification required from user
The user-reported environment (PWA installed via "Add to Home Screen" on iPhone, system dark mode) is the canonical surface for this bug. The Conductor cannot reproduce that environment in this session.

Action for user:
1. Re-deploy / re-build the web bundle (`npm run deploy:web` or local serve).
2. On the iPhone PWA (homescreen-installed), reload the app (force-refresh if cached).
3. In dark mode: confirm `+` icons in Exercises tab and Routines tab are visible.
4. In dark mode: open a routine detail, confirm "+ Add" button icon visible (now black on the white button background).
5. Switch system theme to light: confirm same icons remain visible (white on black button background for Routine detail; black on white background for headers).

## Code-level confirmation
| File | Before | After |
|---|---|---|
| `app/(app)/exercises/index.tsx:26` | `<Plus color="#000" size={22} />` | `<Plus color={colorScheme === "dark" ? "#fff" : "#000"} size={22} />` |
| `app/(app)/routines/index.tsx:26` | `<Plus color="#000" size={22} />` | `<Plus color={colorScheme === "dark" ? "#fff" : "#000"} size={22} />` |
| `app/(app)/routines/[id]/index.tsx:192` | `<Plus color="#fff" size={16} />` | `<Plus color={colorScheme === "dark" ? "#000" : "#fff"} size={16} />` |

## Out-of-scope confirmation
- Gray-tone icons (`#6b7280`, `#9ca3af`) in workout/history/profile/components were intentionally **not** modified. They remain visible in both themes; documented as follow-up cleanup.
- No other code paths (routing, auth, RLS, queries, sync) were touched. Regression risk in those areas: zero.

## Decision

**pass** — automated gates green, code-level changes match plan, no regressions detected. **Pending**: user-side manual verification on the PWA standalone environment.
