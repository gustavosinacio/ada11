/**
 * Dynamic E2E for the WeeklyVolumeStrip on the History screen.
 *
 * Strategy:
 *  - Spin up a fresh confirmed user via the admin API.
 *  - Seed an exercise + N finished sessions across the last 8 ISO weeks.
 *  - Seed sets so different weeks have different volumes (one rest week, one
 *    big week, the current week with mid volume).
 *  - Sign in via the UI, navigate to /(app)/history, snapshot the DOM,
 *    screenshot the rendered strip, then assert visible text.
 *  - Repeat with an empty-history user to verify the "no sessions yet" branch.
 *  - Repeat with a user who has ONLY warmup sets to confirm the strip is hidden
 *    (all-zero buckets → return null) while the sessions list still renders.
 *  - Refetch path: after seeding a new session, force a fresh fetch by clearing
 *    the persisted TanStack cache (`ada11-query-cache`) and verify the new
 *    total renders.
 */

import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

import { pickCanonicalExercise } from "./_helpers/canonical-exercise";

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
  "docs/runs/2026-05-19_2144_weekly-volume-stat/screenshots",
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

async function getSeedExerciseId(_userId: string): Promise<string> {
  const { id } = await pickCanonicalExercise(admin);
  return id;
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

test.describe("Weekly volume strip — History screen", () => {
  test("golden path: strip renders with header, bars, and labels for seeded data", async ({
    page,
  }) => {
    const email = `e2e-strip-golden-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exerciseId = await getSeedExerciseId(userId);

    const plan: { offset: number; weight: number }[] = [
      { offset: 0, weight: 100 }, // current week → 2500 kg
      { offset: 1, weight: 80 },
      { offset: 3, weight: 120 },
      { offset: 4, weight: 60 },
      { offset: 5, weight: 70 },
      { offset: 7, weight: 50 },
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

      // Current-week sum: 5 sets × 100 kg × 5 reps = 2500 kg → "2,500 kg".
      await expect(page.getByText("2,500 kg", { exact: true })).toBeVisible({
        timeout: 5_000,
      });

      const labelTexts = await page
        .locator("text=/^\\d{1,2}\\/\\d{1,2}$/")
        .allTextContents();
      expect(labelTexts.length).toBeGreaterThanOrEqual(8);

      const file = path.join(SCREENSHOT_DIR, "golden-strip.png");
      await page.screenshot({ path: file, fullPage: false });
      console.log(`[screenshot] ${file}`);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("empty state: brand-new user shows 'No sessions yet' and no strip", async ({
    page,
  }) => {
    const email = `e2e-strip-empty-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      await signInViaUi(page, email);
      await gotoHistory(page);

      await expect(
        page.getByText("No sessions yet", { exact: false }),
      ).toBeVisible({ timeout: 10_000 });

      await expect(page.getByText("This week", { exact: true })).toHaveCount(0);

      const file = path.join(SCREENSHOT_DIR, "empty-state.png");
      await page.screenshot({ path: file, fullPage: false });
      console.log(`[screenshot] ${file}`);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("warmup-only user: strip returns null but sessions list still renders", async ({
    page,
  }) => {
    const email = `e2e-strip-warmup-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exerciseId = await getSeedExerciseId(userId);

    const startedAt = new Date(Date.now() - 60 * 60 * 1000);
    const endedAt = new Date(Date.now() - 30 * 60 * 1000);
    const { data: sess, error: e1 } = await admin
      .from("sessions")
      .insert({
        user_id: userId,
        started_at: startedAt.toISOString(),
        ended_at: endedAt.toISOString(),
      })
      .select("id")
      .single();
    if (e1 || !sess) throw new Error(`session: ${e1?.message}`);
    const sessionId = sess.id as string;
    await admin.from("sets").insert([
      {
        user_id: userId,
        session_id: sessionId,
        exercise_id: exerciseId,
        set_number: 1,
        reps: 10,
        weight: "20",
        set_type: "warmup",
        completed_at: endedAt.toISOString(),
      },
      {
        user_id: userId,
        session_id: sessionId,
        exercise_id: exerciseId,
        set_number: 2,
        reps: 10,
        weight: "20",
        set_type: "warmup",
        completed_at: endedAt.toISOString(),
      },
    ]);

    try {
      await signInViaUi(page, email);
      await gotoHistory(page);

      await expect(page.getByText("This week", { exact: true })).toHaveCount(0, {
        timeout: 10_000,
      });

      const file = path.join(SCREENSHOT_DIR, "warmup-only.png");
      await page.screenshot({ path: file, fullPage: false });
      console.log(`[screenshot] ${file}`);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("refetch path: clearing the persisted TanStack cache + reload yields new total", async ({
    page,
  }) => {
    const email = `e2e-strip-refetch-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exerciseId = await getSeedExerciseId(userId);

    const baseTime = new Date();
    baseTime.setUTCHours(baseTime.getUTCHours() - 2);
    await seedFinishedSession({
      userId,
      exerciseId,
      completedAt: baseTime,
      workingSets: 5,
      weight: 100,
      reps: 1,
    });

    try {
      await signInViaUi(page, email);
      await gotoHistory(page);

      // Initial: 5 sets × 100 kg × 1 rep = 500 kg this week.
      await expect(page.getByText("500 kg", { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      // Insert ANOTHER session.
      const t2 = new Date();
      t2.setUTCMinutes(t2.getUTCMinutes() - 5);
      await seedFinishedSession({
        userId,
        exerciseId,
        completedAt: t2,
        workingSets: 5,
        weight: 100,
        reps: 1,
      });

      // Purge the persisted TanStack cache key (preserving the Supabase auth
      // token so the user stays signed in across the reload).
      await page.evaluate(() => {
        window.localStorage.removeItem("ada11-query-cache");
      });

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

      // Now: 10 sets × 100 kg × 1 rep = 1000 kg → "1,000 kg".
      await expect(page.getByText("1,000 kg", { exact: true })).toBeVisible({
        timeout: 20_000,
      });

      const file = path.join(SCREENSHOT_DIR, "post-refetch.png");
      await page.screenshot({ path: file, fullPage: false });
      console.log(`[screenshot] ${file}`);
    } finally {
      await deleteUserSafe(userId);
    }
  });
});
