# Decision Log

> Captures the architectural decisions made during initial scaffolding (May 2026), the options considered, what was rejected and why. **This is the most important doc in `docs/`** — code shows what; this shows why.

When you change an architectural decision, append a new entry at the bottom under "Revisions" rather than rewriting history.

---

## Framing decision: stack philosophy for solo + AI

**Question**: How do you pick a stack when a single human + AI will build and maintain the app?

**Decided**: Optimize for **AI's feedback loop and corpus stability**, not pure runtime performance.

**Rationale**: Performance is downstream of correctness. AI makes faster progress when:
1. The compiler/linter catches its mistakes immediately (strict TS, Rust-level types).
2. There's one obvious way to do things (strong conventions, less hallucination).
3. The framework hasn't changed paradigm in the last 18 months (training data stays fresh).
4. The training corpus is large (TS, Python > Rust, Elixir).

**What was rejected**:
- "Pick the most performant stack" (Rust everywhere). Skipped because runtime perf isn't the bottleneck for a CRUD app, and the corpus is smaller.
- "Pick the trendy stack" (e.g., a new RSC-heavy Next.js setup). Paradigm churn confuses AI.
- "Pick the fewest dependencies" stack (Phoenix LiveView, Django + HTMX). Real candidates, but they don't compound the owner's existing React/RN expertise.

**Confidence: HIGH. Risk: LOW.**

---

## Decision 1 — Framework: Expo Router (universal app)

**Question**: One codebase for web + mobile, or two?

**Decided**: Expo Router universal app. Web target enabled from day 1; iOS and Android available the moment we want them with zero rewrite.

**Why not...**
- **Next.js + separate React Native app**: two codebases, two deployment pipelines, type duplication. Native gym UX is the eventual goal; build for it from the start.
- **PWA only**: mobile native is on the roadmap. PWAs work for daily use, but they don't test the binary you'll ship.
- **Tauri**: viable for desktop, but not the right primary target. Web first.

**Confidence: HIGH. Risk: LOW** — universal is a 2-3 hour upfront cost vs a "rewrite when mobile comes" cost measured in weeks.

---

## Decision 2 — Backend architecture: Supabase BaaS, no traditional server

**Question**: Build a Node/Rust/Go API server, or use a BaaS?

**Decided**: Supabase BaaS. No custom backend in v1. The client (Expo app) talks directly to Postgres via PostgREST, with RLS enforcing per-user authorization at the database level. `app/api/*` is reserved for future Expo Router API routes (currently empty) as the escape hatch when BaaS doesn't fit a use case.

**Why not...**
- **Custom Rust/Go/Node API server**: 3-5× the code for the same CRUD functionality. Solo dev can't afford that. The "scalability" argument doesn't apply at one user.
- **Firebase**: paired with our chosen Postgres + RLS data layer, you'd lose RLS or write a Firebase-Auth-to-Postgres bridge. Either go all-Firebase or all-Supabase. We picked Supabase because relational data (routines → exercises → sessions → sets) fits SQL naturally.
- **AWS Amplify / cloud serverless from scratch**: more pieces, more vendor lock-in spread across services. Not solo-friendly.

**The architectural mental model**: "thick database, thin server". Most logic lives client-side or as Postgres functions/triggers. Supabase Edge Functions (Deno) are available for custom logic that doesn't fit BaaS, but currently unused.

**Confidence: HIGH. Risk: LOW.** When BaaS stops fitting, we add an Expo Router API route or Edge Function for that one path — not a wholesale rewrite.

---

## Decision 3 — Auth: Supabase Auth with email/password + Google + Apple

**Question**: Magic links, password, OAuth, or all of the above? Which provider?

**Decided**: **Supabase Auth** as the provider. Methods: **email + password**, **Google Sign-In**, **Sign in with Apple**. Email verification is required. Minimum password is 8 characters, no other rules (the strict-rules theatre annoys users without measurable security gain).

**Why not...**
- **Magic links** (originally suggested as default): owner explicitly preferred password — "I want log in", not magic links.
- **Firebase Auth**: would force a user-ID bridge into Postgres or kill RLS. See Decision 2.
- **Clerk**: premium auth UX, free up to 10k MAU. Good option, but added complexity vs Supabase's built-in auth, with the same Postgres-bridge pain. Skipped.
- **Better Auth (self-hosted)**: real option for pure open-source. Skipped because Supabase Auth is good enough and integrates natively with RLS.

**App Store note**: Apple's guideline 4.8 requires Sign in with Apple if Google Sign-In is offered. Adding both now means future App Store review is unblocked.

**Confidence: HIGH. Risk: LOW.** Setup cost: ~30 min for Google OAuth (the trickiest step is bundle-ID + redirect-URI alignment between Google Cloud Console, Supabase, and `app.json`).

---

## Decision 4 — Data layer: Drizzle (schema) + Supabase JS (runtime)

**Question**: Which ORM? Where do schema, types, and queries live?

**Decided**:
- **Drizzle ORM** owns the schema (`src/db/schema.ts`). `drizzle-kit generate` produces SQL migrations.
- **Supabase JS client** handles all runtime queries from the client. It carries the user JWT and lets RLS enforce security automatically.
- **TS types** come from Drizzle's `InferSelectModel` / `InferInsertModel` (in `src/db/types.ts`). Optional: `supabase gen types` for autocompletion on `.from()` calls.
- **RLS policies** are hand-written SQL in `supabase/migrations/0001_rls_and_seed.sql`. Drizzle does not generate RLS — it's outside its scope.
- **`user_id` is denormalized onto every user-owned table** so RLS policies are uniformly `auth.uid() = user_id`. AI gets this right consistently; the join-based alternative is where security bugs hide.

