# Design v2 — 2026-05-20_1937_edit-workout-times

## Goal (1 sentence)
Let the owner correct a finished session's `started_at` / `ended_at` from the History detail screen via a tap-to-reveal text-input form, propagating to history list, week drill-down, weekly volume strip, and per-exercise progress chart.

## Approach
Add an explicit, opt-in edit mode on `app/(app)/history/[id].tsx`. Default render keeps the current read-only start/duration display; pressing a "Edit times" pencil reveals four `TextInput`s (start-date `YYYY-MM-DD` + start-time `HH:mm` + end-date + end-time) with explicit Save / Cancel buttons. Validation uses `date-fns/parse` for strict component checking (mirror of `src/utils/measurements-form.ts:128-137`) and strict regexes so invalid clock values (`25:99`) or rollovers (`2026-02-30`) are rejected before any `Date` math. Save composes UTC ISO strings via `parse(...).toISOString()`, calls a narrow helper `updateSessionTimes(id, { started_at, ended_at })`, and a new `useUpdateSessionTimes` hook invalidates `["sessions"]`, `["sessions", id]`, `["sessions", "active"]`, `["stats"]`, `["progress"]` to mirror the `useFinishSession` + `useSoftDeleteSession` precedents.

The draft state is initialized **imperatively** when `setEditing(true)` is invoked — there is no prop-sync `useEffect`. Cancel reads from props on demand. This removes the v1 race where a post-mutation `setQueryData` could wipe an in-flight draft. Strip/drill-down asymmetry (strip buckets by `set.completed_at`, list buckets by `session.started_at`) is **accepted and documented**, and the e2e covers it explicitly.

## Decisions on unknowns

| # | Unknown | Decision | Justification |
|---|---|---|---|
| 1 | Picker strategy | (a) Four `TextInput`s — date `YYYY-MM-DD` + time `HH:mm` per timestamp | Zero new deps, matches measurements precedent, identical UX on web/iOS/Android, Playwright-friendly. |
| 2 | API surface | Narrow `updateSessionTimes(id, { started_at, ended_at })` — sibling of `updateSessionName` | Smallest blast radius. Existing `updateSessionName`/`updateSessionNotes` stay untouched. |
| 3 | Hook | New `useUpdateSessionTimes` invalidating `["sessions"]` + `["sessions", id]` + `["sessions", "active"]` + `["stats"]` + `["progress"]` | Mirrors `useFinishSession` (broad stats + progress) and `useSoftDeleteSession` (active key); defense-in-depth. |
| 4 | Edit mode UX | (a) Tap-to-reveal pencil → form with explicit Save / Cancel | Cross-field validation (`start <= end`) is awkward on `onBlur` commit. Matches measurements-edit affordance pattern. Prevents accidental edits. |
| 5 | Validation rules | strict regex + `date-fns/parse`; `end >= start`; `end <= now()`; no max duration cap; `start` can be arbitrarily in the past | "Finished in the future" is always a typo. No real cap on workout duration. Historical backfill must allow old `start`. |
| 6 | Cross-week edit | (i) Accept asymmetry + document it inline + e2e demonstrates it | Sets carry the truth about when work happened (`completed_at` → strip). Cascade would misalign multi-day sessions. |
| 7 | Save trigger | Explicit Save button | Two coupled fields need cross-field validation before commit. |
| 8 | Confirmation dialog for cross-week edit | None | We accept the asymmetry (decision 6); UI immediately reflects new date after save. |
| — | `sets.completed_at` bound check | Soft warning, not block — uses **composed UTC** bounds vs UTC `completed_at` strings | Sets are source of truth and may legitimately precede a corrected `started_at`. Bounds check happens in ms-since-epoch to avoid local-vs-UTC mismatch. |
| — | Active-session guard | Helper signature requires non-null `ended_at`; no path sets `ended_at = null` | Detail screen redirects in-progress sessions to `/workout/<id>` (`history/[id].tsx:84-88`). |
| — | Timezone display vs storage | Display + input in device-local; store UTC ISO via `parse(...).toISOString()` | Matches measurements form. `date-fns/parse` uses host TZ; tests pin `process.env.TZ = 'America/Sao_Paulo'`. |
| — | Draft prop-sync | **No `useEffect` prop-sync.** Initialize draft imperatively on `setEditing(true)`; Cancel re-derives from props. | Removes BLK-1 race. No flicker risk, no effect ordering concerns. |

