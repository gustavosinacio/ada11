# Diagnosis — 2026-05-20_0042_exercise-block-undefined-muscles

## Hypothesis (stated BEFORE searching)
Given the repro — iOS-only render error on `exercise.muscles.length`, recent schema change adding `muscles`, web confirmed working on today's fresh deploy — I suspect the cause is a **stale TanStack Query persisted cache** on iOS AsyncStorage holding `ExerciseRow` entries from BEFORE commit `b51dd01` added the `muscles` field. Those persisted rows lack `muscles`; on rehydration the type system still says `string[]`, but at runtime the value is `undefined`. The render guard `(exercise.muscles.length > 0 || ...)` then crashes.

Web is unaffected because today's PWA reinstall / fresh deploy gave it a clean cache.

## Evidence

### Source-of-truth files (verified by reading)
- `src/db/types.ts:63` — `muscles: string[]` (non-optional, non-nullable in the TS type contract).
- `src/db/schema.ts:50` — `muscles: text("muscles").array().notNull().default(sql\`'{}'::text[]\`)` (Postgres-side: non-null with default empty array). Server-side data conforms to the type.
- `git log` — commit `b51dd01` (Tue May 19 20:55:57 2026 -0300, **less than 4 hours ago**) titled "feat: exercises track muscles as required multi-select array". Migration 0004 ADDed `muscles` and DROPped `primary_muscle`.
- `src/lib/query-client.ts:1-23` — TanStack Query persistence config:
  - Persister: `createAsyncStoragePersister({ storage: AsyncStorage, key: "ada11-query-cache" })`.
  - **No `buster` parameter.** The cache key is stable across schema changes. Persisted entries from before `b51dd01` rehydrate verbatim.
  - `gcTime: 1000 * 60 * 60 * 24` — entries stay alive for 24 hours.
- `app/(app)/exercises/[id]/index.tsx:52` — `muscles: data.muscles ?? []`. This file ALREADY defends against `muscles` being undefined; the rest of the codebase does NOT. The defensive read here is evidence that the issue was anticipated locally but the same defense wasn't applied to consumers.

### Candidate locations affected by the same root cause

All sites read `.muscles.length` / `.muscles.some()` / `.muscles.join()` directly on the runtime value. Any of them crashes when `muscles === undefined`.

| File:Line | Token / pattern | Context | Severity |
|---|---|---|---|
| `src/components/exercise-block.tsx:86` | `exercise.muscles.length > 0` | Header subtitle render guard. **The site the user hit.** | blocker |
| `src/components/exercise-block.tsx:89-90` | `exercise.muscles.length > 0 ? exercise.muscles.join(", ") : null` | Same component, inside subtitle text. | blocker |
| `src/components/exercise-list-item.tsx:13` | `exercise.muscles.length > 0 ? exercise.muscles.join(", ") : null` | Exercise library list row. Will crash on Exercises tab if cached rows are stale. | blocker |
| `src/components/routine-exercise-row.tsx:64,67-68` | `entry.exercise.muscles.length > 0 ...` | Routine builder row. Same shape. | blocker |
| `src/components/exercise-picker.tsx:36` | `e.muscles.some((m) => m.toLowerCase().includes(q))` | Search filter in exercise picker. **Crashes even before any UI render** when the search input is touched. | blocker |
| `src/components/exercise-picker.tsx:111,114-115` | `item.muscles.length > 0 ? item.muscles.join(", ") : null` | Exercise picker list item subtitle. | blocker |
| `src/lib/query-client.ts:18-22` | `createAsyncStoragePersister` with no `buster` | Root cause of the stale cache problem; affects future migrations too. | major |
| `app/(app)/exercises/[id]/index.tsx:52` | `data.muscles ?? []` | Already defensive — no fix needed. Reference pattern for the consumer fix. | (none — reference only) |

### Cross-environment confirmation

- **iOS dev build** — uses `@react-native-async-storage/async-storage` for the persister. AsyncStorage retains cache across rebuilds of the same install. The user's iOS app has run pre-`b51dd01` builds, persisted `useExercises()` and related results, and those persisted blobs do not contain a `muscles` field. On rehydration the JSON deserializer simply leaves the key absent → `undefined` at access time.
- **Web (PWA)** — `react-native-web` maps `AsyncStorage` to `localStorage`, BUT the user re-installed the PWA today after the fresh deploy. PWA reinstall clears the standalone-context localStorage; first run of the new bundle fetches fresh server rows (which include `muscles`) and persists those.
- **Android** — untested by user; predicted to fail identically to iOS on any device with a pre-`b51dd01` install + AsyncStorage cache. Risk is the same.

The hypothesis fully accounts for the iOS-only observation. Web is not protected; it just happened to land on a clean cache today.

## Root cause

**Two collaborating defects:**

1. **Consumer code reads `exercise.muscles.*` directly**, trusting the TS type (`string[]`). When the runtime value is `undefined`, every consumer crashes. This is the user-visible cause.
2. **TanStack Query persister has no `buster`**. Schema-incompatible cached data rehydrates on launch and feeds the consumers from #1. This is the structural cause that allowed #1 to surface and will allow future schema-incompatible regressions.

The right fix addresses both. Fixing only #1 (defensive reads) masks the symptom but leaves the cache-versioning gap open for the next migration. Fixing only #2 (cache buster) prevents recurrence but the current install of every user is already poisoned; their next launch on this build crashes anyway because the buster only invalidates AFTER they upgrade to the build that has the buster.

## Severity classification

- **Blocker** (must fix in this run — user-facing crashes):
  - `src/components/exercise-block.tsx:86,89-90`
  - `src/components/exercise-list-item.tsx:13`
  - `src/components/routine-exercise-row.tsx:64,67-68`
  - `src/components/exercise-picker.tsx:36,111,114-115`
- **Major** (should fix in this run — prevents recurrence on next migration):
  - `src/lib/query-client.ts:18-22` — add a `buster` parameter keyed to a schema/version string.
- **Minor (out of scope by default)** — none in this run.

## Symptom-only fix risk

A fix that ONLY adds defensive reads is a symptom fix. It would resolve the iOS crash now but leaves the cache-versioning gap open: the next schema change will surface the same class of bug somewhere else in the app. We recommend fixing both — the consumer-side defensive reads (immediate user impact) AND the persister buster (long-term hygiene). The cost of also fixing the buster is one extra line.
