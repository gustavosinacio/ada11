/**
 * E2E: Read-only history detail view + Edit toggle.
 *
 * Run-id: 2026-05-23_1855_read-only-history-view
 *
 * Drives the screen-level read-only/edit toggle on `app/(app)/history/[id]`:
 *
 *   1. Default render is read-only: no `<TextInput>` for weight/reps, no
 *      "Open set details" trigger, no per-set trash, no "+ Working set", no
 *      "Add exercise", no "Delete workout", no session-name `<TextInput>`.
 *      Time-edit pencil (`Edit start and end times`) IS still present and
 *      tappable (independent of this toggle by prompt directive).
 *   2. Tap the header Pencil (`Edit workout`) → header swaps to "Done"
 *      (`Exit edit mode`) and every editable affordance appears.
 *   3. Tap "Done" → screen reverts to read-only + Pencil.
 *   4. MAJ-2 regression guard: enter Edit, type a new value into a reps
 *      `<TextInput>`, tap Done → re-enter Edit → the new value persists
 *      (proves `Keyboard.dismiss()` fires the on-blur commit before unmount).
 *   5. Per-screen scope: enabling Edit unlocks all blocks at once.
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
    timeout: 10_000,
  });
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByText("Sign in", { exact: true }).last().click();
  await page.waitForURL(/\/workout/, { timeout: 15_000 });
}

/**
 * Seed an ended session with two exercises (each with one logged set) so we
 * can deep-link to /history/<id> without the live-workout flow.
 */
async function seedEndedSessionWithTwoBlocks(
  userId: string,
): Promise<{ sessionId: string; setOneId: string; setTwoId: string }> {
  const now = new Date();
  const startedAt = new Date(now.getTime() - 60 * 60 * 1000);
  const endedAt = new Date(now.getTime() - 30 * 60 * 1000);

  const { data: sess, error: sessErr } = await admin
    .from("sessions")
    .insert({
      user_id: userId,
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      name: "Read-only target",
    })
    .select("id")
    .single();
  if (sessErr || !sess) throw new Error(`session seed: ${sessErr?.message}`);

  // Exercises now live in a shared canonical catalog (user_id IS NULL,
  // visible via RLS to every authenticated user). Helper-shaped equivalent
  // would need a 2-row variant; inline-filtering on `user_id IS NULL` keeps
  // the `.limit(2)` shape unchanged.
  const { data: exRows, error: exErr } = await admin
    .from("exercises")
    .select("id, name")
    .is("user_id", null)
    .is("deleted_at", null)
    .order("name")
    .limit(2);
  if (exErr || !exRows || exRows.length < 2)
    throw new Error(`seed exercise lookup: ${exErr?.message}`);

  const [ex1, ex2] = exRows;
  if (!ex1 || !ex2) throw new Error("seed exercises missing");

  const { data: set1, error: set1Err } = await admin
    .from("sets")
    .insert({
      user_id: userId,
      session_id: sess.id,
      exercise_id: ex1.id,
      set_number: 1,
      reps: 8,
      weight: "100",
      set_type: "working",
      completed_at: endedAt.toISOString(),
    })
    .select("id")
    .single();
  if (set1Err || !set1) throw new Error(`seed set1: ${set1Err?.message}`);

  const { data: set2, error: set2Err } = await admin
    .from("sets")
    .insert({
      user_id: userId,
      session_id: sess.id,
      exercise_id: ex2.id,
      set_number: 1,
      reps: 10,
      weight: "60",
      set_type: "working",
      completed_at: endedAt.toISOString(),
    })
    .select("id")
    .single();
  if (set2Err || !set2) throw new Error(`seed set2: ${set2Err?.message}`);

  return {
    sessionId: sess.id,
    setOneId: set1.id,
    setTwoId: set2.id,
  };
}

test.afterAll(async () => {
  await Promise.all(Array.from(createdUserIds).map(deleteUserSafe));
});

