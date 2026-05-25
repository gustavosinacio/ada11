/**
 * E2E: Remove exercise from live workout session.
 *
 * Run-id: 2026-05-20_1657_remove-exercise-from-session
 *
 * Drives:
 *  - Quick-start workout, add two ad-hoc exercises via picker.
 *  - Log a set on the first exercise; wait for it to render.
 *  - Tap the trash on the first (with sets) — confirm dialog mentions name + "1 logged set",
 *    accept → block disappears, picker re-exposes the exercise.
 *  - Tap the trash on the second (zero sets) — confirm dialog mentions name + "This exercise
 *    will be removed", accept → block disappears.
 *  - Empty-state copy appears + "Add exercise" button still present.
 *  - Finish session, go to History detail by direct deep-link to /history/<sessionId> →
 *    no trash icons rendered (history detail does not pass onRemove).
 *  - Cancel path: dismiss dialog → block stays.
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

async function addExerciseFromPicker(page: Page, name: string) {
  await page.getByText("Add exercise", { exact: true }).click();
  await expect(page.getByText("Pick exercise")).toBeVisible({ timeout: 10_000 });
  await page.getByPlaceholder("Search by name, muscle, equipment").fill(name);
  await page.getByText(name, { exact: true }).first().click();
  await expect(page.getByText("Pick exercise")).not.toBeVisible({ timeout: 10_000 });
}

function sessionIdFromUrl(url: string): string | null {
  const m = url.match(/\/workout\/([0-9a-f-]+)/);
  return m ? (m[1] ?? null) : null;
}

test.afterAll(async () => {
  await Promise.all(Array.from(createdUserIds).map(deleteUserSafe));
});

test.describe("Remove exercise from session (web)", () => {
  test("golden + edge: removes-with-sets, removes-without-sets, empty state, history hides", async ({
    page,
  }) => {
    const email = `e2e-remove-exercise-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);

    try {
      await signInAndLand(page, email);

      // Quick start an ad-hoc workout.
      await expect(page.getByText("Quick start workout").last()).toBeVisible({
        timeout: 10_000,
      });
      await page.getByText("Quick start workout").last().click();
      await page.waitForURL(/\/workout\/[0-9a-f-]+/, { timeout: 15_000 });
      await expect(page.getByText("Elapsed", { exact: true })).toBeVisible();

      const sessionId = sessionIdFromUrl(page.url());
      if (!sessionId) throw new Error("could not extract sessionId from URL");

      // Add two ad-hoc exercises.
      await addExerciseFromPicker(page, "Bench Press");
      await addExerciseFromPicker(page, "Back Squat");

      // Confirm trash icons present for both blocks.
      const benchTrash = page.getByLabel("Remove Bench Press from workout");
      const squatTrash = page.getByLabel("Remove Back Squat from workout");
      await expect(benchTrash).toBeVisible({ timeout: 5_000 });
      await expect(squatTrash).toBeVisible({ timeout: 5_000 });

      // Log one working set on Bench Press (added first → its "+ Working set" is the first).
      // Wait for the set row to actually render (per-row Delete-set button appears).
      await page.getByText("+ Working set", { exact: true }).first().click();
      await expect(page.getByLabel("Delete set").first()).toBeVisible({ timeout: 10_000 });

      // ---- Remove Bench Press (has 1 logged set) ----
      let benchDialogMessage = "";
      page.once("dialog", (d) => {
        benchDialogMessage = d.message();
        void d.accept();
      });
      await benchTrash.click();
      await expect(benchTrash).toBeHidden({ timeout: 5_000 });

      expect(benchDialogMessage).toContain("Remove Bench Press?");
      expect(benchDialogMessage).toContain("1 logged set");

      // Picker should re-expose Bench Press (it was excluded; now selectable again).
      await page.getByText("Add exercise", { exact: true }).click();
      await page.getByPlaceholder("Search by name, muscle, equipment").fill("Bench Press");
      // "added" label is the marker for already-included rows; assert it's NOT there.
      await expect(page.getByText("added", { exact: true })).not.toBeVisible({
        timeout: 3_000,
      });
      await page.getByLabel("Close").click();
      await expect(page.getByText("Pick exercise")).not.toBeVisible({ timeout: 5_000 });

      // ---- Remove Back Squat (zero logged sets) ----
      let squatDialogMessage = "";
      page.once("dialog", (d) => {
        squatDialogMessage = d.message();
        void d.accept();
      });
      await squatTrash.click();
      await expect(squatTrash).toBeHidden({ timeout: 5_000 });

      expect(squatDialogMessage).toContain("Remove Back Squat?");
      expect(squatDialogMessage).toContain("This exercise will be removed");
      // Should NOT contain the "logged sets" copy.
      expect(squatDialogMessage).not.toContain("logged set");

      // ---- Empty-state copy + Add exercise button still works ----
      await expect(
        page.getByText("No exercises in this session yet. Add one to start logging."),
      ).toBeVisible({ timeout: 5_000 });
      await expect(page.getByText("Add exercise", { exact: true })).toBeVisible();

      // ---- Finish the session ----
      page.once("dialog", (d) => void d.accept());
      await page.getByText("Finish", { exact: true }).last().click();
      // Finish lands on the verdict screen (added by the end-of-session-verdict
      // feature); the test only needs to confirm Finish succeeded before
      // deep-linking elsewhere, so the verdict URL is enough.
      await page.waitForURL(/\/workout\/verdict\//, { timeout: 10_000 });

      // ---- History detail via deep-link: no trash icons rendered ----
      await page.goto(`/history/${sessionId}`, { waitUntil: "domcontentloaded" });
      await page.waitForURL(new RegExp(`/history/${sessionId}$`), { timeout: 10_000 });
      // Give the detail screen a moment to render queries (exercises + sets).
      await page.waitForTimeout(1000);

      // Trash icons absent in history detail.
      await expect(
        page.getByLabel(/^Remove .* from workout$/),
      ).toHaveCount(0);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("cancel: dialog cancel keeps the exercise present", async ({ page }) => {
    const email = `e2e-remove-cancel-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);

    try {
      await signInAndLand(page, email);
      await page.getByText("Quick start workout").last().click();
      await page.waitForURL(/\/workout\/[0-9a-f-]+/, { timeout: 15_000 });

      await addExerciseFromPicker(page, "Bench Press");
      const benchTrash = page.getByLabel("Remove Bench Press from workout");
      await expect(benchTrash).toBeVisible({ timeout: 5_000 });

      // Dismiss the confirm dialog.
      page.once("dialog", (d) => void d.dismiss());
      await benchTrash.click();
      await page.waitForTimeout(500);

      // The trash (and the block) stay.
      await expect(benchTrash).toBeVisible({ timeout: 5_000 });

      // Cleanup — finish the session.
      page.once("dialog", (d) => void d.accept());
      await page.getByText("Finish", { exact: true }).last().click();
      // Finish lands on the verdict screen.
      await page.waitForURL(/\/workout\/verdict\//, { timeout: 10_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });
});
