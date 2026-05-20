# Development Workflow

## First-time setup

### 1. Install dependencies

```bash
npm install
```

The repo's `.npmrc` sets `legacy-peer-deps=true` because some libraries (currently `lucide-react-native@0.469`) ship outdated peer-dependency ranges. Runtime is fine; the warning is cosmetic.

### 2. Create a Supabase project

1. Sign up at [supabase.com](https://supabase.com) (free).
2. Create a new project. Pick a region close to you (BRT users → São Paulo).
3. Wait ~2 min for provisioning.
4. **Project Settings → API**: copy the `Project URL` and `anon` key, plus the `service_role` key.
5. **Project Settings → Database → Connection string → URI**: copy the connection string.

### 3. Configure local env

```bash
cp .env.example .env.local
```

Fill in:

```
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>   # NEVER commit. Server / migrations / tests only.
DATABASE_URL=postgres://postgres:<password>@<host>:6543/postgres
```

Google OAuth credentials (`EXPO_PUBLIC_GOOGLE_*_CLIENT_ID`) are filled in once Google Cloud Console setup is done — see auth setup section below.

### 4. Apply migrations

```bash
# Link this repo to your Supabase project
npx supabase login
npx supabase link --project-ref <project-ref>

# Apply 0000_schema.sql (DDL) and 0001_rls_and_seed.sql (RLS + seed)
npm run db:push
```

### 5. Verify RLS

```bash
npx tsx tests/rls.test.ts
```

Expected output:

```
✅ RLS test passed — B cannot read/update/delete A's data.
```

If this fails, **stop**. RLS is the security boundary. Fix it before doing anything else.

## Daily dev loop

### Web (browser, fastest iteration)

```bash
npm run web
```

Opens `http://localhost:8081` (or similar). Hot reload on save.

### iOS Simulator

```bash
npm run ios
```

Requires Xcode installed. Boots a simulator and runs the app on it.

### Real iPhone (free provisioning, weekly cert)

```bash
npx expo run:ios --device
```

First time: signs you into Xcode with your free Apple ID, builds, deploys via USB. Subsequent runs are faster.

The cert expires every **7 days**. When the app stops launching, just rerun `npx expo run:ios --device` while the phone is connected. ~3 min.

### Expo Go (alternative for fast JS iteration)

```bash
npm start
```

Scan the QR code with the Expo Go app on your phone. Loads JS over Metro. Doesn't test the native binary; great for UI tweaks.

## Schema changes

1. Edit `src/db/schema.ts`.
2. Generate the migration:
   ```bash
   npm run db:generate
   ```
   This produces a new file in `supabase/migrations/`, e.g., `0002_<name>.sql`.
3. **Important**: regenerated `0000_schema.sql` may re-emit `CREATE TABLE auth.users` (Supabase already manages it). If that happens, delete those lines.
4. If the change adds a new user-owned table, append RLS policies for it to a new migration file or to `0001_rls_and_seed.sql` (if not yet applied).
5. Apply:
   ```bash
   npm run db:push
   ```
6. Re-run the RLS test:
   ```bash
   npx tsx tests/rls.test.ts
   ```

### Local Supabase (optional, for offline schema work)

Supabase CLI can run a local Postgres for development:

```bash
npx supabase start
```

Spins up local Postgres at `localhost:54322` and a Supabase Studio UI at `localhost:54323`. Useful when iterating on migrations without touching the hosted project. Run `npx supabase stop` when done.

## Importing from Strong

The repo includes a CLI importer that ingests a Strong-app CSV export into the owner's Supabase account. The full design lives in `docs/runs/2026-05-20_0127_import-strong-csv/`.

Two passes:

1. **Analyze** — emit a mapping file next to the CSV, with one row per unique Strong exercise name and a suggested action (`map` to an existing ada11 exercise, `create-new`, or `drop`):
   ```bash
   npm run import:strong -- analyze \
     "$HOME/Library/Mobile Documents/com~apple~CloudDocs/Workouts/strong_workouts_may_2026.csv"
   ```
   This writes `strong-mapping.csv` next to the CSV. Open it, review the suggestions, and adjust `action` columns as needed.

2. **Import** — group CSV rows into sessions and bulk-insert, using the mapping file:
   ```bash
   npm run import:strong -- import \
     "$HOME/Library/Mobile Documents/com~apple~CloudDocs/Workouts/strong_workouts_may_2026.csv" \
     "$HOME/Library/Mobile Documents/com~apple~CloudDocs/Workouts/strong-mapping.csv"
   ```
   Add `--dry-run` to parse + dedup + report without writing to the DB.

Conventions:

- Strong dates are interpreted as **BRT** and converted to UTC for storage.
- **Cardio rows** (Distância > 0 or Segundos > 0) are dropped.
- Pathological durations (e.g. `"143h 49min"`) are clamped to 6 hours.
- Inserted rows are flagged `source = 'strong'`.
- Re-runs are safe: existing sessions are matched on `(user_id, started_at, name)`. If an existing session has a different set count than the CSV expects, it is deleted (sets cascade) and reinserted — recovers from partial-failure runs.

Required env (auto-loaded from `.env.local` by the script):

- `EXPO_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_EMAIL` — resolves to the target user_id.

If `ADMIN_EMAIL` is missing the script aborts with a helpful message; add the line to your `.env.local` (or pass it inline: `ADMIN_EMAIL=you@example.com npm run import:strong -- ...`).

## Auth setup (Google + Apple)

### Google Sign-In

1. **Google Cloud Console** → APIs & Services → Credentials.
2. Create three OAuth 2.0 Client IDs:
   - **Web** — for the Supabase OAuth callback. Add `https://<project-ref>.supabase.co/auth/v1/callback` to authorized redirect URIs.
   - **iOS** — bundle identifier `com.gustavoinacio.ada11`.
   - **Android** — package name `com.gustavoinacio.ada11`, SHA-1 fingerprint from `eas credentials` output (Expo will print it on first build).
3. **Supabase dashboard** → Authentication → Providers → Google → enable, paste **web client ID** and **secret**.
4. **`.env.local`**: fill in `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`.
5. Wire up `expo-auth-session` in `app/(auth)/sign-in.tsx`'s Google button (currently a stub).

**Common gotcha**: bundle ID + redirect URI mismatch is the #1 cause of "Google Sign-In doesn't return". Triple-check the strings match exactly across Google, Supabase, and `app.json`.

### Apple Sign-In

1. **App.json** already has `usesAppleSignIn: true` and the `expo-apple-authentication` plugin.
2. **Apple Developer Portal**: enable "Sign in with Apple" capability for the app ID. Requires the paid Apple Developer fee — defer until App Store time.
3. **Supabase dashboard** → Authentication → Providers → Apple → enable, paste service ID + key.

For now: the Apple button in sign-in is a stub that says "coming soon".

## Deploying the web build

```bash
npx expo export --platform web    # builds to dist/
npx eas-cli login                  # one-time
npx eas-cli deploy                 # uploads to EAS Hosting
```

Returns a `https://ada11.expo.app` URL (or similar based on slug).

## Testing

Currently scoped to:

- **`tests/rls.test.ts`** — two-user RLS check. Mandatory before any auth/RLS-related change.

Add unit/integration tests when feature complexity demands. No test runner is preconfigured; recommended: `vitest` (faster than Jest, native ESM support).

## Troubleshooting

### `npm install` fails with peer dep errors
Already mitigated by `legacy-peer-deps=true` in `.npmrc`. If it persists, run `npm install --legacy-peer-deps` explicitly.

### `expo-doctor` reports version mismatches
```bash
npx expo install --check          # show mismatches
npx expo install <pkg> ...        # install Expo-recommended versions
```

### Metro bundler crashes after schema or NativeWind changes
```bash
rm -rf node_modules .expo
npm install
npm start -- --clear
```

### `npm run db:push` fails with "schema already exists" / "duplicate object"
Likely a partial earlier run. Either:
- Use `npx supabase db reset` to nuke and reapply (destructive — only on dev project),
- Or hand-edit the offending migration with `IF NOT EXISTS` guards.

### `tests/rls.test.ts` fails
Check that:
1. RLS is enabled on every user-owned table (`SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('exercises', 'routines', ...)`).
2. Policies exist (`SELECT * FROM pg_policies WHERE tablename IN (...);`).
3. The test users were created with `email_confirm: true` (otherwise sign-in fails before the test even runs).

### iPhone build expires after 7 days
Expected. Reconnect to Mac via USB and rerun `npx expo run:ios --device`.

### `lucide-react-native` warnings on install
Cosmetic, ignore. The library's peer-dep range hasn't been updated for React 19. Drop the `.npmrc` flag once a newer version ships.

## Git conventions

- Conventional Commits: `feat: ...`, `fix: ...`, `chore: ...`, `docs: ...`.
- Don't commit `.env.local`, `.env`, or anything in `supabase/.branches/` / `supabase/.env`.
- The `.gitignore` already covers these.

## Things to NOT do without a plan and approval

Per the owner's global CLAUDE.md, modifications to files require an explicit plan + confirmation. No silent edits. Run-of-the-mill commits, branches, pushes, dependency installs all need the plan-and-confirm dance. This isn't bureaucracy — it's how the owner stays in control of an AI-assisted codebase.
