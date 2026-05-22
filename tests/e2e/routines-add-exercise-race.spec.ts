/**
 * E2E: Adding an exercise to a routine should be race-safe.
 *
 * Run-id: 2026-05-22_1640_routines-409-and-aria
 *
 * Repro: on `/routines/{id}`, the exercise picker `Pressable` had no in-flight
 * guard. A rapid double-tap on the same row fired the `addRoutineExercise`
 * mutation twice; both reads computed the same `MAX(position) + 1`; the DB
 * unique constraint `routine_exercises_routine_position_uq` rejected the second
 * insert with a `23505` and the UI surfaced a 409 toast/console error.
 *
 * Fix lives in `src/components/exercise-picker.tsx`: per-row `pickingId` state
 * disables further taps (and other rows) while a pick is in flight.
 *
 * What we assert here:
 *   1. Two near-simultaneous clicks on the same picker row result in EXACTLY
 *      ONE POST to `/rest/v1/routine_exercises` (the second click is debounced
 *      out by the in-flight guard).
 *   2. No 4xx response is observed on that endpoint during the race window.
 *   3. The routine has exactly +1 row in `routine_exercises` after the race
 *      (verified via admin client against the DB).
 */

import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

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
  if (error || !data.user) throw new Error(`createConfirmedUser: ${error?.message}`);
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
    timeout: 10_000,
  });
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByText("Sign in", { exact: true }).last().click();
  await page.waitForURL(/\/workout/, { timeout: 15_000 });
}

async function seedRoutine(
  userId: string,
  name: string,
): Promise<string> {
  const { data, error } = await admin
    .from("routines")
    .insert({ user_id: userId, name })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedRoutine: ${error?.message}`);
  return data.id as string;
}

async function countRoutineExercises(routineId: string): Promise<number> {
  const { count, error } = await admin
    .from("routine_exercises")
    .select("*", { count: "exact", head: true })
    .eq("routine_id", routineId)
    .is("deleted_at", null);
  if (error) throw error;
  return count ?? 0;
}

test.afterAll(async () => {
  await Promise.all(Array.from(createdUserIds).map(deleteUserSafe));
});

test.describe("Exercise picker race (web)", () => {
  test("rapid double-click on the same row fires only one POST and inserts one row", async ({
    page,
  }) => {
    const email = `e2e-picker-race-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const routineName = `Race Routine ${Date.now()}`;
    const routineId = await seedRoutine(userId, routineName);

    // Track network calls to /rest/v1/routine_exercises (POST inserts only).
    const inserts: { status: number; url: string }[] = [];
    page.on("response", async (resp) => {
      const req = resp.request();
      if (
        req.method() === "POST" &&
        /\/rest\/v1\/routine_exercises\b/.test(resp.url())
      ) {
        inserts.push({ status: resp.status(), url: resp.url() });
      }
    });

    try {
      await signInAndLand(page, email);

      // Navigate directly to the routine detail page.
      await page.goto(`/routines/${routineId}`, { waitUntil: "domcontentloaded" });
      await page.waitForURL(new RegExp(`/routines/${routineId}$`), {
        timeout: 10_000,
      });

      // Wait for the routine builder to render — "Exercises" header is the marker.
      await expect(page.getByText("Exercises", { exact: true }).first()).toBeVisible({
        timeout: 10_000,
      });

      // Open the picker.
      await page.getByLabel("Add exercise").click();
      await expect(page.getByText("Pick exercise")).toBeVisible({
        timeout: 10_000,
      });

      // Narrow the list down to a single exercise so the row is unambiguous.
      // The seed trigger inserts a known set of lifts including "Bench Press".
      await page
        .getByPlaceholder("Search by name, muscle, equipment")
        .fill("Bench Press");

      const target = page.getByText("Bench Press", { exact: true }).first();
      await expect(target).toBeVisible({ timeout: 5_000 });

      // Race the row: fire two clicks back-to-back without awaiting between
      // them. The first should set pickingId; the second must be debounced.
      await Promise.all([target.click(), target.click()]);

      // The picker closes on success (the caller's onPick sets pickerOpen=false).
      await expect(page.getByText("Pick exercise")).not.toBeVisible({
        timeout: 10_000,
      });

      // Give the (potential) second request a chance to land if the guard
      // were broken — settle on idle network before asserting.
      await page.waitForLoadState("networkidle");

      // ---- Assertions ----

      // Exactly one POST hit the inserts endpoint.
      expect(
        inserts.length,
        `expected exactly 1 POST to /routine_exercises, got ${inserts.length}: ${JSON.stringify(inserts)}`,
      ).toBe(1);

      // That single POST succeeded (no 409 from the DB unique constraint).
      expect(inserts[0]?.status, "POST status").toBeGreaterThanOrEqual(200);
      expect(inserts[0]?.status, "POST status").toBeLessThan(300);

      // DB state: exactly one routine_exercises row inserted.
      const rowCount = await countRoutineExercises(routineId);
      expect(rowCount, "row count in routine_exercises").toBe(1);
    } finally {
      await deleteUserSafe(userId);
    }
  });
});
