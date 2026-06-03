/**
 * E2E for the Progress-tab CHART WINDOW selector (`/(app)/progress`).
 *
 * The selector is a page-level discrete weeks control (0/10/20/30/40/50 →
 * "All"/"10w"/…/"50w") that windows BOTH trend charts (weekly per-muscle
 * volume + per-exercise e1RM) in lockstep. It is view-only/ephemeral — it
 * never writes the stored `max_volume_window_weeks` preference. A fresh user
 * has no pref, so the selector SEEDS to "All" (default 0 → full history).
 *
 * Tests:
 *   1. Default seed + lockstep: a populated user lands with "All" active and
 *      both charts rendered (the old AND recent exercises' chips present).
 *      Shrinking to "10w" drops the OLD-only exercise's legend chip from BOTH
 *      charts (it had no in-window data) while the recent one stays — and "All"
 *      restores it. This is the MAJ-1 teeth-bearing assertion: a chip that has
 *      ONLY pre-window data must disappear on shrink and return at "All". (We do
 *      NOT assert x-axis label COUNT, which `<MultiSeriesChart>` thins to ~5
 *      ticks regardless of span — that assertion has no teeth.)
 *   2. Empty window then recover (Unknown 6 / R-3): a user whose data is ALL
 *      older than 10 weeks → tapping "10w" collapses both charts (no section)
 *      BUT the selector stays mounted and tappable; "All" brings the charts
 *      back. Proves the selector lives at page level above the charts.
 *   3. Same-series shrink PRESERVES visibility (MIN-4): toggle a line OFF, then
 *      shrink to a window that does NOT drop that series; the line stays OFF —
 *      proving `seriesKeysSig` stability (the window changed the axis, not the
 *      series SET, so visibility is not re-seeded).
 *
 * Flow mirrors `e1rm-strength.spec.ts` (admin-seed via service role, sign in
 * via UI, navigate to /progress). Exercise names are verified-present in the
 * live CANONICAL catalog by the existing passing spec suite: "Bench Press" +
 * "Squat (Barbell)" (both weighted barbell — they plot on the e1RM chart and
 * map to the Chest/Legs muscle lines). `.first()` on every navigation
 * `getByText` per the suite's strict-mode locator convention.
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
  "docs/runs/2026-06-03_1124_progress-chart-window/screenshots",
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
 *  from any week boundary (mirrors the e1rm/muscle specs' seeding). */
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
  await page
    .goto("/progress", { waitUntil: "domcontentloaded" })
    .catch(() => {});
  await page
    .waitForLoadState("networkidle", { timeout: 10_000 })
    .catch(() => {});
}

