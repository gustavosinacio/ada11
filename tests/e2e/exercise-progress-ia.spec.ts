/**
 * E2E driver for the exercise-progress IA change (run 2026-05-20_0302).
 *
 * Exercises the contract:
 *   - List row tap lands on /exercises/{id}/progress (not edit).
 *   - Progress header has a Pencil "Edit exercise" button that routes to /exercises/{id}.
 *   - Save from edit lands back on the progress screen (title reflects new name).
 *   - Delete from edit lands on /exercises (the list), not a broken progress screen.
 *   - Workout finish invalidates the ["progress"] cache.
 *
 * Created by the Tester agent for dynamic evidence. Safe to delete once verified.
 */

import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE) {
  throw new Error("Missing Supabase env vars.");
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

test.afterAll(async () => {
  await Promise.all(Array.from(createdUserIds).map(deleteUserSafe));
});

test.describe("Exercise progress IA (web)", () => {
  test("golden + delete: list → progress → pencil → edit → save → progress; delete lands on list", async ({
    page,
  }) => {
    const email = `e2e-ex-ia-golden-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);

    try {
      await signInAndLand(page, email);

      // Go to Exercises list (seeded by trigger ~30 lifts).
      await page.getByText("Exercises", { exact: true }).first().click();
      await page.waitForURL(/\/exercises$/, { timeout: 10_000 });

      // Tap a known seeded row; fall back to first list pressable if not present.
      const candidate = page.getByText("Bench Press", { exact: true }).first();
      if (await candidate.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await candidate.click();
      } else {
        await page.getByRole("button").filter({ hasText: /./ }).nth(0).click();
      }

      // URL is .../exercises/<uuid>/progress (NOT .../exercises/<uuid>).
      await page.waitForURL(/\/exercises\/[0-9a-f-]+\/progress$/, { timeout: 10_000 });
      const progressUrl = page.url();
      const idMatch = progressUrl.match(/\/exercises\/([0-9a-f-]+)\/progress$/);
      expect(idMatch, "captured exercise id from progress URL").not.toBeNull();
      const exerciseId = idMatch![1];

      // Empty state copy renders (zero working sets for a fresh user).
      await expect(
        page.getByText(/No working sets recorded yet/i),
      ).toBeVisible({ timeout: 10_000 });

      // headerRight Pencil button is present and accessible.
      const pencil = page.getByLabel("Edit exercise");
      await expect(pencil).toBeVisible({ timeout: 5_000 });

      // Tap the pencil → lands on the edit screen (no /progress suffix).
      await pencil.click();
      await page.waitForURL(new RegExp(`/exercises/${exerciseId}$`), {
        timeout: 10_000,
      });
      await expect(page.getByText("Edit exercise", { exact: true }).first()).toBeVisible({
        timeout: 5_000,
      });

      // Change the name and save.
      const renamedTo = `Renamed ${Date.now()}`;
      const nameInput = page.locator("input").first();
      await nameInput.fill(renamedTo);
      await page.getByText("Save changes", { exact: true }).last().click();

      // Save handler calls router.back() — lands back on progress for the same id.
      await page.waitForURL(new RegExp(`/exercises/${exerciseId}/progress$`), {
        timeout: 10_000,
      });

      // The progress screen body shows the new name in the h1 below the header.
      await expect(page.getByText(renamedTo).first()).toBeVisible({ timeout: 10_000 });

      // Now exercise the delete path. Open the edit form again via pencil.
      await page.getByLabel("Edit exercise").click();
      await page.waitForURL(new RegExp(`/exercises/${exerciseId}$`), {
        timeout: 10_000,
      });

      // Web confirmDelete uses window.confirm — accept it.
      page.on("dialog", (d) => void d.accept());
      await page.getByText("Delete exercise", { exact: true }).last().click();

      // CRITICAL: after delete, land on the LIST (/exercises), not on the broken progress.
      await page.waitForURL(/\/exercises$/, { timeout: 10_000 });

      // The renamed (and now soft-deleted) exercise must not be in the list.
      await expect(page.getByText(renamedTo).first()).not.toBeVisible({ timeout: 5_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("cache: finishing a session does not break the progress screen on re-entry", async ({
    page,
  }) => {
    const email = `e2e-ex-ia-cache-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);

    try {
      await signInAndLand(page, email);

      // Pick an exercise and remember its id.
      await page.getByText("Exercises", { exact: true }).first().click();
      await page.waitForURL(/\/exercises$/, { timeout: 10_000 });

      const candidate = page.getByText("Bench Press", { exact: true }).first();
      if (await candidate.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await candidate.click();
      } else {
        await page.getByRole("button").filter({ hasText: /./ }).nth(0).click();
      }
      await page.waitForURL(/\/exercises\/[0-9a-f-]+\/progress$/, { timeout: 10_000 });
      const exerciseId = page.url().match(/\/exercises\/([0-9a-f-]+)\/progress$/)![1];

      // Empty state visible — caches the [progress, exerciseId] query.
      await expect(page.getByText(/No working sets recorded yet/i)).toBeVisible({
        timeout: 10_000,
      });

      // Start an ad-hoc workout via direct URL navigation, then finish via UI.
      await page.goto("/(app)/workout", { waitUntil: "domcontentloaded" });
      await page.waitForURL(/\/workout$/, { timeout: 10_000 });
      await page.getByText("Quick start workout").last().click();
      await page.waitForURL(/\/workout\/[0-9a-f-]+/, { timeout: 15_000 });

      page.on("dialog", (d) => void d.accept());
      await page.getByText("Finish", { exact: true }).last().click();
      await page.waitForURL(/\/workout$/, { timeout: 10_000 });

      // Re-enter the same exercise's progress — must render without breakage.
      // (After useFinishSession's ["progress"] invalidation, the next mount refetches.)
      await page.goto(`/(app)/exercises/${exerciseId}/progress`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForURL(/\/exercises\/[0-9a-f-]+\/progress$/, { timeout: 10_000 });
      await expect(page.getByText(/No working sets recorded yet/i)).toBeVisible({
        timeout: 10_000,
      });
      // Header pencil still present (no header regression after finishing a workout).
      await expect(page.getByLabel("Edit exercise")).toBeVisible({ timeout: 5_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("name tap in live workout block routes to /exercises/{id}/progress and back", async ({
    page,
  }) => {
    const email = `e2e-ex-ia-blocktap-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);

    try {
      await signInAndLand(page, email);

      // Quick start an ad-hoc workout.
      await expect(page.getByText("Quick start workout").last()).toBeVisible({
        timeout: 10_000,
      });
      await page.getByText("Quick start workout").last().click();
      await page.waitForURL(/\/workout\/[0-9a-f-]+/, { timeout: 15_000 });
      const workoutUrl = page.url();

      // Add one exercise via the picker.
      await page.getByText("Add exercise", { exact: true }).click();
      await expect(page.getByText("Pick exercise")).toBeVisible({ timeout: 10_000 });
      await page.getByPlaceholder("Search by name, muscle, equipment").fill("Bench Press");
      await page.getByText("Bench Press", { exact: true }).first().click();
      await expect(page.getByText("Pick exercise")).not.toBeVisible({ timeout: 10_000 });

      // Tap the exercise name (accessible label includes "View progress for ...").
      await page.getByLabel("View progress for Bench Press").click();

      // URL lands on /exercises/<uuid>/progress. expo-router web appends a
      // `?id=<uuid>` query suffix when navigating into a dynamic [id] route
      // from outside the exercises stack — the regex must allow it.
      await page.waitForURL(/\/exercises\/[0-9a-f-]+\/progress(\?.*)?$/, {
        timeout: 10_000,
      });

      // Go back — should return to the same live workout URL.
      await page.goBack();
      await page.waitForURL(new RegExp(workoutUrl.replace(/^https?:\/\/[^/]+/, "").replace(/[/]/g, "\\/") + "$"), {
        timeout: 10_000,
      });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  // Regression guard for the history-detail back-stack bug (run
  // 2026-05-21_1554, fix round). Tapping an exercise name inside a finished
  // session's detail must push (not replace) — browser back must return to
  // /history/{sessionId}, NOT to the /history list.
  test("name tap in history detail block routes to /exercises/{id}/progress and back to detail", async ({
    page,
  }) => {
    const email = `e2e-ex-ia-histtap-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);

    try {
      await signInAndLand(page, email);

      // Quick start a workout so we have a finished session to view in history.
      await expect(page.getByText("Quick start workout").last()).toBeVisible({
        timeout: 10_000,
      });
      await page.getByText("Quick start workout").last().click();
      await page.waitForURL(/\/workout\/[0-9a-f-]+/, { timeout: 15_000 });

      // Add Bench Press so the finished session has an exercise to tap.
      await page.getByText("Add exercise", { exact: true }).click();
      await expect(page.getByText("Pick exercise")).toBeVisible({ timeout: 10_000 });
      await page.getByPlaceholder("Search by name, muscle, equipment").fill("Bench Press");
      await page.getByText("Bench Press", { exact: true }).first().click();
      await expect(page.getByText("Pick exercise")).not.toBeVisible({ timeout: 10_000 });

      // Log a working set so the exercise appears on the session detail page
      // (history-detail's orderedExercises is built from setsForSession).
      await page.getByText("+ Working set", { exact: true }).first().click();
      await expect(page.getByLabel("Mark set as completed").first()).toBeVisible({
        timeout: 5_000,
      });

      // Finish the session. We have 1 unchecked set, so the 3-button
      // ChooseActionModal opens — click "Check all and finish" to commit.
      await page.getByText("Finish", { exact: true }).last().click();
      await page.getByText("Check all and finish", { exact: true }).click();
      await page.waitForURL(/\/workout$/, { timeout: 15_000 });

      // Go to History tab and open the just-finished session.
      await page.getByText("History", { exact: true }).first().click();
      await page.waitForURL(/\/history$/, { timeout: 10_000 });

      // Open the just-finished session. For a brand-new user it's the only
      // session row. The row's secondary line is "<date> · <duration> ·
      // <volume>" (the list page passes totalVolumeKg but not totalSets to
      // SessionSummaryRow, so there's no "N sets" text — but there IS a
      // "12,345 kg" volume token appended). Match by the " · 0m" duration
      // substring — unique to a just-finished session row, and absent from
      // the tab bar. The regex anchors on the duration token only, so the
      // appended volume slot doesn't affect the selector.
      const sessionRow = page.getByRole("button").filter({ hasText: /·\s*\d+m\b/ }).first();
      await expect(sessionRow).toBeVisible({ timeout: 10_000 });
      await sessionRow.click();
      await page.waitForURL(/\/history\/[0-9a-f-]+$/, { timeout: 10_000 });
      const historyDetailUrl = page.url();

      // Tap the exercise name inside the history detail block.
      await page.getByLabel("View progress for Bench Press").click();

      // URL lands on /exercises/<uuid>/progress (allow optional ?id= suffix).
      await page.waitForURL(/\/exercises\/[0-9a-f-]+\/progress(\?.*)?$/, {
        timeout: 10_000,
      });

      // CRITICAL regression check: browser back must return to the SAME
      // /history/{sessionId} detail, not bounce to the /history list.
      await page.goBack();
      await page.waitForURL(
        new RegExp(
          historyDetailUrl.replace(/^https?:\/\/[^/]+/, "").replace(/[/]/g, "\\/") + "$",
        ),
        { timeout: 10_000 },
      );
    } finally {
      await deleteUserSafe(userId);
    }
  });
});
