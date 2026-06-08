/**
 * E2E: Strong-like routine builder with per-set targets.
 *
 * Run-id: 2026-05-26_0101_routine-strong-builder
 *
 * Covers the user-visible contracts of the per-set normalization refactor:
 *   1. Golden path — admin-seed routine + per-set targets, start session, the
 *      seeded `sets` rows appear unchecked on the live screen.
 *   2. Dropset variant — routine has a working + dropset pair; live screen
 *      shows the dropset with correct parent_set_id linkage.
 *   3. Idempotency — double-tap Start results in exactly one session.
 *   4. Soft-delete a set then re-add — set_number stays monotonic via the
 *      MAX-based next-set computation.
 *   5. Edit-then-restart — editing the routine after a session started does
 *      NOT alter the active session's sets.
 *   6. Seed-failure hard fail — when `seedSetsForSession`'s second insert is
 *      intercepted with 500, the user stays on the routine list, an orphan
 *      empty session exists, and zero `sets` rows are written.
 *   7. Duplicate-exercise rejection — admin attempt to insert two
 *      non-deleted (routine_id, exercise_id) pairs fails 23505; succeeds
 *      after soft-deleting the first.
 *
 * Test infrastructure mirrors `tests/e2e/rest-timer-auto-start.spec.ts`:
 *  - admin client for setup via service-role,
 *  - user client implicit via the running app,
 *  - `pickCanonicalExercise` helper for canonical-catalog reads.
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

type SeedRoutineResult = {
  routineId: string;
  routineExerciseId: string;
  workingSetIds: string[];
  dropsetIds: string[];
};

async function seedRoutineWithSets(opts: {
  userId: string;
  routineName: string;
  exerciseId: string;
  workingSets: { reps: number | null; weight: string | null }[];
  dropsetParentIndex?: number; // index into workingSets to attach a dropset to
  dropsetWeight?: string | null;
  dropsetReps?: number | null;
}): Promise<SeedRoutineResult> {
  const { data: r, error: rErr } = await admin
    .from("routines")
    .insert({ user_id: opts.userId, name: opts.routineName })
    .select("id")
    .single();
  if (rErr || !r) throw new Error(`routine insert: ${rErr?.message}`);

  const { data: re, error: reErr } = await admin
    .from("routine_exercises")
    .insert({
      user_id: opts.userId,
      routine_id: r.id,
      exercise_id: opts.exerciseId,
      position: 0,
      target_rest_seconds: null,
    })
    .select("id")
    .single();
  if (reErr || !re) {
    throw new Error(`routine_exercise insert: ${reErr?.message}`);
  }

  const workingRows = opts.workingSets.map((s, i) => ({
    user_id: opts.userId,
    routine_exercise_id: re.id as string,
    set_number: i + 1,
    set_type: "working" as const,
    target_reps: s.reps,
    target_weight: s.weight,
  }));
  const { data: working, error: wErr } = await admin
    .from("routine_exercise_sets")
    .insert(workingRows)
    .select("id, set_number")
    .order("set_number", { ascending: true });
  if (wErr || !working) {
    throw new Error(`working sets insert: ${wErr?.message}`);
  }
  const workingSetIds = working.map((s) => s.id as string);

  const dropsetIds: string[] = [];
  if (opts.dropsetParentIndex != null) {
    const parentId = workingSetIds[opts.dropsetParentIndex];
    if (!parentId) {
      throw new Error("invalid dropsetParentIndex");
    }
    const { data: drops, error: dErr } = await admin
      .from("routine_exercise_sets")
      .insert({
        user_id: opts.userId,
        routine_exercise_id: re.id as string,
        set_number: opts.workingSets.length + 1,
        set_type: "dropset" as const,
        target_reps: opts.dropsetReps ?? null,
        target_weight: opts.dropsetWeight ?? null,
        parent_set_id: parentId,
      })
      .select("id");
    if (dErr || !drops) {
      throw new Error(`dropset insert: ${dErr?.message}`);
    }
    dropsetIds.push(...drops.map((d) => d.id as string));
  }

  return {
    routineId: r.id as string,
    routineExerciseId: re.id as string,
    workingSetIds,
    dropsetIds,
  };
}

test.afterAll(async () => {
  await Promise.all([...createdUserIds].map(deleteUserSafe));
});

// ---------------------------------------------------------------------------
// 1. Golden path — seeded routine sets appear on live screen as unchecked.
// ---------------------------------------------------------------------------

test.describe("Routine builder + seed-on-Start (web)", () => {
  test("golden path: routine with 3 working sets seeds 3 unchecked rows in live session", async ({
    page,
  }) => {
    const email = `e2e-rsb-golden-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const ex = await pickCanonicalExercise(admin, "Bench Press");

    await seedRoutineWithSets({
      userId,
      routineName: `Golden RSB ${Date.now()}`,
      exerciseId: ex.id,
      workingSets: [
        { reps: 8, weight: "60.00" },
        { reps: 8, weight: "70.00" },
        { reps: 6, weight: "80.00" },
      ],
    });

    await signInAndLand(page, email);

    // Tap the routine row → opens the read-only PREVIEW (no longer starts the
    // session directly). Row a11y label is now "View routine: {name}".
    const row = page
      .locator('[aria-label^="View routine: Golden RSB"]')
      .first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();
    await page.waitForURL(/\/routines\/[0-9a-f-]+\/preview(\?|$)/, {
      timeout: 15_000,
    });

    // Start the workout from the preview.
    await page.getByRole("button", { name: "Start workout" }).click();

    // Wait for nav to live screen.
    await page.waitForURL(/\/workout\/[0-9a-f-]+/, { timeout: 15_000 });

    // Verify 3 sets exist for this exercise in this session (via admin).
    // Read via admin to avoid flaky DOM ordering.
    const { data: sessions } = await admin
      .from("sessions")
      .select("id")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("started_at", { ascending: false })
      .limit(1);
    expect(sessions?.length).toBe(1);
    const sessionId = sessions![0]!.id as string;

    const { data: sets } = await admin
      .from("sets")
      .select("set_number, set_type, reps, weight, completed_at, parent_set_id")
      .eq("session_id", sessionId)
      .order("set_number", { ascending: true });
    expect(sets?.length).toBe(3);
    expect(sets?.map((s) => s.set_number)).toEqual([1, 2, 3]);
    expect(sets?.every((s) => s.set_type === "working")).toBe(true);
    expect(sets?.every((s) => s.completed_at == null)).toBe(true);
    expect(sets?.every((s) => s.parent_set_id == null)).toBe(true);
    expect(sets?.map((s) => Number(s.weight))).toEqual([60, 70, 80]);
  });

  // ---------------------------------------------------------------------------
  // 2. Dropset variant.
  // ---------------------------------------------------------------------------

  test("dropset variant: routine with 1 working + 1 dropset → live shows correct parent_set_id", async ({
    page,
  }) => {
    const email = `e2e-rsb-dropset-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const ex = await pickCanonicalExercise(admin, "Bench Press");

    await seedRoutineWithSets({
      userId,
      routineName: `Dropset RSB ${Date.now()}`,
      exerciseId: ex.id,
      workingSets: [{ reps: 8, weight: "80.00" }],
      dropsetParentIndex: 0,
      dropsetReps: 6,
      dropsetWeight: "60.00",
    });

    await signInAndLand(page, email);
    const row = page
      .locator('[aria-label^="View routine: Dropset RSB"]')
      .first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();
    await page.waitForURL(/\/routines\/[0-9a-f-]+\/preview(\?|$)/, {
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Start workout" }).click();
    await page.waitForURL(/\/workout\/[0-9a-f-]+/, { timeout: 15_000 });

    const { data: sessions } = await admin
      .from("sessions")
      .select("id")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("started_at", { ascending: false })
      .limit(1);
    const sessionId = sessions![0]!.id as string;

    const { data: sets } = await admin
      .from("sets")
      .select("id, set_number, set_type, parent_set_id")
      .eq("session_id", sessionId)
      .order("set_number", { ascending: true });
    expect(sets?.length).toBe(2);
    const [working, dropset] = sets!;
    expect(working!.set_type).toBe("working");
    expect(dropset!.set_type).toBe("dropset");
    expect(dropset!.parent_set_id).toBe(working!.id);
  });

  // ---------------------------------------------------------------------------
  // 3. Idempotency — double-tap Start.
  // ---------------------------------------------------------------------------

  test("idempotency: rapid double-tap on Start produces exactly ONE session", async ({
    page,
  }) => {
    const email = `e2e-rsb-idem-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const ex = await pickCanonicalExercise(admin, "Bench Press");

    await seedRoutineWithSets({
      userId,
      routineName: `Idem RSB ${Date.now()}`,
      exerciseId: ex.id,
      workingSets: [{ reps: 8, weight: "60.00" }],
    });

    await signInAndLand(page, email);
    const row = page
      .locator('[aria-label^="View routine: Idem RSB"]')
      .first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();
    await page.waitForURL(/\/routines\/[0-9a-f-]+\/preview(\?|$)/, {
      timeout: 15_000,
    });

    // Two near-simultaneous clicks on the preview's Start button. The in-flight
    // `pendingRoutineId` guard (now on the preview) must block the second from
    // firing the mutation. `noWaitAfter` keeps each click from waiting on the
    // post-click navigation, and the 2nd click gets a short timeout + .catch so
    // it fails fast instead of hanging when the first click's router.replace
    // detaches the button mid-navigation (which otherwise stalls the test the
    // full 60s — a flaky, NOT a Guard-B defect: traces confirm exactly ONE
    // session POST regardless).
    const startBtn = page.getByRole("button", { name: "Start workout" });
    await expect(startBtn).toBeVisible({ timeout: 10_000 });
    await Promise.all([
      startBtn.click({ noWaitAfter: true }),
      startBtn
        .click({ noWaitAfter: true, timeout: 2_000 })
        .catch(() => undefined),
    ]);

    await page.waitForURL(/\/workout\/[0-9a-f-]+/, { timeout: 15_000 });

    // Poll the DB until the Start mutation has landed (replaces a flaky
    // waitForLoadState("networkidle") — RN-Web keeps long-lived connections so
    // networkidle can hang the full timeout). Guard B must leave exactly ONE
    // session; if it produced two, the poll would settle on 2 and fail.
    await expect
      .poll(
        async () => {
          const { count } = await admin
            .from("sessions")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
            .is("deleted_at", null);
          return count ?? 0;
        },
        { message: "exactly one session", timeout: 15_000 },
      )
      .toBe(1);

    const { data: sessions } = await admin
      .from("sessions")
      .select("id")
      .eq("user_id", userId)
      .is("deleted_at", null);
    const sessionId = sessions![0]!.id as string;
    await expect
      .poll(
        async () => {
          const { count } = await admin
            .from("sets")
            .select("id", { count: "exact", head: true })
            .eq("session_id", sessionId)
            .is("deleted_at", null);
          return count ?? 0;
        },
        { message: "exactly one seeded set", timeout: 15_000 },
      )
      .toBe(1);
  });

  // ---------------------------------------------------------------------------
  // 4. Soft-delete a set in the builder, re-add — set_number stays monotonic.
  // ---------------------------------------------------------------------------

  test("soft-delete then re-add: new set's set_number = max(non-deleted) + 1", async ({
    page,
  }) => {
    const email = `e2e-rsb-redel-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const ex = await pickCanonicalExercise(admin, "Bench Press");

    const { routineId, routineExerciseId, workingSetIds } =
      await seedRoutineWithSets({
        userId,
        routineName: `ReAdd RSB ${Date.now()}`,
        exerciseId: ex.id,
        workingSets: [
          { reps: 8, weight: "60.00" },
          { reps: 8, weight: "70.00" },
        ],
      });

    // Soft-delete set #2 directly via admin (simulates the builder removing it).
    await admin
      .from("routine_exercise_sets")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", workingSetIds[1]!);

    await signInAndLand(page, email);
    await page.goto(`/routines/${routineId}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Exercises", { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });

    // Click "+ Working set" — the new row's set_number should be 2 (MAX(1) + 1).
    const addBtn = page.getByLabel("Add working set").first();
    await expect(addBtn).toBeVisible({ timeout: 5_000 });
    await addBtn.click();
    await page.waitForLoadState("networkidle");

    const { data: sets } = await admin
      .from("routine_exercise_sets")
      .select("set_number, deleted_at")
      .eq("routine_exercise_id", routineExerciseId)
      .is("deleted_at", null)
      .order("set_number", { ascending: true });
    expect(sets?.length).toBe(2);
    expect(sets?.map((s) => s.set_number)).toEqual([1, 2]);
  });

  // ---------------------------------------------------------------------------
  // 5. Edit-then-restart — routine edits do NOT affect active session.
  // ---------------------------------------------------------------------------

  test("edit-then-restart: removing a routine set after Start does NOT remove the seeded set in the active session", async ({
    page,
  }) => {
    const email = `e2e-rsb-edit-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const ex = await pickCanonicalExercise(admin, "Bench Press");

    const { workingSetIds } = await seedRoutineWithSets({
      userId,
      routineName: `Edit RSB ${Date.now()}`,
      exerciseId: ex.id,
      workingSets: [
        { reps: 8, weight: "60.00" },
        { reps: 8, weight: "70.00" },
        { reps: 6, weight: "80.00" },
      ],
    });

    await signInAndLand(page, email);
    const row = page
      .locator('[aria-label^="View routine: Edit RSB"]')
      .first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();
    await page.waitForURL(/\/routines\/[0-9a-f-]+\/preview(\?|$)/, {
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Start workout" }).click();
    await page.waitForURL(/\/workout\/[0-9a-f-]+/, { timeout: 15_000 });

    const { data: sessions } = await admin
      .from("sessions")
      .select("id")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("started_at", { ascending: false })
      .limit(1);
    const sessionId = sessions![0]!.id as string;

    // Edit the routine: soft-delete set #1 via admin (simulates the user
    // opening the builder in a different tab and removing a set).
    await admin
      .from("routine_exercise_sets")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", workingSetIds[0]!);

    // Live session sets still 3.
    const { count } = await admin
      .from("sets")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId)
      .is("deleted_at", null);
    expect(count).toBe(3);
  });

  // ---------------------------------------------------------------------------
  // 6. Seed-failure hard fail (MAJ-2).
  // ---------------------------------------------------------------------------

  test("hard fail: seed insert fault → user stays on routines, orphan session exists, zero sets", async ({
    page,
  }) => {
    const email = `e2e-rsb-fail-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const ex = await pickCanonicalExercise(admin, "Bench Press");

    await seedRoutineWithSets({
      userId,
      routineName: `Fail RSB ${Date.now()}`,
      exerciseId: ex.id,
      workingSets: [{ reps: 8, weight: "60.00" }],
    });

    await signInAndLand(page, email);

    // Intercept the first `POST /rest/v1/sets` (the seed) and reject with 500.
    // Note: this includes regular `logSet` traffic too — fine for this spec
    // because nothing else writes to sets between sign-in and Start.
    await page.route(/\/rest\/v1\/sets(\?.*)?$/, (route, request) => {
      if (request.method() === "POST") {
        return route.fulfill({ status: 500, body: '{"message":"seeded fault"}' });
      }
      return route.continue();
    });

    await purgeQueryCache(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/workout/, { timeout: 15_000 });

    const row = page
      .locator('[aria-label^="View routine: Fail RSB"]')
      .first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();
    await page.waitForURL(/\/routines\/[0-9a-f-]+\/preview(\?|$)/, {
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Start workout" }).click();

    // Poll until the session-create POST has landed (the seed POST is faulted
    // 500, so the mutation throws AFTER creating the orphan session). Replaces
    // a flaky waitForLoadState("networkidle"): the 500-intercepted route plus
    // RN-Web's long-lived connections can keep the page from ever reaching
    // networkidle, hanging the test the full timeout.
    await expect
      .poll(
        async () => {
          const { count } = await admin
            .from("sessions")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
            .is("deleted_at", null);
          return count ?? 0;
        },
        { message: "exactly one orphan session", timeout: 15_000 },
      )
      .toBe(1);

    // Assert: on seed failure the user STAYS on the preview (LOCKED U9, Guard
    // C — no /workout/{id} redirect, no router.back()).
    expect(page.url()).toMatch(/\/routines\/[0-9a-f-]+\/preview(\?|$)/);

    const { data: orphanSessions } = await admin
      .from("sessions")
      .select("id")
      .eq("user_id", userId)
      .is("deleted_at", null);
    const orphanId = orphanSessions![0]!.id as string;

    // Assert: zero sets for that session.
    const { count } = await admin
      .from("sets")
      .select("id", { count: "exact", head: true })
      .eq("session_id", orphanId);
    expect(count).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 7. Duplicate-exercise rejection at the DB level (MAJ-3 verification).
  // ---------------------------------------------------------------------------

  test("duplicate-exercise: second non-deleted (routine_id, exercise_id) insert fails 23505", async () => {
    const email = `e2e-rsb-dupe-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const ex = await pickCanonicalExercise(admin, "Bench Press");

    const { data: routine } = await admin
      .from("routines")
      .insert({ user_id: userId, name: `Dupe RSB ${Date.now()}` })
      .select("id")
      .single();

    const { data: first, error: firstErr } = await admin
      .from("routine_exercises")
      .insert({
        user_id: userId,
        routine_id: routine!.id,
        exercise_id: ex.id,
        position: 0,
      })
      .select("id")
      .single();
    expect(firstErr).toBeNull();
    expect(first).not.toBeNull();

    // Second insert with same (routine_id, exercise_id) — must 23505.
    const { error: secondErr } = await admin
      .from("routine_exercises")
      .insert({
        user_id: userId,
        routine_id: routine!.id,
        exercise_id: ex.id,
        position: 1,
      })
      .select("id");
    expect(secondErr).not.toBeNull();
    expect(secondErr?.code).toBe("23505");
    expect(secondErr?.message ?? "").toMatch(
      /routine_exercises_routine_exercise_uq/,
    );

    // Soft-delete the first and retry — must succeed.
    await admin
      .from("routine_exercises")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", first!.id);

    const { error: retryErr } = await admin
      .from("routine_exercises")
      .insert({
        user_id: userId,
        routine_id: routine!.id,
        exercise_id: ex.id,
        position: 1,
      })
      .select("id");
    expect(retryErr).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // P1. Tap row → preview renders the per-set targets (read-only) with teeth.
  // ---------------------------------------------------------------------------

  test("preview: tapping a routine row opens the read-only preview showing the set targets", async ({
    page,
  }) => {
    const email = `e2e-rsb-preview-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const ex = await pickCanonicalExercise(admin, "Bench Press");

    await seedRoutineWithSets({
      userId,
      routineName: `Preview RSB ${Date.now()}`,
      exerciseId: ex.id,
      // Distinctive non-collision-prone weight (MIN-NEW-3): "137.50" → "137.5".
      workingSets: [{ reps: 8, weight: "137.50" }],
    });

    await signInAndLand(page, email);

    const row = page
      .locator('[aria-label^="View routine: Preview RSB"]')
      .first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();
    await page.waitForURL(/\/routines\/[0-9a-f-]+\/preview(\?|$)/, {
      timeout: 15_000,
    });

    // Teeth: the exercise name renders, and the displayed target weight value
    // is the distinctive "137.5" on a real <Text> node (NOT an SVG tick). The
    // value is unique in the preview so a bare getByText cannot false-match.
    await expect(page.getByText(ex.name).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("137.5", { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });

    // The Start button is present and queryable.
    await expect(page.getByRole("button", { name: "Start workout" })).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // P3. Row no longer direct-starts (regression guard, E8).
  // ---------------------------------------------------------------------------

  test("preview: tapping a routine row never direct-starts a session", async ({
    page,
  }) => {
    const email = `e2e-rsb-nodirect-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const ex = await pickCanonicalExercise(admin, "Bench Press");

    await seedRoutineWithSets({
      userId,
      routineName: `NoDirect RSB ${Date.now()}`,
      exerciseId: ex.id,
      workingSets: [{ reps: 8, weight: "60.00" }],
    });

    await signInAndLand(page, email);

    const row = page
      .locator('[aria-label^="View routine: NoDirect RSB"]')
      .first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();

    // The row tap lands on the PREVIEW, not on a live session.
    await expect(page).toHaveURL(/\/routines\/[0-9a-f-]+\/preview(\?|$)/, {
      timeout: 15_000,
    });

    // And no session was created by merely opening the preview.
    const { count } = await admin
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("deleted_at", null);
    expect(count, "no session created by opening the preview").toBe(0);
  });

  // ---------------------------------------------------------------------------
  // P4. Edit jump from the preview header (E7).
  // ---------------------------------------------------------------------------

  test("preview: header 'Edit this routine' jumps to the routine builder", async ({
    page,
  }) => {
    const email = `e2e-rsb-editjump-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const ex = await pickCanonicalExercise(admin, "Bench Press");

    await seedRoutineWithSets({
      userId,
      routineName: `EditJump RSB ${Date.now()}`,
      exerciseId: ex.id,
      workingSets: [{ reps: 8, weight: "60.00" }],
    });

    await signInAndLand(page, email);

    const row = page
      .locator('[aria-label^="View routine: EditJump RSB"]')
      .first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();
    await page.waitForURL(/\/routines\/[0-9a-f-]+\/preview(\?|$)/, {
      timeout: 15_000,
    });

    // Exact label (MIN-1): "Edit this routine", NOT "Edit routine".
    await page.getByLabel("Edit this routine").click();
    // The builder URL ends after the id (no /preview suffix).
    await page.waitForURL(/\/routines\/[0-9a-f-]+$/, { timeout: 15_000 });
    await expect(
      page.getByText("Exercises", { exact: true }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  // ---------------------------------------------------------------------------
  // P5. Guard A — Start-while-active routes to the EXISTING session (MIN-2/E4).
  //     TEETH: if Guard A (`if (active.data) router.push(active.id)`) were
  //     removed, Start would create a 2nd session and router.replace into it,
  //     so the URL would NOT contain the pre-existing id AND count would be 2.
  // ---------------------------------------------------------------------------

  test("preview Guard A: Start while a session is active routes to the EXISTING session", async ({
    page,
  }) => {
    const email = `e2e-rsb-guardA-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const ex = await pickCanonicalExercise(admin, "Bench Press");

    const { routineId } = await seedRoutineWithSets({
      userId,
      routineName: `GuardA RSB ${Date.now()}`,
      exerciseId: ex.id,
      workingSets: [{ reps: 8, weight: "60.00" }],
    });

    await signInAndLand(page, email);

    // Open the preview FIRST — the row is interactive only while no session is
    // active (disabled={hasActive}).
    const row = page
      .locator('[aria-label^="View routine: GuardA RSB"]')
      .first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();
    await page.waitForURL(/\/routines\/[0-9a-f-]+\/preview(\?|$)/, {
      timeout: 15_000,
    });

    // Now seed an ACTIVE session via admin matching getActiveSession's
    // predicate (deleted_at IS NULL + ended_at IS NULL — sessions.ts:25-36).
    const { data: activeSession, error: asErr } = await admin
      .from("sessions")
      .insert({
        user_id: userId,
        started_at: new Date().toISOString(),
        ended_at: null,
      })
      .select("id")
      .single();
    if (asErr || !activeSession) {
      throw new Error(`active session insert: ${asErr?.message}`);
    }
    const existingId = activeSession.id as string;

    // Reload the preview so useActiveSession picks up the seeded active row.
    await purgeQueryCache(page);
    await page.goto(`/routines/${routineId}/preview`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForURL(/\/routines\/[0-9a-f-]+\/preview(\?|$)/, {
      timeout: 15_000,
    });

    // Tap Start — Guard A routes to the EXISTING session, not a new one.
    await page.getByRole("button", { name: "Start workout" }).click();
    await page.waitForURL(new RegExp(`/workout/${existingId}`), {
      timeout: 15_000,
    });
    expect(page.url()).toContain(existingId);

    // Teeth: still exactly ONE session — no 2nd session was created.
    const { count } = await admin
      .from("sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("deleted_at", null);
    expect(count, "Guard A must not create a 2nd session").toBe(1);
  });
});
