/**
 * E2E: back navigation from the per-exercise progress screen.
 *
 * The progress route lives in the `exercises` tab, so opening it from another
 * tab (the live workout) and tapping the header back button used to pop the
 * exercises stack → the exercises list, instead of returning to the session.
 * Fix: the workout passes a `backHref` and the progress screen renders a
 * custom back button that navigates to that origin.
 *
 * This covers the reported case: tap an exercise NAME inside a live session →
 * progress screen → header back → must land back on the SAME session.
 */

import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

import { pickCanonicalExercise } from "./_helpers/canonical-exercise";

dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  throw new Error(
    "Missing Supabase env vars. Source .env.local before running playwright.",
  );
}

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PASSWORD = "test-password-123";

async function createConfirmedUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user)
    throw new Error(`createConfirmedUser: ${error?.message}`);
  return data.user.id;
}

async function deleteUserSafe(userId: string) {
  try {
    await admin.auth.admin.deleteUser(userId);
  } catch {
    // best-effort
  }
}

async function seedRoutineWithTwoExercises(opts: {
  userId: string;
  exA: string;
  exB: string;
}): Promise<string> {
  const { data: r, error: e1 } = await admin
    .from("routines")
    .insert({ user_id: opts.userId, name: "Back-nav e2e routine" })
    .select("id")
    .single();
  if (e1 || !r) throw new Error(`routine insert: ${e1?.message}`);

  const { error: e2 } = await admin.from("routine_exercises").insert([
    { user_id: opts.userId, routine_id: r.id, exercise_id: opts.exA, position: 0 },
    { user_id: opts.userId, routine_id: r.id, exercise_id: opts.exB, position: 1 },
  ]);
  if (e2) throw new Error(`routine_exercises insert: ${e2.message}`);
  return r.id as string;
}

async function startLiveSession(
  userId: string,
  routineId: string,
): Promise<string> {
  const { data, error } = await admin
    .from("sessions")
    .insert({
      user_id: userId,
      routine_id: routineId,
      started_at: new Date().toISOString(),
      ended_at: null,
      name: "Back-nav e2e session",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`session insert: ${error?.message}`);
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

async function gotoLiveSession(page: Page, sessionId: string, secondName: string) {
  await page.evaluate(() =>
    window.localStorage.removeItem("ada11-query-cache"),
  );
  await page.goto(`/(app)/workout/${sessionId}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForURL(/\/workout\/[0-9a-f-]+/, { timeout: 15_000 });
  await expect(page.getByText("Elapsed", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  // Both routine exercises render once routine_exercises resolves.
  await expect(page.getByText(secondName, { exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("Exercise progress back navigation", () => {
  test("from a live session, header back returns to the session — not the exercises list", async ({
    page,
  }) => {
    const email = `e2e-progress-backnav-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      const exA = await pickCanonicalExercise(admin, "Bench Press");
      const exB = await pickCanonicalExercise(admin, "Squat (Barbell)");
      const routineId = await seedRoutineWithTwoExercises({
        userId,
        exA: exA.id,
        exB: exB.id,
      });
      const sessionId = await startLiveSession(userId, routineId);

      await signInAndLand(page, email);
      await gotoLiveSession(page, sessionId, exB.name);

      // Tap the exercise NAME → its progress screen (carries backHref).
      await page.getByLabel(`View progress for ${exA.name}`).click();
      await page.waitForURL(/\/exercises\/[0-9a-f-]+\/progress/, {
        timeout: 15_000,
      });

      // Tap the in-app header back button → must come back to THIS session,
      // not the exercises list.
      await page.getByLabel("Go back").click();
      await expect(page).toHaveURL(new RegExp(`/workout/${sessionId}`), {
        timeout: 15_000,
      });
      await expect(page.getByText("Elapsed", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await deleteUserSafe(userId);
    }
  });
});
