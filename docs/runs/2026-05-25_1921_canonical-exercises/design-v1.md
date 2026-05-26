# Design v1 — 2026-05-25_1921_canonical-exercises

## Goal (1 sentence)

Convert `public.exercises` into a single-table shared catalog where `user_id IS NULL` rows are the canonical (admin-only) library visible to every authenticated user, while `user_id = auth.uid()` rows are private user creations — with a "Created by you" chip on the picker + library list to disambiguate, and edit/delete affordances suppressed for canonical rows at both the source (progress-screen pencil) and the destination (edit screen).

## Approach

Single SQL migration `0011_canonical_exercises.sql` does five things in one transaction: drops `NOT NULL` on `exercises.user_id`, flips all 127 existing rows to `NULL` (UUIDs preserved → every FK from `sets`, `routine_exercises`, `exercise_notes` keeps resolving), replaces the four `exercises_*` RLS policies (SELECT widens to `user_id IS NULL OR user_id = auth.uid()`; INSERT/UPDATE/DELETE stay `user_id = auth.uid()`), rewrites `seed_new_user()` to stop inserting per-user exercises (keeps the `user_preferences` insert), and drops the unused `exercises_user_idx`. Drizzle schema + the hand-rolled `ExerciseRow` type lose their `NOT NULL`/`string` constraints on `user_id` in the same commit to prevent schema drift. The persisted-query cache buster is bumped because the runtime value of `user_id` changes for every cached row. App layer adds a single new visual affordance — a neutral-slate `<View>` chip rendered next to the exercise name in `<ExercisePicker>` and `<ExerciseListItem>` when `row.user_id !== null` (RLS-trusted predicate, no `useAuth()` coupling at the leaf) — and gates edit/delete affordances on the same predicate at both the progress-screen pencil and the edit screen itself (defense-in-depth against deep links). The 17 e2e sites that lookup-by-`user_id` collapse into a single `pickCanonicalExercise(admin, name?)` helper module; `tests/seed-and-auth.test.ts` is rewritten to assert the new contract (zero seeded rows, canonical visible via RLS). The migration is single-transaction-safe (Supabase CLI wraps each file in `BEGIN ... COMMIT`; no `CREATE INDEX CONCURRENTLY` or other txn-incompatible statements present).

## Mudanças por arquivo

### Migrations / schema (single responsibility: shared-catalog refactor)

| File | Type | Change |
|---|---|---|
| `supabase/migrations/0011_canonical_exercises.sql` | new | The 5-step migration. See "New artifacts" for the exact body. |
| `src/db/schema.ts:50-52` | edited | Drop `.notNull()` from `userId: uuid("user_id").references(...)`. Keep the FK + `onDelete: "cascade"` — when a user is deleted, their owned exercises still cascade; canonical rows are unaffected (NULL is never the cascade target). |
| `src/db/schema.ts:60-62` | edited | Remove the `userIdx: index("exercises_user_idx").on(t.userId)` declaration from the table's index builder. Leave a one-line code comment ("// canonical-exercises: index dropped in 0011 — no client query exercises it.") matching the precedent style at `schema.ts:211-216`. |
| `src/db/types.ts:86-97` | edited | `ExerciseRow.user_id: string` → `string \| null`. Load-bearing for the chip predicate and the edit-screen gate (`data?.user_id == null`). |
| `src/lib/query-client.ts:27` | edited | Bump `queryCacheBuster` from `"schema-2026-05-21-set-check"` to `"schema-2026-05-25-canonical-exercises"`. Forces all clients to drop their persisted cache on next launch; first read repopulates with `user_id = null` for canonical rows. |

### API layer (zero functional changes; all behaviour shifts come from RLS)

| File | Type | Change |
|---|---|---|
| `src/api/exercises.ts` | unchanged | Verified by Discovery — `listExercises`, `getExercise`, `listAllExercises`, `getAnyExercise`, `createExercise`, `updateExercise`, `softDeleteExercise` all work as-is. The post-migration UPDATE/DELETE against a canonical row affects zero rows (RLS UPDATE/DELETE policies still require `user_id = auth.uid()`); UI gating prevents the call from being issued. |

### UI (chip + edit gating; one responsibility per file)

