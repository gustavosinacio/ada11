# Architecture

## High-level diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Client (Expo Router app)                                    │
│   Targets: iOS, Android, Web (all from one codebase)        │
│                                                             │
│   ┌──────────────────┐  ┌─────────────────────────────┐     │
│   │  React 19 / RN   │  │  Supabase JS client         │     │
│   │  + NativeWind    │  │  (auth-aware, RLS-protected)│     │
│   │  + Expo Router   │  └─────────────────────────────┘     │
│   └──────────────────┘  ┌─────────────────────────────┐     │
│                         │  TanStack Query             │     │
│                         │  (cache, persistence,       │     │
│                         │   optimistic updates later) │     │
│                         └─────────────────────────────┘     │
└────────────┬────────────────────────────────────────────────┘
             │ HTTPS (Supabase JS)
             ▼
┌─────────────────────────────────────────────────────────────┐
│ Supabase (managed, free tier)                               │
│                                                             │
│   ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│   │ Postgres 15  │  │ GoTrue (auth)│  │ Storage (S3)    │   │
│   │ + RLS        │  │ Email + OAuth│  │ (unused in v1)  │   │
│   └──────────────┘  └──────────────┘  └─────────────────┘   │
│   ┌──────────────────────────────────────────────────────┐  │
│   │ PostgREST  →  auto-generated REST API from schema    │  │
│   └──────────────────────────────────────────────────────┘  │
│   ┌──────────────────────────────────────────────────────┐  │
│   │ Edge Functions (Deno) — for custom server logic      │  │
│   │ (currently unused)                                   │  │
│   └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘

   ┌────────────────────────────────────────────────────────┐
   │ EAS Hosting (free tier)                                │
   │   - Hosts the web build of the Expo app                │
   │   - app/api/* routes reserved (currently empty)        │
   └────────────────────────────────────────────────────────┘

   ┌────────────────────────────────────────────────────────┐
   │ Local dev / iOS testing                                │
   │   - Expo Go for fast JS iteration                      │
   │   - `expo run:ios --device` for actual native binary   │
   │     (Xcode free provisioning, 7-day cert)              │
   └────────────────────────────────────────────────────────┘
```

## Stack summary

| Layer | Choice | Notes |
|---|---|---|
| Framework | Expo SDK 54 + Expo Router 6 | File-based routing, universal (iOS/Android/web), strict TS. |
| Language | TypeScript 5.9, `strict: true`, `noUncheckedIndexedAccess: true` | Strict types are AI's best feedback loop. |
| UI | React 19 + React Native 0.81 + NativeWind v4 | Tailwind for RN. AI-friendly because Tailwind has massive training corpus. |
| Forms | react-hook-form + zod | Validation lives next to schema. |
| Icons | lucide-react-native | Cross-platform, predictable. |
| Server state | TanStack Query + persisted cache (AsyncStorage) | Replaces a sync engine for v1 — see decisions.md #3. |
| Auth + DB + API | Supabase (BaaS) | Single platform: Postgres, Auth, Storage, Edge Functions. |
| Schema source of truth | Drizzle ORM | TS schema → SQL migrations. **Not** used for runtime queries on the client. |
| Runtime queries | Supabase JS client | Auth-aware; RLS protects every read/write. |
| RLS policies | Hand-written SQL in `supabase/migrations/0001_rls_and_seed.sql` | Uniform `auth.uid() = user_id` across all user tables. |
| Hosting (web) | EAS Hosting | Free tier; native Expo Router support including future API routes. |
| Hosting (mobile testing) | Xcode free provisioning (`expo run:ios --device`) | Free, 7-day cert renewal. No Apple Developer fee yet. |

## Key architectural choices, in one paragraph each

### "Thick database, thin server"
The backend is **Supabase** — there is no traditional API server. The client talks directly to Postgres via PostgREST (auto-generated REST API). Authorization is enforced inside the database via Row-Level Security (RLS) policies, not in middleware. Custom server logic, when needed, lives in **Postgres functions** (for SQL-shaped logic) or **Supabase Edge Functions** (Deno, for everything else). This is sometimes called BaaS or "serverless". For a CRUD-shaped, single-tenant-per-user app like Ada11, this halves the codebase and the operational burden.

### Schema in Drizzle, queries in Supabase JS
**Drizzle** owns the schema definition (`src/db/schema.ts`). Running `drizzle-kit generate` produces `supabase/migrations/0000_schema.sql`. We do **not** use Drizzle at runtime to query the database from the client — that would require exposing connection strings and lose RLS's auth-context awareness. Instead, runtime queries go through `@supabase/supabase-js`, which carries the user JWT and lets RLS do its job. We get type safety from Drizzle's `InferSelectModel` types in `src/db/types.ts`. This split is the key insight that makes BaaS tooling cooperate with TypeScript-first development.

### Online-first, with persistence
The first version is **online-first with TanStack Query persistence**. There is no offline write queue, no last-write-wins reconciliation, no `dirty` flag, no soft-delete sync semantics. If the network is down, the user sees stale cached data and writes fail with a banner. This was a deliberate scoping choice (see `decisions.md` #3) because writing a real offline sync engine takes a week and adds bugs that aren't worth it before there's evidence the gym wifi is genuinely unusable. The schema includes `created_at`, `updated_at`, `deleted_at` on every table specifically so that adding offline-first sync later is a code change, not a schema migration.

### Universal codebase, even though web is first
The first surface is the web app. But the same Expo Router codebase compiles to native iOS and Android. This is paid for by ~3 hours of extra setup vs a Next.js-only stack, and unlocks the gym-on-iPhone use case the moment we want it. The cost of "make it universal later" is a rewrite; the cost of "ship universal from day 1" is small. We took the small upfront cost.

## File-system layout (canonical)

```
app/                        Expo Router routes (file-based)
  (auth)/                   Sign-in / sign-up flows
  (app)/                    Protected, tabbed area
    workout/
    routines/
    history/
    profile.tsx
  api/                      Reserved for Expo Router API routes (empty in v1)
  _layout.tsx               Providers + auth gate

src/
  lib/                      Cross-cutting concerns
    env.ts                  zod-validated env vars
    supabase.ts             Supabase client init
    auth-context.tsx        AuthProvider + useAuth hook
    query-client.ts         TanStack Query + persistence
  db/                       Schema source of truth
    schema.ts               Drizzle PG schema
    types.ts                Inferred TS types (Exercise, Routine, Set, ...)
  api/                      Supabase JS query helpers (not server routes)
    exercises.ts
    routines.ts
    sessions.ts
    sets.ts
  utils/                    Pure helpers (kg/lbs, dates)
    units.ts
  components/               UI primitives + feature components
    ui/                     Reusable atoms (Button, Input, ...)

supabase/
  migrations/
    0000_schema.sql         Generated by drizzle-kit; auth.users CREATE removed
    0001_rls_and_seed.sql   Hand-written: RLS, seed function, updated_at triggers
    meta/                   Drizzle's internal snapshot — do not edit
  config.toml               supabase CLI config

tests/
  rls.test.ts               Two-user security check (run before any auth-related change)

docs/                       This folder
drizzle.config.ts           Drizzle Kit (excludes auth schema from generation)
tailwind.config.js          NativeWind / Tailwind
metro.config.js             NativeWind metro adapter
babel.config.js             NativeWind babel preset
app.json                    Expo config (name, scheme, bundle IDs, plugins)
.env.example                Template; copy to .env.local
.npmrc                      legacy-peer-deps=true (for stale lucide peers)
```

## Boundaries an agent should respect

- `app/` is **routes only**. No logic beyond what the screen needs.
- `src/api/` is **Supabase JS queries only** — these are the data-access layer. Don't import from here in API routes; that's a different concern.
- `src/db/schema.ts` is the **single source of truth** for the schema. If you need a new column, edit `schema.ts`, run `npm run db:generate`, then hand-edit migrations only if you must.
- `src/lib/` is for cross-cutting concerns (auth, env, query-client). Don't put feature-specific code here.
- `supabase/migrations/0000_schema.sql` is **regenerated from Drizzle**. Don't hand-edit it (the auth.users removal is a known one-time fix; if you regenerate, redo it).
- `supabase/migrations/0001_rls_and_seed.sql` is **hand-written**. Edit freely, but keep RLS policies uniform across tables.

## Things this architecture deliberately does NOT have

- **No custom backend / API server.** Supabase is the backend.
- **No GraphQL.** PostgREST + Supabase JS is the API contract.
- **No state management library** (Redux, Zustand, Jotai). TanStack Query for server state, React `useState` for UI state. That's it.
- **No design system / component library.** Just NativeWind + small ad-hoc components.
- **No CI/CD yet.** Manual `eas deploy` for web, `expo run:ios --device` for phone.
- **No analytics / observability.** Add later if needed.
- **No tests beyond the RLS check.** Will add a test runner if/when feature complexity demands.

If you find yourself reaching for one of the above, check `decisions.md` first — there's likely a reason it's missing.
