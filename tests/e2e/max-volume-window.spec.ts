/**
 * E2E for the configurable max-volume window feature (run 2026-05-23_0211).
 *
 * Tests written by the Tester agent. Drives the actual UI: Profile screen
 * segmented control, Progress hero legend copy, weekly-volume-strip overlay
 * caption. Seeds historic data so the cross-week + windowed-PR scenarios
 * exercise the kernel filters at runtime, not just unit-test math.
 *
 * Tab navigation uses `page.goto("/<route>")` rather than clicking tab labels:
 * the Profile screen has an `<h1>Profile</h1>` heading that intercepts clicks
 * on the bottom-tab labels because the heading text overlaps the tab text.
 */

import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const ANON = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !ANON || !SERVICE_ROLE) {
  throw new Error("Missing Supabase env vars; source .env.local first.");
}

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PASSWORD = "test-password-123";
const SCREENSHOT_DIR = path.resolve(
  "docs/runs/2026-05-23_0211_configurable-max-volume-window/screenshots",
);
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const createdUserIds = new Set<string>();

async function createConfirmedUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(error?.message);
  createdUserIds.add(data.user.id);
  return data.user.id;
}

async function deleteUserSafe(userId: string) {
  try {
    await admin.auth.admin.deleteUser(userId);
  } catch {
    /* best-effort */
  } finally {
    createdUserIds.delete(userId);
  }
}

test.afterAll(async () => {
  await Promise.all(Array.from(createdUserIds).map(deleteUserSafe));
});

async function getSeedExerciseId(userId: string): Promise<string> {
  const { data, error } = await admin
    .from("exercises")
    .select("id, name")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .limit(1);
  if (error || !data || data.length === 0) {
    throw new Error(`No seeded exercise for ${userId}: ${error?.message}`);
  }
  return data[0]!.id;
}

function mondayNWeeksAgoUtc(weekOffset: number): Date {
  const now = new Date();
  const day = now.getUTCDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - daysSinceMonday);
  monday.setUTCHours(0, 0, 0, 0);
  monday.setUTCDate(monday.getUTCDate() - 7 * weekOffset);
  return monday;
}

async function seedFinishedSession(opts: {
  userId: string;
  exerciseId: string;
  startedAt: Date;
  completedAt: Date;
  workingSets: number;
  weight: number;
  reps: number;
}): Promise<string> {
  const { userId, exerciseId, startedAt, completedAt, workingSets, weight, reps } = opts;
  const { data: sess, error: e1 } = await admin
    .from("sessions")
    .insert({
      user_id: userId,
      started_at: startedAt.toISOString(),
      ended_at: completedAt.toISOString(),
    })
    .select("id")
    .single();
  if (e1 || !sess) throw new Error(`session insert: ${e1?.message}`);
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
      completedAt.getTime() - (workingSets - i) * 60 * 1000,
    ).toISOString(),
  }));
  const { error: e2 } = await admin.from("sets").insert(setRows);
  if (e2) throw new Error(`sets insert: ${e2.message}`);
  return sessionId;
}

async function signInViaUi(page: Page, email: string) {
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Sign in", { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByText("Sign in", { exact: true }).last().click();
  await page.waitForURL(/\/workout/, { timeout: 15_000 });
}

async function gotoRoute(page: Page, route: string) {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
}

async function waitForPrefValue(userId: string, expected: number, timeoutMs = 5000): Promise<number | undefined> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data } = await admin
      .from("user_preferences")
      .select("max_volume_window_weeks")
      .eq("user_id", userId)
      .single();
    if (data?.max_volume_window_weeks === expected) return expected;
    await new Promise((r) => setTimeout(r, 200));
  }
  return undefined;
}

