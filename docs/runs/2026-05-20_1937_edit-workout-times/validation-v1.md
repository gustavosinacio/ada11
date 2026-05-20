# Validation v1 — 2026-05-20_1937_edit-workout-times

## Summary
Overall shape is sound — narrow `updateSessionTimes`, mirrored `useFinishSession` invalidation, tap-to-reveal pencil, 4 TextInputs, accept-and-document asymmetry. All claims about file:line locations check out. But 2 blockers + 4 majors need fixing before implementation.

## Blockers

### BLK-1 — `useEffect` race resets the draft mid-edit (`design-v1.md:236-240`)
The reset effect fires on every change to `props.startedAt`/`props.endedAt`, including the post-save `setQueryData(KEYS.detail, row)` from the hook. On any **failed** submit followed by background refetch, the user's in-flight draft is silently wiped. Worse: the *close-on-success* effect and this *reset* effect run in non-deterministic order — could briefly show "form open with new server values," which is incoherent UX.

**Fix**: Gate the reset on `editing` transitioning false → true, OR initialize the draft imperatively when `setEditing(true)` is called (no prop-sync effect at all):
```tsx
useEffect(() => {
  if (!editing) {
    const s = decomposeIso(props.startedAt);
    const e = decomposeIso(props.endedAt);
    setDraft({...});
  }
}, [editing, props.startedAt, props.endedAt]);
```

### BLK-2 — `composeIso` swallows invalid dates that pass the regex (`design-v1.md:60,106-110,132-143`)
Regex `^\d{4}-\d{2}-\d{2}$` passes `2026-13-45`, `2026-02-30`, `2026-02-29` (non-leap). `new Date('2026-13-45T10:00')` behavior is engine-quirky; Hermes may roll over silently. **This is exactly the MAJ-1 bug the measurements run already paid to fix.**

The measurements precedent uses `date-fns/parse(s, "yyyy-MM-dd", new Date())` precisely because `parse` strictly validates components and returns Invalid Date on rollover.

**Fix**: Use `date-fns/parse` with combined format:
```ts
import { parse } from "date-fns";

export function composeIso(localDate: string, localTime: string): string {
  const d = parse(`${localDate} ${localTime}`, "yyyy-MM-dd HH:mm", new Date());
  if (Number.isNaN(d.getTime())) throw new RangeError("Invalid date or time");
  return d.toISOString();
}
```

Also tighten `TIME_RE = /^(2[0-3]|[01]\d):([0-5]\d)$/` (current `\d{2}:\d{2}` accepts `25:99`).

## Majors

### MAJ-1 — Save button not gated on `isSubmitting`
The pseudo-code never shows the Save button receiving `loading={props.isSubmitting}`. Slow network → user double-taps → two writes. **Fix**: pass `loading={props.isSubmitting}`; existing Button component handles `loading` → disabled.

### MAJ-2 — `Cancel` doesn't clear stale `submitError`
Editor closes itself on Cancel internally but doesn't clear the parent's `useUpdateSessionTimes.error`. Re-opening edit mode shows stale error. **Fix**: add `onCancel` callback so parent can call `mutation.reset()`.

### MAJ-3 — Cross-engine `new Date(string-without-offset)` requires explicit TZ pinning in tests
Even after BLK-2 fix, `date-fns/parse` uses system local TZ. Owner in BRT is fine in production, but CI runners in UTC could produce different displayed strings. **Fix**: pin TZ in test files via `process.env.TZ = 'America/Sao_Paulo'`; document in `Riscos`.

### MAJ-4 — "Sets outside range" advisory could mis-compare local vs UTC
The Implementer might naively compare draft strings (local) against `set.completed_at` (UTC). **Fix**: spec the bounds check on *composed* UTC ISO values:
```ts
const startMs = new Date(composedStartIso).getTime();
const endMs = new Date(composedEndIso).getTime();
const outsideCount = (setsCompletedAt ?? [])
  .filter((c): c is string => Boolean(c))
  .filter((c) => {
    const t = new Date(c).getTime();
    return t < startMs || t > endMs;
  }).length;
```

## Minors
- **MIN-1**: Add `qc.invalidateQueries({ queryKey: KEYS.active })` for symmetry with `useSoftDeleteSession`. Defense-in-depth.
- **MIN-2**: `decomposeIso` truncates seconds. Re-saving without changes drifts `started_at` by up to 59 seconds. Document or use a `secondsBuffer`.
- **MIN-3**: `keyboardType="numbers-and-punctuation"` is iOS-only. If Android matters, use `"numeric"` + accept long-press for punctuation.
- **MIN-4**: e2e test plan doesn't include the cross-week scenario. With decision (i) accepting asymmetry, the e2e should *demonstrate* the asymmetry: edit `started_at` to previous ISO week, assert session moves in drill-down list but strip bar in original week unchanged.

## Verified claims (pass)
- `history/[id].tsx:84-88` redirects in-progress.
- `Pencil` icon available + used in measurements/exercises screens.
- `Button` variants + `loading`/`disabled` props exist.
- `updateSessionName` shape matches proposed `updateSessionTimes`.
- `useUpdateSessionName` invalidation `setQueryData(detail, row) + invalidateQueries(KEYS.all)` is the sibling pattern.
- `sets[].completed_at` on `SetRow`; `setsQ` already mounted.
- `sessions` schema: `started_at timestamptz NOT NULL`, `ended_at timestamptz`, composite index `(user_id, started_at)`.
- RLS covers UPDATE; no new policy.
- `tests/e2e/crud.spec.ts` shape compatible.

## Decision

**no-go** — 2 blockers, 4 majors, 4 minors.

Both blockers are real runtime bugs that the measurements MAJ-1 fix and standard effect-hook patterns would have prevented. v2 should land in a single Designer round.

Designer must address in v2:
1. **BLK-1**: gate draft-reset effect on `editing` transition, or skip prop-sync effect entirely.
2. **BLK-2**: switch `composeIso` to `date-fns/parse` (mirror measurements precedent); tighten `TIME_RE`.
3. **MAJ-1**: wire `loading={isSubmitting}` on Save.
4. **MAJ-2**: add `onCancel` callback so parent can `mutation.reset()`.
5. **MAJ-3**: spec TZ pinning in test files.
6. **MAJ-4**: spec UTC-vs-UTC bounds check for sets-outside-range advisory.
7. Fold 4 minors.

Round 1 of 3. Two rounds left.