## Mudanças por arquivo

| File | Type | Change |
|---|---|---|
| `src/api/sessions.ts` | edited | Add `updateSessionTimes(id, { started_at, ended_at })`. Single responsibility: Supabase UPDATE of those two columns. |
| `src/hooks/use-sessions.ts` | edited | Add `useUpdateSessionTimes()` mirroring `useUpdateSessionName` shape, with widened invalidation: `KEYS.all`, `KEYS.detail(id)`, `KEYS.active`, `["stats"]`, `["progress"]`. |
| `src/utils/session-times-form.ts` | new | Pure helpers: strict `DATE_RE` / `TIME_RE`, `composeIso` (uses `date-fns/parse`), `decomposeIso`, `validateTimes` (cross-field), `countSetsOutsideRange` (UTC-vs-UTC bounds check). |
| `src/components/session-times-editor.tsx` | new | Presentational + local-state edit component. Owns read-only display, "Edit times" pencil, expanded form (four `TextInput`s + Save/Cancel + inline errors), soft "sets outside range" advisory recomputed on every keystroke. Accepts `onSubmit` and `onCancel` callbacks. |
| `app/(app)/history/[id].tsx` | edited | Replace the two read-only `<Text>` rows (`history/[id].tsx:217-222`) that render `formatDateTime(started_at)` + `Duration: ...` with `<SessionTimesEditor … onSubmit={…} onCancel={…} isSubmitting={mutation.isPending} submitError={…} />`. Parent owns `mutation.reset()` on Cancel. |
| `tests/unit/session-times-form.test.ts` | new | Unit tests for `composeIso`, `decomposeIso`, `validateTimes`, `countSetsOutsideRange`. Pins TZ via `process.env.TZ = 'America/Sao_Paulo'` at the top of the file. |
| `tests/e2e/crud.spec.ts` | edited | Add two `test()` arms: (1) edit start back by 1h, save, assert new duration text on detail + history list; (2) cross-week — move `started_at` to previous ISO week, assert session moves in drill-down list but strip bar in original week unchanged. |

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
      qc.invalidateQueries({ queryKey: KEYS.active }); // MIN-1 — symmetry with useSoftDeleteSession
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["progress"] });
    },
  });
}
```

```ts
// src/utils/session-times-form.ts
import { parse } from "date-fns";

// BLK-2 fix — strict regexes reject 25:99, 2026-13-45, etc. before parse runs.
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^(2[0-3]|[01]\d):([0-5]\d)$/;

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

/**
 * Compose local date + time strings into a UTC ISO 8601 string.
 * Uses `date-fns/parse` (mirror of measurements-form.ts:128-137) so component
 * rollovers (2026-02-30, 13th month, leap-day on non-leap years) become Invalid
 * Date instead of being silently corrected by `new Date()`.
 * Throws RangeError if the combined string fails strict parsing.
 */
