/**
 * E2E for the soft-deleted-session volume leak
 * (run 2026-05-25_0933_soft-deleted-session-volume-leak).
 *
 * Pins the bug class: three Supabase SELECT call sites in
 * `src/api/{stats,progress,sets}.ts` joined `sets → sessions!inner` without
 * filtering on `sessions.deleted_at IS NULL`. Soft-deleting a session via
 * `softDeleteSession` only flips `sessions.deleted_at`; without the joined-
 * table filter, every derived surface (weekly volume strip, Progress hero,
 * History header, week drill-down, verdict PR list, exercises-this-week list,
 * per-exercise progress chart, `<VolumeTargetSlot>`, auto-fill placeholder)
 * keeps reading the deleted session's rows.
 *
 * Tests below mirror the admin-seed + deep-link pattern proven stable in
 * `tests/e2e/exercise-note.spec.ts` test #3 / `read-only-history.spec.ts:82-151`.
 * No live-workout UI flow — that path primes the in-memory React Query cache
 * before the admin soft-delete lands and causes flake.
 *
 * Coverage:
 *   1. Variant A (single session): seed 1 finished session this week (1,500 kg),
 *      admin soft-delete it, clear persisted cache + reload, navigate to
 *      /progress, assert hero shows 0 kg and weekly strip is hidden.
 *   2. Variant B (survivor + deleted): seed survivor (100 kg) + doomed
 *      (1,500 kg), admin soft-delete the doomed one, clear cache + reload,
 *      navigate to /history, assert THIS WEEK = 100 kg.
 *   3. Per-exercise progress chart: variant A's leak surfaces on the
 *      per-exercise progress page too — after delete, the page must not
 *      surface the 1,500 kg session.
 *   4. `getLastWorkingSetForExercise`: with a soft-deleted session as the
 *      ONLY history, the auto-fill must not leak the deleted weight into a
 *      new live session's set placeholder.
 *
 * Tests #3 and #4 cover `src/api/progress.ts` and `src/api/sets.ts`
 * respectively. Tests #1 and #2 cover `src/api/stats.ts` (both branches —
 * lifetime paginated read for the strip).
 */

import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

import { pickCanonicalExercise } from "./_helpers/canonical-exercise";

dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE) {
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
  if (error || !data.user) {
    throw new Error(`createConfirmedUser: ${error?.message}`);
  }
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

async function pickSeedExercise(
  _userId: string,
): Promise<{ id: string; name: string }> {
  return pickCanonicalExercise(admin, "Bench Press");
}

/**
 * Admin-seed an ended finished session in the current ISO week with N working
 * sets of `weight` × `reps`. Returns the seeded session id so the caller can
 * later admin-soft-delete it. Pattern lifted from weekly-volume-strip.spec.ts.
 */
async function seedFinishedSession(opts: {
  userId: string;
  exerciseId: string;
  endedAt: Date;
  workingSets: number;
  weight: number;
  reps: number;
}): Promise<string> {
  const { userId, exerciseId, endedAt, workingSets, weight, reps } = opts;
  const startedAt = new Date(endedAt.getTime() - 60 * 60 * 1000);
  const { data: sess, error: sessErr } = await admin
    .from("sessions")
    .insert({
      user_id: userId,
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
    })
    .select("id")
    .single();
  if (sessErr || !sess) throw new Error(`session insert: ${sessErr?.message}`);
  const sessionId = sess.id as string;

  const setRows = Array.from({ length: workingSets }).map((_, i) => ({
    user_id: userId,
    session_id: sessionId,
    exercise_id: exerciseId,
    set_number: i + 1,
    reps,
    weight: weight.toString(),
    set_type: "working",
    completed_at: new Date(
      endedAt.getTime() - (workingSets - i) * 60 * 1000,
    ).toISOString(),
  }));
  const { error: setsErr } = await admin.from("sets").insert(setRows);
  if (setsErr) throw new Error(`sets insert: ${setsErr.message}`);
  return sessionId;
}

async function softDeleteSessionAdmin(sessionId: string): Promise<void> {
  const { error } = await admin
    .from("sessions")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) throw new Error(`softDeleteSessionAdmin: ${error.message}`);
}

