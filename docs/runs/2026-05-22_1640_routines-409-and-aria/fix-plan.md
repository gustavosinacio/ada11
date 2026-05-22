# Fix plan — 2026-05-22_1640_routines-409-and-aria

## Scope

Two bundled bug fixes, both in the routines flow:

1. **Bug 1 — 409 race**: add in-flight guard to `<ExercisePicker>` so quick double-tap on an exercise row no longer fires multiple `addRoutineExercise` POSTs. Same shape as F6 add-set debounce.

2. **Bug 2 — aria-hidden warning**: blur the active web element when `<ExercisePicker>` opens, so the still-focused Edit button from the prior screen doesn't end up inside an `aria-hidden` ancestor.

## Approach

Bug 1 is symmetric with the F6 fix: per-row `isPending` state via a `pickingId: useState<string | null>(null)`. While a pick is in flight, the row's Pressable is disabled. The mutation is invoked via the existing `onPick` prop — the picker tracks its own state from `onPick`'s Promise return.

Bug 2 fix is a one-liner in the `<Modal>` `onShow` callback: `if (typeof document !== "undefined") (document.activeElement as HTMLElement | null)?.blur()`. RN-Web specific — Native modals don't have this issue. Document the wrap.

Both changes live in `src/components/exercise-picker.tsx`. No DB change, no schema change, no migration.

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `src/components/exercise-picker.tsx` | edited | (Bug 1) Track `pickingId: string \| null` in state. `Pressable.disabled = already \|\| pickingId === item.id`. `onPress` sets `pickingId = item.id`, awaits `onPick(item)` (now allowed since the prop is async-friendly), then `pickingId = null` in `finally`. (Bug 2) Add `onShow` handler to the `<Modal>` that calls `(document.activeElement as HTMLElement \| null)?.blur()` on web (guard `typeof document !== "undefined"`). |
| `tests/e2e/routines-add-exercise-race.spec.ts` | **new** | E2E: rapid double-tap on exercise picker → only ONE row inserted (count = N+1 across pick attempts). |

## Contratos de I/O

- **Function signatures / types added or changed**: `<ExercisePicker>.onPick` callers don't change; the picker just wraps the call in its own `pickingId` state machine.
- **DB columns / queries**: none.
- **UI props / state**: new internal `pickingId` state on `<ExercisePicker>`.

## Riscos

- **Regressões em fluxos adjacentes**: `<ExercisePicker>` is also used on the live workout screen (`app/(app)/workout/[sessionId].tsx`) for ad-hoc exercise picks. The guard applies there too — slightly safer behavior in both surfaces.
- **Data integrity**: unchanged. The DB unique constraint already enforces correctness; the UI guard prevents the user-visible 409 error toast.
- **Platform-specific**: the `document.activeElement?.blur()` is web-only (guarded by `typeof document !== "undefined"`). Native React Native is unaffected — RN-Native modals handle focus on iOS/Android.
- **Performance**: negligible.

## Alternativas descartadas

1. **Track in-flight at the caller** (`routines/[id]/index.tsx`'s `onPick`) — descartada because the picker has 2 consumer surfaces (routines + live workout); fixing it at the source means consumers don't need to remember to guard.
2. **Use `inert` attribute** instead of fixing focus — descartada because RN-Web doesn't expose `inert`; would require a custom DOM ref + manual attribute setting.
3. **DOM `tabindex="-1"` on the Edit button after press** — descartada; too intrusive on the `RoutineListItem` component for what is a navigation issue.

## Out of scope (follow-up)

- Lift the same `pickingId` guard into other modal-list patterns app-wide (none currently exist; would be premature).
- Replace `aria-hidden`/`document.activeElement` with a proper focus-trap library — too heavy for v1.

## Regression test plan

- **Static gates**: `npm run typecheck`, `npm run lint`, `npm run test:unit`.
- **New e2e**: `tests/e2e/routines-add-exercise-race.spec.ts` — open routine detail → open picker → tap same exercise row twice in <50ms → assert ONE exercise inserted, no 409 in network log.
- **Adjacent regression**:
  - `tests/e2e/crud.spec.ts` — exercise picker on workout flow.
  - `tests/e2e/set-row-menu.spec.ts` — set-row menu (similar Modal pattern; no regression expected).
- **Manual verification needed?** Yes — visual smoke on `/routines/{id}` after the fix lands. Confirm no aria-hidden warning in DevTools console.

## Confidence / Risk

- **Confiança**: ALTA — both bugs have clear root causes, surgical fixes, and a precedent (F6 add-set debounce).
- **Risco**: BAIXO — UI-only edits, no DB / schema / migration changes. Defense-in-depth at both the UI and DB layers.

## Awaiting

User pre-approved via "finish it". Proceeding to Implementer.
