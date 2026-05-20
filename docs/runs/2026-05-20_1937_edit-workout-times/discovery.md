# Discovery — 2026-05-20_1937_edit-workout-times

## Feature prompt

> "Edit a workout's start and end time from the history detail screen — e.g. fix a session that was finished hours late, or one started before the user remembered to tap 'Quick start'. Needs a writable `started_at` / `ended_at` UI on `app/(app)/history/[id].tsx`, plus consider what happens if the new times move the session into a different ISO week (weekly volume strip + week drill-down should refresh)."

## Scope summary

Add user-editable `started_at` and `ended_at` to the History detail screen for finished sessions. Backfill use cases — "I forgot to tap Quick start" and "I forgot to tap Finish, so the session shows 12h duration." Changes must propagate to history list duration, weekly-volume strip, and week drill-down, including the case where new times move the session into a different ISO week. **Edit applies only to finished sessions** — in-progress sessions are out of scope and already redirect to the live workout screen (`app/(app)/history/[id].tsx:84-88`).

## Affected files (verified)

- `app/(app)/history/[id].tsx:33-54,191-235` — History detail. `formatDateTime` and `formatDuration` render `session.started_at` / `session.ended_at` as read-only `Text` rows under the editable name input. Existing affordances on this screen: rename (TextInput w/ `onBlur` commit), Delete workout (Button + `confirmDelete`), add exercise, edit/add/delete sets. No edit UI for times today.
- `src/api/sessions.ts:62-99` — Mutations exist for `finishSession` (sets `ended_at = now()`), `updateSessionNotes`, `updateSessionName`, `softDeleteSession`. **No `updateSession` that accepts arbitrary fields** — there is no helper that writes `started_at` or a non-`now()` `ended_at`. Adding the feature requires either a new `updateSessionTimes(id, { started_at, ended_at })` or widening into a generic patch helper.
- `src/hooks/use-sessions.ts:53-89` — `useFinishSession` invalidates `["sessions"]`, sets `KEYS.detail`, and invalidates `["stats"]` + `["progress"]` (lines 60-63). `useUpdateSessionName` invalidates only `["sessions"]` + sets detail cache (84-87). `useUpdateSessionNotes` same. **No existing hook touches `started_at`/`ended_at` after the finish event.**
- `src/db/schema.ts:107-127` — `sessions.startedAt` is `timestamp("started_at", { withTimezone: true }).notNull()`; `sessions.endedAt` is the same type but nullable. Both are `timestamptz`. Composite index `sessions_user_started_idx` on `(user_id, started_at)`. `updated_at` is part of `timestamps` (lines 23-31) — RLS migration applies a `touch_updated_at` trigger via `0001_rls_and_seed.sql` loop on tables including `sessions` (line 22 + 119).
- `src/db/types.ts:98-110` — `SessionRow.started_at: string`, `ended_at: string | null`.
- `app/(app)/history/index.tsx:11-62` — History list. `useSessions()` data feeds `WeeklyVolumeStrip` (header) + `FlatList` of `SessionSummaryRow`. `onRefresh` re-pulls `useSessions` + `useWeeklyVolume` concurrently.
- `app/(app)/history/week/[isoWeek].tsx:55-86` — Week drill-down. `useSessions()` data is filtered client-side by `weekKeyOf(parseISO(s.started_at)) === targetKey`. Re-bucketing on edit is **automatic** as long as `["sessions"]` invalidates. Headline weekly volume (lines 91-102) bucket-reduces `useWeeklyVolume()` rows by `weekKeyOf(parseISO(row.completed_at))` — see asymmetry note below.
- `src/components/weekly-volume-strip.tsx:43-65` — Buckets by `weekKeyOf(parseISO(row.completed_at))`. **Reads from sets (via `listWeeklyVolumeRows`), not sessions.**
- `src/api/stats.ts:18-33` — `listWeeklyVolumeRows` returns `sets` rows since `sinceUtc`, filtered by `sessions.ended_at IS NOT NULL` and `set_type != 'warmup'`. Each row carries the parent `sessions.started_at` / `ended_at`, but the **bucket key in the strip is `set.completed_at`**, which the session edit does not modify.
- `src/components/session-summary-row.tsx:15-36` — Renders `started_at` date + `ended_at - started_at` duration.
- `src/api/progress.ts:10-36` — Exercise progress feed groups sets by session and sorts by `session.started_at`. The X-axis label on the chart uses `started_at` (`app/(app)/exercises/[id]/progress.tsx:66`). **Editing `started_at` reorders the chart and changes the label, so `["progress"]` must invalidate.**
- `tests/e2e/crud.spec.ts:162-202` — "workout: start ad-hoc, finish, see in history" is the existing happy path. No coverage for editing times. Need new spec arm or new file.