test.describe("Progress chart window selector", () => {
  test("1. default 'All' seed + lockstep shrink drops the OLD-only chip from both charts", async ({
    page,
  }) => {
    const email = `e2e-window-shrink-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    // OLD-only weighted exercise — its only data sits ~52 weeks ago, so a
    // 10-week window drops it entirely. Bench Press → Chest.
    const { id: benchId } = await pickCanonicalExercise(admin, "Bench Press");
    // RECENT weighted exercise — data this week, always in-window for any
    // option. Squat (Barbell) → Legs.
    const { id: squatId } = await pickCanonicalExercise(
      admin,
      "Squat (Barbell)",
    );

    // Bench: only ~52 weeks ago (pre-window for 10w/20w/30w/40w/50w).
    await seedFinishedSession({
      userId,
      exerciseId: benchId,
      completedAt: midWeekUtc(52),
      workingSets: 3,
      weight: 90,
      reps: 5,
    });
    // Squat: this week (recent — survives every window).
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

      // Settle: the e1RM section header is the reliable post-load anchor (this
      // user has a weighted exercise → the section renders).
      await expect(
        page.getByText("Estimated 1RM per exercise", { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 });

      // DEFAULT SEED: a fresh user has no pref → selector seeds to "All".
      // rn-web 0.21 does NOT emit `aria-selected` from `accessibilityState`
      // (see set-row-menu.spec.ts:141-145), so the active segment's source of
      // truth is the `bg-black` NativeWind class it carries (matches the
      // Profile segmented control idiom).
      const allSeg = page.getByRole("button", {
        name: "Chart window: all history",
      });
      await expect(allSeg).toBeVisible({ timeout: 5_000 });
      await expect(allSeg).toHaveClass(/bg-black/);

      // At "All" both exercises' e1RM legend chips are present (full history).
      await expect(page.getByLabel("Toggle Bench Press")).toHaveCount(1);
      await expect(page.getByLabel("Toggle Squat (Barbell)")).toHaveCount(1);

      const file1 = path.join(SCREENSHOT_DIR, "01-all-history.png");
      await page.screenshot({ path: file1, fullPage: false });
      console.log(`[screenshot] ${file1}`);

      // SHRINK to "10w".
      await page
        .getByRole("button", { name: "Chart window: last 10 weeks" })
        .click();

      // Settle-gate: wait for the 10w segment to become active (carry the
      // `bg-black` class) BEFORE the negative chip assertion, so the
      // chip-absence isn't a cold false-green.
      await expect(
        page.getByRole("button", { name: "Chart window: last 10 weeks" }),
      ).toHaveClass(/bg-black/, { timeout: 5_000 });
      // The recent exercise's chip is the positive settle anchor — once it is
      // present at 10w, the windowed model has rendered.
      await expect(page.getByLabel("Toggle Squat (Barbell)")).toHaveCount(1);

      // MAJ-1 (teeth): Bench Press had ONLY pre-window data → its legend chip
      // disappears from the e1RM chart under a 10-week window.
      await expect(page.getByLabel("Toggle Bench Press")).toHaveCount(0);

      const file2 = path.join(SCREENSHOT_DIR, "02-window-10w.png");
      await page.screenshot({ path: file2, fullPage: false });
      console.log(`[screenshot] ${file2}`);

      // RESTORE: back to "All" → Bench Press chip returns (proves the shrink
      // assertion has teeth — it changes with the window, not statically true).
      await page
        .getByRole("button", { name: "Chart window: all history" })
        .click();
      await expect(
        page.getByRole("button", { name: "Chart window: all history" }),
      ).toHaveClass(/bg-black/, { timeout: 5_000 });
      await expect(page.getByLabel("Toggle Bench Press")).toHaveCount(1);
      await expect(page.getByLabel("Toggle Squat (Barbell)")).toHaveCount(1);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("2. over-narrow window collapses both charts but keeps the selector (Unknown 6)", async ({
    page,
  }) => {
    const email = `e2e-window-empty-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    // ALL data older than 10 weeks → a 10-week window excludes everything.
    const { id: benchId } = await pickCanonicalExercise(admin, "Bench Press");
    await seedFinishedSession({
      userId,
      exerciseId: benchId,
      completedAt: midWeekUtc(40),
      workingSets: 3,
      weight: 100,
      reps: 5,
    });

    try {
      await signInViaUi(page, email);
      await gotoProgress(page);

      // At "All" the charts render (anchor on the e1RM header).
      await expect(
        page.getByText("Estimated 1RM per exercise", { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 });

      // Tap "10w" → the only data (40 weeks old) is excluded.
      await page
        .getByRole("button", { name: "Chart window: last 10 weeks" })
        .click();

      // Settle-gate: the selector itself stays mounted (page level) — wait for
      // its 10w segment to become active (`bg-black`) BEFORE asserting the
      // charts collapsed.
      await expect(
        page.getByRole("button", { name: "Chart window: last 10 weeks" }),
      ).toHaveClass(/bg-black/, { timeout: 5_000 });

      // Both chart sections collapse (return null when series is empty).
      await expect(
        page.getByText("Estimated 1RM per exercise", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByText("Weekly volume per muscle", { exact: true }),
      ).toHaveCount(0);
      // But the selector persists and is tappable.
      await expect(
        page.getByRole("button", { name: "Chart window: all history" }),
      ).toBeVisible();

      const file = path.join(SCREENSHOT_DIR, "03-empty-window.png");
      await page.screenshot({ path: file, fullPage: false });
      console.log(`[screenshot] ${file}`);

      // Widen back to "All" → the charts return.
      await page
        .getByRole("button", { name: "Chart window: all history" })
        .click();
      await expect(
        page.getByText("Estimated 1RM per exercise", { exact: true }).first(),
      ).toBeVisible({ timeout: 5_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("3. same-series shrink preserves a toggled-off line (MIN-4 / seriesKeysSig stability)", async ({
    page,
  }) => {
    const email = `e2e-window-preserve-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    // A single exercise trained both recently (week 0) and ~8 weeks ago. Under
    // both "All" and "10w" the SAME series remains (Squat is always in-window);
    // only the axis shrinks. So the series SET is unchanged across the shrink →
    // `seriesKeysSig` is stable → a toggled-off line must STAY off.
    const { id: squatId } = await pickCanonicalExercise(
      admin,
      "Squat (Barbell)",
    );
    await seedFinishedSession({
      userId,
      exerciseId: squatId,
      completedAt: midWeekUtc(8),
      workingSets: 3,
      weight: 130,
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

      // Toggle the Squat line OFF (rn-web 0.21 drops aria-checked → assert the
      // `opacity-40` class the OFF state adds; same source-of-truth as the
      // sibling specs).
      const chip = page.getByLabel("Toggle Squat (Barbell)");
      await expect(chip).toBeVisible({ timeout: 5_000 });
      await expect(chip).not.toHaveClass(/opacity-40/);
      await chip.click();
      await expect(chip).toHaveClass(/opacity-40/);

      // Shrink to a window that does NOT drop Squat (it has week-0 data).
      await page
        .getByRole("button", { name: "Chart window: last 10 weeks" })
        .click();
      // Settle-gate on the selection flip (active segment carries `bg-black`).
      await expect(
        page.getByRole("button", { name: "Chart window: last 10 weeks" }),
      ).toHaveClass(/bg-black/, { timeout: 5_000 });

      // The chip is still present (same series set) AND still OFF — proving
      // the toggle survived the same-series axis shrink (seriesKeysSig stable).
      const chipAfter = page.getByLabel("Toggle Squat (Barbell)");
      await expect(chipAfter).toHaveCount(1);
      await expect(chipAfter).toHaveClass(/opacity-40/);
    } finally {
      await deleteUserSafe(userId);
    }
  });
});
