/**
 * E2E for the Progress tab (`/(app)/progress`).
 *
 * 7 tests per design-v3 §"Test plan":
 *   1. Tab is visible on the bottom bar (5-tab regression).
 *   2. Empty user shows the day-zero empty states without crashing.
 *   3. Populated user mid-week renders hero/bars/list/streak.
 *   4. Tapping a per-exercise list row routes to /(app)/exercises/{id}/progress.
 *   5. Empty current ISO week with prior history shows the empty-list copy.
 *   6. PR badge surfaces on a row that beats its lifetime best this week.
 *   7. 5-tab smoke: all 5 visible labels render together (History → Progress → Profile).
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
  "docs/runs/2026-05-22_0030_progress-page/screenshots",
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

async function gotoProgress(page: Page) {
  await page.goto("/progress", { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
}

test.describe("Progress page", () => {
  test("1. tab visibility — Progress tab renders on the bottom bar", async ({
    page,
  }) => {
    const email = `e2e-progress-tab-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      await signInViaUi(page, email);
      await expect(
        page.getByText("Progress", { exact: true }).first(),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("2. empty user — day-zero empty states render without crashing", async ({
    page,
  }) => {
    const email = `e2e-progress-empty-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      await signInViaUi(page, email);
      await gotoProgress(page);

      // Hero shows "Log your first session" copy when maxKg = 0.
      await expect(
        page.getByText("Log your first session", { exact: false }),
      ).toBeVisible({ timeout: 10_000 });
      // Empty list copy.
      await expect(
        page.getByText("No exercises trained this week yet", { exact: false }),
      ).toBeVisible({ timeout: 5_000 });
      // Day-zero streak copy.
      await expect(
        page.getByText("Finish a session this week to start a streak", {
          exact: false,
        }),
      ).toBeVisible({ timeout: 5_000 });

      const file = path.join(SCREENSHOT_DIR, "empty-state.png");
      await page.screenshot({ path: file, fullPage: false });
      console.log(`[screenshot] ${file}`);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("3. populated user mid-week — hero, bars, list, streak all render", async ({
    page,
  }) => {
    const email = `e2e-progress-populated-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exerciseId = await getSeedExerciseId(userId);

    // Seed: 3 weeks ago a heavier session, then a lighter session this week.
    const farPast = mondayNWeeksAgoUtc(3);
    farPast.setUTCDate(farPast.getUTCDate() + 2);
    farPast.setUTCHours(18, 0, 0, 0);
    await seedFinishedSession({
      userId,
      exerciseId,
      completedAt: farPast,
      workingSets: 5,
      weight: 100,
      reps: 5,
    });

    const thisWeek = mondayNWeeksAgoUtc(0);
    thisWeek.setUTCDate(thisWeek.getUTCDate() + 1);
    thisWeek.setUTCHours(18, 0, 0, 0);
    await seedFinishedSession({
      userId,
      exerciseId,
      completedAt: thisWeek,
      workingSets: 3,
      weight: 80,
      reps: 5,
    });

    try {
      await signInViaUi(page, email);
      await gotoProgress(page);

      // Hero "PRs this week" eyebrow.
      await expect(
        page.getByText("PRs this week", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });
      // Strip's "This week" label (still rendered alongside the hero).
      await expect(page.getByText("This week", { exact: true })).toBeVisible({
        timeout: 5_000,
      });
      // Streak card label.
      await expect(page.getByText("Streak", { exact: true })).toBeVisible({
        timeout: 5_000,
      });

      const file = path.join(SCREENSHOT_DIR, "populated.png");
      await page.screenshot({ path: file, fullPage: false });
      console.log(`[screenshot] ${file}`);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("4. per-row navigation — tapping a list row routes to /(app)/exercises/{id}/progress", async ({
    page,
  }) => {
    const email = `e2e-progress-nav-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exerciseId = await getSeedExerciseId(userId);

    // Seed a single this-week session so the list has at least one row.
    const thisWeek = mondayNWeeksAgoUtc(0);
    thisWeek.setUTCDate(thisWeek.getUTCDate() + 1);
    thisWeek.setUTCHours(18, 0, 0, 0);
    await seedFinishedSession({
      userId,
      exerciseId,
      completedAt: thisWeek,
      workingSets: 3,
      weight: 80,
      reps: 5,
    });

    try {
      await signInViaUi(page, email);
      await gotoProgress(page);

      // Fetch the seeded exercise's name to locate the row.
      const { data } = await admin
        .from("exercises")
        .select("name")
        .eq("id", exerciseId)
        .single();
      const exerciseName = (data?.name as string | undefined) ?? "";
      if (!exerciseName) throw new Error("Could not load seeded exercise name");

      // The exerciseName also appears earlier in DOM order in the e1RM legend
      // chip ("Toggle <name>"); target the navigable list row by its
      // role+accessible-name (matches test #8's locator at the row defined in
      // src/components/exercises-this-week-list.tsx:120-121).
      const row = page
        .getByRole("button", { name: `${exerciseName}, view progress` })
        .first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.click();

      await page.waitForURL(new RegExp(`/exercises/${exerciseId}/progress`), {
        timeout: 10_000,
      });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("5. empty current ISO week with prior history — list shows empty copy, hero/bars still render", async ({
    page,
  }) => {
    const email = `e2e-progress-early-week-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exerciseId = await getSeedExerciseId(userId);

    // Seed only prior-week sessions; current week stays empty.
    const lastWeek = mondayNWeeksAgoUtc(1);
    lastWeek.setUTCDate(lastWeek.getUTCDate() + 2);
    lastWeek.setUTCHours(18, 0, 0, 0);
    await seedFinishedSession({
      userId,
      exerciseId,
      completedAt: lastWeek,
      workingSets: 3,
      weight: 80,
      reps: 5,
    });

    try {
      await signInViaUi(page, email);
      await gotoProgress(page);

      // Strip should still render (last week shows a bar).
      await expect(page.getByText("This week", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      // List shows the empty-this-week copy.
      await expect(
        page.getByText("No exercises trained this week yet", { exact: false }),
      ).toBeVisible({ timeout: 5_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("6. PR badge — a row that beats its lifetime best this week renders the PR pill + accordion shows celebratory line", async ({
    page,
  }) => {
    const email = `e2e-progress-pr-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exerciseId = await getSeedExerciseId(userId);

    // Prior session = 100 × 5 × 3 sets = 1500 kg.
    const prior = mondayNWeeksAgoUtc(2);
    prior.setUTCDate(prior.getUTCDate() + 2);
    prior.setUTCHours(18, 0, 0, 0);
    await seedFinishedSession({
      userId,
      exerciseId,
      completedAt: prior,
      workingSets: 3,
      weight: 100,
      reps: 5,
    });

    // This week = 100 × 6 × 4 sets = 2400 kg (clearly beats prior).
    const thisWeek = mondayNWeeksAgoUtc(0);
    thisWeek.setUTCDate(thisWeek.getUTCDate() + 1);
    thisWeek.setUTCHours(18, 0, 0, 0);
    await seedFinishedSession({
      userId,
      exerciseId,
      completedAt: thisWeek,
      workingSets: 4,
      weight: 100,
      reps: 6,
    });

    try {
      await signInViaUi(page, email);
      await gotoProgress(page);

      await expect(
        page.getByText("PR", { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 });

      // Tap the hero count to expand the accordion. A11y-label-based selector
      // (design-v3 MIN-10): `"${count} PRs this week, tap to expand"`.
      await page
        .getByRole("button", { name: /\d+ PRs this week/i })
        .click();

      // overflowKg = 2400 - 1500 = 900; priorMaxKg = 1500. Assert the literal
      // "PR!" prefix substring matches the verdict screen copy.
      // The celebratory line renders TWICE on this page (hero accordion + the
      // per-muscle list's PR row), both intentional per design-v3. Playwright
      // strict-mode forbids ambiguous getByText — use .first() to bind to
      // either match.
      await expect(
        page.getByText("PR! +900 kg (was 1,500 kg)", { exact: false }).first(),
      ).toBeVisible({ timeout: 5_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("8. hero accordion — tap count → expand → tap row → routes to exercise progress", async ({
    page,
  }) => {
    const email = `e2e-progress-accordion-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exerciseId = await getSeedExerciseId(userId);

    // Prior session for baseline.
    const prior = mondayNWeeksAgoUtc(2);
    prior.setUTCDate(prior.getUTCDate() + 2);
    prior.setUTCHours(18, 0, 0, 0);
    await seedFinishedSession({
      userId,
      exerciseId,
      completedAt: prior,
      workingSets: 3,
      weight: 100,
      reps: 5,
    });

    // This-week PR session.
    const thisWeek = mondayNWeeksAgoUtc(0);
    thisWeek.setUTCDate(thisWeek.getUTCDate() + 1);
    thisWeek.setUTCHours(18, 0, 0, 0);
    await seedFinishedSession({
      userId,
      exerciseId,
      completedAt: thisWeek,
      workingSets: 4,
      weight: 100,
      reps: 6,
    });

    try {
      await signInViaUi(page, email);
      await gotoProgress(page);

      // Hero count is rendered.
      await expect(
        page.getByText("PRs this week", { exact: true }),
      ).toBeVisible({ timeout: 15_000 });

      // Tap to expand.
      await page
        .getByRole("button", { name: /\d+ PRs this week/i })
        .click();

      // Get the seeded exercise's name to find the accordion row.
      const { data } = await admin
        .from("exercises")
        .select("name")
        .eq("id", exerciseId)
        .single();
      const exerciseName = (data?.name as string | undefined) ?? "";
      if (!exerciseName) throw new Error("Could not load seeded exercise name");

      // Tap the accordion row → route to /(app)/exercises/{id}/progress.
      // The same exerciseName also appears in the per-muscle list below; the
      // accordion row appears first in DOM order.
      await page
        .getByRole("button", { name: `${exerciseName}, view progress` })
        .first()
        .click();

      await page.waitForURL(new RegExp(`/exercises/${exerciseId}/progress`), {
        timeout: 10_000,
      });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("7. 5-tab regression — History, Progress, Profile labels coexist on the bar", async ({
    page,
  }) => {
    const email = `e2e-progress-tabs-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      await signInViaUi(page, email);
      await expect(
        page.getByText("Workout", { exact: true }).first(),
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        page.getByText("Exercises", { exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByText("History", { exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByText("Progress", { exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByText("Profile", { exact: true }).first(),
      ).toBeVisible();
    } finally {
      await deleteUserSafe(userId);
    }
  });
});
