# Design v1 — 2026-05-20_1937_edit-workout-times

## Goal (1 sentence)
Let the owner correct a finished session's `started_at` / `ended_at` from the History detail screen via a tap-to-reveal text-input form, propagating to history list, week drill-down, weekly volume strip, and per-exercise progress chart.

## Approach
Add an explicit, opt-in edit mode on `app/(app)/history/[id].tsx`. By default the start time + duration render read-only (current behaviour). Tapping a small "Edit times" pencil reveals four `TextInput`s — `start date` (`YYYY-MM-DD`) + `start time` (`HH:mm`) + `end date` + `end time` — pre-filled from the current values in device-local time, plus Save / Cancel buttons. Save validates the four fields, composes two ISO strings (device-local → UTC via `new Date(localStr).toISOString()`), and calls a new narrow helper `updateSessionTimes(id, { started_at, ended_at })`. A new React Query hook `useUpdateSessionTimes` invalidates the full union — `["sessions"]`, `["sessions", id]`, `["stats"]`, `["progress"]` — to mirror the `useFinishSession` precedent, since `started_at` moves the session's bucket in the week drill-down list and the per-exercise progress chart while `ended_at` changes the displayed duration.

The strip/drill-down asymmetry (strip buckets by `set.completed_at`, list buckets by `session.started_at`) is **accepted and documented**, not cascaded — the strip already reflects when training load occurred, and the session timestamp is a separate container concept. The owner can revisit cascade later if it bites.

Picker choice: **option (a) — four `TextInput`s** (date `YYYY-MM-DD` + time `HH:mm` per timestamp). No new dep, matches the measurements precedent (`src/utils/measurements-form.ts`), keeps Playwright e2e straightforward. Cosmetic upgrade to a real picker is a follow-up if owner complains.

## Decisions on unknowns

