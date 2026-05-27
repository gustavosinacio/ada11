/**
 * E2E for the "auto-fill placeholder on check" feature.
 *
 * Run-id: 2026-05-24_2020_auto-fill-placeholder-on-check
 *
 * Covers (per design-v3.md §"E2E test cases"):
 *  - E1: prior-session placeholder + empty inputs → check fills both.
 *  - E2: typed weight "100" survives; empty reps gets auto-filled.
 *  - E3: typed reps "5" survives; empty weight gets auto-filled.
 *  - E4: no prior session → check no-fill (null weight/reps).
 *  - E5: warmup set → check no auto-fill (gate in screen handler).
 *  - E6: dropset → check no auto-fill (gate in screen handler).
 *  - E7: re-check after uncheck → no spurious second auto-fill (predicate
 *        returns null because row is already filled from first auto-fill).
 *  - E8: bulk "Check all and finish" → no auto-fill (bypasses
 *        onToggleSetChecked entirely; uses useBulkCheckAllInSession).
 *  - E9: lbs mode → user sees lbs-converted display, persisted canonical kg.
 *  - E10: rest-timer regression — both inputs already filled → predicate
 *         null → no extra await, timer fires on the existing optimistic
 *         schedule.
 *
 * Selectors: `getByLabel("Mark set as completed", { exact: true })` / `Unmark set as
 * completed` — byte-identical to rest-timer-auto-start.spec.ts so the same
 * suite continues to pass.
 *
 * MIN-1 (validation v3): inline math comment for E9's lbs string. Actual
 * implementation at src/utils/units.ts:6-8 is `kg / KG_PER_LB`, i.e.
 * `120 / 0.45359237 ≈ 264.5547`. Then `.toFixed(1) === "264.6"`.
 */

import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

import { pickCanonicalExercise } from "./_helpers/canonical-exercise";

dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !ANON || !SERVICE_ROLE) {
  throw new Error(
    "Missing Supabase env vars. Source .env.local before running playwright.",
  );
}

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PASSWORD = "test-password-123";
const createdUserIds = new Set<string>();

async function createConfirmedUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user)
    throw new Error(`createConfirmedUser: ${error?.message}`);
  createdUserIds.add(data.user.id);
  return data.user.id;
}

async function deleteUserSafe(userId: string) {
  try {
    await admin.auth.admin.deleteUser(userId);
  } catch {
    // best-effort
  } finally {
    createdUserIds.delete(userId);
  }
}

async function getSeedExerciseByName(
  _userId: string,
  preferred: string,
): Promise<{ id: string; name: string }> {
  // `_userId` retained for call-site readability + future flexibility, but
  // exercises now live in a shared canonical catalog (user_id IS NULL).
  return pickCanonicalExercise(admin, preferred);
}

/**
 * Same shape as rest-timer-auto-start.spec.ts so the live screen has a
 * stable two-exercise layout and a routine_exercises query that resolves
 * deterministically (with the second exercise — "Squat (Barbell)" — anchoring
 * the wait in gotoLiveSession below).
 */
async function seedRoutineWithTwoExercises(opts: {
  userId: string;
  withRestExerciseId: string;
  withoutRestExerciseId: string;
  restSeconds: number;
}): Promise<string> {
  const { data: r, error: e1 } = await admin
    .from("routines")
    .insert({ user_id: opts.userId, name: "Auto-fill e2e routine" })
    .select("id")
    .single();
  if (e1 || !r) throw new Error(`routine insert: ${e1?.message}`);

  const { error: e2 } = await admin.from("routine_exercises").insert([
    {
      user_id: opts.userId,
      routine_id: r.id,
      exercise_id: opts.withRestExerciseId,
      position: 0,
      target_rest_seconds: opts.restSeconds,
    },
    {
      user_id: opts.userId,
      routine_id: r.id,
      exercise_id: opts.withoutRestExerciseId,
      position: 1,
      target_rest_seconds: null,
    },
  ]);
  if (e2) throw new Error(`routine_exercises insert: ${e2.message}`);
  return r.id as string;
}