## Relevant conventions (verified by reading code)

- **Inline-edit pattern (name)** — `app/(app)/history/[id].tsx:144-149,200-208` uses a `TextInput` with local `nameDraft` state, `onBlur` + `onSubmitEditing` commit via `useUpdateSessionName.mutate({...})`. Inline error rendered when `mutation.isError`. No explicit Save button for the name.
- **Form-based edit pattern (measurements)** — `app/(app)/measurements/[id]/edit.tsx` uses React Hook Form + zod via `~/utils/measurements-form.ts`. Date is a `YYYY-MM-DD` `TextInput` (no native picker), validated by `dateStr` regex (`src/utils/measurements-form.ts:60`) and converted via `parse(values.measuredAt, "yyyy-MM-dd", new Date())`. Range checks live in `buildSubmitPayload`. Save button + Cancel + Delete in a column.
- **Mutation invalidation pattern (finish-time precedent)** — `useFinishSession` invalidates `["sessions"]`, `["stats"]`, `["progress"]` (`src/hooks/use-sessions.ts:60-63`). The edit-times hook should mirror this trio because both `started_at` (progress chart, week bucket) and `ended_at` (duration only — strip doesn't depend on it) are affected.
- **Cache key shape** — `["sessions"]`, `["sessions", id]`, `["sessions", "active"]`, `["stats", "weekly-volume", sinceUtc.slice(0, 10)]`, `["progress", exerciseId]`. Invalidating `["sessions"]` triggers `useSessions`; invalidating `["stats"]` (broad) catches the weekly-volume key.
- **`updated_at` is owned by Postgres** — `touch_updated_at` trigger keeps the column current on every UPDATE. Client must not write it.
- **Datetime helpers** — `src/utils/dates.ts` re-exports `parseISO` and exposes `weekKeyOf`, `isoWeekStart`, `lastNIsoWeeks`. All use Monday-start, local time (`weekStartsOn: 1`). Comment at line 12-15 explicitly says "do NOT switch to `getUTCDay()`".
- **Date displayed in BRT/device-local everywhere** — `formatDateTime` uses `toLocaleString(undefined, ...)`; `formatDate` in summary row uses `toLocaleDateString(undefined, ...)`. No timezone preference.
- **`confirmDelete` pattern** (`src/components/confirm-delete.tsx`) used for destructive operations. Editing times is non-destructive; precedent suggests no confirm dialog.
- **No datetime picker dep installed** — `package.json` has no `@react-native-community/datetimepicker` or equivalent. Date entry today is purely `TextInput` (measurements `YYYY-MM-DD`).

## Constraints

- **Data**:
  - Both columns are `timestamptz`. ISO 8601 with offset is the canonical wire format (matches `new Date().toISOString()` already used by `startSession`/`finishSession`).
  - RLS on `sessions` is `auth.uid() = user_id`. No additional policy work needed for UPDATE — same policy that allows finish/notes/name update will allow times update.
  - No CHECK constraint on `started_at <= ended_at` in the schema. Validation is client-only unless we add a migration (out of scope per "no DB changes if not needed").
  - Editing `started_at` changes which ISO week a session appears in (sessions list filter in week drill-down). Editing `ended_at` only affects duration and "finished" status. Neither changes `set.completed_at`.
  - **Asymmetry**: `WeeklyVolumeStrip` buckets by `set.completed_at`, not `session.started_at`. If a user shifts only `started_at` to a different week, the strip bar does NOT move — but the week drill-down's session list DOES. The headline volume number in the drill-down (uses `completed_at` bucketing) also does NOT move. This is a real divergence the Designer must address: either (a) accept the asymmetry and document it, (b) ban edits that cross a week boundary if any sets exist in the old week, or (c) cascade an update to `set.completed_at` (heavy — out of scope for a "edit times" feature).
- **UI**:
  - NativeWind utility classes; dark-mode parity required (`dark:bg-black`, `dark:text-white` etc.).
  - History detail uses a single ScrollView with a header card (`px-6 py-6`, `border-b border-gray-200`). Edit UI fits inside the existing card.
  - The screen already redirects to `workout/[sessionId]` when `ended_at == null` (`history/[id].tsx:84-88`), so the edit UI only ever renders for finished sessions.
- **Platform**: Web + iOS + Android (Expo). Any native datetime picker would need a web shim. Current codebase has none.
- **Auth**: `auth.uid() = user_id` RLS for `sessions` UPDATE — see `0001_rls_and_seed.sql`. The owner is already authenticated when reaching this screen.
- **Performance**: Mutation invalidates 3 query keys; all are already cheap (no N+1 in the affected reads). The weekly-volume query is rate-limited by `staleTime: 60_000` (`src/hooks/use-stats.ts:25`) but `invalidateQueries` forces a refetch regardless.

## Existing precedents

- **Rename inline-edit** — `app/(app)/history/[id].tsx:198-215` is the closest precedent. `TextInput` + `onBlur` commit + inline error. **Likely too lightweight for two coupled timestamps** (need cross-field validation: `started <= ended`). The Designer should consider a Save button with both fields drafted in local state.
- **Measurements full-form edit** — `app/(app)/measurements/[id]/edit.tsx` with `react-hook-form` + zod + `buildSubmitPayload`. Used for a separate dedicated screen, not in-place edit. Could be adopted in a "tap-to-edit times" sub-screen or inline section.
- **Notes editor (if present)** — `updateSessionNotes` exists in `src/api/sessions.ts:73-85` but the History detail screen renders notes as plain `Text` (`history/[id].tsx:230-234`), not editable. So the only inline edit precedent on this screen is the name field.
- **Date input via text** — `src/utils/measurements-form.ts:60` `dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")` + `parse(values.measuredAt, "yyyy-MM-dd", new Date())` is the pure-text precedent. **For session times we need date + time, so an analogous pattern is two inputs (date `YYYY-MM-DD` + time `HH:mm`) or a single `YYYY-MM-DD HH:mm` input** unless a new picker dep is added.
- **Soft-delete + cache invalidation across stats** — `useSoftDeleteSession` invalidates `["sessions"]`, `["sessions", "active"]`, `["stats"]` (`src/hooks/use-sessions.ts:91-101`). Combined with `useFinishSession` (which adds `["progress"]`), the union of both is the right set for "edit times": `["sessions"]`, `["sessions", id]` (or `setQueryData`), `["stats"]`, `["progress"]`.

## Unknowns (require Designer judgment or human decision)

1. **Picker strategy** — three options:
   - **(a) Two `TextInput`s** (`YYYY-MM-DD` + `HH:mm`) per field, parsed via `date-fns/parse`. Zero new deps, matches measurements precedent. Ugly, error-prone.
   - **(b) `@react-native-community/datetimepicker` + web shim** — new dep; native UX is good, web is mediocre.
   - **(c) Web `<input type="datetime-local">` (via `dom-input` prop or raw web element) + RN native picker** — heavy platform divergence.
   - Designer's call; **(a) is the cheapest and matches house style**, but two coupled fields (date + time) per timestamp = 4 inputs total, easy to mistype.
2. **Edit mode UX**:
   - Inline like the name field (always editable, `onBlur` commit)?
   - Tap-to-reveal edit mode (read-only by default, "Edit times" pencil expands inputs)?
   - Dedicated edit sub-screen (matches measurements `/(app)/measurements/[id]/edit`)?
   - Inline-always for two coupled timestamps risks accidental edits and noisy commits on every blur. **Tap-to-reveal with explicit Save** is probably the right call but needs Designer.
3. **Validation rules**:
   - **Hard**: `started_at <= ended_at`. Required.
   - **Hard**: `ended_at != null` after edit (only finished sessions are editable here).
   - **Soft caps**: future timestamps? Max duration? Min duration? Designer should propose; my recommendation is `ended_at <= now()` and no hard duration cap (some real workouts are 4-6h; comp prep can be longer).
   - **Bound vs sets?** If a session's first `set.completed_at` is before the new `started_at` (or last `completed_at` is after the new `ended_at`), should we reject the edit, warn, or silently allow? Today no DB constraint links the two. I'd flag a soft warning; Designer to decide.
4. **Save trigger** — implicit (`onBlur`) like name, or explicit Save button? Tied to #2.
5. **Week-boundary cross — strip/drill-down asymmetry**:
   - Strip buckets by `set.completed_at`; drill-down session list buckets by `session.started_at`; drill-down headline volume buckets by `set.completed_at`. After editing `started_at` across a week boundary, the session appears in the new week's drill-down session list, but its volume contribution stays in the old week's bar AND the old week's headline.
   - **Options**: (a) accept and document; (b) reject edits that move `started_at` across a boundary if any set's `completed_at` is in the old week; (c) cascade-update `set.completed_at` for all sets in this session by the same delta (heavy, mutates set data). **Designer must pick.** My recommendation: (a) — sets carry their own truth (when they were logged), and the strip already tells the truth about training volume. The session is just a container. But this needs explicit owner sign-off.
   - **Sub-question**: confirm dialog when edit crosses a week boundary? Probably noise; the screen already shows the new date inline post-save.
6. **API extension**: introduce `updateSessionTimes(id, { started_at, ended_at })` (narrow, type-safe) or generalize to `updateSession(id, patch: Partial<Pick<SessionRow, 'started_at' | 'ended_at' | 'name' | 'notes'>>)` and migrate `updateSessionName` / `updateSessionNotes` into wrappers? Migration is mild refactor; the narrow helper is cheaper for one feature. Designer choice; I'd lean narrow for now to keep blast radius small.
7. **Active-session collision guard** — `getActiveSession` filters `ended_at IS NULL`. Since the History detail screen only renders for finished sessions (`ended_at != null`), and we require `ended_at != null` on edit, there's no risk of accidentally "un-finishing" a session. But the Validator should confirm we don't allow setting `ended_at = null` via this path.
8. **e2e coverage** — `tests/e2e/crud.spec.ts:162-202` covers finish + appears in history but never edits times. Need new arm or new spec; the existing pattern is to add a separate `test()` in the same describe block. Datetime input testing on Playwright is straightforward for text inputs, less so for native pickers (another reason favoring option 1a).
9. **Timezone display vs storage** — `toLocaleString(undefined, ...)` (BRT for the owner) is used everywhere for display. Storage is UTC ISO. Need to be clear: when the user types `2026-05-12 14:30`, that's local-time → convert to UTC ISO via `new Date('2026-05-12T14:30').toISOString()` (uses device tz). This is the same implicit behavior the measurements form has and is fine, but worth calling out.

## Out-of-scope flags

- **Editing `started_at`/`ended_at` on an in-progress session** (live workout screen is the source of truth; History detail redirects away).
- **Editing per-set `completed_at`** — separate concern; this feature edits the session container only. Documented divergence under unknown #5.
- **Bulk-editing multiple sessions** — not requested.
- **Adding a CHECK constraint `started_at <= ended_at`** — schema migration is broader than this feature; client-side validation is sufficient.
- **Timezone display preferences** — keep device-local rendering everywhere; no toggle.
- **Touching `updateSessionName` / `updateSessionNotes`** — leave the existing rename inline-edit UX untouched. Only add the times edit.
- **Re-bucketing sets when session times move** — the divergence between strip (`completed_at`) and week drill-down (`started_at`) is real but not in this feature's mandate. Designer must explicitly punt or include it.