| File | Type | Change |
|---|---|---|
| `src/components/exercise-picker.tsx:128-146` | edited | Wrap the existing name `<Text>` (line 129-133) in a `flex-row items-center` row, append the `<CanonicalChip>` next to it when `item.user_id !== null`. See "Contratos de I/O" for the exact JSX shape and NativeWind classes. |
| `src/components/exercise-list-item.tsx:25-30` | edited | Same wrap-name-in-row + append-chip pattern as the picker. Predicate is `exercise.user_id !== null`. |
| `src/components/created-by-you-chip.tsx` | new | Tiny presentational component re-used by the picker and the library row. Single responsibility: render the chip with the agreed NativeWind classes and accessibilityLabel. Exporting a component (vs. inlining) is justified because the precedent (`pr-list-row.tsx:48-52`) is single-use inline, but this chip ships in two surfaces simultaneously — extracting eliminates the visual-drift risk between picker and library row. See "Contratos de I/O" for the body. |
| `app/(app)/exercises/[id]/progress.tsx:55-63` | edited | Conditionally render the pencil `<Pressable>` based on `exercise.data?.user_id != null`. If canonical, `headerRight` becomes `undefined` (omit the property entirely; do not render an empty placeholder). Source-of-truth predicate uses `useAllExercise(id)` (already imported at line 44 — includes soft-deleted) so soft-deleted user-owned exercises still expose the pencil consistently. |
| `app/(app)/exercises/[id]/index.tsx:31-208` | edited | When `data?.user_id == null`, render a read-only view: replace each `<Input>`/`<Textarea>`/`<MuscleGroupPicker>` with a `<Text>` showing the current value; omit the Save button, omit the Cancel/Save row, omit the Delete button. The header changes from `title: "Edit exercise"` to `title: "Exercise"`. Form state (useForm, zodResolver) is gated behind `data?.user_id != null` to avoid a wasted controller mount; see "Contratos de I/O" for the precise screen shape. |

### Tests (helper extraction + new arms)

| File | Type | Change |
|---|---|---|
| `tests/e2e/_helpers/canonical-exercise.ts` | new | Exposes `pickCanonicalExercise(admin, name?)`. Replaces 17 in-place call sites with one helper. See "New artifacts" for the body. |
| `tests/e2e/rest-timer-auto-start.spec.ts:69-84` | edited | Replace local `getSeedExerciseByName` with the helper. |
| `tests/e2e/auto-fill-placeholder-on-check.spec.ts:~81` | edited | Replace local lookup with helper. |
| `tests/e2e/max-volume-window.spec.ts:~69` | edited | Replace local lookup with helper. |
| `tests/e2e/week-drill-down.spec.ts:~75` | edited | Replace local lookup with helper. |
| `tests/e2e/end-of-session-verdict.spec.ts:~75` | edited | Replace local lookup with helper. |
| `tests/e2e/read-only-history.spec.ts:~102` | edited | Replace local lookup with helper. |
| `tests/e2e/exercise-session-row-list.spec.ts:~83` | edited | Replace local lookup with helper. |
| `tests/e2e/volume-target.spec.ts:~90` | edited | Replace local lookup with helper. |
| `tests/e2e/exercise-note.spec.ts:~87` | edited | Replace local lookup with helper. (Line ~457 — UPDATE-by-id — stays unchanged.) |
| `tests/e2e/weekly-volume-strip.spec.ts:~74` | edited | Replace local lookup with helper. |
| `tests/e2e/chart-scroll-week-selector.spec.ts:~77` | edited | Replace local lookup with helper. |
| `tests/e2e/soft-deleted-session-volume-leak.spec.ts:~99` | edited | Replace local lookup with helper. |
| `tests/e2e/session-total-volume-header.spec.ts:~86` | edited | Replace local lookup with helper. |
| `tests/e2e/progress-page.spec.ts:~69` | edited | Replace local lookup with helper. (Lines 277 + 443 — UPDATE-by-id — stay unchanged.) |
| `tests/e2e/crud.spec.ts:323-329` | edited | Replace local lookup with helper. |
| `tests/seed-and-auth.test.ts:52-81` | edited | Rewrite the assertion pair: (a) `.eq("user_id", userId)` must return zero rows (trigger no longer inserts); (b) a separate `.is("user_id", null)` admin query asserts the canonical count is present (sanity check that the migration ran); (c) the RLS-scoped userClient read still expects `>= 25` rows but now reads canonical-via-RLS. Update header comment + log strings to reflect the new contract. |
| `tests/rls.test.ts` | edited | Add a 7th block ("canonical exercises") at the bottom of the existing flow, before the cleanup. See "New artifacts" for the body. |

### Cosmetic (in scope — single-line fix)

| File | Type | Change |
|---|---|---|
| `scripts/create-user.ts:50-57` | edited | Replace the `eq("user_id", data.user.id)` count with two counts: per-user (expected 0) and canonical (`.is("user_id", null)`, expected ~31). Update the log line from `exercises seeded: ${exCount}` to `exercises seeded (per-user): ${userCount}` + `canonical visible (via RLS): ${canonicalCount}`. Strictly a diagnostic; doesn't affect runtime. **In scope** because (a) it's one read + one print-line change in a file already being indirectly invalidated by this run, (b) leaving it printing `0` is a future-debugger trap. |

