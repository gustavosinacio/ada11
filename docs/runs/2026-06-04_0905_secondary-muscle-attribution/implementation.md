# Implementation — <run-id>

Based on: `design-v<N>.md` (final approved) and `validation-v<N>.md` (matching `go`).

## Files changed
- `path/to/file.tsx` (edited) — <one-line summary>
- `path/new.ts` (new) — <purpose>
- ...

## Deviations from design
- **<design item>**: <how it differs, why this deviation is correct>.
- (or: "None.")

## Soft callbacks made (during this implementation pass)
- <none | path to questions.md and reason>

## Quality gates
- [ ] `npm run typecheck` passed
- [ ] `npm run lint` passed (only pre-existing warnings, if any)
- [ ] Relevant unit tests pass — `npm run test:unit`
- [ ] No new `any`
- [ ] No new `// @ts-ignore`
- [ ] No stray `console.log`

## Notes for Reviewer / Tester
- <e.g. "The weekly volume query joins on workout_sessions.completed_at — Reviewer please verify the existing index covers this access path">
- <e.g. "Tester: empty state for new users should render the 'No completed workouts' card on the History screen">
