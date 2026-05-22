/**
 * E2E for the per-set bottom-sheet menu (RPE + notes).
 *
 * Covers:
 *  - Open menu via the "Open set details" trigger
 *  - Tap an RPE chip → value persists after dismiss + reopen
 *  - Type notes → commits on dismiss → persists after reopen
 *  - BLK-1 regression: editing reps/weight after setting RPE preserves the
 *    saved RPE (no clobber on `updateSet`).
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
    "Missing Supabase env vars. Source .env.local before running playwright (see README).",
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

async function quickStartAndLogOneSet(page: Page) {
  await expect(page.getByText("Quick start workout").last()).toBeVisible({
    timeout: 10_000,
  });
  await page.getByText("Quick start workout").last().click();
  await page.waitForURL(/\/workout\/[0-9a-f-]+/, { timeout: 15_000 });

  // Pick Bench Press.
  await page.getByText("Add exercise", { exact: true }).click();
  await expect(page.getByText("Pick exercise")).toBeVisible({ timeout: 10_000 });
  await page.getByPlaceholder("Search by name, muscle, equipment").fill("Bench Press");
  await page.getByText("Bench Press", { exact: true }).first().click();
  await expect(page.getByText("Pick exercise")).not.toBeVisible({
    timeout: 10_000,
  });

  // Log one working set.
  await page.getByText("+ Working set", { exact: true }).first().click();
  await expect(page.getByLabel("Open set details").first()).toBeVisible({
    timeout: 10_000,
  });
}

test.afterAll(async () => {
  await Promise.all(Array.from(createdUserIds).map(deleteUserSafe));
});

test.describe("set-row-menu (web)", () => {
  test("RPE chip selection persists across reopen", async ({ page }) => {
    const email = `e2e-set-menu-rpe-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      await signInAndLand(page, email);
      await quickStartAndLogOneSet(page);

      // Open the menu.
      await page.getByLabel("Open set details").first().click();
      await expect(page.getByText(/Set 1 · Bench Press/)).toBeVisible({
        timeout: 10_000,
      });

      // Arm PATCH+GET waits BEFORE the chip tap so the close→reopen sequence
      // doesn't race the network round-trip (same pattern as the notes test).
      const rpePatch = page.waitForResponse(
        (resp) =>
          resp.url().includes("/rest/v1/sets") &&
          resp.url().includes("id=eq.") &&
          resp.request().method() === "PATCH",
        { timeout: 10_000 },
      );
      const setsRefresh = page.waitForResponse(
        (resp) =>
          resp.url().includes("/rest/v1/sets") &&
          resp.url().includes("session_id=eq.") &&
          resp.request().method() === "GET",
        { timeout: 10_000 },
      );

      // Tap the 9.0 chip.
      await page.getByLabel("Set RPE to 9.0").click();

      // Close via the X button.
      await page.getByLabel("Close").click();
      await expect(page.getByText(/Set 1 · Bench Press/)).not.toBeVisible({
        timeout: 5_000,
      });

      // Make sure both the write and the cache refresh have landed before
      // re-mounting the menu.
      await Promise.all([rpePatch, setsRefresh]);

      // Reopen — the chip should still read as selected.
      // NOTE: react-native-web 0.21 does NOT translate
      // `accessibilityState={{ selected }}` to an `aria-selected` DOM
      // attribute, so we assert on the `bg-emerald-500` NativeWind class
      // that `<SetRowMenu>` toggles for the active chip — that class is the
      // visible source of truth for "selected" (see set-row-menu.tsx:183-184).
      await page.getByLabel("Open set details").first().click();
      await expect(page.getByLabel("Set RPE to 9.0")).toHaveClass(
        /bg-emerald-500/,
      );
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("Notes commit on dismiss and survive reopen", async ({ page }) => {
    const email = `e2e-set-menu-notes-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      await signInAndLand(page, email);
      await quickStartAndLogOneSet(page);

      await page.getByLabel("Open set details").first().click();
      await expect(page.getByText(/Set 1 · Bench Press/)).toBeVisible({
        timeout: 10_000,
      });

      await page.getByPlaceholder("Notes for this set").fill("Felt heavy");

      // Arm waits for the notes PATCH and the cache-refresh GET BEFORE
      // clicking Close. Without these, the bot-cadence test closes the
      // menu (~11ms after fill) and reopens it (~28ms later) before the
      // network round-trip completes (~300ms), so the menu re-mounts with
      // a stale `initialNotes = null` and the persistence assertion fails.
      // Real users hit the natural debounce; the bot needs explicit gating.
      const notesPatch = page.waitForResponse(
        (resp) =>
          resp.url().includes("/rest/v1/sets") &&
          resp.url().includes("id=eq.") &&
          resp.request().method() === "PATCH",
        { timeout: 10_000 },
      );
      const setsRefresh = page.waitForResponse(
        (resp) =>
          resp.url().includes("/rest/v1/sets") &&
          resp.url().includes("session_id=eq.") &&
          resp.request().method() === "GET",
        { timeout: 10_000 },
      );

      await page.getByLabel("Close").click();
      await expect(page.getByText(/Set 1 · Bench Press/)).not.toBeVisible({
        timeout: 5_000,
      });

      // Make sure both the write and the cache refresh have landed before
      // re-mounting the menu.
      await Promise.all([notesPatch, setsRefresh]);

      // Reopen — notes textarea contains the persisted text.
      await page.getByLabel("Open set details").first().click();
      await expect(
        page.getByPlaceholder("Notes for this set"),
      ).toHaveValue("Felt heavy");
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("BLK-1 regression: editing reps after setting RPE preserves RPE", async ({
    page,
  }) => {
    const email = `e2e-set-menu-blk1-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      await signInAndLand(page, email);
      await quickStartAndLogOneSet(page);

      // Set RPE to 9.0 via the menu.
      await page.getByLabel("Open set details").first().click();

      // Arm PATCH+GET waits so the close→reps-edit sequence doesn't race the
      // RPE write (same pattern as the persistence test above).
      const rpePatch = page.waitForResponse(
        (resp) =>
          resp.url().includes("/rest/v1/sets") &&
          resp.url().includes("id=eq.") &&
          resp.request().method() === "PATCH",
        { timeout: 10_000 },
      );
      const setsRefresh = page.waitForResponse(
        (resp) =>
          resp.url().includes("/rest/v1/sets") &&
          resp.url().includes("session_id=eq.") &&
          resp.request().method() === "GET",
        { timeout: 10_000 },
      );

      await page.getByLabel("Set RPE to 9.0").click();
      await page.getByLabel("Close").click();

      // Wait for the RPE write + cache refresh before triggering the reps blur.
      await Promise.all([rpePatch, setsRefresh]);

      // Now edit the reps inline on the row — this is the path that
      // previously clobbered RPE under the v1 implementation.
      const repsInput = page.getByPlaceholder("reps").first();
      await repsInput.fill("5");
      await repsInput.blur();

      // Wait briefly for the reps write network round-trip.
      await page.waitForTimeout(500);

      // Reopen the menu — RPE should still be selected.
      // See note above: assert on `bg-emerald-500` class instead of
      // `aria-selected` (RN-Web 0.21 doesn't emit the attribute).
      await page.getByLabel("Open set details").first().click();
      await expect(page.getByLabel("Set RPE to 9.0")).toHaveClass(
        /bg-emerald-500/,
      );
    } finally {
      await deleteUserSafe(userId);
    }
  });
});