## Contratos de I/O

### Migration `0011_canonical_exercises.sql` (full SQL outline — body in "New artifacts" section)

- **Step 1** — `alter table public.exercises alter column user_id drop not null;`
- **Step 2** — `update public.exercises set user_id = null;` (flips all 127 rows; UUIDs preserved; cascades not triggered because NULL is not a delete target on `auth.users`).
- **Step 3** — Drop + recreate the four `exercises_*` policies inline (`drop policy if exists exercises_select ...; create policy exercises_select ... using (user_id is null or auth.uid() = user_id);` + the three mutating policies kept on `auth.uid() = user_id`). Matches the inline style of `0010_exercise_notes.sql:53-67`.
- **Step 4** — `create or replace function public.seed_new_user() returns trigger language plpgsql security definer set search_path = public as $$ begin insert into public.user_preferences ... on conflict do nothing; return new; end; $$;` (drops the entire `insert into public.exercises ...` block from `0004:54-86`; keeps the `user_preferences` insert).
- **Step 5** — `drop index if exists public.exercises_user_idx;`

### RLS policy bodies (exact SQL)

```sql
create policy exercises_select on public.exercises
  for select using (user_id is null or auth.uid() = user_id);

create policy exercises_insert on public.exercises
  for insert with check (auth.uid() = user_id);

create policy exercises_update on public.exercises
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy exercises_delete on public.exercises
  for delete using (auth.uid() = user_id);
```

### Type contracts

```ts
// src/db/types.ts
export type ExerciseRow = {
  id: string;
  user_id: string | null;        // was: string
  name: string;
  muscles: string[];
  equipment: string | null;
  notes: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
```

```ts
// src/db/schema.ts (relevant fragment)
export const exercises = pgTable(
  "exercises",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .references(() => authUsers.id, { onDelete: "cascade" }),  // .notNull() removed
    // ... unchanged fields ...
  },
  // canonical-exercises: index dropped in 0011 — no client query exercises it.
);
```

### Chip component contract

```ts
// src/components/created-by-you-chip.tsx
import { Text, View } from "react-native";

export function CreatedByYouChip() {
  return (
    <View
      accessibilityLabel="Created by you"
      className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800"
    >
      <Text className="text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
        You
      </Text>
    </View>
  );
}
```

**Why these classes**: mirrors the `pr-list-row.tsx:48-52` shape (same `ml-2 rounded-full px-2 py-0.5` + `text-[10px] font-semibold uppercase tracking-wide`) for visual rhythm; swaps emerald (achievement semantic) for slate (neutral attribution semantic). Light-mode contrast: slate-600 on slate-100 ≈ 5.6:1 (AA-large pass at 10px). Dark-mode contrast: slate-300 on slate-800 ≈ 7.1:1 (AAA-large pass). The label text is **"You"** (single word, three glyphs) — short enough to read at 10px, accessibility-label expanded to "Created by you" so screen readers announce the full meaning.

**Why a component vs. inline**: two consumer surfaces, same shape. Extracting eliminates the silent-drift risk if one surface evolves but not the other.

### Picker insertion point

```tsx
// src/components/exercise-picker.tsx — replace lines 128-146 inner content
<View className="flex-1 pr-3">
  <View className="flex-row items-center">
    <Text
      className={`text-base ${already ? "text-gray-400" : "text-black dark:text-white"}`}
    >
      {item.name}
    </Text>
    {item.user_id !== null ? <CreatedByYouChip /> : null}
  </View>
  {(muscles.length > 0 || item.equipment) && (
    <Text className="mt-0.5 text-sm text-gray-500">
      {/* unchanged subline */}
    </Text>
  )}
</View>
```

### Library row insertion point

```tsx
// src/components/exercise-list-item.tsx — replace lines 25-30 inner content
<View className="flex-1 pr-3">
  <View className="flex-row items-center">
    <Text className="text-base text-black dark:text-white">{exercise.name}</Text>
    {exercise.user_id !== null ? <CreatedByYouChip /> : null}
  </View>
  {subtitle ? (
    <Text className="mt-0.5 text-sm text-gray-500">{subtitle}</Text>
  ) : null}
</View>
```

### Edit-screen read-only shape (when `data?.user_id == null`)