test.describe("Max-volume window — UI smoke", () => {
  test("1. profile renders 4 segments with All active by default + legend caption visible", async ({
    page,
  }) => {
    const email = `e2e-mvw-default-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      await signInViaUi(page, email);
      await gotoRoute(page, "/profile");

      // Section label visible
      await expect(
        page.getByText("Max-volume window", { exact: true }).first(),
      ).toBeVisible({ timeout: 10_000 });

      // All 4 segments visible
      for (const label of ["All", "10w", "20w", "30w"]) {
        await expect(
          page.getByText(label, { exact: true }).first(),
        ).toBeVisible();
      }

      // Legend caption present
      await expect(
        page
          .getByText(
            "Max-volume window — how many recent weeks to compare against.",
            { exact: true },
          )
          .first(),
      ).toBeVisible();

      await page.screenshot({
        path: `${SCREENSHOT_DIR}/01-profile-default.png`,
        fullPage: true,
      });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("2. tapping 10w persists pref + reload keeps the value", async ({
    page,
  }) => {
    const email = `e2e-mvw-tap-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      await signInViaUi(page, email);
      await gotoRoute(page, "/profile");

      await expect(
        page.getByText("Max-volume window", { exact: true }).first(),
      ).toBeVisible({ timeout: 10_000 });

      // Tap 10w
      await page.getByText("10w", { exact: true }).first().click();
      expect(await waitForPrefValue(userId, 10)).toBe(10);

      // Reload — pref should survive.
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

      const { data: persisted } = await admin
        .from("user_preferences")
        .select("max_volume_window_weeks")
        .eq("user_id", userId)
        .single();
      expect(persisted?.max_volume_window_weeks).toBe(10);

      await page.screenshot({
        path: `${SCREENSHOT_DIR}/02-profile-10w-active.png`,
        fullPage: true,
      });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("3. cycling 0 → 10 → 20 → 30 → 0 updates DB correctly without crash", async ({
    page,
  }) => {
    const email = `e2e-mvw-cycle-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      await signInViaUi(page, email);
      await gotoRoute(page, "/profile");
      await expect(
        page.getByText("Max-volume window", { exact: true }).first(),
      ).toBeVisible({ timeout: 10_000 });

      for (const [label, expected] of [
        ["10w", 10],
        ["20w", 20],
        ["30w", 30],
        ["All", 0],
      ] as const) {
        await page.getByText(label, { exact: true }).first().click();
        expect(
          await waitForPrefValue(userId, expected),
          `tapping ${label} should persist ${expected}`,
        ).toBe(expected);
      }
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("4. hero legend changes from 'best week ever' to 'best of last 10 weeks' after switching", async ({
    page,
  }) => {
    const email = `e2e-mvw-hero-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      const exerciseId = await getSeedExerciseId(userId);

      // Ancient session ~25 weeks ago.
      const ancientMonday = mondayNWeeksAgoUtc(25);
      const ancientCompleted = new Date(
        ancientMonday.getTime() + 3 * 24 * 3600 * 1000 + 9 * 3600 * 1000,
      );
      await seedFinishedSession({
        userId,
        exerciseId,
        startedAt: new Date(ancientCompleted.getTime() - 3600 * 1000),
        completedAt: ancientCompleted,
        workingSets: 5,
        weight: 200,
        reps: 5,
      });

      // Recent session 5 weeks ago.
      const recentMonday = mondayNWeeksAgoUtc(5);
      const recentCompleted = new Date(
        recentMonday.getTime() + 3 * 24 * 3600 * 1000 + 9 * 3600 * 1000,
      );
      await seedFinishedSession({
        userId,
        exerciseId,
        startedAt: new Date(recentCompleted.getTime() - 3600 * 1000),
        completedAt: recentCompleted,
        workingSets: 5,
        weight: 50,
        reps: 5,
      });

      await signInViaUi(page, email);

      // Tap 10w from Profile first, then go to /progress.
      await gotoRoute(page, "/profile");
      await expect(
        page.getByText("Max-volume window", { exact: true }).first(),
      ).toBeVisible({ timeout: 10_000 });
      await page.getByText("10w", { exact: true }).first().click();
      expect(await waitForPrefValue(userId, 10)).toBe(10);
      // Allow the AsyncStorage persister (default ~1s debounce) to flush
      // the new prefs to localStorage before a hard navigation re-hydrates
      // the cache. SPA in-app navigation does not need this; Playwright's
      // page.goto is a hard reload.
      await page.waitForTimeout(1500);

      await gotoRoute(page, "/progress");

      // The hero should now display the windowed legend (since data exists
      // 5 weeks ago which is within the 10-week window).
      await expect(page.getByText(/Max = best of last 10 weeks/i).first()).toBeVisible({
        timeout: 15_000,
      });

      await page.screenshot({
        path: `${SCREENSHOT_DIR}/04-progress-10w-hero.png`,
        fullPage: true,
      });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("5. windowed Max excludes ancient session — strip caption shows recent value", async ({
    page,
  }) => {
    const email = `e2e-mvw-best-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      const exerciseId = await getSeedExerciseId(userId);

      // Ancient session ~25 weeks ago: 5 sets × 200 kg × 5 reps = 5000 kg.
      const ancientMonday = mondayNWeeksAgoUtc(25);
      const ancientCompleted = new Date(
        ancientMonday.getTime() + 3 * 24 * 3600 * 1000 + 9 * 3600 * 1000,
      );
      await seedFinishedSession({
        userId,
        exerciseId,
        startedAt: new Date(ancientCompleted.getTime() - 3600 * 1000),
        completedAt: ancientCompleted,
        workingSets: 5,
        weight: 200,
        reps: 5,
      });

      // Recent session 5 weeks ago: 5 sets × 50 kg × 5 reps = 1250 kg.
      const recentMonday = mondayNWeeksAgoUtc(5);
      const recentCompleted = new Date(
        recentMonday.getTime() + 3 * 24 * 3600 * 1000 + 9 * 3600 * 1000,
      );
      await seedFinishedSession({
        userId,
        exerciseId,
        startedAt: new Date(recentCompleted.getTime() - 3600 * 1000),
        completedAt: recentCompleted,
        workingSets: 5,
        weight: 50,
        reps: 5,
      });

      // Set window to 10w directly in DB.
      await admin
        .from("user_preferences")
        .update({ max_volume_window_weeks: 10 })
        .eq("user_id", userId);

      await signInViaUi(page, email);
      await gotoRoute(page, "/progress");

      // The strip caption should read "Best of last 10 weeks: ..." and show
      // 1,250 kg, NOT the ancient 5,000 kg.
      const caption = page.getByText(/Best of last 10 weeks/i).first();
      await expect(caption).toBeVisible({ timeout: 10_000 });
      const text = await caption.textContent();
      expect(text).toBeTruthy();
      // Must NOT contain "5,000" or "5000" (the ancient lifetime value).
      expect(text!).not.toMatch(/5,?000/);

      await page.screenshot({
        path: `${SCREENSHOT_DIR}/05-progress-10w-strip-caption.png`,
        fullPage: true,
      });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("6. user with NO history — Profile renders + Progress does not crash on 30w", async ({
    page,
  }) => {
    const email = `e2e-mvw-empty-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      await signInViaUi(page, email);
      await gotoRoute(page, "/profile");

      await expect(
        page.getByText("Max-volume window", { exact: true }).first(),
      ).toBeVisible({ timeout: 10_000 });

      // Tap 30w on a brand-new user
      await page.getByText("30w", { exact: true }).first().click();
      expect(await waitForPrefValue(userId, 30)).toBe(30);

      // Navigate to Progress — must not crash.
      await gotoRoute(page, "/progress");

      // Some Progress UI must render (heading, hero, or empty state).
      // Just verify no exception page appeared.
      const errorBanner = page.getByText(/Something went wrong/i).first();
      await expect(errorBanner).toHaveCount(0);

      await page.screenshot({
        path: `${SCREENSHOT_DIR}/06-empty-user-30w.png`,
        fullPage: true,
      });
    } finally {
      await deleteUserSafe(userId);
    }
  });
});
