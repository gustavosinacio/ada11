/**
 * E2E for the rest-timer auto-start on set check.
 *
 * Run-id: 2026-05-22_1415_rest-timer-auto-start
 *
 * Covers:
 *  - Working-set check on exercise with rest configured → overlay flips to
 *    "Resting" with the routine's target_rest_seconds countdown.
 *  - Warmup check → overlay stays idle.
 *  - Dropset check → overlay stays idle.
 *  - Re-check (uncheck then re-check) → overlay restarts with a fresh count.
 *  - Working-set check on exercise WITHOUT rest configured → overlay stays idle.
 *  - Bulk "Check all and finish" does NOT fire the timer (uses bulkCheckAll).
 *  - MIN-1 nav-away survival: timer running → navigate to exercise progress
 *    → back to the live session → overlay still showing the countdown
 *    (proves AsyncStorage persistence under the auto-start path).
 *
 * MIN-2 note: assertions on remainingSeconds use a `>= N` threshold (not `~N`)
 * because the 250ms tick interval in use-rest-timer.ts:70 means the displayed
 * remaining seconds can drop by 1 across a single Date.now() boundary even when
 * elapsed wall time is <1s. Strict equality would flake.
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
  // Helper looks them up by name, falling back to the first canonical row.
  return pickCanonicalExercise(admin, preferred);
}

/**
 * Seeds a routine with two exercises:
 *  - "with-rest" exercise: target_rest_seconds = restSeconds.
 *  - "without-rest" exercise: target_rest_seconds = null.
 * Returns the routine id + the seeded exercise ids.
 */
async function seedRoutineWithTwoExercises(opts: {
  userId: string;
  withRestExerciseId: string;
  withoutRestExerciseId: string;
  restSeconds: number;
}): Promise<string> {
  const { data: r, error: e1 } = await admin
    .from("routines")
    .insert({ user_id: opts.userId, name: "Rest-timer e2e routine" })
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
      name: "Rest-timer e2e session",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`session insert: ${error?.message}`);
  return data.id as string;
}