```tsx
// app/(app)/exercises/[id]/index.tsx — replace the form return block
return (
  <ScrollView className="flex-1 bg-white dark:bg-black" contentContainerClassName="px-6 py-6">
    <Stack.Screen options={{ title: "Exercise", headerShown: true }} />

    <Text className="mb-1 text-xs uppercase tracking-wide text-gray-500">Name</Text>
    <Text className="mb-6 text-base text-black dark:text-white">{data.name}</Text>

    <Text className="mb-1 text-xs uppercase tracking-wide text-gray-500">Muscles</Text>
    <Text className="mb-6 text-base text-black dark:text-white">
      {data.muscles.length > 0 ? data.muscles.join(", ") : "—"}
    </Text>

    <Text className="mb-1 text-xs uppercase tracking-wide text-gray-500">Equipment</Text>
    <Text className="mb-6 text-base text-black dark:text-white">{data.equipment ?? "—"}</Text>

    <Text className="mb-1 text-xs uppercase tracking-wide text-gray-500">Notes</Text>
    <Text className="mb-6 text-base text-black dark:text-white">{data.notes ?? "—"}</Text>

    <View className="mt-2 gap-3">
      <Button label="Back" variant="secondary" onPress={() => router.back()} />
    </View>
  </ScrollView>
);
```

The branch sits between `if (isError) { ... }` and the form `return`. `useForm` still mounts (cheap, harmless) — gating it would add a hook-ordering risk; the read-only branch just doesn't reach the Controllers. Save/Delete handlers are unreachable from the read-only tree.

### Progress-screen pencil gate

```tsx
// app/(app)/exercises/[id]/progress.tsx — replace the screenHeader expression
const canEdit = exercise.data?.user_id != null;
const screenHeader = (
  <Stack.Screen
    options={{
      title: exercise.data?.name ?? "Progress",
      headerShown: true,
      headerRight: canEdit
        ? () => (
            <Pressable
              onPress={() => router.push(`/(app)/exercises/${id}`)}
              accessibilityLabel="Edit exercise"
              accessibilityRole="button"
              className="px-3 py-1"
            >
              <Pencil color={colorScheme === "dark" ? "#fff" : "#000"} size={20} />
            </Pressable>
          )
        : undefined,
    }}
  />
);
```

Using `headerRight: undefined` (vs. a no-op function) is idiomatic for `Stack.Screen`: the navigator omits the right slot entirely.

### Helper contract

```ts
// tests/e2e/_helpers/canonical-exercise.ts
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Picks a canonical (user_id IS NULL) exercise via the admin client.
 * Replaces the per-spec `.eq("user_id", userId)` pattern that broke when
 * exercises moved to a shared catalog (migration 0011_canonical_exercises).
 *
 * If `preferred` is supplied and present, returns it. Otherwise returns the
 * first row name-ordered (deterministic for parallel runs).
 *
 * The `admin` client is required because RLS still hides soft-deleted rows
 * from the anon client; tests need the predictable canonical list (which
 * 0011 seeded by flipping the existing 127 rows).
 */
export async function pickCanonicalExercise(
  admin: SupabaseClient,
  preferred?: string,
): Promise<{ id: string; name: string }> {
  const { data, error } = await admin
    .from("exercises")
    .select("id, name")
    .is("user_id", null)
    .is("deleted_at", null)
    .order("name", { ascending: true });
  if (error || !data || data.length === 0) {
    throw new Error(`No canonical exercises: ${error?.message ?? "empty"}`);
  }
  if (preferred) {
    const match = data.find((r) => r.name === preferred);
    if (match) return { id: match.id, name: match.name };
  }
  return { id: data[0]!.id, name: data[0]!.name };
}
```

**Why admin** (not the user client): the existing pattern at all 17 sites already uses `admin`; switching to a user client would also work post-migration (canonical visible via RLS) but would change the implicit contract — tests today read setup data via admin, not via the system-under-test client. Keep the convention.

## New artifacts

### `supabase/migrations/0011_canonical_exercises.sql` (body outline)

```
-- =============================================================================
-- 0011_canonical_exercises.sql
-- Hand-written. Converts public.exercises to a shared-catalog model:
--   - canonical rows have user_id IS NULL, visible to every authenticated user
--   - user-created rows keep user_id = auth.uid(), private as today
-- All 127 existing rows (owned by the only existing user) flip to canonical.
-- UUIDs preserved → FKs from sets/routine_exercises/exercise_notes unaffected.
-- Mirrors 0004_exercise_muscles_array.sql's structural shape:
--   nullability change → backfill UPDATE → policy replace → trigger rewrite.
-- =============================================================================

-- 1. Drop NOT NULL so canonical rows can exist.
alter table public.exercises alter column user_id drop not null;

-- 2. Flip every existing row to canonical. The single existing user owned all
--    127 rows; the seed library becomes the canonical catalog in place.
--    UUIDs preserved → sets.exercise_id, routine_exercises.exercise_id,
--    exercise_notes.exercise_id continue to resolve unchanged.
update public.exercises set user_id = null;

-- 3. Replace the 4 exercises_* RLS policies. SELECT widens to allow canonical;
--    INSERT/UPDATE/DELETE stay scoped to auth.uid() = user_id so canonical
--    rows are app-immutable (service role bypasses RLS for admin edits).
drop policy if exists exercises_select on public.exercises;
create policy exercises_select on public.exercises
  for select using (user_id is null or auth.uid() = user_id);

drop policy if exists exercises_insert on public.exercises;
create policy exercises_insert on public.exercises
  for insert with check (auth.uid() = user_id);

drop policy if exists exercises_update on public.exercises;
create policy exercises_update on public.exercises
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists exercises_delete on public.exercises;
create policy exercises_delete on public.exercises
  for delete using (auth.uid() = user_id);

-- 4. Rewrite seed_new_user(): drop the per-user exercises insert (canonical
--    covers it via RLS). Keep the user_preferences insert.
create or replace function public.seed_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_preferences (user_id, weight_unit)
  values (new.id, 'kg')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- 5. Drop the unused exercises_user_idx. With 127 rows + no client predicate
--    on user_id, the planner seq-scans regardless. YAGNI consistent with the
--    repo ethos (see docs/decisions.md). If user-owned-row volume ever climbs,
--    a future migration can introduce a partial index on (user_id) WHERE
--    user_id IS NOT NULL via the Drizzle "SQL is source of truth" precedent.
drop index if exists public.exercises_user_idx;
```

