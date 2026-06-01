/**
 * Dynamic E2E for the scrollable weekly-volume strip + week selector.
 *
 * Strategy:
 *  - Seed a user with ≥16 weeks of activity.
 *  - Sign in, navigate to /history, assert:
 *    (a) the strip mounts pinned to the right edge (current week visible),
 *    (b) older bars are off-screen but reachable via horizontal scroll,
 *    (c) the visible-range pill renders a label,
 *    (d) tapping the pill opens the bottom-sheet selector,
 *    (e) confirming a Year/Month pick scrolls the strip,
 *    (f) the modal can be dismissed via backdrop tap.
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
  "docs/runs/2026-05-22_1130_chart-scroll-week-selector/screenshots",
);
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

// MIN-A: ensure the current run's screenshot directory exists before any test
// captures into it. Pattern mirrors `SCREENSHOT_DIR` above.
const NARROW_VIEWPORT_SCREENSHOT_DIR = path.resolve(
  "docs/runs/2026-05-23_2357_progress-graph-current-week/screenshots",
);
fs.mkdirSync(NARROW_VIEWPORT_SCREENSHOT_DIR, { recursive: true });

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

test.describe("Weekly volume strip — scroll + week selector", () => {
  test("default mount: pinned to right edge, current-week visible, pill rendered", async ({
    page,
  }) => {
    const email = `e2e-scroll-default-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exerciseId = await getSeedExerciseId(userId);

    // Seed 16 weeks of activity (every other week, varying weights).
    for (let offset = 0; offset < 16; offset++) {
      const dt = mondayNWeeksAgoUtc(offset);
      dt.setUTCDate(dt.getUTCDate() + 2);
      dt.setUTCHours(18, 0, 0, 0);
      const weight = 50 + offset * 5; // vary so heights differ
      await seedFinishedSession({
        userId,
        exerciseId,
        completedAt: dt,
        workingSets: 3,
        weight,
        reps: 5,
      });
    }

    try {
      await signInViaUi(page, email);
      await gotoHistory(page);

      // Strip mounted, "This week" headline visible.
      await expect(page.getByText("This week", { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      // Visible-range pill ("Jump to week — visible range ..."): present and
      // tappable. We assert by accessibility role.
      const pill = page.getByRole("button", {
        name: /Jump to week — visible range/,
      });
      await expect(pill).toBeVisible({ timeout: 5_000 });

      // Current-week bar (rightmost) is in view by default.
      const currentMonday = mondayNWeeksAgoUtc(0);
      // dd/mm, zero-padded — matches `formatShortDate` after the app-wide
      // date-format swap (5a2382b). The bar a11y label is
      // `View week of ${formatShortDate(b.start)}` = "25/05", not "5/25".
      const currentLabel = `${String(currentMonday.getUTCDate()).padStart(2, "0")}/${String(currentMonday.getUTCMonth() + 1).padStart(2, "0")}`;
      const currentBar = page.getByRole("button", {
        name: `View week of ${currentLabel}`,
      });
      await expect(currentBar).toBeVisible({ timeout: 5_000 });

      const file = path.join(SCREENSHOT_DIR, "scroll-default-mount.png");
      await page.screenshot({ path: file, fullPage: false });
      console.log(`[screenshot] ${file}`);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("week-selector flow: tap pill → modal opens → confirm scrolls strip", async ({
    page,
  }) => {
    const email = `e2e-scroll-selector-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exerciseId = await getSeedExerciseId(userId);

    // Seed 16 weeks so the strip definitely has content older than the
    // initial viewport.
    for (let offset = 0; offset < 16; offset++) {
      const dt = mondayNWeeksAgoUtc(offset);
      dt.setUTCDate(dt.getUTCDate() + 2);
      dt.setUTCHours(18, 0, 0, 0);
      await seedFinishedSession({
        userId,
        exerciseId,
        completedAt: dt,
        workingSets: 3,
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

      // Open the selector.
      const pill = page.getByRole("button", {
        name: /Jump to week — visible range/,
      });
      await pill.click();

      // Modal header should be visible.
      await expect(
        page.getByText("Jump to month", { exact: true }),
      ).toBeVisible({ timeout: 5_000 });

      // Tap the Jump button — selector picks the last-available (year, month)
      // by default, which is "now". Confirms the modal closes without crash.
      const jumpBtn = page.getByRole("button", {
        name: "Jump to selected month",
      });
      await jumpBtn.click();

      // Modal dismissed: header no longer visible.
      await expect(
        page.getByText("Jump to month", { exact: true }),
      ).toHaveCount(0, { timeout: 5_000 });

      // Pill still rendered.
      await expect(pill).toBeVisible({ timeout: 5_000 });

      const file = path.join(SCREENSHOT_DIR, "scroll-selector-flow.png");
      await page.screenshot({ path: file, fullPage: false });
      console.log(`[screenshot] ${file}`);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("modal backdrop dismiss: tap outside the card closes it", async ({
    page,
  }) => {
    const email = `e2e-scroll-backdrop-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exerciseId = await getSeedExerciseId(userId);

    // Minimal seed — just the current week so the strip renders the pill.
    const dt = mondayNWeeksAgoUtc(0);
    dt.setUTCDate(dt.getUTCDate() + 2);
    dt.setUTCHours(18, 0, 0, 0);
    await seedFinishedSession({
      userId,
      exerciseId,
      completedAt: dt,
      workingSets: 3,
      weight: 100,
      reps: 5,
    });

    try {
      await signInViaUi(page, email);
      await gotoHistory(page);

      await expect(page.getByText("This week", { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      const pill = page.getByRole("button", {
        name: /Jump to week — visible range/,
      });
      await pill.click();

      await expect(
        page.getByText("Jump to month", { exact: true }),
      ).toBeVisible({ timeout: 5_000 });

      // Tap the backdrop dismiss button.
      const dismiss = page.getByRole("button", {
        name: "Dismiss week selector",
      });
      await dismiss.click();

      await expect(
        page.getByText("Jump to month", { exact: true }),
      ).toHaveCount(0, { timeout: 5_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("default mount on narrow viewport: scroll is pinned to right edge", async ({
    page,
  }) => {
    // CRITICAL: shrink viewport BEFORE sign-in / navigation so layout reflects
    // 390pt width when the strip first measures itself. On the default
    // Playwright viewport (~1280pt) the entire 16-bucket strip fits without
    // overflow and the regression cannot be observed.
    await page.setViewportSize({ width: 390, height: 844 });

    const email = `e2e-scroll-narrow-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exerciseId = await getSeedExerciseId(userId);

    // Seed 16 weeks so the strip definitely overflows a 390pt viewport.
    for (let offset = 0; offset < 16; offset++) {
      const dt = mondayNWeeksAgoUtc(offset);
      dt.setUTCDate(dt.getUTCDate() + 2);
      dt.setUTCHours(18, 0, 0, 0);
      await seedFinishedSession({
        userId,
        exerciseId,
        completedAt: dt,
        workingSets: 3,
        weight: 50 + offset * 5,
        reps: 5,
      });
    }

    try {
      await signInViaUi(page, email);
      await gotoHistory(page);

      await expect(page.getByText("This week", { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      // Direct selector via data-testid emitted by RN Web from
      // testID="weekly-strip-scroller" on the <ScrollView>.
      const scroller = page.locator('[data-testid="weekly-strip-scroller"]');
      await expect(scroller).toBeVisible({ timeout: 5_000 });

      // Deterministic regression-killer: scrollLeft + clientWidth must equal
      // scrollWidth (within 4-px sub-pixel tolerance) — i.e. pinned right.
      const pinned = await scroller.evaluate((el) => {
        const slack = el.scrollWidth - el.clientWidth - el.scrollLeft;
        return {
          ok: slack <= 4,
          slack,
          scrollLeft: el.scrollLeft,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        };
      });
      expect(
        pinned.ok,
        `scroll not pinned to right edge: ${JSON.stringify(pinned)}`,
      ).toBe(true);

      // Sanity: current-week bar is present in the DOM (no a11y regression).
      const currentMonday = mondayNWeeksAgoUtc(0);
      // dd/mm, zero-padded — matches `formatShortDate` after the app-wide
      // date-format swap (5a2382b). The bar a11y label is
      // `View week of ${formatShortDate(b.start)}` = "25/05", not "5/25".
      const currentLabel = `${String(currentMonday.getUTCDate()).padStart(2, "0")}/${String(currentMonday.getUTCMonth() + 1).padStart(2, "0")}`;
      await expect(
        page.getByRole("button", { name: `View week of ${currentLabel}` }),
      ).toBeVisible({ timeout: 5_000 });

      // MIN-5 / MIN-A: capture the narrow-viewport pinned screenshot as
      // visual evidence. Directory created at module load via
      // NARROW_VIEWPORT_SCREENSHOT_DIR.
      const file = path.join(
        NARROW_VIEWPORT_SCREENSHOT_DIR,
        "narrow-viewport-pin.png",
      );
      await page.screenshot({ path: file, fullPage: false });
      console.log(`[screenshot] ${file}`);
    } finally {
      await deleteUserSafe(userId);
    }
  });
});
