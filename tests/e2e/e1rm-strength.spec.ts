/**
 * E2E for the Phase-2a e1RM strength-progress chart on the Progress page
 * (`/(app)/progress`) — the strength complement to the weekly per-muscle
 * volume chart.
 *
 * Tests:
 *   1. Section renders for a populated user — "Estimated 1RM per exercise"
 *      header + the exercise legend chip for the trained (weighted) exercise.
 *   2. Per-exercise line toggles: tapping a chip toggles its visibility
 *      (`opacity-40`); "Uncheck all" / "Check all" flips them together.
 *   3. (folded into 2) check-all / uncheck-all.
 *   4. NEGATIVE — a bodyweight-only user (weight=0) produces NO e1RM line:
 *      the section is absent (Invariant D). This is the OPPOSITE of the muscle
 *      chart's bodyweight test (which asserts the line DOES appear), because
 *      e1RM uses LOGGED weight only.
 *
 * Flow mirrors `weekly-muscle-volume.spec.ts` (admin-seed via service role,
 * sign in via UI, navigate to /progress). Uses `pickCanonicalExercise` with
 * names verified present in the live CANONICAL catalog by the existing passing
 * spec suite: "Bench Press" + "Squat (Barbell)" (weighted), "Chin-up"
 * (bodyweight). `.first()` on every navigation `getByText` per the suite's
 * strict-mode locator convention.
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
  "docs/runs/2026-05-30_2006_e1rm-strength-chart/screenshots",
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

/** Tuesday 18:00 UTC of the ISO week `weekOffset` weeks ago — mid-week, far
 *  from any week boundary (mirrors the muscle spec's seeding). */
function midWeekUtc(weekOffset: number): Date {
  const d = mondayNWeeksAgoUtc(weekOffset);
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(18, 0, 0, 0);
  return d;
}

async function seedFinishedSession(opts: {
  userId: string;
  exerciseId: string;
  completedAt: Date;
  workingSets: number;
  /** numeric(6,2) — stored as a string. `0` for an unweighted bodyweight set. */
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

test.describe("e1RM strength-progress chart", () => {
  test("1. section renders for a populated user with a weighted exercise", async ({
    page,
  }) => {
    const email = `e2e-e1rm-render-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    // Bench Press → barbell (weighted). Seed across 2 weeks with increasing
    // weight so the e1RM line trends upward (a visible multi-week line).
    const { id: benchId } = await pickCanonicalExercise(admin, "Bench Press");

    await seedFinishedSession({
      userId,
      exerciseId: benchId,
      completedAt: midWeekUtc(1),
      workingSets: 3,
      weight: 90,
      reps: 5,
    });
    await seedFinishedSession({
      userId,
      exerciseId: benchId,
      completedAt: midWeekUtc(0),
      workingSets: 3,
      weight: 100,
      reps: 5,
    });

    try {
      await signInViaUi(page, email);
      await gotoProgress(page);

      // New section header.
      await expect(
        page.getByText("Estimated 1RM per exercise", { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 });
      // Exercise legend chip (the weighted exercise's name).
      await expect(
        page.getByLabel("Toggle Bench Press"),
      ).toBeVisible({ timeout: 5_000 });

      const file = path.join(SCREENSHOT_DIR, "e1rm-section.png");
      await page.screenshot({ path: file, fullPage: false });
      console.log(`[screenshot] ${file}`);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("2. per-exercise chip toggle + check-all / uncheck-all", async ({
    page,
  }) => {
    const email = `e2e-e1rm-toggle-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const { id: benchId } = await pickCanonicalExercise(admin, "Bench Press");
    // A second weighted exercise so check-all/uncheck-all toggles >1 line.
    const { id: squatId } = await pickCanonicalExercise(
      admin,
      "Squat (Barbell)",
    );

    await seedFinishedSession({
      userId,
      exerciseId: benchId,
      completedAt: midWeekUtc(0),
      workingSets: 3,
      weight: 100,
      reps: 5,
    });
    await seedFinishedSession({
      userId,
      exerciseId: squatId,
      completedAt: midWeekUtc(0),
      workingSets: 3,
      weight: 140,
      reps: 5,
    });

    try {
      await signInViaUi(page, email);
      await gotoProgress(page);

      await expect(
        page.getByText("Estimated 1RM per exercise", { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 });

      // Per-line chip toggle. rn-web 0.21 drops `accessibilityState` →
      // `aria-checked`, so assert on the `opacity-40` class the OFF state adds
      // (e1rm-strength-section.tsx). Same source-of-truth as the muscle spec.
      const chip = page.getByLabel("Toggle Bench Press");
      await expect(chip).toBeVisible({ timeout: 5_000 });
      await expect(chip).not.toHaveClass(/opacity-40/);
      await chip.click();
      await expect(chip).toHaveClass(/opacity-40/);
      await chip.click();
      await expect(chip).not.toHaveClass(/opacity-40/);

      // Check-all / uncheck-all. All-on by default → control reads "Uncheck
      // all" with a11y label "Hide all exercises".
      const toggleAll = page.getByRole("button", {
        name: "Hide all exercises",
      });
      await expect(toggleAll).toBeVisible({ timeout: 5_000 });
      await toggleAll.click();
      await expect(
        page.getByRole("button", { name: "Show all exercises" }),
      ).toBeVisible({ timeout: 5_000 });
      // Re-check all.
      await page.getByRole("button", { name: "Show all exercises" }).click();
      await expect(
        page.getByRole("button", { name: "Hide all exercises" }),
      ).toBeVisible({ timeout: 5_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("4. bodyweight-only exercise (weight=0) produces NO e1RM line", async ({
    page,
  }) => {
    const email = `e2e-e1rm-bw-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    // Chin-up → bodyweight equipment. Logged with weight=0 (no added load) →
    // never eligible under Invariant D → no e1RM line / no section.
    const { id: chinupId } = await pickCanonicalExercise(admin, "Chin-up");

    await seedFinishedSession({
      userId,
      exerciseId: chinupId,
      completedAt: midWeekUtc(0),
      workingSets: 4,
      weight: 0,
      reps: 8,
    });

    try {
      await signInViaUi(page, email);
      await gotoProgress(page);

      // CARRY-IN MAJ-1: the section is `null` BOTH while loading AND when
      // correctly empty, so a cold `toHaveCount(0)` could false-green before
      // hydration. Gate on a reliably-present, settled-page anchor FIRST: the
      // <StreakCard> "Streak" eyebrow always renders once the page has loaded
      // (this user has one finished session). Only after that anchor is visible
      // do we assert the e1RM section is absent — at which point a present
      // section would have rendered.
      await expect(
        page.getByText("Streak", { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 });

      // No e1RM section header (section is `return null` when series.length===0).
      await expect(
        page.getByText("Estimated 1RM per exercise", { exact: true }),
      ).toHaveCount(0);
      // No legend chip for the bodyweight exercise.
      await expect(page.getByLabel("Toggle Chin-up")).toHaveCount(0);

      const file = path.join(SCREENSHOT_DIR, "e1rm-bodyweight-absent.png");
      await page.screenshot({ path: file, fullPage: false });
      console.log(`[screenshot] ${file}`);
    } finally {
      await deleteUserSafe(userId);
    }
  });
});