### `tests/e2e/_helpers/canonical-exercise.ts`

Body as specified in "Contratos de I/O" above. New module, ~25 LOC including comments.

### New `rls.test.ts` arm (appended to existing flow, before cleanup)

Block 4 of the test (after the existing exercises / measurements / exercise_notes arms):

1. **Admin canonical insert**: `admin.from("exercises").insert({ user_id: null, name: "Canonical RLS Test ${now}" })` succeeds; capture `id`.
2. **A reads canonical**: `clientA.from("exercises").select("*").eq("id", canonicalId)` returns 1 row.
3. **B reads same canonical**: `clientB.from("exercises").select("*").eq("id", canonicalId)` returns 1 row.
4. **A cannot UPDATE canonical**: `clientA.from("exercises").update({ name: "hijacked" }).eq("id", canonicalId).select()` returns 0 rows; re-read shows the name unchanged.
5. **A cannot DELETE canonical**: `clientA.from("exercises").delete().eq("id", canonicalId).select()` returns 0 rows; re-read shows the row present.
6. **A cannot INSERT a canonical**: `clientA.from("exercises").insert({ user_id: null, name: "spoof" }).select()` — assert `(error !== null) OR (data.length === 0)` (mirror the `bNSpoof` pattern at `rls.test.ts:181-192`).
7. **Anon read of canonical** (pins U1's default): create a fresh `createClient(url, anon)` with no sign-in, call `.from("exercises").select("id").is("user_id", null).limit(1)` — assert `(data ?? []).length >= 1`. This is the explicit pin: changing the SELECT policy to gate on `auth.uid() IS NOT NULL` in a future migration will break this arm and force a conscious choice.
8. **Cleanup**: `admin.from("exercises").delete().eq("id", canonicalId)` (service role bypasses RLS).

### `seed-and-auth.test.ts` updated assertions (lines 52-81)

- **Replace 52-60** (`.eq("user_id", userId)` expecting `length >= 25`) with:
  ```ts
  const { data: perUser } = await admin.from("exercises").select("id, name").eq("user_id", userId);
  if ((perUser ?? []).length !== 0) {
    throw new Error(`FAIL: new user should have 0 owned exercises post-canonical, got ${perUser?.length}`);
  }
  console.log("✅ new user has 0 owned exercises (canonical model)");

  const { data: canonical } = await admin.from("exercises").select("id").is("user_id", null);
  if ((canonical ?? []).length < 25) {
    throw new Error(`FAIL: expected canonical catalog (>=25 rows), got ${canonical?.length ?? 0}`);
  }
  console.log(`✅ canonical catalog present (${canonical!.length} rows)`);
  ```
- **Lines 76-81** (`userClient.from("exercises").select("id")` expecting `length >= 25`) keep the same assertion (now reads canonical-via-RLS); update the log to `"✅ RLS allows user to read canonical exercises (${ownEx!.length} rows)"`.
- Update the file's top docstring to describe the new contract.

## Alternativas descartadas

### Decisions on each Discovery unknown (defaults accepted)

1. **U1 — Anon SELECT**: kept the looser variant (`user_id IS NULL OR auth.uid() = user_id`). Alternatives weighed: (a) `auth.uid() IS NOT NULL AND (...)` — strictly tighter; (b) `user_id IS NULL OR auth.uid() = user_id` (chosen). Chose (b) because canonical content is public-knowledge exercise names with no privacy gradient; preserving future SEO/landing-page optionality is cheap; the new `rls.test.ts` arm 7 pins the behaviour explicitly so a future tightening is a conscious choice, not a silent regression. **Risk of override**: low — flipping later is a 1-line policy change.
2. **U2 — `exercises_user_idx`**: drop in 0011. Alternative: convert to partial index `(user_id) WHERE user_id IS NOT NULL`. Rejected because at 127 rows the planner seq-scans regardless; YAGNI is the repo ethos (`docs/decisions.md`); a future scale problem reintroduces it as a focused migration.
3. **U3 — `schema.ts` + `types.ts` drift**: required in the same commit as 0011. Alternative: defer to a later cleanup. Rejected because `docs/development.md:99-116` codifies the convention and the next `npm run db:generate` would emit a regression migration that re-NOT-NULLs the column — a foot-gun for the next contributor (likely the user themselves).
4. **U4 — Edit-screen gating shape**: both (a) hide pencil + (b) render read-only. Alternatives: (a) alone (hide source) — rejected because deep links / route history leave a hole; (b) alone (read-only destination) — rejected because the affordance still shows, then disappoints; (c) chosen — defense-in-depth, mirrors the `read-only-history.tsx` philosophy.
5. **U5 — Chip predicate**: `user_id !== null` (RLS-trusted, no `useAuth()` import). Alternative: `user_id === currentUser.id` (explicit ownership check via `useAuth()` at the leaf). Rejected because (a) the new `rls.test.ts` arms 2-6 already pin SELECT visibility to RLS-correctness, (b) introducing `useAuth()` at the leaf-component layer for the first time is a precedent-setting choice that we should defer until there's a second use case, (c) the failure mode of `!== null` (chip would render on a leaked canonical row) is bounded by RLS correctness — which the test arm now explicitly defends.
6. **U6 — e2e rewrite shape**: extract `pickCanonicalExercise(admin, name?)` helper. Alternative: 17 in-place rewrites. Rejected because 17 sites is past the DRY threshold; the helper makes future Tester-round rewrites cheaper (one site to edit if e.g. the canonical filter shape ever changes again); the helper module has zero precedent cost (test helpers are a recognized pattern in the codebase via local per-spec `getSeedExerciseByName` shims).

### Other decisions

7. **`<CanonicalChip>` as a component vs. inline JSX**. Alternative: inline both call sites (matches `pr-list-row.tsx:48-52` precedent). Rejected because the chip ships in two surfaces simultaneously — extracting into one component eliminates the visual-drift risk. Cost is one new ~15-LOC file.
8. **Chip text "You" vs. "Created by you" vs. an icon**. Alternative: full text `"Created by you"` — rejected because at 10px font weight + uppercase it would visually crowd the row name. Alternative: an icon (e.g. `User` from lucide-react-native) — rejected because the icon would be ambiguous (could read as profile/avatar). Chose `"You"` glyph + screen-reader-only `accessibilityLabel="Created by you"`.
9. **Chip color: slate vs. amber vs. gray**. Alternative: amber — rejected because amber connotes warning/caution; the chip is informational. Alternative: gray — rejected because gray is already the muted-text default (`text-gray-500` for sublines, `text-gray-400` for disabled rows); a chip in the same gray family would visually disappear. Chose slate — distinct from the gray-family used for muted text, neutral semantic, AA contrast in both light/dark.
10. **Edit screen read-only branch: in-place rendering vs. separate `<ReadOnlyExerciseDetail>` component**. Alternative: a new sibling component mirroring the `<ReadOnlyExerciseBlock>` precedent. Rejected because (a) the edit screen is a single-screen, single-purpose route — not a recurring component, (b) the read-only branch is ~25 LOC of `<Text>` blocks, (c) extracting would split state between the parent (data fetch) and child (display) for no reuse benefit. In-place gate is idiomatic for screens.
11. **`headerRight: undefined` vs. `headerRight: () => null`**. Alternative: render an empty `<View />`. Rejected because Stack.Screen's navigator interprets `undefined` as "omit slot" (matches existing React Navigation idiom); `() => null` leaves a 0×0 placeholder that can still consume tap area.
12. **Cache buster bump vs. skip**. Alternative: skip the bump (no columns added/removed, no JSON shape change). Rejected because the runtime value of `user_id` changes from a UUID string to `null` for every cached row, and the new chip predicate reads `row.user_id`. A user with a persisted cache would see incorrect "You" chips on all 127 canonical exercises until the cache TTL expires (24h via `gcTime`). Bumping the buster forces a clean repopulate on first launch. Matches `docs/decisions.md` Decision 9 (iPhone shakedown lesson).
13. **`scripts/create-user.ts` cosmetic fix in-scope vs. out-of-scope**. Alternative: leave the diagnostic printing `exercises seeded: 0` and flag as future work. Rejected because (a) it's a one-line change in a file already conceptually touched by this run, (b) leaving a misleading diagnostic is a debugger trap for the next contributor. In-scope, scoped to two read lines.

## Riscos

### 1. Data integrity — migration single-transaction safety (HIGH load-bearing, LOW residual)

**Concern**: `0011_canonical_exercises.sql` runs inside the implicit `BEGIN ... COMMIT` that Supabase CLI's `db push` wraps around each migration file. If any step fails, partial state would be catastrophic (e.g., `NOT NULL` dropped but RLS policies still locked to `auth.uid() = user_id` would leave canonical rows invisible to everyone).

**Why low residual**: every step is transaction-compatible — `ALTER TABLE`, `UPDATE`, `DROP POLICY` / `CREATE POLICY`, `CREATE OR REPLACE FUNCTION`, `DROP INDEX` are all valid inside a single transaction. None of the failure-prone forms (`CREATE INDEX CONCURRENTLY`, `ALTER TYPE ... ADD VALUE` in older Postgres) are used. The Tester-round e2e suite will exercise the full migrated state.

**Mitigation**: explicitly call out in the migration file's header comment that the file is a single-transaction migration. Tester arm: run `npm run db:push`, then verify (a) all 127 existing rows have `user_id IS NULL`, (b) the 4 RLS policies match the new bodies, (c) `seed_new_user()` source no longer contains `insert into public.exercises`.

### 2. Data integrity — FK integrity across the flip (LOW)

**Concern**: any process reading `exercises.user_id` non-null assumption between the migration apply and the app cache buster taking effect on the next launch.

**Why low**: the migration mutates `exercises.user_id`, not the PK `exercises.id`. All FKs from `sets.exercise_id` (RESTRICT, `schema.ts:145`), `routine_exercises.exercise_id` (RESTRICT, `schema.ts:93`), `exercise_notes.exercise_id` (RESTRICT, `schema.ts:228`) target `exercises.id` and continue to resolve. Pinned by Tester arm: existing user's 665 sessions / 11,746 sets / 1 exercise_note all resolve to their exercise rows post-migration (admin query + spot check).

**Mitigation**: Tester executes a row-count parity check against the pre-migration baseline. The baseline is documented in `state.md:10-12`.

### 3. UX regression — stale persisted cache renders incorrect chips (MEDIUM)

**Concern**: a user on a phone with a 24h-fresh persisted query cache opens the app post-deploy. The persisted cache still has `user_id = "<uuid>"` for all 127 exercises (the pre-migration value). The chip predicate (`row.user_id !== null`) renders the "You" chip on every canonical row. The user sees 127 "You" chips and concludes everything is broken.

**Mitigation**: bump `queryCacheBuster` from `"schema-2026-05-21-set-check"` to `"schema-2026-05-25-canonical-exercises"`. PersistQueryClientProvider invalidates the entire persisted cache on buster mismatch, triggering a fresh fetch on first launch. The freshly fetched rows have `user_id = NULL` for canonical, predicate resolves correctly. Matches `docs/decisions.md` Decision 9. Tester arm: not directly testable in e2e (Playwright starts with a clean browser context), but Tester should confirm the buster value matches the migration date in the final review.

### 4. UX regression — edit-screen deep-link to canonical now read-only without a clear "why" (MEDIUM)

**Concern**: a user with a bookmarked / shared link to `/(app)/exercises/<canonical-id>` taps it, expecting the edit form they had before. They see a read-only view with a Back button. Without context, they may think the screen is broken.

**Mitigation**: the read-only screen title changes from `"Edit exercise"` to `"Exercise"` — a subtle but immediate signal that this is not the edit context. Out of scope for this run: an explanatory banner ("This is a built-in exercise. Create your own copy to customize."). Reason for excluding: scope-creep risk; the chip on the library row already telegraphs the ownership semantic. Logged in Out-of-scope.

### 5. UX regression — `<ExerciseBlock>` in live workout doesn't show the chip (LOW; intentional)

**Concern**: a user mid-workout looking at an `<ExerciseBlock>` (live session) doesn't see the chip and may wonder why the picker showed it. The state.md feature prompt is explicit: the chip ships in the picker + library list only; the in-session block is out of scope.

**Mitigation**: documented in Out-of-scope. If the user reports this as a regression post-deploy, it's a follow-up run, not a v1 blocker.

### 6. Platform divergence — iOS vs. web (LOW)

**Concern**: NativeWind class differences between RN and RN-Web could render the chip differently.

**Why low**: the chip uses the same classes as the precedent `pr-list-row.tsx:48-52` (already shipping in production on both surfaces). No platform-conditional code anywhere in the changeset.

**Mitigation**: Tester e2e runs against Playwright (web). iOS verification is the user's manual smoke test (per the `docs/iphone-shakedown.md` discipline). The Tester report should note "web verified; iOS smoke recommended".

### 7. Performance — RLS predicate cost on every read (LOW)

**Concern**: the new `(user_id IS NULL OR auth.uid() = user_id)` predicate is slightly more expensive than the old `auth.uid() = user_id`.

**Why low**: at 127 rows the planner seq-scans regardless. The OR-decomposition is constant-time. No measurable perf delta expected at current or 10x scale.

**Mitigation**: none required. Index analysis is in `discovery.md` "Index analysis" appendix; revisit if user-owned exercise volume ever climbs to thousands per user.

## Out of scope

- Admin UI for canonical-exercise editing (prompt: admin via direct DB, no UI).
- Per-user override / overlay table for renaming canonical rows locally.
- Name-uniqueness constraints between canonical and user-owned (prompt explicit).
- Backfill of `sets.exercise_id`, `routine_exercises.exercise_id`, `exercise_notes.exercise_id` — UUIDs preserved by `UPDATE exercises SET user_id = NULL`; FKs resolve unchanged.
- `routine_exercises.user_id` / `sets.user_id` nullability changes — stay `NOT NULL`.
- "Created by you" chip on `<ExerciseBlock>` (live workout + history) — prompt names only the picker + library list.
- Recommended / Featured subset of canonical — canonical stays unsorted, name-ordered.
- Anonymous-public read tightening (per U1 default) — flagged via Tester arm 7 so a future tightening is conscious.
- Explanatory banner on the read-only edit screen ("This is a built-in exercise...") — see Risk 4.
- Backfill of stale persisted client caches deployed before the bump — the buster invalidates them on next launch; no server-side push.
- iOS-specific verification — handled by the user's manual smoke; Tester report flags as a recommendation, not a gate.

## Test plan handoff (Acceptance Criteria → test arm)

The state.md "Acceptance Criteria" enumerates 7 criteria. Below, each maps to a test the Tester will run/verify.

| AC | Type | Test arm |
|---|---|---|
| **AC1** — Migration applies cleanly; all 127 rows now have `user_id IS NULL`. | manual + admin SQL | Tester runs `npm run db:push`; runs `select count(*) from exercises where user_id is null` (expects 127) and `select count(*) from exercises where user_id is not null` (expects 0). |
| **AC2** — New signup creates `user_preferences` but no exercise rows; sees canonical via RLS. | `tests/seed-and-auth.test.ts` (rewritten) | Asserts new user `.eq("user_id", userId)` returns 0; canonical admin count >= 25; user-client SELECT returns >= 25 via RLS. |
| **AC3** — Existing user (`gsinacio94`) sees the same 127 exercises across all surfaces. | manual smoke | Tester signs in as the existing user (or admin-creates a session), navigates picker / library / live workout / history / routines — visual confirmation no regression. Spot-check: row count in the library list = 127. |
| **AC4** — Existing user creates a new exercise → row has `user_id = auth.uid()`, chip renders, edit + delete affordances present. | e2e (extend `tests/e2e/crud.spec.ts`) | Use the existing create-exercise flow; verify the row appears with the "You" chip; verify the progress-screen pencil renders; verify the edit screen shows `<Input>` (editable) for the new row. |
| **AC5** — Existing user attempting to edit/delete a canonical row gets no affordance; forced API call rejected by RLS. | `tests/rls.test.ts` (new arm 4-6) + manual | RLS arms 4-6 cover the API rejection; the new e2e for canonical rows verifies the progress-screen pencil is absent and the read-only edit screen has no Save/Delete buttons. |
| **AC6** — All existing surfaces (live workout, history, routines, progress, notes) continue to work — `exercise_id` references resolve. | e2e (the 16 spec files post-helper-extraction) | The existing e2e suite re-run against the migrated DB — every spec passes. Tester verifies green across the full suite. |
| **AC7** — Tests added for: RLS visibility, RLS mutation rejection, badge rendering, edit/delete gating, signup trigger no exercise insert. | combined | RLS arms (rls.test.ts arms 1-7) + seed-and-auth rewrite + new e2e for canonical-row gating (Tester decides shape — either a new `tests/e2e/canonical-exercise-gating.spec.ts` or extension of `crud.spec.ts`). |

**Tester note**: a new e2e spec for canonical-row gating (verifying the "You" chip + read-only edit screen + absent pencil) is recommended but is a Tester-design call. The chip predicate is RLS-trusted, so the existing rls.test.ts + a single visual e2e assertion is sufficient.

## Open questions / unknowns

None. All 6 Discovery unknowns were resolved with the forwarded defaults (justifications in "Alternativas descartadas"). No new ambiguity surfaced during design.

## Resposta a issues do Validator (only if v > 1)

N/A — this is round 1 of the Design↔Validate loop.
