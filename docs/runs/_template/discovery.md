# Discovery — <run-id>

## Feature prompt
<copied from state.md>

## Scope summary
<2-3 sentences: what this feature is, where it lives in the app>

## Affected files (verified)
- `path/to/file.tsx:line-range` — <one-line role>
- ...

## Relevant conventions (verified by reading code)
- <e.g. "Routine entries use Drizzle schema in src/db/schema.ts:120-140; queries via src/api/routines.ts">

## Constraints
- **Data**: <RLS tables touched, FK relations, denormalization rules>
- **UI**: <NativeWind class patterns, navigation hierarchy, screen routing>
- **Platform**: <iOS/Android/web divergence if any>
- **Auth**: <which session/user context applies>
- **Performance**: <hot paths, query patterns>

## Existing precedents
- <e.g. "Similar pattern exists for daily volume in app/(app)/history/index.tsx:78-110">

## Unknowns (require Designer judgment or human decision)
- <ambiguity in prompt: "weekly = ISO week starting Monday, or rolling 7 days?">
- <missing info: "no spec for empty state when user has no completed workouts">

## Out-of-scope flags
- <things mentioned in or implied by the prompt that should NOT be in this feature>