test.describe("Read-only history detail (web)", () => {
  test("(1) default render is read-only: no inputs, no trash, no add-set, no add-exercise, no delete-workout, no session-name edit", async ({
    page,
  }) => {
    const email = `e2e-ro-default-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);

    try {
      const { sessionId } = await seedEndedSessionWithTwoBlocks(userId);
      await signInAndLand(page, email);

      await page.goto(`/history/${sessionId}`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForURL(new RegExp(`/history/${sessionId}$`), {
        timeout: 10_000,
      });
      // Wait for the screen body to settle.
      await expect(page.getByText("Read-only target").first()).toBeVisible({
        timeout: 10_000,
      });

      // --- Header right slot: Pencil present, "Done" absent. ---
      await expect(page.getByLabel("Edit workout")).toHaveCount(1);
      await expect(page.getByLabel("Exit edit mode")).toHaveCount(0);

      // --- Time-edit pencil stays present (independent of body toggle). ---
      await expect(page.getByLabel("Edit start and end times")).toHaveCount(1);

      // --- Per-row affordances absent. ---
      // No weight/reps inputs. Web maps RN's `keyboardType="decimal-pad"` to
      // `inputmode="decimal"` and `"number-pad"` to `inputmode="numeric"`.
      await expect(page.locator('input[inputmode="decimal"]')).toHaveCount(0);
      await expect(page.locator('input[inputmode="numeric"]')).toHaveCount(0);
      // No per-row trash, no menu trigger.
      await expect(page.getByLabel("Delete set")).toHaveCount(0);
      await expect(page.getByLabel("Open set details")).toHaveCount(0);

      // --- Block / screen footers absent. ---
      await expect(
        page.getByText("+ Working set", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText("Add exercise", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText("Delete workout", { exact: true }),
      ).toHaveCount(0);

      // --- Session-name input absent (rendered as static text). ---
      await expect(page.getByPlaceholder("Workout")).toHaveCount(0);
      // The static name renders verbatim.
      await expect(page.getByText("Read-only target").first()).toBeVisible();
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("(2) tap Pencil → header swaps to Done + editable affordances appear", async ({
    page,
  }) => {
    const email = `e2e-ro-enter-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);

    try {
      const { sessionId } = await seedEndedSessionWithTwoBlocks(userId);
      await signInAndLand(page, email);

      await page.goto(`/history/${sessionId}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByText("Read-only target").first()).toBeVisible({
        timeout: 10_000,
      });

      // Enter edit mode.
      await page.getByLabel("Edit workout").click();

      // Header swap.
      await expect(page.getByLabel("Exit edit mode")).toHaveCount(1);
      await expect(page.getByLabel("Edit workout")).toHaveCount(0);

      // Time-edit pencil still present (independent).
      await expect(page.getByLabel("Edit start and end times")).toHaveCount(1);

      // Per-row + footer affordances appear.
      // Two sets seeded → two weight inputs, two reps inputs.
      await expect(page.locator('input[inputmode="decimal"]')).toHaveCount(2);
      await expect(page.locator('input[inputmode="numeric"]')).toHaveCount(2);
      await expect(page.getByLabel("Delete set")).toHaveCount(2);
      await expect(page.getByLabel("Open set details")).toHaveCount(2);
      // "+ Working set" footer renders once per block (2 blocks seeded).
      await expect(
        page.getByText("+ Working set", { exact: true }),
      ).toHaveCount(2);
      // Screen footers appear.
      await expect(
        page.getByText("Add exercise", { exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByText("Delete workout", { exact: true }).first(),
      ).toBeVisible();
      // Session-name input renders.
      await expect(page.getByPlaceholder("Workout").first()).toBeVisible();
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("(3) tap Done → revert to read-only + Pencil", async ({ page }) => {
    const email = `e2e-ro-exit-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);

    try {
      const { sessionId } = await seedEndedSessionWithTwoBlocks(userId);
      await signInAndLand(page, email);

      await page.goto(`/history/${sessionId}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByText("Read-only target").first()).toBeVisible({
        timeout: 10_000,
      });

      await page.getByLabel("Edit workout").click();
      await expect(page.getByLabel("Exit edit mode")).toHaveCount(1);

      // Tap Done.
      await page.getByLabel("Exit edit mode").click();

      // Back to read-only.
      await expect(page.getByLabel("Edit workout")).toHaveCount(1);
      await expect(page.getByLabel("Exit edit mode")).toHaveCount(0);
      // Editable affordances gone again.
      await expect(page.locator('input[inputmode="decimal"]')).toHaveCount(0);
      await expect(page.locator('input[inputmode="numeric"]')).toHaveCount(0);
      await expect(page.getByLabel("Delete set")).toHaveCount(0);
      await expect(
        page.getByText("+ Working set", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText("Add exercise", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText("Delete workout", { exact: true }),
      ).toHaveCount(0);
      await expect(page.getByPlaceholder("Workout")).toHaveCount(0);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("(4) MAJ-2: edit a value, tap Done, re-enter Edit → edited value persists (Keyboard.dismiss blur path)", async ({
    page,
  }) => {
    const email = `e2e-ro-keepkeystroke-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);

    try {
      const { sessionId } = await seedEndedSessionWithTwoBlocks(userId);
      await signInAndLand(page, email);

      await page.goto(`/history/${sessionId}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByText("Read-only target").first()).toBeVisible({
        timeout: 10_000,
      });

      // Enter edit mode.
      await page.getByLabel("Edit workout").click();
      await expect(page.getByLabel("Exit edit mode")).toHaveCount(1);

      // Edit reps on the first block: change "8" → "12".
      const repsInputs = page.locator('input[inputmode="numeric"]');
      await expect(repsInputs).toHaveCount(2);
      const firstReps = repsInputs.first();
      await firstReps.click();
      // Select all current content (web) and type the replacement, leaving
      // the field focused on purpose — Done must still commit via the blur
      // path triggered on unmount/`Keyboard.dismiss`.
      await firstReps.fill("12");

      // Tap Done without first blurring the input. This exercises the
      // MAJ-2 mitigation: `Keyboard.dismiss()` runs before
      // `setIsEditing(false)`, firing `<SetInput>`'s `onBlur=commit`
      // before unmount.
      await page.getByLabel("Exit edit mode").click();
      await expect(page.getByLabel("Edit workout")).toHaveCount(1);

      // Re-enter Edit and assert the new value is what the field renders.
      await page.getByLabel("Edit workout").click();
      await expect(page.getByLabel("Exit edit mode")).toHaveCount(1);

      const repsInputsAgain = page.locator('input[inputmode="numeric"]');
      await expect(repsInputsAgain).toHaveCount(2);
      // Field value preserved — proves the on-blur commit fired.
      await expect(repsInputsAgain.first()).toHaveValue("12");
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("(5) per-screen scope: enabling Edit unlocks all blocks at once", async ({
    page,
  }) => {
    const email = `e2e-ro-scope-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);

    try {
      const { sessionId } = await seedEndedSessionWithTwoBlocks(userId);
      await signInAndLand(page, email);

      await page.goto(`/history/${sessionId}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByText("Read-only target").first()).toBeVisible({
        timeout: 10_000,
      });

      // Read-only: zero inputs across both blocks.
      await expect(page.locator('input[inputmode="decimal"]')).toHaveCount(0);
      await expect(page.locator('input[inputmode="numeric"]')).toHaveCount(0);

      await page.getByLabel("Edit workout").click();
      await expect(page.getByLabel("Exit edit mode")).toHaveCount(1);

      // One <SetInput> per seeded set across both blocks → 2 weight and 2
      // reps inputs, plus a "+ Working set" footer per block.
      await expect(page.locator('input[inputmode="decimal"]')).toHaveCount(2);
      await expect(page.locator('input[inputmode="numeric"]')).toHaveCount(2);
      await expect(
        page.getByText("+ Working set", { exact: true }),
      ).toHaveCount(2);
      await expect(page.getByLabel("Delete set")).toHaveCount(2);
    } finally {
      await deleteUserSafe(userId);
    }
  });
});