| # | Unknown | Decision | Justification |
|---|---|---|---|
| 1 | Picker strategy | (a) Four `TextInput`s — date `YYYY-MM-DD` + time `HH:mm` per timestamp | Zero new deps, matches measurements precedent, identical UX on web/iOS/Android, Playwright-friendly. |
| 2 | API surface | Narrow `updateSessionTimes(id, { started_at, ended_at })` — sibling of `updateSessionName` | Smallest blast radius. Existing `updateSessionName`/`updateSessionNotes` stay untouched. |
| 3 | Hook | New `useUpdateSessionTimes` invalidating `["sessions"]` + `["sessions", id]` + `["stats"]` + `["progress"]` | Mirrors `useFinishSession`. `started_at` affects strip refetch trigger (broad `["stats"]`), week list bucketing, and progress chart ordering. |
| 4 | Edit mode UX | (a) Tap-to-reveal pencil → form with explicit Save / Cancel | Cross-field validation (`start <= end`) is awkward on `onBlur` commit. Matches measurements-edit affordance pattern. Prevents accidental edits. |
| 5 | Validation rules | `start` and `end` valid (no NaN); `end >= start`; `end <= now()`; no max duration cap; `start` can be arbitrarily in the past | "Finished in the future" is always a typo. No real cap on workout duration (4-6h workouts exist; comp prep longer). Historical backfill must allow old `start`. |
| 6 | Cross-week edit | (i) Accept asymmetry + document it inline (`Riscos`) | Sets carry the truth about when work happened (`completed_at` → strip). Session timestamp is a container — moving it shouldn't lie about training volume distribution. Cascade (iii) risks misalignment with multi-day sessions. |
| 7 | Save trigger | Explicit Save button (paired with decision 4) | Two coupled fields need validation before commit. |
| 8 | Confirmation dialog for cross-week edit | None | We accept the asymmetry (decision 6). A "this won't move the bar" warning would be noisy; UI immediately reflects new date after save. |
| — | `sets.completed_at` bound check (Discovery #3 sub-question) | Soft warning, not block — if any set's `completed_at` falls outside `[start, end]`, show an inline `Text` advisory below the form ("Some sets in this session were logged outside this time range.") but still allow save | Reflects that sets are the source of truth and may legitimately precede a corrected `started_at` (the "forgot to tap Quick start" use case). Not blocking. |
| — | Active-session guard (Discovery #7) | Validation enforces both `started_at` and `ended_at` are non-empty before save; helper only updates these two columns; no path sets `ended_at = null` | The detail screen already redirects in-progress sessions to `/workout/<id>` (`history/[id].tsx:84-88`). |
| — | Timezone display vs storage (Discovery #9) | Display + input in device-local, store UTC ISO via `new Date(localStr).toISOString()` | Same implicit behaviour the measurements form uses. Note prominently in `Riscos`. |

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `src/api/sessions.ts` | edited | Add `updateSessionTimes(id, { started_at, ended_at })` helper. Single responsibility: Supabase UPDATE of the two columns. |
| `src/hooks/use-sessions.ts` | edited | Add `useUpdateSessionTimes()` hook mirroring `useUpdateSessionName` shape, with widened invalidation set (`["sessions"]`, detail, `["stats"]`, `["progress"]`). |
| `src/utils/session-times-form.ts` | new | Form helpers — date/time regex validators, `composeIso(localDate, localTime)`, `decomposeIso(iso) → { date, time }`, cross-field validator `validateTimes(start, end, now)`. Pure functions. |
| `src/components/session-times-editor.tsx` | new | Presentational + local-state edit component. Owns: read-only display, "Edit times" pencil affordance, expanded form (four `TextInput`s + Save/Cancel + inline errors), soft "sets outside range" advisory, `onSave({ started_at, ended_at })` + `onCancel` callbacks. No data fetching; parent passes session + sets + mutation. |
| `app/(app)/history/[id].tsx` | edited | Replace the two read-only `<Text>` rows that render `formatDateTime(started_at)` + `Duration: ...` with `<SessionTimesEditor session={session.data} sets={setsQ.data} onSubmit={(times) => updateTimes.mutate({ id, ...times })} />`. No other changes — name input, notes, exercises, delete button untouched. |
| `tests/e2e/crud.spec.ts` | edited | Add new `test()` arm in the existing workout describe block: start session, finish, navigate to detail, open edit form, change start time backward by 1h, save, assert new duration text appears + history list duration updates. Cross-week scenario deferred to Tester decision. |

## Contratos de I/O

### Function signatures (new code, exact)

```ts
// src/api/sessions.ts
export async function updateSessionTimes(
  id: string,
  times: { started_at: string; ended_at: string },
): Promise<SessionRow> {
  const { data, error } = await supabase
    .from("sessions")
    .update({ started_at: times.started_at, ended_at: times.ended_at })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as SessionRow;
}
```

```ts
// src/hooks/use-sessions.ts
export function useUpdateSessionTimes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      started_at,
      ended_at,
    }: {
      id: string;
      started_at: string;
      ended_at: string;
    }) => updateSessionTimes(id, { started_at, ended_at }),
    onSuccess: (row) => {
      qc.setQueryData(KEYS.detail(row.id), row);
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["progress"] });
    },
  });
}
```

```ts
// src/utils/session-times-form.ts
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^\d{2}:\d{2}$/;

export type TimesDraft = {
  startDate: string; // YYYY-MM-DD
  startTime: string; // HH:mm (24h)
  endDate: string;
  endTime: string;
};

export type ValidationError =
  | { kind: "start-date-invalid" }
  | { kind: "start-time-invalid" }
  | { kind: "end-date-invalid" }
  | { kind: "end-time-invalid" }
  | { kind: "end-before-start" }
  | { kind: "end-in-future" };

/** Compose local-time strings into a UTC ISO string. Throws RangeError on NaN. */
export function composeIso(localDate: string, localTime: string): string {
  const d = new Date(`${localDate}T${localTime}`);
  if (Number.isNaN(d.getTime())) throw new RangeError("Invalid date");
  return d.toISOString();
}

/** Split a UTC ISO into device-local date + time strings for display. */
export function decomposeIso(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** Cross-field validation. Returns first error or null. */
export function validateTimes(
  draft: TimesDraft,
  now: Date,
): { ok: true; started_at: string; ended_at: string } | { ok: false; error: ValidationError } {
  if (!DATE_RE.test(draft.startDate)) return { ok: false, error: { kind: "start-date-invalid" } };
  if (!TIME_RE.test(draft.startTime)) return { ok: false, error: { kind: "start-time-invalid" } };
  if (!DATE_RE.test(draft.endDate)) return { ok: false, error: { kind: "end-date-invalid" } };
  if (!TIME_RE.test(draft.endTime)) return { ok: false, error: { kind: "end-time-invalid" } };

  let started_at: string;
  let ended_at: string;
  try {
    started_at = composeIso(draft.startDate, draft.startTime);
  } catch {
    return { ok: false, error: { kind: "start-date-invalid" } };
  }
  try {
    ended_at = composeIso(draft.endDate, draft.endTime);
  } catch {
    return { ok: false, error: { kind: "end-date-invalid" } };
  }

  if (new Date(ended_at).getTime() < new Date(started_at).getTime()) {
    return { ok: false, error: { kind: "end-before-start" } };
  }
  if (new Date(ended_at).getTime() > now.getTime()) {
    return { ok: false, error: { kind: "end-in-future" } };
  }
  return { ok: true, started_at, ended_at };
}
```

### Component props (new)

```ts
// src/components/session-times-editor.tsx
export type SessionTimesEditorProps = {
  startedAt: string;              // current ISO UTC
  endedAt: string;                // current ISO UTC; required (component only renders for finished sessions)
  setsCompletedAt: (string | null)[]; // for the soft-warning bounds check; null entries ignored
  isSubmitting: boolean;
  submitError: string | null;
  onSubmit: (times: { started_at: string; ended_at: string }) => void;
  // No onCancel callback needed — Cancel resets local draft and closes the form internally.
};
```

### DB columns / queries

- Table: `public.sessions`.
- Columns updated: `started_at timestamptz NOT NULL`, `ended_at timestamptz` (nullable in schema, but we never send `null`).
- `updated_at` is touched server-side by the existing `touch_updated_at` trigger (do not send from client).
- RLS: existing `auth.uid() = user_id` policy on `sessions` covers UPDATE. No new policy needed.
- No CHECK constraint added (client-side validation only — schema change is out of scope per Discovery #5).
- No new index needed. `sessions_user_started_idx` already covers `(user_id, started_at)` for the post-edit re-read.

## UI spec

### Read-only mode (default)

Replaces the current two `<Text>` rows on `history/[id].tsx:217-222`.

```
┌─────────────────────────────────────────────┐
│ Name [TextInput unchanged]                  │
│                                             │
│ Mon, May 18, 4:30 PM       [pencil]         │  ← Pressable row, opens edit
│ Duration: 1h 12m                            │
│ Total: 14 sets · 4,820 kg volume            │
│ [notes if any]                              │
└─────────────────────────────────────────────┘
```

- The pencil affordance uses `Pencil` from `lucide-react-native` (already a dep — `Plus` is imported in the same file).
- Pressing the row OR the pencil enters edit mode.
- `accessibilityRole="button"`, `accessibilityLabel="Edit start and end times"`.

### Edit mode (expanded)

```
┌─────────────────────────────────────────────┐
│ Name [TextInput unchanged]                  │
│                                             │
│ Start                                       │
│ [YYYY-MM-DD]      [HH:mm]                   │
│ End                                         │
│ [YYYY-MM-DD]      [HH:mm]                   │
│                                             │
│ [inline error if any]                       │
│ [soft advisory if sets outside range]       │
│                                             │
│ [Save]  [Cancel]                            │
│                                             │
│ Total: 14 sets · 4,820 kg volume            │
└─────────────────────────────────────────────┘
```

### Pseudo-code (component)

```tsx
function SessionTimesEditor(props) {
  const [editing, setEditing] = useState(false);
  const initial = useMemo(() => ({
    ...decomposeIso(props.startedAt),
    ...{ endDate: decomposeIso(props.endedAt).date, endTime: decomposeIso(props.endedAt).time },
  }), [props.startedAt, props.endedAt]);
  const [draft, setDraft] = useState<TimesDraft>({
    startDate: initial.date, startTime: initial.time,
    endDate: initial.endDate, endTime: initial.endTime,
  });
  const [error, setError] = useState<string | null>(null);

  // Re-sync draft when props.startedAt/endedAt change (post-mutation refetch).
  useEffect(() => {
    const s = decomposeIso(props.startedAt);
    const e = decomposeIso(props.endedAt);
    setDraft({ startDate: s.date, startTime: s.time, endDate: e.date, endTime: e.time });
  }, [props.startedAt, props.endedAt]);

  const onSave = () => {
    const result = validateTimes(draft, new Date());
    if (!result.ok) { setError(messageFor(result.error)); return; }
    setError(null);
    props.onSubmit({ started_at: result.started_at, ended_at: result.ended_at });
    // Parent closes via successful refetch + setEditing(false) on isSubmitting transition.
  };

  const onCancel = () => {
    const s = decomposeIso(props.startedAt);
    const e = decomposeIso(props.endedAt);
    setDraft({ startDate: s.date, startTime: s.time, endDate: e.date, endTime: e.time });
    setError(null);
    setEditing(false);
  };

  // After a successful submit (isSubmitting false → true → false with submitError null), close.
  const prevSubmitting = useRef(false);
  useEffect(() => {
    if (prevSubmitting.current && !props.isSubmitting && !props.submitError) {
      setEditing(false);
    }
    prevSubmitting.current = props.isSubmitting;
  }, [props.isSubmitting, props.submitError]);

  // ...render
}
```

### Validation messages (exact strings)

| Error kind | Message |
|---|---|
| `start-date-invalid` | "Start date must be YYYY-MM-DD." |
| `start-time-invalid` | "Start time must be HH:MM (24h)." |
| `end-date-invalid` | "End date must be YYYY-MM-DD." |
| `end-time-invalid` | "End time must be HH:MM (24h)." |
| `end-before-start` | "End must be the same or after start." |
| `end-in-future` | "End can't be in the future." |
| Soft advisory (not an error) | "Some sets in this session were logged outside this new time range." (rendered as `text-amber-600 dark:text-amber-400`, not red; does not block Save) |
| Mutation error | `props.submitError` rendered verbatim (e.g. "Failed to update session times") |

### Styling

- Field rows use the same classes as the name input (`rounded-md border border-gray-300 px-3 py-2 ... dark:border-gray-700 dark:text-white`).
- Date + time pair shown side-by-side via `flex-row gap-2` (date input wider).
- Save = `<Button variant="primary">`; Cancel = `<Button variant="secondary">` (existing `~/components/ui/button` variants — confirm with Implementer).
- Inline error: `text-xs text-red-500 mt-1` matching the name field error style at `history/[id].tsx:209-215`.
- All text/border colors carry `dark:` variants.

### Keyboard hints

- Date fields: `keyboardType="numbers-and-punctuation"` (iOS) / `inputMode="numeric"` (web) — owner types `2026-05-12`.
- Time fields: same keyboard hint; max length 5 enforced via `maxLength={5}`.
- No `autoFocus`; tapping the pencil opens form but does not focus, to avoid keyboard popping on a long form.

## Riscos

### Data integrity
- **RLS**: existing `auth.uid() = user_id` covers UPDATE. No new policy work. The Validator should confirm via `0001_rls_and_seed.sql`.
- **No DB CHECK** on `started_at <= ended_at`. Client validation is the only guard. A malicious or buggy client could write inverted times. Acceptable since this is a single-user app and RLS prevents cross-user writes; revisit if multi-user.
- **`updated_at` trigger**: server-owned. Client must not include `updated_at` in the payload. Helper writes only `started_at` + `ended_at`.
- **Soft-delete invariant**: untouched — helper does not modify `deleted_at`.
- **Active-session invariant**: helper requires non-null `ended_at` via the typed signature (`{ ended_at: string }`, not nullable). No path sets `ended_at = null`, so a finished session cannot be reverted to in-progress through this UI. The History detail screen also redirects unfinished sessions away (`history/[id].tsx:84-88`).

### UX regressions
- **Strip vs drill-down asymmetry (accepted)**. If the owner edits `started_at` across an ISO-week boundary, the session row appears in the new week's drill-down list, but the strip bar (bucketed by `set.completed_at`) and the drill-down's headline weekly volume (also `set.completed_at`) stay in the old week. This **is the correct behaviour**: the strip reports when training load happened; the session list reports when the user says the session started. Documented here; if owner pushes back, upgrade path is to cascade `set.completed_at` by the same delta (out of scope for v1).
- **Name field unchanged**: rename inline-edit (`onBlur` commit) on the same screen remains as-is. New time-edit form is visually distinct (explicit Save/Cancel) to avoid confusion with the always-editable name input.
- **Notes**: still rendered as read-only `<Text>`. No regression.
- **Cache invalidation widened**. `useUpdateSessionTimes` invalidates `["stats"]` and `["progress"]` in addition to `["sessions"]`. This forces a refetch of weekly volume rows and any per-exercise progress chart currently mounted. Cost is low; both queries are cheap and rate-limited by `staleTime: 60_000` on `useWeeklyVolume`, but `invalidateQueries` overrides staleness. Net cost: one extra round-trip per edit. Acceptable.

### Platform-specific
- **No native picker**. iOS/Android/web all get the same four `TextInput`s. Trade-off: ugly compared to a native datetime wheel; acceptable for v1 (matches measurements precedent). Mistypes possible — validation guards.
- **`new Date('2026-05-12T14:30').toISOString()` interprets the input as device-local time** because the string has no offset. On iOS, Android, and web this behaves consistently. No timezone preference; relies on device clock. Documented under §Open questions for the Validator (sanity check on iOS/Android).
- **Web Playwright e2e**: text inputs are easy to drive. No platform-specific test scaffolding needed.

### Performance
- Cache invalidation triggers refetch of `["sessions"]` (full session list), `["stats", "weekly-volume", *]`, and any mounted `["progress", *]` queries. Each is a single Supabase select; aggregate cost is small (~3 round-trips). On a slow connection the History detail screen will briefly show stale data; React Query's `placeholderData` is not used here so the list briefly reflects old values during the refetch window — acceptable.
- The soft "sets outside range" advisory requires iterating `setsCompletedAt` once per render. O(n) over sets-in-session (typically <30). Negligible.

## Alternativas descartadas

1. **`@react-native-community/datetimepicker` + web shim** — descartada porque adds a new platform-divergent dep with a mediocre web fallback, for a single screen. Cosmetic-only win; cost not justified for v1. Upgrade path if owner asks.
2. **Dedicated edit sub-screen at `app/(app)/history/[id]/edit-times.tsx`** (mirroring `measurements/[id]/edit.tsx`) — descartada porque navigation overhead (push + back) is heavier than tap-to-reveal for two fields. The measurements edit screen exists because measurement entries have many fields (date, weight, body fat, notes). Session times are two timestamps; inline form is enough.
3. **Cascade `set.completed_at` by the same delta** — descartada porque sets may have non-uniform completion times within a session (10s rest between sets vs 5min); a single delta misaligns them. Also mutates 5-30 set rows per edit. The asymmetry (strip vs list) is a feature, not a bug — the strip tells the truth about training volume distribution.
4. **Generic `updateSession(id, patch)` helper** that absorbs `updateSessionName` / `updateSessionNotes` / new times — descartada porque a refactor of two existing helpers is out of scope; the narrow helper has zero blast radius. Revisit if a fourth field appears.
5. **Reject edits that cross an ISO-week boundary** — descartada porque the "I forgot to tap Quick start last night" use case (most common backfill) often crosses midnight which can cross a week boundary on Sunday→Monday or Sunday→Sunday. Blocking it kills the feature for the case that motivates it.
6. **Inline edit per field with `onBlur` commit** (like name) — descartada porque cross-field validation (`end >= start`) needs both fields drafted before commit. Per-field blur commits could write `started_at > current ended_at` mid-edit and reject; UX is confusing. Explicit Save consolidates the validation.

## Out of scope

- Editing per-set `completed_at` (Discovery #out-of-scope-flags).
- Editing times on in-progress sessions (Discovery #out-of-scope-flags; screen already redirects).
- Cascade-updating sets' `completed_at` when session times move (alternative 3 above).
- Bulk-editing multiple sessions.
- Timezone preference / display toggle.
- New datetime picker UI library.
- Adding a CHECK constraint `started_at <= ended_at` (schema migration broader than this feature).
- Editing `notes` inline on the History detail (still read-only).
- Confirm dialog for cross-week edits (decision 8).

## Open questions for Validator

1. **Web vs native `new Date('YYYY-MM-DDTHH:mm').toISOString()` parsing**: confirm device-local interpretation is consistent across iOS Safari (Hermes), Android (Hermes), and Chrome (web). Spec says YES (per ECMA-262 § 21.4.3.2 — no-offset → local) but Hermes has had historical quirks. Validator: grep for prior `new Date(stringWithoutOffset)` usage; check if measurements form has any open issues.
2. **`useUpdateSessionTimes` cache invalidation order**: `setQueryData(KEYS.detail, row)` runs before `invalidateQueries(KEYS.all)`. This matches `useUpdateSessionName`. Validator: confirm no race where the detail screen briefly re-renders with stale list data, causing the editor's `useEffect` to reset draft incorrectly. (Mitigated by the editor closing on successful submit before refetch lands.)
3. **`Pencil` icon import from `lucide-react-native`**: verify the icon exists in the project's installed version of `lucide-react-native`. (Reasonable confidence — `Plus` from same package is used in the same file.)
4. **Soft advisory threshold for "sets outside range"**: should the check use a small tolerance (e.g., ±60s) to avoid false positives from sub-second precision drift? Designer's call: no tolerance, exact `[start, end]` bounds. Validator: confirm `set.completed_at` is stored with second-or-better precision (timestamptz default).
5. **`composeIso` on a "spring forward" DST gap** (e.g., `2026-03-08T02:30` in BRT — though Brazil has no DST since 2019, the engine may still respect host OS DST in other regions). `new Date()` collapses to the next valid instant. Acceptable; no user-facing impact for the BRT owner. Validator: confirm no test runs in a DST-active locale.

---

**Status**: `done`