export function composeIso(localDate: string, localTime: string): string {
  const d = parse(`${localDate} ${localTime}`, "yyyy-MM-dd HH:mm", new Date());
  if (Number.isNaN(d.getTime())) throw new RangeError("Invalid date or time");
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

/** Cross-field validation. Returns composed UTC ISO pair or first error. */
export function validateTimes(
  draft: TimesDraft,
  now: Date,
):
  | { ok: true; started_at: string; ended_at: string }
  | { ok: false; error: ValidationError } {
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

/**
 * MAJ-4 — Count sets whose completed_at falls outside [composedStartIso, composedEndIso].
 * Both inputs are UTC ISO strings; comparison is in ms-since-epoch to avoid
 * any local-vs-UTC string-comparison mismatch. `null` completed_at entries are ignored.
 */
export function countSetsOutsideRange(
  composedStartIso: string,
  composedEndIso: string,
  setsCompletedAt: ReadonlyArray<string | null>,
): number {
  const startMs = new Date(composedStartIso).getTime();
  const endMs = new Date(composedEndIso).getTime();
  return setsCompletedAt
    .filter((c): c is string => Boolean(c))
    .filter((c) => {
      const t = new Date(c).getTime();
      return t < startMs || t > endMs;
    }).length;
}
```

### Component props (new)

```ts
// src/components/session-times-editor.tsx
export type SessionTimesEditorProps = {
  startedAt: string;                          // current ISO UTC
  endedAt: string;                            // current ISO UTC; required (only renders for finished sessions)
  setsCompletedAt: ReadonlyArray<string | null>; // for the soft-warning bounds check
  isSubmitting: boolean;
  submitError: string | null;
  onSubmit: (times: { started_at: string; ended_at: string }) => void;
  onCancel?: () => void;                      // MAJ-2 — parent calls mutation.reset() then closes
};
```

### DB columns / queries

- Table: `public.sessions`.
- Columns updated: `started_at timestamptz NOT NULL`, `ended_at timestamptz` (nullable in schema, but helper signature never sends `null`).
- `updated_at` is touched server-side by the `touch_updated_at` trigger (do not send from client).
- RLS: existing `auth.uid() = user_id` policy on `sessions` covers UPDATE. No new policy needed.
- No CHECK constraint added (client-side validation only).
- No new index needed. `sessions_user_started_idx` already covers `(user_id, started_at)`.

## UI spec

### Read-only mode (default)

Replaces the two `<Text>` rows on `history/[id].tsx:217-222`.

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

- Pencil affordance via `Pencil` from `lucide-react-native` (verified by Validator).
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
│ [Save (loading=isSubmitting)]  [Cancel]     │
│                                             │
│ Total: 14 sets · 4,820 kg volume            │
└─────────────────────────────────────────────┘
```

### Pseudo-code (component)

```tsx
function SessionTimesEditor(props: SessionTimesEditorProps) {
  const [editing, setEditing] = useState(false);
  // BLK-1 fix — no prop-sync useEffect. Draft is initialized imperatively
  // when entering edit mode; Cancel re-derives from props on demand.
  const [draft, setDraft] = useState<TimesDraft>(() => {
    const s = decomposeIso(props.startedAt);
    const e = decomposeIso(props.endedAt);
    return { startDate: s.date, startTime: s.time, endDate: e.date, endTime: e.time };
  });
  const [error, setError] = useState<string | null>(null);

  const openEdit = () => {
    const s = decomposeIso(props.startedAt);
    const e = decomposeIso(props.endedAt);
    setDraft({ startDate: s.date, startTime: s.time, endDate: e.date, endTime: e.time });
    setError(null);
    setEditing(true);
  };

  const onSave = () => {
    const result = validateTimes(draft, new Date());
    if (!result.ok) { setError(messageFor(result.error)); return; }
    setError(null);
    props.onSubmit({ started_at: result.started_at, ended_at: result.ended_at });
    // Parent closes by transitioning isSubmitting true→false with no submitError (see effect below).
  };

  const onCancel = () => {
    // MAJ-2 — call parent so it can mutation.reset() before we close.
    props.onCancel?.();
    setError(null);
    setEditing(false);
  };

  // Close on successful submit (isSubmitting true → false with no error).
  const prevSubmitting = useRef(false);
  useEffect(() => {
    if (prevSubmitting.current && !props.isSubmitting && !props.submitError) {
      setEditing(false);
    }
    prevSubmitting.current = props.isSubmitting;
  }, [props.isSubmitting, props.submitError]);

  // MAJ-4 — recomputed on every keystroke (cheap, ≤30 sets/session).
  // Only computed when draft passes strict validation; otherwise we cannot
  // form composed ISO strings.
  const outsideCount = useMemo(() => {
    const result = validateTimes(draft, new Date(Date.now() + 365 * 24 * 3600 * 1000));
    if (!result.ok) return 0;
    return countSetsOutsideRange(result.started_at, result.ended_at, props.setsCompletedAt);
  }, [draft, props.setsCompletedAt]);

  if (!editing) {
    return (
      <Pressable onPress={openEdit} accessibilityRole="button" accessibilityLabel="Edit start and end times">
        <View className="flex-row items-center justify-between">
          <Text className="text-base text-gray-900 dark:text-white">{formatDateTime(props.startedAt)}</Text>
          <Pencil size={16} className="text-gray-500 dark:text-gray-400" />
        </View>
        <Text className="text-sm text-gray-600 dark:text-gray-400">
          Duration: {formatDuration(props.startedAt, props.endedAt)}
        </Text>
      </Pressable>
    );
  }

  return (
    <View className="gap-2">
      <Text className="text-xs uppercase text-gray-500 dark:text-gray-400">Start</Text>
      <View className="flex-row gap-2">
        <TextInput
          value={draft.startDate}
          onChangeText={(v) => setDraft((d) => ({ ...d, startDate: v }))}
          placeholder="YYYY-MM-DD"
          keyboardType="numeric"             {/* MIN-3 — universal across iOS/Android/web */}
          maxLength={10}
          className="flex-2 rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:text-white"
        />
        <TextInput
          value={draft.startTime}
          onChangeText={(v) => setDraft((d) => ({ ...d, startTime: v }))}
          placeholder="HH:mm"
          keyboardType="numeric"
          maxLength={5}
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:text-white"
        />
      </View>

      <Text className="text-xs uppercase text-gray-500 dark:text-gray-400">End</Text>
      <View className="flex-row gap-2">
        {/* same two TextInputs, bound to endDate / endTime */}
      </View>

      {error && <Text className="text-xs text-red-500">{error}</Text>}
      {props.submitError && <Text className="text-xs text-red-500">{props.submitError}</Text>}
      {outsideCount > 0 && (
        <Text className="text-xs text-amber-600 dark:text-amber-400">
          {outsideCount === 1
            ? "1 set in this session was logged outside this time range."
            : `${outsideCount} sets in this session were logged outside this time range.`}
        </Text>
      )}

      <View className="flex-row gap-2">
        <Button onPress={onSave} loading={props.isSubmitting} variant="primary">
          Save
        </Button>
        <Button onPress={onCancel} variant="secondary" disabled={props.isSubmitting}>
          Cancel
        </Button>
      </View>
    </View>
  );
}
```

### Parent wiring (`app/(app)/history/[id].tsx`)

```tsx
const updateTimes = useUpdateSessionTimes();

// MAJ-2 — wire onCancel so we clear stale mutation error before closing.
<SessionTimesEditor
  startedAt={session.data.started_at}
  endedAt={session.data.ended_at!}                  // screen redirects when null
  setsCompletedAt={(setsQ.data ?? []).map((s) => s.completed_at)}
  isSubmitting={updateTimes.isPending}
  submitError={updateTimes.error ? "Failed to update session times" : null}
  onSubmit={(times) => updateTimes.mutate({ id: session.data.id, ...times })}
  onCancel={() => updateTimes.reset()}
/>
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
| Soft advisory | "N sets in this session were logged outside this time range." (`text-amber-600 dark:text-amber-400`, non-blocking) |
| Mutation error | `props.submitError` rendered verbatim ("Failed to update session times") |

### Styling

- Field rows reuse the name-input classes (`rounded-md border border-gray-300 px-3 py-2 ... dark:border-gray-700 dark:text-white`).
- Date + time pair shown side-by-side via `flex-row gap-2` (date wider).
- Save = `<Button variant="primary" loading={isSubmitting}>`; Cancel = `<Button variant="secondary" disabled={isSubmitting}>`.
- Inline error: `text-xs text-red-500 mt-1` matching the name field error style at `history/[id].tsx:209-215`.
- All text/border colors carry `dark:` variants.

### Keyboard hints

- All four fields: `keyboardType="numeric"` (universal across iOS/Android/web — MIN-3). On iOS this hides the dash/colon glyphs from the dedicated keyboard but they are still typeable via long-press; trade-off accepted since separator characters are constant and the validation surfaces clear errors.
- `maxLength={10}` on date, `maxLength={5}` on time.
- No `autoFocus`; tapping the pencil opens form but does not focus, to avoid keyboard popping on a long form.

## Riscos

### Data integrity
- **RLS**: existing `auth.uid() = user_id` covers UPDATE. No new policy.
- **No DB CHECK** on `started_at <= ended_at`. Client validation is the only guard. Acceptable for single-user app under RLS.
- **`updated_at` trigger**: server-owned. Helper writes only `started_at` + `ended_at`.
- **Soft-delete invariant**: untouched — helper does not modify `deleted_at`.
- **Active-session invariant**: helper signature requires non-null `ended_at`; no path can revert a session to in-progress. History detail screen also redirects unfinished sessions (`history/[id].tsx:84-88`).
- **MIN-2 — second truncation**: `decomposeIso` outputs `HH:mm` only. Re-saving without changing inputs truncates seconds from `started_at` / `ended_at` (drift up to 59s). Acceptable for a human-entered backfill UI — the user already lost time precision when typing minutes.

### UX regressions
- **Strip vs drill-down asymmetry (accepted)**. If the owner edits `started_at` across an ISO-week boundary, the session row appears in the new week's drill-down list, but the strip bar (bucketed by `set.completed_at`) and the drill-down's headline weekly volume (also `set.completed_at`) stay in the old week. This is correct behaviour and explicitly demonstrated in the new e2e arm (MIN-4).
- **Name field unchanged**: rename inline-edit (`onBlur` commit) on the same screen remains as-is.
- **Notes**: still rendered as read-only `<Text>`. No regression.
- **Cache invalidation widened**. Net cost: one extra round-trip per edit across stats + progress + sessions list + active key. Cheap.
- **Stale mutation error on re-open**: addressed via MAJ-2 — `onCancel` calls `mutation.reset()` before closing.

### Platform-specific
- **No native picker**. iOS/Android/web all get the same four `TextInput`s. Trade-off accepted (matches measurements precedent).
- **`date-fns/parse` uses host TZ**. Owner runs in BRT (production). CI runners default to UTC and would render different local-time strings if tests assumed local rendering. **All unit + e2e tests pin `process.env.TZ = 'America/Sao_Paulo'`** (MAJ-3). Documented at the top of `tests/unit/session-times-form.test.ts` and reaffirmed in the Playwright global setup if the e2e arm needs it.
- **DST**: Brazil has no DST since 2019, so `composeIso` cannot land in a DST gap for the owner. `date-fns/parse` resolves gaps deterministically (returns the next valid instant) on regions that do have DST; acceptable.
- **Keyboard hints**: `keyboardType="numeric"` is the universal value (MIN-3); separators are reachable via long-press on iOS.

### Performance
- Cache invalidation triggers refetch of `["sessions"]`, `["sessions", "active"]`, `["stats", "weekly-volume", *]`, and any mounted `["progress", *]`. ~3-4 round-trips; each is a single Supabase select. Acceptable.
- `countSetsOutsideRange` recomputed on every keystroke. O(n) over sets-in-session (typically <30). Negligible. `useMemo` caches across pure draft non-changes.

## Alternativas descartadas

1. **`@react-native-community/datetimepicker` + web shim** — descartada porque adds a new platform-divergent dep with a mediocre web fallback, for a single screen. Cosmetic-only win; cost not justified for v1.
2. **Dedicated edit sub-screen at `app/(app)/history/[id]/edit-times.tsx`** — descartada porque navigation overhead (push + back) is heavier than tap-to-reveal for two fields.
3. **Cascade `set.completed_at` by the same delta** — descartada porque sets may have non-uniform completion times within a session; a single delta misaligns them. The strip/drill-down asymmetry is a feature.
4. **Generic `updateSession(id, patch)` helper** — descartada porque a refactor of two existing helpers is out of scope; the narrow helper has zero blast radius.
5. **Reject edits that cross an ISO-week boundary** — descartada porque the "I forgot to tap Quick start last night" use case often crosses midnight; blocking it kills the feature.
6. **Inline edit per field with `onBlur` commit** — descartada porque cross-field validation (`end >= start`) needs both fields drafted before commit.
7. **Prop-sync `useEffect` that resets draft when `props.startedAt`/`props.endedAt` change** (v1 approach) — descartada porque it races with post-mutation `setQueryData(KEYS.detail, row)` and can wipe an in-flight draft on submit failure + background refetch. Replaced with imperative initialization on `setEditing(true)`.
8. **Use raw `new Date(`${localDate}T${localTime}`)` for parsing** (v1 approach) — descartada porque it silently rolls over `2026-13-45` and other invalid components. `date-fns/parse` is strict and matches the measurements precedent.

## Out of scope

- Editing per-set `completed_at`.
- Editing times on in-progress sessions.
- Cascade-updating sets' `completed_at` when session times move.
- Bulk-editing multiple sessions.
- Timezone preference / display toggle.
- New datetime picker UI library.
- Adding a CHECK constraint `started_at <= ended_at`.
- Editing `notes` inline on the History detail.
- Confirm dialog for cross-week edits.

## Resposta a issues do Validator

| Issue | Resolution |
|---|---|
| **BLK-1** — prop-sync `useEffect` race resets draft mid-edit | Removed the prop-sync effect entirely. Draft is initialized imperatively inside `openEdit()` (called on entering edit mode) and inside the `useState` initializer; Cancel re-derives from props on demand. No effect ordering concerns; post-mutation `setQueryData` cannot wipe an in-flight draft. See pseudo-code under §UI spec. |
| **BLK-2** — `composeIso` swallows invalid dates that pass the regex | Switched to `date-fns/parse(`${localDate} ${localTime}`, "yyyy-MM-dd HH:mm", new Date())` (mirrors `src/utils/measurements-form.ts:128-137`). Also tightened `TIME_RE = /^(2[0-3]|[01]\d):([0-5]\d)$/` so `25:99` is rejected by regex before parse runs. Exact code in §Contratos de I/O. |
| **MAJ-1** — Save not gated on `isSubmitting` | Save button takes `loading={props.isSubmitting}`; Cancel takes `disabled={props.isSubmitting}`. Shown in the pseudo-code. |
| **MAJ-2** — Cancel doesn't clear stale `submitError` | Added `onCancel?: () => void` to `SessionTimesEditorProps`. Parent wiring calls `updateTimes.reset()` then internal state closes via `setEditing(false)`. Exact wiring in §UI spec > Parent wiring. |
| **MAJ-3** — TZ pinning for tests | New `tests/unit/session-times-form.test.ts` starts with `process.env.TZ = 'America/Sao_Paulo'` (set before any imports). Documented under §Riscos > Platform-specific. |
| **MAJ-4** — UTC-vs-UTC bounds check for "sets outside range" advisory | New pure helper `countSetsOutsideRange(composedStartIso, composedEndIso, setsCompletedAt)` computes bounds in `Date.getTime()` milliseconds; component memoizes per draft change. Exact code in §Contratos de I/O. |
| **MIN-1** — Add `KEYS.active` invalidation | Added `qc.invalidateQueries({ queryKey: KEYS.active })` in `useUpdateSessionTimes.onSuccess`. |
| **MIN-2** — Second truncation drift | Documented in §Riscos > Data integrity: re-saving without changes truncates seconds by up to 59s; acceptable for human-entered backfill. |
| **MIN-3** — `keyboardType="numbers-and-punctuation"` is iOS-only | Switched all four fields to `keyboardType="numeric"` (universal). Separators reachable via long-press on iOS; validation surfaces format errors. |
| **MIN-4** — e2e cross-week arm | Added a second `test()` arm in `tests/e2e/crud.spec.ts`: move `started_at` to previous ISO week, assert session appears in the previous week's drill-down list but the strip bar in the original week is unchanged (demonstrates the accepted asymmetry from decision (i)). |

---

**Status**: `done`