async function seedSet(opts: {
  userId: string;
  sessionId: string;
  exerciseId: string;
  setNumber: number;
  setType?: "warmup" | "working" | "dropset";
  parentSetId?: string | null;
  completedAt?: string | null;
}): Promise<string> {
  const { data, error } = await admin
    .from("sets")
    .insert({
      user_id: opts.userId,
      session_id: opts.sessionId,
      exercise_id: opts.exerciseId,
      set_number: opts.setNumber,
      reps: 5,
      weight: "100",
      set_type: opts.setType ?? "working",
      parent_set_id: opts.parentSetId ?? null,
      completed_at: opts.completedAt ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`set insert: ${error?.message}`);
  return data.id as string;
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

async function gotoLiveSession(page: Page, sessionId: string) {
  await purgeQueryCache(page);
  await page.goto(`/(app)/workout/${sessionId}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForURL(/\/workout\/[0-9a-f-]+/, { timeout: 15_000 });
  // Wait for the live header to render (sets cache resolved).
  await expect(page.getByText("Elapsed", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  // Wait for the routine_exercises query to resolve. Every test in this spec
  // seeds a routine with two exercises ("Bench Press" + "Squat (Barbell)"); the
  // second exercise has no sets so it ONLY renders once routine_exercises
  // returns. The rest-timer auto-start handler reads `restByExercise` —
  // which is also derived from this query — so clicking before this resolves
  // would silently no-op. Anchoring on "Squat (Barbell)" makes the wait visible
  // and deterministic.
  await expect(page.getByText("Squat (Barbell)", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * Asserts the overlay is in the "Resting" (running) state.
 * The overlay flips between an idle UI (shows "Rest timer" + quick-start
 * buttons) and a running UI (shows "Resting" + countdown + Skip).
 */
async function expectOverlayRunning(page: Page) {
  await expect(page.getByText("Resting", { exact: true })).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByLabel("Stop rest timer")).toBeVisible({
    timeout: 5_000,
  });
}

async function expectOverlayIdle(page: Page) {
  // Idle state renders the "Rest timer" label (the running state replaces it
  // with "Resting"). Use a short timeout because we want to assert the absence
  // of a transient flip — the overlay should never enter running.
  await expect(page.getByText("Rest timer", { exact: true })).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByText("Resting", { exact: true })).not.toBeVisible();
  await expect(page.getByLabel("Stop rest timer")).not.toBeVisible();
}

/**
 * Reads the countdown text (e.g. "1:00") shown next to "Resting".
 * Returns the value as a total-seconds number.
 *
 * NOTE: there are TWO `m:ss`-shaped strings on the live session screen — the
 * `SessionHeader` "Elapsed" timer at the top, and the rest-timer overlay at
 * the bottom. Both match `/^\d+:\d{2}$/`. We scope by the overlay's anchor
 * label ("Resting") to be safe.
 */
async function readRemainingSeconds(page: Page): Promise<number> {
  // Find the row that contains the "Resting" label, then find the m:ss text
  // inside that same row. Walks up two parent levels: Text("Resting") →
  // flex-row container → contains Text(m:ss).
  const restingRow = page
    .getByText("Resting", { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'flex-row')][1]");
  const text = await restingRow.getByText(/^\d+:\d{2}$/).first().innerText();
  const match = text.match(/^(\d+):(\d{2})$/);
  if (!match) throw new Error(`Unexpected countdown shape: ${text}`);
  const minutes = parseInt(match[1]!, 10);
  const seconds = parseInt(match[2]!, 10);
  return minutes * 60 + seconds;
}

test.afterAll(async () => {
  await Promise.all(Array.from(createdUserIds).map(deleteUserSafe));
});

test.describe("Rest-timer auto-start on check (web)", () => {
  test("working-set check on exercise with rest configured → overlay shows countdown", async ({
    page,
  }) => {
    const email = `e2e-rest-auto-working-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      const withRest = await getSeedExerciseByName(userId, "Bench Press");
      const withoutRest = await getSeedExerciseByName(userId, "Squat (Barbell)");
      const routineId = await seedRoutineWithTwoExercises({
        userId,
        withRestExerciseId: withRest.id,
        withoutRestExerciseId: withoutRest.id,
        restSeconds: 90,
      });
      const sessionId = await startLiveSession(userId, routineId);
      await seedSet({
        userId,
        sessionId,
        exerciseId: withRest.id,
        setNumber: 1,
        setType: "working",
        completedAt: null,
      });

      await signInAndLand(page, email);
      await gotoLiveSession(page, sessionId);

      // Sanity: overlay starts idle.
      await expectOverlayIdle(page);

      // Tap the check on the unchecked working set.
      await page.getByLabel("Mark set as completed").first().click();

      // Overlay flips to running with ~90s countdown.
      await expectOverlayRunning(page);
      const remaining = await readRemainingSeconds(page);
      // 90s target; tolerate the 250ms tick boundary — see MIN-2 in the
      // file-level docblock.
      expect(remaining).toBeGreaterThanOrEqual(89);
      expect(remaining).toBeLessThanOrEqual(90);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("warmup check → overlay stays idle", async ({ page }) => {
    const email = `e2e-rest-auto-warmup-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      const withRest = await getSeedExerciseByName(userId, "Bench Press");
      const withoutRest = await getSeedExerciseByName(userId, "Squat (Barbell)");
      const routineId = await seedRoutineWithTwoExercises({
        userId,
        withRestExerciseId: withRest.id,
        withoutRestExerciseId: withoutRest.id,
        restSeconds: 60,
      });
      const sessionId = await startLiveSession(userId, routineId);
      await seedSet({
        userId,
        sessionId,
        exerciseId: withRest.id,
        setNumber: 1,
        setType: "warmup",
        completedAt: null,
      });

      await signInAndLand(page, email);
      await gotoLiveSession(page, sessionId);

      await expectOverlayIdle(page);

      // Tap the check on the warmup set.
      await page.getByLabel("Mark set as completed").first().click();

      // Wait a tick to let the mutation round-trip and any (incorrect) timer
      // start propagate; then assert overlay is still idle.
      await page.waitForTimeout(500);
      await expectOverlayIdle(page);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("dropset check → overlay stays idle", async ({ page }) => {
    const email = `e2e-rest-auto-dropset-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      const withRest = await getSeedExerciseByName(userId, "Bench Press");
      const withoutRest = await getSeedExerciseByName(userId, "Squat (Barbell)");
      const routineId = await seedRoutineWithTwoExercises({
        userId,
        withRestExerciseId: withRest.id,
        withoutRestExerciseId: withoutRest.id,
        restSeconds: 60,
      });
      const sessionId = await startLiveSession(userId, routineId);
      // Parent working set must be checked first (drop is chained off it).
      const parentSetId = await seedSet({
        userId,
        sessionId,
        exerciseId: withRest.id,
        setNumber: 1,
        setType: "working",
        completedAt: new Date().toISOString(),
      });
      // The dropset row — unchecked, so we can tap check on it.
      await seedSet({
        userId,
        sessionId,
        exerciseId: withRest.id,
        setNumber: 2,
        setType: "dropset",
        parentSetId,
        completedAt: null,
      });

      await signInAndLand(page, email);
      await gotoLiveSession(page, sessionId);

      // The parent working set is already checked (green tint); the dropset
      // is the only unchecked row → "Mark set as completed" targets the drop.
      await expectOverlayIdle(page);
      await page.getByLabel("Mark set as completed").first().click();

      await page.waitForTimeout(500);
      await expectOverlayIdle(page);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("re-check after uncheck restarts the timer with a fresh count", async ({
    page,
  }) => {
    const email = `e2e-rest-auto-recheck-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      const withRest = await getSeedExerciseByName(userId, "Bench Press");
      const withoutRest = await getSeedExerciseByName(userId, "Squat (Barbell)");
      const routineId = await seedRoutineWithTwoExercises({
        userId,
        withRestExerciseId: withRest.id,
        withoutRestExerciseId: withoutRest.id,
        restSeconds: 90,
      });
      const sessionId = await startLiveSession(userId, routineId);
      await seedSet({
        userId,
        sessionId,
        exerciseId: withRest.id,
        setNumber: 1,
        setType: "working",
        completedAt: null,
      });

      await signInAndLand(page, email);
      await gotoLiveSession(page, sessionId);

      // First check — timer fires.
      await page.getByLabel("Mark set as completed").first().click();
      await expectOverlayRunning(page);
      const first = await readRemainingSeconds(page);
      expect(first).toBeGreaterThanOrEqual(89);

      // Let the timer drain ~5s.
      await page.waitForTimeout(5_000);

      // Uncheck (no timer action by design — see [sessionId].tsx handler).
      await page.getByLabel("Unmark set as completed").first().click();
      // Wait for the uncheck refetch AND for react-native-web's Pressable
      // to re-bind its `onPress` to the post-uncheck closure. The
      // Pressable responder is updated via a useEffect (see
      // `react-native-web/dist/cjs/modules/usePressEvents/index.js`), so
      // clicking immediately after the "Mark" label becomes visible can
      // still dispatch the previous (stale) handler. The 1500ms buffer is
      // safely above the cache-refetch + commit cycle and well below a
      // realistic human rapid-tap interval — production users do not hit
      // this race, but a tightly-timed e2e click sequence can.
      await expect(
        page.getByLabel("Mark set as completed").first(),
      ).toBeVisible({ timeout: 5_000 });
      await page.waitForTimeout(1_500);

      // Re-check — timer should reset to a fresh 90s window.
      await page.getByLabel("Mark set as completed").first().click();
      await expectOverlayRunning(page);
      const fresh = await readRemainingSeconds(page);
      // MIN-2: use a `>= 59`-style tolerance for the 90s target. We drained
      // ~5s before the uncheck; if `start` did NOT overwrite, the displayed
      // remaining would be <=85. With overwrite semantics intact, it bounces
      // back up to ~90. Threshold 88 gives slack for the 250ms tick.
      expect(fresh).toBeGreaterThanOrEqual(88);
      expect(fresh).toBeLessThanOrEqual(90);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("working-set check on exercise WITHOUT rest configured → overlay stays idle", async ({
    page,
  }) => {
    const email = `e2e-rest-auto-no-target-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      const withRest = await getSeedExerciseByName(userId, "Bench Press");
      const withoutRest = await getSeedExerciseByName(userId, "Squat (Barbell)");
      const routineId = await seedRoutineWithTwoExercises({
        userId,
        withRestExerciseId: withRest.id,
        withoutRestExerciseId: withoutRest.id,
        restSeconds: 60,
      });
      const sessionId = await startLiveSession(userId, routineId);
      // Seed a working set on the no-rest exercise only.
      await seedSet({
        userId,
        sessionId,
        exerciseId: withoutRest.id,
        setNumber: 1,
        setType: "working",
        completedAt: null,
      });

      await signInAndLand(page, email);
      await gotoLiveSession(page, sessionId);

      await expectOverlayIdle(page);

      // The Squat (Barbell) block renders second (position=1 in the routine); its
      // unchecked set is the only check button. Targeting "first" works
      // because the Bench Press block has no sets yet → no check buttons there.
      await page.getByLabel("Mark set as completed").first().click();

      await page.waitForTimeout(500);
      await expectOverlayIdle(page);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("bulk Check all and finish does NOT fire the timer", async ({ page }) => {
    const email = `e2e-rest-auto-bulk-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      const withRest = await getSeedExerciseByName(userId, "Bench Press");
      const withoutRest = await getSeedExerciseByName(userId, "Squat (Barbell)");
      const routineId = await seedRoutineWithTwoExercises({
        userId,
        withRestExerciseId: withRest.id,
        withoutRestExerciseId: withoutRest.id,
        restSeconds: 90,
      });
      const sessionId = await startLiveSession(userId, routineId);
      // Two unchecked working sets on the with-rest exercise.
      await seedSet({
        userId,
        sessionId,
        exerciseId: withRest.id,
        setNumber: 1,
        setType: "working",
        completedAt: null,
      });
      await seedSet({
        userId,
        sessionId,
        exerciseId: withRest.id,
        setNumber: 2,
        setType: "working",
        completedAt: null,
      });

      // Accept the confirmDelete dialog that the bulk-check-all branch shows.
      page.on("dialog", (d) => void d.accept());

      await signInAndLand(page, email);
      await gotoLiveSession(page, sessionId);

      await expectOverlayIdle(page);

      // Tap Finish → "Some sets are unchecked" modal → "Check all and finish".
      await page.getByText("Finish", { exact: true }).last().click();
      await expect(
        page.getByText("Check all and finish", { exact: true }).first(),
      ).toBeVisible({ timeout: 10_000 });
      await page
        .getByText("Check all and finish", { exact: true })
        .last()
        .click();

      // Land on the verdict screen — confirms the bulk flow completed.
      await page.waitForURL(/\/workout\/verdict\//, { timeout: 15_000 });

      // The overlay is mounted only on the live workout screen, so by the
      // time we're on /verdict it's already unmounted. The load-bearing
      // assertion is the negation: at no point during the bulk flow did the
      // overlay flip to "Resting". We re-mount the overlay by navigating
      // back into the same session (the timer would have persisted in
      // AsyncStorage if it had fired) and confirm it's idle.
      await gotoLiveSession(page, sessionId);
      await expectOverlayIdle(page);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("MIN-1: nav-away survival — timer persists across navigation", async ({
    page,
  }) => {
    const email = `e2e-rest-auto-navaway-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      const withRest = await getSeedExerciseByName(userId, "Bench Press");
      const withoutRest = await getSeedExerciseByName(userId, "Squat (Barbell)");
      const routineId = await seedRoutineWithTwoExercises({
        userId,
        withRestExerciseId: withRest.id,
        withoutRestExerciseId: withoutRest.id,
        restSeconds: 90,
      });
      const sessionId = await startLiveSession(userId, routineId);
      await seedSet({
        userId,
        sessionId,
        exerciseId: withRest.id,
        setNumber: 1,
        setType: "working",
        completedAt: null,
      });

      await signInAndLand(page, email);
      await gotoLiveSession(page, sessionId);

      // Start the timer via check.
      await page.getByLabel("Mark set as completed").first().click();
      await expectOverlayRunning(page);
      const before = await readRemainingSeconds(page);
      expect(before).toBeGreaterThanOrEqual(89);

      // Navigate to the exercise progress screen.
      await page.goto(`/(app)/exercises/${withRest.id}/progress`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForURL(/\/exercises\/[0-9a-f-]+\/progress/, {
        timeout: 10_000,
      });

      // Wait a couple seconds so we can prove the timer kept ticking.
      await page.waitForTimeout(2_000);

      // Navigate back to the live session. AsyncStorage rehydrates the
      // running timer via use-rest-timer.ts:29-51.
      await page.goto(`/(app)/workout/${sessionId}`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForURL(/\/workout\/[0-9a-f-]+/, { timeout: 15_000 });
      await expect(page.getByText("Elapsed", { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      // Overlay still showing the countdown — and it has decremented.
      await expectOverlayRunning(page);
      const after = await readRemainingSeconds(page);
      // MIN-2: use `>= 59`-style threshold — the displayed value depends on
      // the 250ms tick boundary plus our 2s wait. We started near 90s, so
      // `after` should be in [85, 88] range, never > before.
      expect(after).toBeLessThan(before);
      expect(after).toBeGreaterThanOrEqual(80);
    } finally {
      await deleteUserSafe(userId);
    }
  });
});
