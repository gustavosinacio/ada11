# Roadmap

## Status legend

- ✅ **Done** — scaffolded and verified
- 🟡 **Stubbed** — placeholder exists, real implementation pending
- ⬜ **Not started**
- 🔒 **Deferred** — explicit decision to skip; promotion criterion noted

## What's done (initial scaffold, May 2026)

✅ Expo Router universal app (iOS, Android, web), strict TypeScript
✅ NativeWind v4 wired (babel, metro, tailwind config)
✅ Supabase client + auth context + protected route gate
✅ TanStack Query with persisted cache
✅ Drizzle schema (all 6 tables, FKs, indexes, CHECK constraints)
✅ Migrations: `0000_schema.sql` (DDL) + `0001_rls_and_seed.sql` (RLS + seed + triggers)
✅ Auth screen scaffold: email/password form (functional), Google/Apple buttons (stubs)
✅ Tab structure: Workout / Routines / History / Profile (placeholders)
✅ API helpers (`src/api/{exercises,routines,sessions,sets}.ts`) ready for hooks
✅ Sign-out works on Profile tab
✅ RLS test (`tests/rls.test.ts`) — runs once Supabase env is configured
✅ Documentation in `docs/` (this folder)

## Week-1 build order

| Day | Goal | Status |
|---|---|---|
| 1 | Bootstrap, schema, RLS, RLS test passing | ✅ scaffolded; awaits Supabase project + `npm run db:push` |
| 2 | Auth: providers in Supabase, Google OAuth setup, sign-in working end-to-end on web + iPhone | ⬜ |
| 3 | Exercises CRUD (list, create, edit, soft-delete) + Routines CRUD (without exercises inside yet) | ⬜ |
| 4 | Routine builder: add/reorder exercises, set targets (sets, reps, weight, rest seconds) | ⬜ |
| 5 | Live workout flow: start session (from routine or ad-hoc), log sets, set type selector (warmup/working/dropset), parent linking for drops | ⬜ |
| 6 | Rest timer (client-side state) + history list + session detail (read-only) | ⬜ |
| 7 | Profile screen polish, weight unit toggle, empty/loading/error states, `eas deploy` web, install on iPhone via `expo run:ios --device` | ⬜ |

## Hooks and components needed (week-1 detail)

### Day 3 — Exercises and Routines

**Hooks** (TanStack Query, in `src/hooks/`):
- `use-exercises.ts` — `useExercises()`, `useCreateExercise()`, `useUpdateExercise()`, `useSoftDeleteExercise()`
- `use-routines.ts` — `useRoutines()`, `useCreateRoutine()`, `useUpdateRoutine()`, `useSoftDeleteRoutine()`

**Screens**:
- `app/(app)/routines/index.tsx` — list with edit/delete
- `app/(app)/routines/new.tsx` — create form (name, notes only at this stage)
- `app/(app)/routines/[id].tsx` — edit form

**Components** (`src/components/`):
- `ui/button.tsx`, `ui/input.tsx`, `ui/textarea.tsx`
- `exercise-list-item.tsx`
- `routine-list-item.tsx`
- `confirm-delete.tsx`

### Day 4 — Routine builder

**Hooks**:
- `use-routine-exercises.ts` — `useRoutineExercises(routineId)`, `useAddExerciseToRoutine()`, `useReorderRoutineExercises()`, `useUpdateRoutineExercise()`, `useRemoveExerciseFromRoutine()`

**Screens**:
- `app/(app)/routines/[id]/builder.tsx` — drag-to-reorder, exercise picker modal, target inputs

**Components**:
- `exercise-picker.tsx` — search, select from `exercises` library
- `routine-exercise-row.tsx` — name + target sets/reps/weight/rest editor
- `reorderable-list.tsx` — drag handle support

### Day 5 — Live workout

**Hooks**:
- `use-sessions.ts` — `useStartSession()`, `useCurrentSession()`, `useFinishSession()`
- `use-sets.ts` — `useLogSet()`, `useUpdateSet()`, `useDeleteSet()`

**Screens**:
- `app/(app)/workout/index.tsx` — "Start from routine" / "Ad-hoc" + resume current
- `app/(app)/workout/[sessionId].tsx` — live logging UI

**Components**:
- `session-header.tsx` — timer, finish button
- `exercise-block.tsx` — exercise name + list of sets logged + "add set" button
- `set-input.tsx` — weight, reps, RPE, type selector
- `dropset-action.tsx` — "drop weight" button on a working set; creates dropset child rows

### Day 6 — Rest timer + history

**Hooks**:
- `use-rest-timer.ts` — client-side, localStorage-persisted to survive backgrounding (web), kept in memory on native

**Screens**:
- `app/(app)/history/index.tsx` — sessions list (paged or infinite scroll)
- `app/(app)/history/[id].tsx` — read-only session view

**Components**:
- `rest-timer-overlay.tsx` — sticky/floating bar with countdown, configurable rest target
- `session-summary-row.tsx` — date, routine name, total volume, duration

### Day 7 — Profile, polish, deploy

- `app/(app)/profile.tsx` — already exists; add `weight_unit` toggle (`kg` / `lbs`).
- Empty states (no routines yet, no sessions yet) on each tab.
- Loading skeletons.
- Error toasts for write failures.
- `eas deploy` for web.
- `expo run:ios --device` final smoke test.

## Deferred — promotion criteria

| Item | Promote when |
|---|---|
| 🔒 Cardio / time-based exercises | Owner picks up running, cycling, etc. and feels the friction. |
| 🔒 Supersets | Owner runs a program with explicit supersets and the current "log them sequentially" feels wrong. |
| 🔒 Body weight tracking | Owner wants to chart body weight alongside lift weight. Trivial: one new table. |
| 🔒 Personal records table | If "compute PRs from `sets` on demand" gets too slow (won't, at personal scale). |
| 🔒 Photos / form videos | When owner wants form check via camera. Needs Supabase Storage wiring. |
| 🔒 Per-set notes | When per-session notes feel insufficient. One new column on `sets`. |
| 🔒 Plate calculator | UI feature, no schema. Day-7 stretch goal. |
| 🔒 Progress charts | Day-7+ when there's session data to chart. UI feature, no schema. |
| 🔒 Sharing / social | Probably never. App is personal. |
| 🔒 Periodization (mesocycles) | If owner does structured programming and the current "routines as flat templates" feels limiting. |
| 🔒 Offline-first sync engine | When the owner reports concrete gym-side pain logging sets. See `decisions.md` #5. |
| 🔒 Custom domain on EAS | When going public and `*.expo.app` URL is no longer acceptable. Migrate to Cloudflare Pages or pay $19/mo for EAS custom domain. |
| 🔒 App Store / Play Store launch | When the owner wants to share or use TestFlight. Requires $99/yr Apple + $25 once Google. |
| 🔒 Native push notifications | When the rest timer or workout reminders need to fire when the app is closed. |
| 🔒 Custom Postgres functions / triggers beyond `seed_new_user` and `touch_updated_at` | When CRUD-shaped logic isn't enough. |
| 🔒 Expo Router API routes (`app/api/*`) | When client-only logic isn't enough — typically: third-party API with secret keys (Stripe, etc.), webhooks, complex aggregations. |

## Out of scope (unlikely to ever happen)

- Multi-user collaboration / shared routines.
- Marketplace of public routines.
- AI-generated training plans.
- Wearable integration (Apple Watch, Garmin).
- Nutrition tracking.

If any of these become tempting, write them down in this file with a date and a reason — don't start building.