async function startLiveSession(
  userId: string,
  routineId: string | null,
): Promise<string> {
  const { data, error } = await admin
    .from("sessions")
    .insert({
      user_id: userId,
      routine_id: routineId,
      started_at: new Date().toISOString(),
      ended_at: null,
      name: "Auto-fill e2e session",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`session insert: ${error?.message}`);
  return data.id as string;
}

async function seedFinishedSession(opts: {
  userId: string;
  exerciseId: string;
  weightKg: number;
  reps: number;
  finishedDaysAgo?: number;
}): Promise<void> {
  const finishedDaysAgo = opts.finishedDaysAgo ?? 2;
  const endedAt = new Date(Date.now() - finishedDaysAgo * 24 * 60 * 60 * 1000);
  const startedAt = new Date(endedAt.getTime() - 60 * 60 * 1000);
  const { data: sess, error: e1 } = await admin
    .from("sessions")
    .insert({
      user_id: opts.userId,
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      name: "Prior session",
    })
    .select("id")
    .single();
  if (e1 || !sess) throw new Error(`prior session insert: ${e1?.message}`);

  const { error: e2 } = await admin.from("sets").insert({
    user_id: opts.userId,
    session_id: sess.id,
    exercise_id: opts.exerciseId,
    set_number: 1,
    reps: opts.reps,
    weight: opts.weightKg.toString(),
    set_type: "working",
    completed_at: endedAt.toISOString(),
  });
  if (e2) throw new Error(`prior set insert: ${e2.message}`);
}

async function seedSet(opts: {
  userId: string;
  sessionId: string;
  exerciseId: string;
  setNumber: number;
  setType?: "warmup" | "working" | "dropset";
  parentSetId?: string | null;
  completedAt?: string | null;
  weightKg?: number | null;
  reps?: number | null;
}): Promise<string> {
  const { data, error } = await admin
    .from("sets")
    .insert({
      user_id: opts.userId,
      session_id: opts.sessionId,
      exercise_id: opts.exerciseId,
      set_number: opts.setNumber,
      reps: opts.reps ?? null,
      weight: opts.weightKg != null ? opts.weightKg.toString() : null,
      set_type: opts.setType ?? "working",
      parent_set_id: opts.parentSetId ?? null,
      completed_at: opts.completedAt ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`set insert: ${error?.message}`);
  return data.id as string;
}

async function setWeightUnit(userId: string, unit: "kg" | "lbs"): Promise<void> {
  // user_preferences rows are upserted on first read by the app. To pre-set
  // lbs before sign-in we upsert here so the live screen mounts in lbs mode.
  const { error } = await admin
    .from("user_preferences")
    .upsert(
      { user_id: userId, weight_unit: unit },
      { onConflict: "user_id" },
    );
  if (error) throw new Error(`user_preferences upsert: ${error.message}`);
}

async function getSet(setId: string): Promise<{
  weight: string | null;
  reps: number | null;
  completed_at: string | null;
}> {
  const { data, error } = await admin
    .from("sets")
    .select("weight, reps, completed_at")
    .eq("id", setId)
    .single();
  if (error || !data) throw new Error(`get set: ${error?.message}`);
  return data as { weight: string | null; reps: number | null; completed_at: string | null };
}

async function signInAndLand(page: Page, email: string) {
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Sign in", { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByText("Sign in", { exact: true }).last().click();
  await page.waitForURL(/\/workout/, { timeout: 15_000 });
}

async function purgeQueryCache(page: Page) {
  await page.evaluate(() => {
    window.localStorage.removeItem("ada11-query-cache");
  });
}

async function gotoLiveSession(
  page: Page,
  sessionId: string,
  opts?: { previousWeightPlaceholder?: string },
) {
  await purgeQueryCache(page);
  await page.goto(`/(app)/workout/${sessionId}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForURL(/\/workout\/[0-9a-f-]+/, { timeout: 15_000 });
  await expect(page.getByText("Elapsed", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  // Anchor on the second routine exercise so we know routine_exercises has
  // resolved before any check — otherwise the gate that reads
  // `restByExercise` could silently no-op. Same pattern as rest-timer spec.
  await expect(page.getByText("Squat (Barbell)", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  // Fix 3 (race 2 mitigation): wait for `useLastWorkingSet` to have resolved
  // before allowing the first click. Without this anchor, Playwright can
  // fire the click before the cross-session placeholder query lands; the
  // handler then receives `previousSet = null`, `computeAutoFillPayload`
  // returns null, auto-fill is skipped, and the DB row stays null after the
  // check — the E7 `:633` NaN flake flagged by the regression report.
  // The placeholder text on the weight input is the visual proxy for the
  // query data having arrived (see <SetInput>.weightPlaceholder at
  // src/components/set-input.tsx:86-90). Callers seeded with a prior
  // session pass the expected placeholder (e.g. "120" for 120 kg in kg
  // mode, "264.6" for 120 kg in lbs mode). Callers without a prior session
  // can omit the option and skip this anchor.
  if (opts?.previousWeightPlaceholder) {
    await expect(
      page.getByPlaceholder(opts.previousWeightPlaceholder).first(),
    ).toBeVisible({ timeout: 15_000 });
  }
}

test.afterAll(async () => {
  await Promise.all(Array.from(createdUserIds).map(deleteUserSafe));
});

test.describe("Auto-fill placeholder on check", () => {
  test("E1: prior 120kg x 8, fresh empty working set → check fills both", async ({
    page,
  }) => {
    const email = `e2e-autofill-e1-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      const withRest = await getSeedExerciseByName(userId, "Bench Press");
      const withoutRest = await getSeedExerciseByName(userId, "Squat (Barbell)");
      await seedFinishedSession({
        userId,
        exerciseId: withRest.id,
        weightKg: 120,
        reps: 8,
      });
      const routineId = await seedRoutineWithTwoExercises({
        userId,
        withRestExerciseId: withRest.id,
        withoutRestExerciseId: withoutRest.id,
        restSeconds: 60,
      });
      const sessionId = await startLiveSession(userId, routineId);
      const setId = await seedSet({
        userId,
        sessionId,
        exerciseId: withRest.id,
        setNumber: 1,
        setType: "working",
        completedAt: null,
        weightKg: null,
        reps: null,
      });

      await signInAndLand(page, email);
      await gotoLiveSession(page, sessionId, {
        previousWeightPlaceholder: "120",
      });

      await page.getByLabel("Mark set as completed", { exact: true }).first().click();
      await expect(
        page.getByLabel("Unmark set as completed", { exact: true }).first(),
      ).toBeVisible({ timeout: 5_000 });

      const row = await getSet(setId);
      expect(row.weight).not.toBeNull();
      expect(parseFloat(row.weight as string)).toBeCloseTo(120, 1);
      expect(row.reps).toBe(8);
      expect(row.completed_at).not.toBeNull();
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("E2: typed weight \"100\" survives; empty reps auto-filled", async ({
    page,
  }) => {
    const email = `e2e-autofill-e2-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      const withRest = await getSeedExerciseByName(userId, "Bench Press");
      const withoutRest = await getSeedExerciseByName(userId, "Squat (Barbell)");
      await seedFinishedSession({
        userId,
        exerciseId: withRest.id,
        weightKg: 120,
        reps: 8,
      });
      const routineId = await seedRoutineWithTwoExercises({
        userId,
        withRestExerciseId: withRest.id,
        withoutRestExerciseId: withoutRest.id,
        restSeconds: 60,
      });
      const sessionId = await startLiveSession(userId, routineId);
      const setId = await seedSet({
        userId,
        sessionId,
        exerciseId: withRest.id,
        setNumber: 1,
        setType: "working",
        completedAt: null,
        weightKg: null,
        reps: null,
      });

      await signInAndLand(page, email);
      await gotoLiveSession(page, sessionId, {
        previousWeightPlaceholder: "120",
      });

      // Type "100" into the weight input. We target the input via placeholder
      // text: with prior 120 kg x 8, the weight input renders placeholder
      // "120" and the reps input "8".
      const weightInput = page.getByPlaceholder("120").first();
      await weightInput.fill("100");

      // Explicit blur + settle BEFORE the check click. Without this, the
      // implicit blur fired by the check-button click races the auto-fill
      // PATCH: the blur-driven `commit()` issues `{weight: "100", reps: null}`
      // and the awaited auto-fill issues `{reps: 8}` — both PATCHes go to
      // PostgREST in parallel, with no ordering guarantee. Forcing blur
      // first (and awaiting cache settlement) eliminates the race. The
      // load-bearing BLK-1 invariant ("auto-fill PATCH does not include the
      // typed field") still holds: at click time `currentInput.weight ===
      // "100"` (non-empty), so the auto-fill payload is `{reps: 8}` only.
      await weightInput.blur();
      await page.waitForTimeout(800);

      // Tap check. `currentInput` carries `{weight: "100", reps: ""}`
      // synchronously from <SetInput>'s local state; the predicate fills
      // ONLY reps.
      await page.getByLabel("Mark set as completed", { exact: true }).first().click();
      await expect(
        page.getByLabel("Unmark set as completed", { exact: true }).first(),
      ).toBeVisible({ timeout: 5_000 });

      // Wait for the cache to settle (auto-fill `updateSet` + `checkSet`).
      await page.waitForTimeout(800);

      const row = await getSet(setId);
      // BLK-1 closed: weight is "100" (the typed value, committed via the
      // explicit blur above — never the previous "120"). Reps auto-filled
      // from previous (8).
      expect(row.reps).toBe(8);
      expect(row.weight).not.toBeNull();
      expect(parseFloat(row.weight as string)).toBeCloseTo(100, 1);
      expect(row.completed_at).not.toBeNull();
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("E3: typed reps \"5\" survives; empty weight auto-filled", async ({
    page,
  }) => {
    const email = `e2e-autofill-e3-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      const withRest = await getSeedExerciseByName(userId, "Bench Press");
      const withoutRest = await getSeedExerciseByName(userId, "Squat (Barbell)");
      await seedFinishedSession({
        userId,
        exerciseId: withRest.id,
        weightKg: 120,
        reps: 8,
      });
      const routineId = await seedRoutineWithTwoExercises({
        userId,
        withRestExerciseId: withRest.id,
        withoutRestExerciseId: withoutRest.id,
        restSeconds: 60,
      });
      const sessionId = await startLiveSession(userId, routineId);
      const setId = await seedSet({
        userId,
        sessionId,
        exerciseId: withRest.id,
        setNumber: 1,
        setType: "working",
        completedAt: null,
        weightKg: null,
        reps: null,
      });

      await signInAndLand(page, email);
      await gotoLiveSession(page, sessionId, {
        previousWeightPlaceholder: "120",
      });

      // Type "5" into reps. Same deterministic-blur scaffolding as E2 —
      // without explicit blur, the check-button's implicit blur races the
      // auto-fill PATCH (blur commits `{weight: null, reps: 5}`; auto-fill
      // commits `{weight: "120"}`; PATCH order is non-deterministic). The
      // load-bearing BLK-1 invariant ("auto-fill PATCH does not include the
      // typed field") is unchanged: at click time `currentInput.reps ===
      // "5"` (non-empty), so the auto-fill payload is `{weight: "120"}`
      // only.
      const repsInput = page.getByPlaceholder("8").first();
      await repsInput.fill("5");
      await repsInput.blur();
      await page.waitForTimeout(800);

      await page.getByLabel("Mark set as completed", { exact: true }).first().click();
      await expect(
        page.getByLabel("Unmark set as completed", { exact: true }).first(),
      ).toBeVisible({ timeout: 5_000 });
      await page.waitForTimeout(800);

      const row = await getSet(setId);
      // BLK-1 closed: weight auto-filled from previous (120); reps "5"
      // (the typed value, committed via the explicit blur above — never
      // the previous "8").
      expect(row.weight).not.toBeNull();
      expect(parseFloat(row.weight as string)).toBeCloseTo(120, 1);
      expect(row.reps).toBe(5);
      expect(row.completed_at).not.toBeNull();
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("E4: no prior session → check no-fill (null weight/reps)", async ({
    page,
  }) => {
    const email = `e2e-autofill-e4-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      const withRest = await getSeedExerciseByName(userId, "Bench Press");
      const withoutRest = await getSeedExerciseByName(userId, "Squat (Barbell)");
      // No prior finished session for the exercise.
      const routineId = await seedRoutineWithTwoExercises({
        userId,
        withRestExerciseId: withRest.id,
        withoutRestExerciseId: withoutRest.id,
        restSeconds: 60,
      });
      const sessionId = await startLiveSession(userId, routineId);
      const setId = await seedSet({
        userId,
        sessionId,
        exerciseId: withRest.id,
        setNumber: 1,
        setType: "working",
        completedAt: null,
        weightKg: null,
        reps: null,
      });

      await signInAndLand(page, email);
      await gotoLiveSession(page, sessionId);

      await page.getByLabel("Mark set as completed", { exact: true }).first().click();
      await expect(
        page.getByLabel("Unmark set as completed", { exact: true }).first(),
      ).toBeVisible({ timeout: 5_000 });
      await page.waitForTimeout(500);

      const row = await getSet(setId);
      // No source available → helper returns null → no updateSet issued.
      expect(row.weight).toBeNull();
      expect(row.reps).toBeNull();
      expect(row.completed_at).not.toBeNull();
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("E5: warmup set → no auto-fill (gate in handler)", async ({
    page,
  }) => {
    const email = `e2e-autofill-e5-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      const withRest = await getSeedExerciseByName(userId, "Bench Press");
      const withoutRest = await getSeedExerciseByName(userId, "Squat (Barbell)");
      await seedFinishedSession({
        userId,
        exerciseId: withRest.id,
        weightKg: 120,
        reps: 8,
      });
      const routineId = await seedRoutineWithTwoExercises({
        userId,
        withRestExerciseId: withRest.id,
        withoutRestExerciseId: withoutRest.id,
        restSeconds: 60,
      });
      const sessionId = await startLiveSession(userId, routineId);
      const setId = await seedSet({
        userId,
        sessionId,
        exerciseId: withRest.id,
        setNumber: 1,
        setType: "warmup",
        completedAt: null,
        weightKg: null,
        reps: null,
      });

      await signInAndLand(page, email);
      await gotoLiveSession(page, sessionId, {
        previousWeightPlaceholder: "120",
      });

      await page.getByLabel("Mark set as completed", { exact: true }).first().click();
      await expect(
        page.getByLabel("Unmark set as completed", { exact: true }).first(),
      ).toBeVisible({ timeout: 5_000 });
      await page.waitForTimeout(500);

      const row = await getSet(setId);
      expect(row.weight).toBeNull();
      expect(row.reps).toBeNull();
      expect(row.completed_at).not.toBeNull();
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("E6: dropset → no auto-fill (gate in handler)", async ({ page }) => {
    const email = `e2e-autofill-e6-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      const withRest = await getSeedExerciseByName(userId, "Bench Press");
      const withoutRest = await getSeedExerciseByName(userId, "Squat (Barbell)");
      await seedFinishedSession({
        userId,
        exerciseId: withRest.id,
        weightKg: 120,
        reps: 8,
      });
      const routineId = await seedRoutineWithTwoExercises({
        userId,
        withRestExerciseId: withRest.id,
        withoutRestExerciseId: withoutRest.id,
        restSeconds: 60,
      });
      const sessionId = await startLiveSession(userId, routineId);
      // Parent working set must exist and be checked (drop chains off it).
      const parentId = await seedSet({
        userId,
        sessionId,
        exerciseId: withRest.id,
        setNumber: 1,
        setType: "working",
        completedAt: new Date().toISOString(),
        weightKg: 100,
        reps: 8,
      });
      const dropId = await seedSet({
        userId,
        sessionId,
        exerciseId: withRest.id,
        setNumber: 2,
        setType: "dropset",
        parentSetId: parentId,
        completedAt: null,
        weightKg: null,
        reps: null,
      });

      await signInAndLand(page, email);
      await gotoLiveSession(page, sessionId, {
        previousWeightPlaceholder: "120",
      });

      // The parent working set is already checked; the only unchecked row
      // is the dropset.
      await page.getByLabel("Mark set as completed", { exact: true }).first().click();
      await expect(
        page.getByLabel("Unmark set as completed", { exact: true }).nth(1),
      ).toBeVisible({ timeout: 5_000 });
      await page.waitForTimeout(500);

      const row = await getSet(dropId);
      expect(row.weight).toBeNull();
      expect(row.reps).toBeNull();
      expect(row.completed_at).not.toBeNull();
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("E7: re-check after uncheck → no spurious second auto-fill", async ({
    page,
  }) => {
    const email = `e2e-autofill-e7-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      const withRest = await getSeedExerciseByName(userId, "Bench Press");
      const withoutRest = await getSeedExerciseByName(userId, "Squat (Barbell)");
      await seedFinishedSession({
        userId,
        exerciseId: withRest.id,
        weightKg: 120,
        reps: 8,
      });
      const routineId = await seedRoutineWithTwoExercises({
        userId,
        withRestExerciseId: withRest.id,
        withoutRestExerciseId: withoutRest.id,
        restSeconds: 60,
      });
      const sessionId = await startLiveSession(userId, routineId);
      const setId = await seedSet({
        userId,
        sessionId,
        exerciseId: withRest.id,
        setNumber: 1,
        setType: "working",
        completedAt: null,
        weightKg: null,
        reps: null,
      });

      await signInAndLand(page, email);
      await gotoLiveSession(page, sessionId, {
        previousWeightPlaceholder: "120",
      });

      // First check → auto-fill 120 / 8.
      await page.getByLabel("Mark set as completed", { exact: true }).first().click();
      await expect(
        page.getByLabel("Unmark set as completed", { exact: true }).first(),
      ).toBeVisible({ timeout: 5_000 });
      await page.waitForTimeout(500);

      let row = await getSet(setId);
      expect(parseFloat(row.weight as string)).toBeCloseTo(120, 1);
      expect(row.reps).toBe(8);

      // Uncheck. Weight/reps preserved (uncheck only flips completed_at).
      await page.getByLabel("Unmark set as completed", { exact: true }).first().click();
      await expect(
        page.getByLabel("Mark set as completed", { exact: true }).first(),
      ).toBeVisible({ timeout: 5_000 });
      await page.waitForTimeout(800);

      row = await getSet(setId);
      expect(parseFloat(row.weight as string)).toBeCloseTo(120, 1);
      expect(row.reps).toBe(8);
      expect(row.completed_at).toBeNull();

      // Re-check. Predicate sees row already filled (input local strings
      // resync to "120"/"8" via useEffect) → null patch → no spurious
      // updateSet. Numbers should remain unchanged.
      await page.getByLabel("Mark set as completed", { exact: true }).first().click();
      await expect(
        page.getByLabel("Unmark set as completed", { exact: true }).first(),
      ).toBeVisible({ timeout: 5_000 });
      await page.waitForTimeout(500);

      row = await getSet(setId);
      expect(parseFloat(row.weight as string)).toBeCloseTo(120, 1);
      expect(row.reps).toBe(8);
      expect(row.completed_at).not.toBeNull();
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("E8: bulk \"Check all and finish\" → no auto-fill", async ({ page }) => {
    const email = `e2e-autofill-e8-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      const withRest = await getSeedExerciseByName(userId, "Bench Press");
      const withoutRest = await getSeedExerciseByName(userId, "Squat (Barbell)");
      await seedFinishedSession({
        userId,
        exerciseId: withRest.id,
        weightKg: 120,
        reps: 8,
      });
      const routineId = await seedRoutineWithTwoExercises({
        userId,
        withRestExerciseId: withRest.id,
        withoutRestExerciseId: withoutRest.id,
        restSeconds: 60,
      });
      const sessionId = await startLiveSession(userId, routineId);
      const set1 = await seedSet({
        userId,
        sessionId,
        exerciseId: withRest.id,
        setNumber: 1,
        setType: "working",
        completedAt: null,
        weightKg: null,
        reps: null,
      });
      const set2 = await seedSet({
        userId,
        sessionId,
        exerciseId: withRest.id,
        setNumber: 2,
        setType: "working",
        completedAt: null,
        weightKg: null,
        reps: null,
      });

      // Accept the modal's confirm dialog if any (matches rest-timer spec).
      page.on("dialog", (d) => void d.accept());

      await signInAndLand(page, email);
      await gotoLiveSession(page, sessionId, {
        previousWeightPlaceholder: "120",
      });

      // Trigger the "Some sets are unchecked" modal → "Check all and finish".
      await page.getByText("Finish", { exact: true }).last().click();
      await expect(
        page.getByText("Check all and finish", { exact: true }).first(),
      ).toBeVisible({ timeout: 10_000 });
      await page
        .getByText("Check all and finish", { exact: true })
        .last()
        .click();

      await page.waitForURL(/\/workout\/verdict\//, { timeout: 15_000 });

      // Both sets get `completed_at` set by the bulk path, but NEITHER
      // gets weight/reps auto-filled (the bulk path bypasses
      // onToggleSetChecked entirely).
      const a = await getSet(set1);
      const b = await getSet(set2);
      expect(a.completed_at).not.toBeNull();
      expect(b.completed_at).not.toBeNull();
      expect(a.weight).toBeNull();
      expect(a.reps).toBeNull();
      expect(b.weight).toBeNull();
      expect(b.reps).toBeNull();
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("E9: lbs mode → lbs-converted display, canonical kg persisted", async ({
    page,
  }) => {
    const email = `e2e-autofill-e9-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      const withRest = await getSeedExerciseByName(userId, "Bench Press");
      const withoutRest = await getSeedExerciseByName(userId, "Squat (Barbell)");
      // Prior session canonical kg = 120; in lbs that's
      //   120 / 0.45359237 ≈ 264.5547 → .toFixed(1) === "264.6".
      await seedFinishedSession({
        userId,
        exerciseId: withRest.id,
        weightKg: 120,
        reps: 8,
      });
      await setWeightUnit(userId, "lbs");
      const routineId = await seedRoutineWithTwoExercises({
        userId,
        withRestExerciseId: withRest.id,
        withoutRestExerciseId: withoutRest.id,
        restSeconds: 60,
      });
      const sessionId = await startLiveSession(userId, routineId);
      const setId = await seedSet({
        userId,
        sessionId,
        exerciseId: withRest.id,
        setNumber: 1,
        setType: "working",
        completedAt: null,
        weightKg: null,
        reps: null,
      });

      await signInAndLand(page, email);
      await gotoLiveSession(page, sessionId, {
        previousWeightPlaceholder: "264.6",
      });

      // Anchor explicitly here as well (matches the historical assertion)
      // for clarity that lbs-converted display took effect before the click.
      await expect(page.getByPlaceholder("264.6").first()).toBeVisible({
        timeout: 10_000,
      });

      await page.getByLabel("Mark set as completed", { exact: true }).first().click();
      await expect(
        page.getByLabel("Unmark set as completed", { exact: true }).first(),
      ).toBeVisible({ timeout: 5_000 });
      await page.waitForTimeout(800);

      // Persisted canonical kg is 120 (not lbs-rounded then converted back).
      const row = await getSet(setId);
      expect(parseFloat(row.weight as string)).toBeCloseTo(120, 2);
      expect(row.reps).toBe(8);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("E10: rest-timer regression — both inputs filled → no extra await", async ({
    page,
  }) => {
    const email = `e2e-autofill-e10-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      const withRest = await getSeedExerciseByName(userId, "Bench Press");
      const withoutRest = await getSeedExerciseByName(userId, "Squat (Barbell)");
      await seedFinishedSession({
        userId,
        exerciseId: withRest.id,
        weightKg: 120,
        reps: 8,
      });
      const routineId = await seedRoutineWithTwoExercises({
        userId,
        withRestExerciseId: withRest.id,
        withoutRestExerciseId: withoutRest.id,
        restSeconds: 60,
      });
      const sessionId = await startLiveSession(userId, routineId);
      // Live set already filled with 90 kg x 6 — predicate returns null.
      const setId = await seedSet({
        userId,
        sessionId,
        exerciseId: withRest.id,
        setNumber: 1,
        setType: "working",
        completedAt: null,
        weightKg: 90,
        reps: 6,
      });

      await signInAndLand(page, email);
      await gotoLiveSession(page, sessionId, {
        previousWeightPlaceholder: "120",
      });

      // Tap check → rest-timer overlay should flip to "Resting" near
      // instantly (no extra round-trip on the no-fill path because the
      // helper returns null and the check writes only completed_at).
      await page.getByLabel("Mark set as completed", { exact: true }).first().click();
      await expect(page.getByText("Resting", { exact: true })).toBeVisible({
        timeout: 5_000,
      });
      // Both "Resting" and the "Unmark" label are now OPTIMISTIC: the timer
      // starts synchronously and useCheckSet's onMutate flips completed_at in
      // the cache before the PATCH lands. So the label is no longer a
      // persistence signal — poll the row until completed_at actually persists
      // rather than reading the DB the instant the label appears.
      await expect(
        page.getByLabel("Unmark set as completed", { exact: true }).first(),
      ).toBeVisible({ timeout: 5_000 });

      await expect
        .poll(async () => (await getSet(setId)).completed_at, {
          timeout: 5_000,
        })
        .not.toBeNull();

      const row = await getSet(setId);
      // Values unchanged (no auto-fill, no clobber).
      expect(parseFloat(row.weight as string)).toBeCloseTo(90, 1);
      expect(row.reps).toBe(6);
      expect(row.completed_at).not.toBeNull();
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("E11: focused empty input + tap check → auto-fill is sole PATCH, no commit collision", async ({
    page,
  }) => {
    // Pins the F7 follow-up race fix: with both <SetInput> local strings
    // empty AND row.weight/row.reps already null, the blur-commit triggered
    // by Keyboard.dismiss() inside the toggle handler must NOT dispatch a
    // null→null PATCH that races the auto-fill `updateSet`. The gate in
    // src/components/set-input.tsx:commit() suppresses that emit at the
    // source. This test focuses the empty weight input then taps the check
    // button without typing or blurring — exactly the Repro A shape from
    // docs/runs/2026-05-25_1214_blur-commit-skip-when-empty/repro.md.
    const email = `e2e-autofill-e11-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      const withRest = await getSeedExerciseByName(userId, "Bench Press");
      const withoutRest = await getSeedExerciseByName(userId, "Squat (Barbell)");
      await seedFinishedSession({
        userId,
        exerciseId: withRest.id,
        weightKg: 120,
        reps: 8,
      });
      const routineId = await seedRoutineWithTwoExercises({
        userId,
        withRestExerciseId: withRest.id,
        withoutRestExerciseId: withoutRest.id,
        restSeconds: 60,
      });
      const sessionId = await startLiveSession(userId, routineId);
      const setId = await seedSet({
        userId,
        sessionId,
        exerciseId: withRest.id,
        setNumber: 1,
        setType: "working",
        completedAt: null,
        weightKg: null,
        reps: null,
      });

      await signInAndLand(page, email);
      await gotoLiveSession(page, sessionId, {
        previousWeightPlaceholder: "120",
      });

      // Count PATCHes targeting this row. The handler's auto-fill issues
      // exactly one PATCH on /rest/v1/sets?id=eq.<setId> with weight+reps.
      // The toggle's checkSet path issues a SEPARATE PATCH against the
      // /sets/check RPC (or a distinct shape) — but our existing check
      // implementation also uses /rest/v1/sets?id=eq.<setId> to set
      // completed_at. So we filter PATCHes to ones whose body contains
      // weight/reps (not completed_at) to single out the auto-fill family.
      // Pre-fix: a second null→null PATCH from <SetInput>.commit would also
      // land on the same URL with weight+reps in the body → count == 2.
      // Post-fix: exactly one PATCH with weight/reps in the body.
      const setPatchBodies: string[] = [];
      page.on("request", (req) => {
        const url = req.url();
        if (
          url.includes(`/rest/v1/sets?`) &&
          url.includes(`id=eq.${setId}`) &&
          req.method() === "PATCH"
        ) {
          const body = req.postData() ?? "";
          // Only count writes that touch weight or reps. The checkSet
          // PATCH carries `completed_at` and (currently) does not include
          // weight/reps in its body — filtering this way isolates the
          // auto-fill vs blur-commit collision family.
          if (body.includes("\"weight\"") || body.includes("\"reps\"")) {
            setPatchBodies.push(body);
          }
        }
      });

      // Focus the empty weight input. Do NOT type. Do NOT blur explicitly.
      // The placeholder ("120") is rendered because the prior session is
      // 120 kg x 8.
      const weightInput = page.getByPlaceholder("120").first();
      await weightInput.focus();

      // Tap check. The handler runs Keyboard.dismiss() synchronously, which
      // on react-native-web blurs the focused input → <SetInput>.commit()
      // fires with local strings empty AND row.weight/row.reps null. The
      // gate must short-circuit before the no-op `{weight: null, reps: null}`
      // PATCH is dispatched.
      await page.getByLabel("Mark set as completed", { exact: true }).first().click();
      await expect(
        page.getByLabel("Unmark set as completed", { exact: true }).first(),
      ).toBeVisible({ timeout: 5_000 });

      // Settle window: let any in-flight PATCH land before counting.
      await page.waitForTimeout(800);

      // EXACTLY ONE PATCH with weight/reps in body (the auto-fill).
      expect(setPatchBodies).toHaveLength(1);
      // Sanity-check the surviving body carries the auto-fill payload, not
      // a null clobber.
      expect(setPatchBodies[0]).toContain("\"weight\"");
      expect(setPatchBodies[0]).toContain("\"reps\"");
      expect(setPatchBodies[0]).not.toMatch(/"weight"\s*:\s*null/);
      expect(setPatchBodies[0]).not.toMatch(/"reps"\s*:\s*null/);

      const row = await getSet(setId);
      expect(row.weight).not.toBeNull();
      expect(parseFloat(row.weight as string)).toBeCloseTo(120, 1);
      expect(row.reps).toBe(8);
      expect(row.completed_at).not.toBeNull();
    } finally {
      await deleteUserSafe(userId);
    }
  });
});
