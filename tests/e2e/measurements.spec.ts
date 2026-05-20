/**
 * E2E Measurements feature tests (web target) — Tester agent, run 2026-05-19_2353_measurements-tracking.
 *
 * The Input component renders <Text label> + <TextInput> as siblings without
 * aria linkage, so we address inputs by placeholder + index (8 lengths share
 * the "cm" placeholder, ordered DOM-wise: neck, chest, biceps, forearm, waist,
 * hips, thigh, calf).
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

const IDX = {
  date: 0,
  weight: 1,
  bodyFat: 2,
  neck: 3,
  chest: 4,
  biceps: 5,
  forearm: 6,
  waist: 7,
  hips: 8,
  thigh: 9,
  calf: 10,
} as const;

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
  } catch {}
  finally {
    createdUserIds.delete(userId);
  }
}

async function signInAndLand(page: Page, email: string) {
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Sign in", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByText("Sign in", { exact: true }).last().click();
  await page.waitForURL(/\/workout/, { timeout: 15_000 });
}

async function goToMeasurements(page: Page) {
  await page.getByText("Measurements", { exact: true }).first().click();
  await page.waitForURL(/\/measurements/, { timeout: 10_000 });
}

async function fillInput(page: Page, idx: number, value: string) {
  await page.locator("input").nth(idx).fill(value);
}

test.afterAll(async () => {
  await Promise.all(Array.from(createdUserIds).map(deleteUserSafe));
});

test.describe("Measurements feature (web)", () => {
  test("golden: empty state → create → list → edit", async ({ page }) => {
    const email = `e2e-measure-golden-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      await signInAndLand(page, email);
      await goToMeasurements(page);

      await expect(
        page.getByText("No measurements logged yet. Log your first to start tracking progress."),
      ).toBeVisible({ timeout: 10_000 });
      await page.getByText("Log measurement", { exact: true }).first().click();
      await page.waitForURL(/\/measurements\/new/, { timeout: 10_000 });

      // Sections rendered (5 explicit headers — section 1 has no header)
      await expect(page.getByText("Weight & body fat")).toBeVisible();
      await expect(page.getByText("Upper body")).toBeVisible();
      await expect(page.getByText("Core")).toBeVisible();
      await expect(page.getByText("Lower body")).toBeVisible();
      // "Notes" header collides with "Notes (optional)" input label; use first() to relax.
      await expect(page.getByText("Notes", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Notes (optional)")).toBeVisible();

      await fillInput(page, IDX.weight, "80.0");
      await fillInput(page, IDX.bodyFat, "15.5");
      await fillInput(page, IDX.chest, "100.0");
      await fillInput(page, IDX.biceps, "35.0");
      await fillInput(page, IDX.waist, "80.0");
      await page.getByPlaceholder("How you felt, time of day, etc.").fill("first entry");

      await page.getByText("Save measurement").last().click();
      await page.waitForURL(/\/measurements$/, { timeout: 10_000 });

      await expect(page.getByText(/80\.0 kg/).first()).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("first entry").first()).toBeVisible();

      await page.getByText(/80\.0 kg/).first().click();
      await page.waitForURL(/\/measurements\/[0-9a-f-]+$/, { timeout: 10_000 });
      // View screen renders read-only value (no <input> element); the inline
      // "Edit measurement" CTA promotes to the edit form. Use the headerRight
      // pencil's accessibilityLabel — unique to the view screen (the list and
      // edit screens don't expose this label, so it's a more discriminating
      // selector than the per-screen weight text).
      await expect(page.getByLabel("Edit measurement")).toBeVisible();

      // Header-button coverage (accessibilityLabel → aria-label on web).
      await page.getByLabel("Edit measurement").click();
      await page.waitForURL(/\/measurements\/[0-9a-f-]+\/edit$/, { timeout: 10_000 });
      // Bounce back to view, then click the inline CTA to exercise both paths.
      await page.goBack();
      await page.waitForURL(/\/measurements\/[0-9a-f-]+$/, { timeout: 10_000 });
      await page.getByText("Edit measurement", { exact: true }).click();
      await page.waitForURL(/\/measurements\/[0-9a-f-]+\/edit$/, { timeout: 10_000 });
      await expect(page.locator("input").nth(IDX.weight)).toHaveValue("80.0");

      await fillInput(page, IDX.weight, "80.5");
      await page.getByText("Save changes", { exact: true }).last().click();
      await page.waitForURL(/\/measurements$/, { timeout: 10_000 });
      // After `router.replace`, prior stack routes remain hidden in the DOM;
      // the list row text may resolve in both the stale and the new mount.
      // `.last()` picks the most recently pushed (visible) one.
      await expect(page.getByText(/80\.5 kg/).last()).toBeVisible({ timeout: 10_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("MAJ-1 regression: impossible date submit (2026-13-99) shows inline error", async ({ page }) => {
    // Permanent regression guard for MAJ-1 (review-v1.md). Before the fix,
    // submitting an impossible-but-regex-passing date threw an uncaught
    // RangeError("Invalid time value") from `.toISOString()` inside
    // buildSubmitPayload. The fix routes the failure through z.ZodError so
    // the user sees an inline "Invalid date" message against the Date field,
    // and the URL stays on /measurements/new (no navigation, no crash).
    const email = `e2e-measure-maj1-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const pageErrors: Error[] = [];
    const consoleErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    try {
      await signInAndLand(page, email);
      await goToMeasurements(page);
      await page.getByText("Log measurement", { exact: true }).first().click();
      await page.waitForURL(/\/measurements\/new/, { timeout: 10_000 });

      await fillInput(page, IDX.date, "2026-13-99");
      await fillInput(page, IDX.weight, "80");
      await page.getByText("Save measurement").last().click();

      // Inline field error renders; no pageerror; URL unchanged.
      await expect(page.getByText("Invalid date").first()).toBeVisible({ timeout: 5_000 });
      expect(page.url()).toMatch(/\/measurements\/new/);
      expect(
        pageErrors.some((e) => /Invalid time value/i.test(e.message)),
      ).toBe(false);
      expect(
        consoleErrors.some((e) => /Invalid time value/i.test(e)),
      ).toBe(false);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("edge: empty form shows at-least-one error", async ({ page }) => {
    const email = `e2e-measure-empty-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      await signInAndLand(page, email);
      await goToMeasurements(page);
      await page.getByText("Log measurement", { exact: true }).first().click();
      await page.waitForURL(/\/measurements\/new/, { timeout: 10_000 });

      await page.getByText("Save measurement").last().click();
      await expect(page.getByText("Log at least one measurement")).toBeVisible({ timeout: 5_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("edge: duplicate same-day shows amber banner with CTA", async ({ page }) => {
    const email = `e2e-measure-dup-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      await signInAndLand(page, email);
      await goToMeasurements(page);

      await page.getByText("Log measurement", { exact: true }).first().click();
      await page.waitForURL(/\/measurements\/new/, { timeout: 10_000 });
      await fillInput(page, IDX.weight, "80");
      await page.getByText("Save measurement").last().click();
      await page.waitForURL(/\/measurements$/, { timeout: 10_000 });

      await page.goto("/measurements/new", { waitUntil: "domcontentloaded" });
      await page.waitForURL(/\/measurements\/new/, { timeout: 10_000 });
      await fillInput(page, IDX.weight, "81");
      await page.getByText("Save measurement").last().click();

      await expect(page.getByText(/You already have a measurement for/)).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("Open existing entry")).toBeVisible();

      await page.getByText("Open existing entry").click();
      await page.waitForURL(/\/measurements\/[0-9a-f-]+\/edit$/, { timeout: 10_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("edge: weight out of range shows inline error", async ({ page }) => {
    const email = `e2e-measure-range-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      await signInAndLand(page, email);
      await goToMeasurements(page);
      await page.getByText("Log measurement", { exact: true }).first().click();
      await page.waitForURL(/\/measurements\/new/, { timeout: 10_000 });

      await fillInput(page, IDX.weight, "19");
      await page.getByText("Save measurement").last().click();
      await expect(page.getByText("Must be between 20 and 400").first()).toBeVisible({ timeout: 5_000 });

      await fillInput(page, IDX.weight, "401");
      await page.getByText("Save measurement").last().click();
      await expect(page.getByText("Must be between 20 and 400").first()).toBeVisible({ timeout: 5_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("edge: notes >500 chars shows inline error", async ({ page }) => {
    const email = `e2e-measure-notes-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      await signInAndLand(page, email);
      await goToMeasurements(page);
      await page.getByText("Log measurement", { exact: true }).first().click();
      await page.waitForURL(/\/measurements\/new/, { timeout: 10_000 });
      await fillInput(page, IDX.weight, "80");
      const long = "a".repeat(501);
      await page.getByPlaceholder("How you felt, time of day, etc.").fill(long);
      await page.getByText("Save measurement").last().click();
      await expect(page.getByText("Too long").first()).toBeVisible({ timeout: 5_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("edge: soft delete clears row and unblocks same-day re-entry", async ({ page }) => {
    const email = `e2e-measure-delete-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      await signInAndLand(page, email);
      await goToMeasurements(page);

      await page.getByText("Log measurement", { exact: true }).first().click();
      await page.waitForURL(/\/measurements\/new/, { timeout: 10_000 });
      await fillInput(page, IDX.weight, "80");
      await page.getByText("Save measurement").last().click();
      await page.waitForURL(/\/measurements$/, { timeout: 10_000 });

      await page.getByText(/80\.0 kg/).first().click();
      await page.waitForURL(/\/measurements\/[0-9a-f-]+$/, { timeout: 10_000 });

      page.on("dialog", (d) => void d.accept());
      await page.getByText("Edit measurement", { exact: true }).click();
      await page.waitForURL(/\/measurements\/[0-9a-f-]+\/edit$/, { timeout: 10_000 });
      await page.getByText("Delete measurement", { exact: false }).last().click();

      await page.waitForURL(/\/measurements$/, { timeout: 10_000 });
      // After `router.replace`, the prior route (edit screen's parent stack)
      // remains hidden in the DOM with its own empty-state rendered (the
      // list query cache is now empty too), so the empty-state text appears
      // twice — the older (hidden) one is DOM-order first, the new visible
      // one is DOM-order last. Assert on `.last()`.
      await expect(
        page.getByText("No measurements logged yet. Log your first to start tracking progress.").last(),
      ).toBeVisible({ timeout: 10_000 });

      // `.last()` for the same reason — the older Log measurement button
      // from the prior stack route is still mounted but hidden.
      await page.getByText("Log measurement", { exact: true }).last().click();
      await page.waitForURL(/\/measurements\/new/, { timeout: 10_000 });
      await fillInput(page, IDX.weight, "82");
      await page.getByText("Save measurement").last().click();
      await page.waitForURL(/\/measurements$/, { timeout: 10_000 });
      await expect(page.getByText(/82\.0 kg/).last()).toBeVisible({ timeout: 10_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("regression: 6 tabs render, Profile shows weight + length unit toggles", async ({ page }) => {
    const email = `e2e-measure-regression-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      await signInAndLand(page, email);
      await expect(page.getByText("Workout", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Routines", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Exercises", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("History", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Measurements", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Profile", { exact: true }).first()).toBeVisible();

      await page.getByText("History", { exact: true }).first().click();
      await page.waitForURL(/\/history/, { timeout: 10_000 });

      await page.getByText("Profile", { exact: true }).first().click();
      await page.waitForURL(/\/profile/, { timeout: 10_000 });
      await expect(page.getByText("Weight unit").first()).toBeVisible();
      await expect(page.getByText("Length unit").first()).toBeVisible();
    } finally {
      await deleteUserSafe(userId);
    }
  });
});