**Why not...**
- **Supabase JS client only (no Drizzle)**: lose schema-as-TS-code, miss out on Drizzle's local-SQLite path if we ever go offline-first. Schema would have to be re-declared.
- **Drizzle for runtime queries on the client**: would expose connection details and lose RLS's auth-context-aware behavior. You'd reimplement Supabase's auth-aware queries.
- **Prisma**: heavier, less AI-friendly than Drizzle's near-SQL syntax, schema-as-code is more roundabout.

**Confidence: HIGH. Risk: LOW.** RLS bugs are the only real risk; mitigated by `tests/rls.test.ts`.

---

## Decision 5 — Sync strategy: online-first with TanStack Query persistence

**Question**: Build offline-first now, or ship online-first and add offline later?

**Decided**: **Online-first**, with **TanStack Query persistence** to AsyncStorage. No write queue, no `dirty` flag, no last-write-wins reconciliation in v1.

**Rationale**: A real offline-first sync engine is a week of work and 300-500 lines of code with edge cases. The owner's gym has cell signal; the failure mode of "1-second loading state per save" is acceptable. The schema *already* has `created_at`, `updated_at`, `deleted_at` on every table, so adding offline sync later is a code change, not a schema migration.

**Why not...**
- **Offline-first with custom sync engine**: scoped out for v1. ~150 lines optimistic, 300-500 realistic. Single user means no real conflict resolution work, but error handling for failed pushes, retries, partial sync is real labor.
- **Replicache / PowerSync / RxDB**: third-party sync libraries. Solve multi-user collab problems we don't have. Overkill.
- **Pure online (no persistence at all)**: harsher offline UX than TanStack Query's persisted cache. The cache buys us "show stale data while reloading" for free.

**Trigger to revisit**: if the owner reports gym-side "tried to log a set, app froze" pain.

**Confidence: HIGH. Risk: LOW.**

---

## Decision 6 — Hosting: EAS Hosting (web), Supabase (backend)

**Question**: Where does the web build live? What about future API routes?

**Decided**: **EAS Hosting** for the web build of the Expo Router app. Free tier (100k req, 1M CPU-ms, 1 GB storage) is plenty. Supabase hosts everything backend-related (Postgres, Auth, Storage, Edge Functions). Future Expo Router API routes (`app/api/*`) deploy alongside the web build via `eas deploy`.

**Why not...**
- **Cloudflare Pages**: more generous free tier (unlimited bandwidth) and free custom domains, but Expo Router API routes need adapter glue to run on Cloudflare Workers. Worth migrating to *if* we go public and want a custom domain on a budget.
- **Vercel**: solid free tier, but its "Hobby" terms forbid commercial use. Fine for personal but a gotcha at launch.
- **Self-hosted**: not worth the operational tax.

**Custom-domain caveat**: EAS Hosting requires a paid plan ($19/mo) for custom domains. The free `*.expo.app` URL works indefinitely; this only bites when "I want ada11.app" becomes a goal.

**Confidence: HIGH. Risk: LOW** for personal use. **Risk MEDIUM** if going public with a custom domain on a tight budget — migrate to Cloudflare at that point.

---

## Decision 7 — Mobile testing path: Xcode free provisioning, no Apple fee yet

**Question**: How does the owner test the actual native binary on iPhone without paying the $99/yr Apple Developer fee?

**Decided**: **Xcode free provisioning** via `npx expo run:ios --device`. The cert expires every 7 days; the owner accepts a weekly redeploy as the testing cadence. No Apple Developer fee until App Store launch.

**Why not...**
- **PWA install on iPhone**: was my earlier (wrong) default. Doesn't test the native binary you'll ship; only validates the web build. Owner correctly pushed back: "this WILL be a native app, so test the native build".
- **Expo Go**: great for fast JS iteration during development, but uses Expo's pre-built shell — not your binary. Use for dev, not for "real" daily testing.
- **TestFlight**: requires the $99/yr fee. Will pay when going public.

**Confidence: HIGH** that this is the right testing path for the goal. **Risk MEDIUM** that the weekly redeploy ritual becomes annoying enough that the owner pays $99 sooner — fine outcome either way.

---

## Decision 8 — App schema: minimal v1, with explicit deferrals

**Question**: What does the gym tracker model? What's deferred?

**Decided**:
- A "lift" is **weight (kg) × reps × optional RPE (6.0-10.0)**.
- Routines are **optional** — sessions can be from a routine or ad-hoc.
- Exercise library is **per-user**, **pre-seeded with ~30 common lifts** on first sign-in via a Postgres trigger on `auth.users` insert.
- Weights stored internally in **kg**; UI converts to `lbs` based on `user_preferences.weight_unit`.
- **`set_type`** column on `sets` (`'warmup' | 'working' | 'dropset'`) with a CHECK constraint enforcing the parent invariant.
- **`parent_set_id`** on `sets` for drop-set chains (drop sets point to the working set they descended from).
- **`target_rest_seconds`** on `routine_exercises` for the rest timer.
- All tables have `created_at`, `updated_at`, `deleted_at` (soft delete).

**Promoted from initial deferred list at owner's request**: drop sets, warm-up vs working set distinction, rest timer.

**Still deferred**: cardio (different metric model), supersets, body weight tracking, photos/form videos, personal records table (compute from `sets` on demand), per-set notes (only per-session for v1), plate calculator UI, progress charts. None require schema changes when promoted.

**Confidence: HIGH. Risk: LOW.** Schema migrations in Postgres are cheap.

---

## Revisions

_None yet. When a decision changes, add an entry below with the date and what changed._