/**
 * Clear the persisted React Query cache so the next mount of any query
 * does NOT rehydrate from localStorage — forces a fresh fetch.
 */
async function purgeQueryCache(page: Page) {
  await page.evaluate(() => {
    window.localStorage.removeItem("ada11-query-cache");
  });
}

test.afterAll(async () => {
  await Promise.all(Array.from(createdUserIds).map(deleteUserSafe));
});

test.describe("Soft-deleted session volume leak (web)", () => {
  test("variant A: single seeded session soft-deleted leaves Progress empty", async ({
    page,
  }) => {
    const email = `e2e-softdel-variantA-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exercise = await pickSeedExercise(userId);

    // Seed one session this week: 5 × 100 × 3 = 1,500 kg.
    const endedAt = new Date(Date.now() - 30 * 60 * 1000);
    const sessionId = await seedFinishedSession({
      userId,
      exerciseId: exercise.id,
      endedAt,
      workingSets: 5,
      weight: 100,
      reps: 3,
    });

    try {
      await signInAndLand(page, email);

      // Baseline: Progress shows 1,500 kg before the delete.
      await page.goto("/progress", { waitUntil: "domcontentloaded" });
      await expect(page.getByText("1,500 kg").first()).toBeVisible({
        timeout: 15_000,
      });

      // Admin soft-delete the session — mirrors useSoftDeleteSession contract.
      await softDeleteSessionAdmin(sessionId);

      // Purge persisted cache + reload to force a fresh fetch (matches the
      // repro: the cold path was leaking even after cache purge, because the
      // server-side SELECTs themselves were broken).
      await purgeQueryCache(page);
      await page.reload({ waitUntil: "domcontentloaded" });

      // Wait for navigation/auth to settle, then re-land on Progress.
      await page.waitForURL(/\/(workout|progress|history)/, {
        timeout: 15_000,
      });
      await page.goto("/progress", { waitUntil: "domcontentloaded" });

      // After fix: hero reads `Max 0 kg · Now 0 kg · To PR 0 kg`. Weekly volume
      // strip returns null when every bucket is zero — "This week" must not
      // appear (the strip is the only surface that renders that label).
      await expect(page.getByText("1,500 kg")).toHaveCount(0, {
        timeout: 15_000,
      });
      await expect(
        page.getByText("This week", { exact: true }),
      ).toHaveCount(0, { timeout: 5_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("variant B: survivor + deleted leaves History THIS WEEK = survivor only", async ({
    page,
  }) => {
    const email = `e2e-softdel-variantB-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exercise = await pickSeedExercise(userId);

    // Seed two sessions today on the same exercise:
    //   survivor: 1 × 100 × 1 = 100 kg
    //   doomed:   5 × 100 × 3 = 1,500 kg
    // Total before delete = 1,600 kg; after delete = 100 kg.
    const survivorEndedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await seedFinishedSession({
      userId,
      exerciseId: exercise.id,
      endedAt: survivorEndedAt,
      workingSets: 1,
      weight: 100,
      reps: 1,
    });
    const doomedEndedAt = new Date(Date.now() - 30 * 60 * 1000);
    const doomedId = await seedFinishedSession({
      userId,
      exerciseId: exercise.id,
      endedAt: doomedEndedAt,
      workingSets: 5,
      weight: 100,
      reps: 3,
    });

    try {
      await signInAndLand(page, email);

      // Baseline: History strip reads 1,600 kg.
      await page.goto("/history", { waitUntil: "domcontentloaded" });
      await expect(page.getByText("1,600 kg").first()).toBeVisible({
        timeout: 15_000,
      });

      // Admin soft-delete the doomed session.
      await softDeleteSessionAdmin(doomedId);

      // Purge persisted cache + reload.
      await purgeQueryCache(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForURL(/\/(workout|progress|history)/, {
        timeout: 15_000,
      });
      await page.goto("/history", { waitUntil: "domcontentloaded" });

      // After fix: THIS WEEK reflects ONLY the survivor (100 kg).
      await expect(page.getByText("100 kg").first()).toBeVisible({
        timeout: 15_000,
      });
      // The doomed session's 1,600 kg total must NOT appear anywhere.
      await expect(page.getByText("1,600 kg")).toHaveCount(0, {
        timeout: 5_000,
      });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("per-exercise progress chart drops the soft-deleted session", async ({
    page,
  }) => {
    const email = `e2e-softdel-progress-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exercise = await pickSeedExercise(userId);

    // Seed exactly one session on the exercise (1,500 kg).
    const endedAt = new Date(Date.now() - 30 * 60 * 1000);
    const sessionId = await seedFinishedSession({
      userId,
      exerciseId: exercise.id,
      endedAt,
      workingSets: 5,
      weight: 100,
      reps: 3,
    });

    try {
      await signInAndLand(page, email);

      // Baseline: the per-exercise progress page surfaces the 1,500 kg
      // session somewhere (chart series + sessions list).
      await page.goto(`/exercises/${exercise.id}/progress`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByText("1,500 kg").first()).toBeVisible({
        timeout: 15_000,
      });

      // Admin soft-delete.
      await softDeleteSessionAdmin(sessionId);

      // Purge cache + reload so `listSetsForExercise` re-fetches against the
      // server — the fix lives in the SELECT, not in cache invalidation here
      // (defect A invalidation covers the WARM path; this test exercises the
      // COLD path).
      await purgeQueryCache(page);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForURL(/\/(workout|progress|history|exercises)/, {
        timeout: 15_000,
      });
      await page.goto(`/exercises/${exercise.id}/progress`, {
        waitUntil: "domcontentloaded",
      });

      // After fix: the 1,500 kg total must NOT surface anywhere on the page.
      await expect(page.getByText("1,500 kg")).toHaveCount(0, {
        timeout: 15_000,
      });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("auto-fill placeholder does not leak from soft-deleted session", async ({
    page,
  }) => {
    const email = `e2e-softdel-autofill-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exercise = await pickSeedExercise(userId);

    // Seed exactly one session with a working set 100 × 3.
    const endedAt = new Date(Date.now() - 60 * 60 * 1000);
    const sessionId = await seedFinishedSession({
      userId,
      exerciseId: exercise.id,
      endedAt,
      workingSets: 1,
      weight: 100,
      reps: 3,
    });

    // Soft-delete BEFORE the user signs in / starts a workout so the live
    // workout's `getLastWorkingSetForExercise` query has no warm cache. This
    // exercises the cold path of the `src/api/sets.ts:187` fix.
    await softDeleteSessionAdmin(sessionId);

    try {
      await signInAndLand(page, email);

      // Start a fresh workout via the "Quick start workout" affordance.
      await page.getByText("Quick start workout").last().click();
      await page.waitForURL(/\/workout\/[0-9a-f-]+/, { timeout: 15_000 });

      // Add the exercise that has the deleted-session history.
      await page.getByText("Add exercise", { exact: true }).first().click();
      await expect(page.getByText("Pick exercise")).toBeVisible({
        timeout: 10_000,
      });
      await page
        .getByPlaceholder("Search by name, muscle, equipment")
        .fill(exercise.name);
      await page.getByText(exercise.name, { exact: true }).first().click();
      await expect(page.getByText("Pick exercise")).not.toBeVisible({
        timeout: 10_000,
      });

      // After fix: with no non-deleted prior history, the placeholder must
      // not leak the deleted 100 / 3 default. We assert by inspecting every
      // text input on the page — none should hold "100" or "3" as a value
      // (the only seeded numbers).
      //
      // The set row inputs render via react-native-web as <input>; their
      // `value` is the committed numeric draft, and a leaking placeholder
      // would also bind via `defaultValue`. We sweep both.
      await page.waitForTimeout(1000); // allow `useLastWorkingSet` to settle
      const inputCount = await page.locator("input").count();
      for (let i = 0; i < inputCount; i++) {
        const input = page.locator("input").nth(i);
        const value = await input.inputValue().catch(() => "");
        // The leaked placeholder would surface as "100" (weight) or "3"
        // (reps) in the very first working-set row's inputs.
        expect(value).not.toBe("100");
        expect(value).not.toBe("3");
      }
    } finally {
      await deleteUserSafe(userId);
    }
  });
});
