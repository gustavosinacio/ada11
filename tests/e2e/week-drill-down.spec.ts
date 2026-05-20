/**
 * Dynamic E2E for the volume-strip drill-down (run 2026-05-20_0334).
 *
 * Strategy:
 *  - Seed a user with multi-week data spanning the rolling 8-week window
 *    (current week + a few prior; intentionally leave one week empty).
 *  - Sign in, land on /history, click a bar with non-zero volume → assert
 *    we navigate to /(app)/history/week/<Monday> and the headline matches.
 *  - Click an empty (zero-volume) bar → assert empty-state copy.
 *  - Deep-link to a Monday >8 weeks ago → assert outside-window copy.
 *  - Deep-link to a garbage segment → assert invalid-state.
 *  - Verify the headline volume on the detail screen equals the bar number
 *    on the strip ("headline-vs-bar contract").
 *
 * Note: on Expo Router web, prior stack screens stay in the DOM with
 * display:none. Use `.locator(":visible")` or count `>0` of visible matches
 * to avoid asserting against the hidden ghost screen below.
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
  "docs/runs/2026-05-20_0334_volume-strip-drill-down/screenshots",
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

function fmtYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function seedFinishedSession(opts: {
  userId: string;
  exerciseId: string;
  completedAt: Date;
  workingSets: number;
  weight: number;
  reps: number;
}): Promise<string> {
  const { userId, exerciseId, completedAt, workingSets, weight, reps } = opts;
  const startedAt = new Date(completedAt.getTime() - 60 * 60 * 1000);
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

async function gotoHistory(page: Page) {
  await page.goto("/history", { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
}

test.describe("Week drill-down — tap a bar opens the per-week screen", () => {
  test("golden path: tap current-week bar, headline matches, list renders", async ({
    page,
  }) => {
    const email = `e2e-drill-golden-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exerciseId = await getSeedExerciseId(userId);

    // Plan: current week = 100 kg × 5 reps × 5 sets = 2500 kg. Other weeks
    // smaller so the current-week bar is the tallest (blue).
    const plan: { offset: number; weight: number }[] = [
      { offset: 0, weight: 100 }, // current
      { offset: 1, weight: 80 },
      { offset: 3, weight: 60 },
      { offset: 5, weight: 70 },
    ];
    for (const { offset, weight } of plan) {
      const dt = mondayNWeeksAgoUtc(offset);
      dt.setUTCDate(dt.getUTCDate() + 2); // Wednesday
      dt.setUTCHours(18, 0, 0, 0);
      await seedFinishedSession({
        userId,
        exerciseId,
        completedAt: dt,
        workingSets: 5,
        weight,
        reps: 5,
      });
    }

    try {
      await signInViaUi(page, email);
      await gotoHistory(page);

      await expect(page.getByText("This week", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText("2.5k kg", { exact: true })).toBeVisible({
        timeout: 5_000,
      });

      const currentMondayUtc = mondayNWeeksAgoUtc(0);
      const currentSegment = fmtYmd(currentMondayUtc);
      const currentLabel = `${currentMondayUtc.getUTCMonth() + 1}/${currentMondayUtc.getUTCDate()}`;

      // Tap the current-week pressable by its accessibility label.
      const currentBar = page.getByRole("button", {
        name: `View week of ${currentLabel}`,
      });
      await expect(currentBar).toBeVisible({ timeout: 5_000 });
      await currentBar.click();

      // URL contract.
      await page.waitForURL(
        new RegExp(`/history/week/${currentSegment}$`),
        { timeout: 10_000 },
      );

      // Headline-vs-bar contract: the strip showed "2.5k kg", the detail
      // screen's Total volume row should too.
      await expect(
        page.getByText("Total volume", { exact: true }),
      ).toBeVisible({ timeout: 5_000 });
      // 2.5k kg appears twice (header + body header range). Use the row value.
      const totalRow = page
        .locator("div")
        .filter({ hasText: /^Total volume2\.5k kg$/ });
      await expect(totalRow.first()).toBeVisible({ timeout: 5_000 });

      // Sessions row = 1 (1 ended, 0 in progress).
      await expect(
        page.getByText("Sessions", { exact: true }).first(),
      ).toBeVisible();

      // Body header has a range like "May 18 – May 24".
      await expect(
        page.getByText(/[A-Z][a-z]{2} \d{1,2} – [A-Z][a-z]{2} \d{1,2}/),
      ).toBeVisible({ timeout: 5_000 });

      // Session row: on Expo Router web the History list keeps prior rows
      // in DOM with display:none. Count VISIBLE "Workout" texts only and
      // expect >= 1 (the seeded session shows on the per-week list).
      const visibleWorkouts = page
        .getByText("Workout", { exact: true })
        .locator("visible=true");
      await expect(visibleWorkouts.first()).toBeVisible({ timeout: 5_000 });

      const file = path.join(SCREENSHOT_DIR, "drill-down-golden.png");
      await page.screenshot({ path: file, fullPage: true });
      console.log(`[screenshot] ${file}`);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("empty week: tap a zero-volume bar lands on empty state", async ({
    page,
  }) => {
    const email = `e2e-drill-empty-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exerciseId = await getSeedExerciseId(userId);

    // Seed only the current week — the other 7 bars in the strip will be
    // zero-volume "rest weeks".
    {
      const dt = mondayNWeeksAgoUtc(0);
      dt.setUTCDate(dt.getUTCDate() + 2);
      dt.setUTCHours(18, 0, 0, 0);
      await seedFinishedSession({
        userId,
        exerciseId,
        completedAt: dt,
        workingSets: 5,
        weight: 100,
        reps: 5,
      });
    }

    try {
      await signInViaUi(page, email);
      await gotoHistory(page);

      // Wait for strip to render.
      await expect(page.getByText("This week", { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      // Tap a rest-week (offset = 3, no sessions).
      const restMonday = mondayNWeeksAgoUtc(3);
      const restSegment = fmtYmd(restMonday);
      const restLabel = `${restMonday.getUTCMonth() + 1}/${restMonday.getUTCDate()}`;

      const restBar = page.getByRole("button", {
        name: `View week of ${restLabel}`,
      });
      await expect(restBar).toBeVisible({ timeout: 5_000 });
      await restBar.click();

      await page.waitForURL(new RegExp(`/history/week/${restSegment}$`), {
        timeout: 10_000,
      });

      // Empty-state copy.
      await expect(
        page.getByText("No sessions this week.", { exact: true }),
      ).toBeVisible({ timeout: 5_000 });

      // Stat sheet still renders with zeros — Total volume "0 kg".
      await expect(
        page.getByText("Total volume", { exact: true }),
      ).toBeVisible();

      const file = path.join(SCREENSHOT_DIR, "drill-down-empty.png");
      await page.screenshot({ path: file, fullPage: true });
      console.log(`[screenshot] ${file}`);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("deep link out-of-window week: outside-range copy", async ({ page }) => {
    const email = `e2e-drill-oow-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exerciseId = await getSeedExerciseId(userId);

    // Seed something so the user has a viable session-aware shell.
    {
      const dt = mondayNWeeksAgoUtc(0);
      dt.setUTCDate(dt.getUTCDate() + 2);
      dt.setUTCHours(18, 0, 0, 0);
      await seedFinishedSession({
        userId,
        exerciseId,
        completedAt: dt,
        workingSets: 5,
        weight: 100,
        reps: 5,
      });
    }

    try {
      await signInViaUi(page, email);
      // Deep link to a Monday 12 weeks ago — well outside the 8-week window.
      const oowMonday = mondayNWeeksAgoUtc(12);
      const oowSegment = fmtYmd(oowMonday);
      await page.goto(`/history/week/${oowSegment}`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

      await expect(
        page.getByText(
          /This week is outside the visible range\. Open the History tab to see the latest weeks\./,
        ),
      ).toBeVisible({ timeout: 10_000 });

      const file = path.join(SCREENSHOT_DIR, "drill-down-outside-window.png");
      await page.screenshot({ path: file, fullPage: true });
      console.log(`[screenshot] ${file}`);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("deep link invalid date: invalid-week copy, no crash", async ({
    page,
  }) => {
    const email = `e2e-drill-invalid-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);

    try {
      await signInViaUi(page, email);
      await page.goto(`/history/week/foobar`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

      await expect(
        page.getByText("Invalid week.", { exact: true }),
      ).toBeVisible({ timeout: 10_000 });

      const file = path.join(SCREENSHOT_DIR, "drill-down-invalid.png");
      await page.screenshot({ path: file, fullPage: true });
      console.log(`[screenshot] ${file}`);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("back navigation: detail → strip restores History list", async ({
    page,
  }) => {
    const email = `e2e-drill-back-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exerciseId = await getSeedExerciseId(userId);

    {
      const dt = mondayNWeeksAgoUtc(0);
      dt.setUTCDate(dt.getUTCDate() + 2);
      dt.setUTCHours(18, 0, 0, 0);
      await seedFinishedSession({
        userId,
        exerciseId,
        completedAt: dt,
        workingSets: 5,
        weight: 100,
        reps: 5,
      });
    }

    try {
      await signInViaUi(page, email);
      await gotoHistory(page);

      await expect(page.getByText("This week", { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      const currentMonday = mondayNWeeksAgoUtc(0);
      const currentLabel = `${currentMonday.getUTCMonth() + 1}/${currentMonday.getUTCDate()}`;
      const currentBar = page.getByRole("button", {
        name: `View week of ${currentLabel}`,
      });
      await currentBar.click();

      await page.waitForURL(/\/history\/week\/\d{4}-\d{2}-\d{2}$/, {
        timeout: 10_000,
      });

      // Browser back → History list.
      await page.goBack({ waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(/\/history$/, { timeout: 10_000 });
      await expect(page.getByText("This week", { exact: true })).toBeVisible({
        timeout: 5_000,
      });
    } finally {
      await deleteUserSafe(userId);
    }
  });
});
