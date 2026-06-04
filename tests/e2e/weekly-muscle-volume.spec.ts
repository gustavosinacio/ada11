/**
 * E2E for the Phase-1 weekly per-muscle volume chart on the Progress page
 * (`/(app)/progress`) — the section that REPLACES the removed per-session
 * volume chart.
 *
 * Tests:
 *   1. Section renders for a populated user — "Weekly volume per muscle"
 *      header + the muscle legend chip for the trained muscle.
 *   2. The removed per-session chart's "Volume per session" header is GONE.
 *   3. Per-muscle line toggles: tapping a muscle chip toggles its visibility;
 *      "Uncheck all" / "Check all" flips them together.
 *   4. A bodyweight exercise (Chin-up) with a seeded weigh-in surfaces its
 *      primary-muscle line — i.e. the Phase-0 kernel feeds the chart (an
 *      unweighted chin-up contributes bodyweight × reps, so the muscle line
 *      exists where pre-feature it would have been 0).
 *   5. kg↔sets toggle swaps the header + the chart's y-axis + the peak caption.
 *   6. dropset rows are EXCLUDED from the hard-sets count (Invariant D).
 *
 * Flow mirrors `progress-page.spec.ts` (admin-seed via service role, sign in
 * via UI, navigate to /progress). Uses `pickCanonicalExercise` with explicit
 * names; `.first()` on every navigation `getByText` per the suite's
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
  "docs/runs/2026-05-30_0126_bodyweight-volume-per-muscle/screenshots",
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

async function seedFinishedSession(opts: {
  userId: string;
  exerciseId: string;
  completedAt: Date;
  workingSets: number;
  /** numeric(6,2) — stored as a string. `0` for an unweighted bodyweight set. */
  weight: number;
  reps: number;
  /**
   * Append ONE extra dropset row in the SAME session, linked to the first
   * working set via `parent_set_id`. The `sets_parent_matches_type` CHECK
   * constraint requires a dropset to carry a non-null `parent_set_id`
   * (working/warmup rows must carry NULL — `0000_schema.sql:67-68`), so a
   * dropset cannot be seeded as a standalone row. This is the schema-honoring
   * way to seed "2 working + 1 dropset" for the Invariant-D divergence test.
   */
  addDropset?: { weight: number; reps: number };
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
    set_type: "working" as const,
    completed_at: new Date(
      completedAt.getTime() - (workingSets - i) * 60 * 1000,
    ).toISOString(),
  }));
  // Insert working sets first so the dropset can reference a real parent id.
  const { data: insertedWorking, error: e2 } = await admin
    .from("sets")
    .insert(setRows)
    .select("id, set_number");
  if (e2 || !insertedWorking) throw new Error(`sets insert: ${e2?.message}`);

  if (opts.addDropset) {
    // The dropset extends the FIRST working set (set_number 1). It carries the
    // required non-null parent_set_id (Invariant D: it must NOT add a hard-set
    // count, but it MUST be a real, schema-valid dropset row).
    const parent = insertedWorking.find((s) => s.set_number === 1)!;
    const { error: e3 } = await admin.from("sets").insert({
      user_id: userId,
      session_id: sessionId,
      exercise_id: exerciseId,
      set_number: workingSets + 1,
      reps: opts.addDropset.reps,
      weight: opts.addDropset.weight.toString(),
      set_type: "dropset" as const,
      parent_set_id: parent.id as string,
      completed_at: new Date(completedAt.getTime() + 60 * 1000).toISOString(),
    });
    if (e3) throw new Error(`dropset insert: ${e3.message}`);
  }
  return sessionId;
}

async function seedWeighIn(opts: {
  userId: string;
  measuredAt: Date;
  /** numeric(6,2) — stored as a string. */
  weightKg: number;
}): Promise<void> {
  const { userId, measuredAt, weightKg } = opts;
  const { error } = await admin.from("measurement_entries").insert({
    user_id: userId,
    measured_at: measuredAt.toISOString(),
    weight_kg: weightKg.toString(),
  });
  if (error) throw new Error(`measurement insert: ${error.message}`);
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

test.describe("Weekly per-muscle volume chart", () => {
  test("1. section renders for a populated user; old per-session chart is gone", async ({
    page,
  }) => {
    const email = `e2e-muscle-vol-render-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    // Bench Press → primary muscle Chest (barbell, no bodyweight needed).
    const { id: exerciseId } = await pickCanonicalExercise(admin, "Bench Press");

    const thisWeek = mondayNWeeksAgoUtc(0);
    thisWeek.setUTCDate(thisWeek.getUTCDate() + 1);
    thisWeek.setUTCHours(18, 0, 0, 0);
    await seedFinishedSession({
      userId,
      exerciseId,
      completedAt: thisWeek,
      workingSets: 3,
      weight: 100,
      reps: 5,
    });

    try {
      await signInViaUi(page, email);
      await gotoProgress(page);

      // New section header.
      await expect(
        page.getByText("Weekly volume per muscle", { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 });
      // Chest legend chip (Bench Press's primary muscle).
      await expect(
        page.getByText("Chest", { exact: true }).first(),
      ).toBeVisible({ timeout: 5_000 });
      // The removed per-session chart header must NOT appear anywhere.
      await expect(
        page.getByText("Volume per session", { exact: true }),
      ).toHaveCount(0);

      const file = path.join(SCREENSHOT_DIR, "muscle-volume-section.png");
      await page.screenshot({ path: file, fullPage: false });
      console.log(`[screenshot] ${file}`);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("2. check-all / uncheck-all toggles every muscle line", async ({
    page,
  }) => {
    const email = `e2e-muscle-vol-toggle-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const { id: exerciseId } = await pickCanonicalExercise(admin, "Bench Press");

    const thisWeek = mondayNWeeksAgoUtc(0);
    thisWeek.setUTCDate(thisWeek.getUTCDate() + 1);
    thisWeek.setUTCHours(18, 0, 0, 0);
    await seedFinishedSession({
      userId,
      exerciseId,
      completedAt: thisWeek,
      workingSets: 3,
      weight: 100,
      reps: 5,
    });

    try {
      await signInViaUi(page, email);
      await gotoProgress(page);

      await expect(
        page.getByText("Weekly volume per muscle", { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 });

      // All-on by default → control reads "Uncheck all".
      const toggleAll = page.getByRole("button", { name: "Hide all muscles" });
      await expect(toggleAll).toBeVisible({ timeout: 5_000 });
      await toggleAll.click();

      // After uncheck-all the control flips to "Show all muscles".
      await expect(
        page.getByRole("button", { name: "Show all muscles" }),
      ).toBeVisible({ timeout: 5_000 });

      // Re-check all.
      await page.getByRole("button", { name: "Show all muscles" }).click();
      await expect(
        page.getByRole("button", { name: "Hide all muscles" }),
      ).toBeVisible({ timeout: 5_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("3. per-muscle chip toggles a single line's visibility", async ({
    page,
  }) => {
    const email = `e2e-muscle-vol-chip-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const { id: exerciseId } = await pickCanonicalExercise(admin, "Bench Press");

    const thisWeek = mondayNWeeksAgoUtc(0);
    thisWeek.setUTCDate(thisWeek.getUTCDate() + 1);
    thisWeek.setUTCHours(18, 0, 0, 0);
    await seedFinishedSession({
      userId,
      exerciseId,
      completedAt: thisWeek,
      workingSets: 3,
      weight: 100,
      reps: 5,
    });

    try {
      await signInViaUi(page, email);
      await gotoProgress(page);

      await expect(
        page.getByText("Weekly volume per muscle", { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 });

      // Locate the chip via its `aria-label` ("Toggle Chest"). NOTE:
      // react-native-web 0.21 does NOT translate `accessibilityState` to an
      // `aria-checked` DOM attribute (see set-row-menu.spec.ts:141-145), so we
      // assert on the visible NativeWind class the chip toggles: the OFF state
      // adds `opacity-40` (weekly-muscle-volume-section.tsx). That class is the
      // visible source of truth for "hidden line".
      const chip = page.getByLabel("Toggle Chest");
      await expect(chip).toBeVisible({ timeout: 5_000 });
      // On by default → NOT dimmed.
      await expect(chip).not.toHaveClass(/opacity-40/);
      await chip.click();
      // Off → dimmed.
      await expect(chip).toHaveClass(/opacity-40/);
      await chip.click();
      // Back on.
      await expect(chip).not.toHaveClass(/opacity-40/);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("4. bodyweight exercise feeds the chart via the Phase-0 kernel", async ({
    page,
  }) => {
    const email = `e2e-muscle-vol-bw-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    // Chin-up → bodyweight equipment, primary muscle "Upper back".
    const { id: exerciseId } = await pickCanonicalExercise(admin, "Chin-up");

    // A weigh-in BEFORE the session so the bodyweight addend resolves to a
    // prior weight (80 kg) — the unweighted chin-ups now carry real volume.
    const weighIn = mondayNWeeksAgoUtc(1);
    weighIn.setUTCHours(8, 0, 0, 0);
    await seedWeighIn({ userId, measuredAt: weighIn, weightKg: 80 });

    const thisWeek = mondayNWeeksAgoUtc(0);
    thisWeek.setUTCDate(thisWeek.getUTCDate() + 1);
    thisWeek.setUTCHours(18, 0, 0, 0);
    // weight: 0 → unweighted bodyweight set. Pre-feature this contributed 0
    // volume; with the kernel it contributes 80 × reps, so the Upper back line
    // exists. (Chin-up's primary muscle muscles[0] = "Upper back".)
    await seedFinishedSession({
      userId,
      exerciseId,
      completedAt: thisWeek,
      workingSets: 4,
      weight: 0,
      reps: 8,
    });

    try {
      await signInViaUi(page, email);
      await gotoProgress(page);

      await expect(
        page.getByText("Weekly volume per muscle", { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 });
      // The bodyweight chin-ups attribute to the "Upper back" line — present
      // ONLY because the Phase-0 kernel gave the 0-weight sets real volume.
      await expect(
        page.getByText("Upper back", { exact: true }).first(),
      ).toBeVisible({ timeout: 5_000 });

      const file = path.join(SCREENSHOT_DIR, "bodyweight-muscle-line.png");
      await page.screenshot({ path: file, fullPage: false });
      console.log(`[screenshot] ${file}`);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("5. kg↔sets toggle swaps the header and the displayed metric value", async ({
    page,
  }) => {
    const email = `e2e-muscle-vol-toggle-metric-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const { id: exerciseId } = await pickCanonicalExercise(admin, "Bench Press");

    // 3 working Chest sets @ 100×5 → weekly tonnage 3×500 = 1500 kg (peak),
    // sets peak 3. (The presenter accumulates w*r PER ROW into the week bucket,
    // so 3 sets contribute 1500 kg, not 500.)
    const thisWeek = mondayNWeeksAgoUtc(0);
    thisWeek.setUTCDate(thisWeek.getUTCDate() + 1);
    thisWeek.setUTCHours(18, 0, 0, 0);
    await seedFinishedSession({
      userId,
      exerciseId,
      completedAt: thisWeek,
      workingSets: 3,
      weight: 100,
      reps: 5,
    });

    try {
      await signInViaUi(page, email);
      await gotoProgress(page);

      // Default (kg) header.
      await expect(
        page.getByText("Weekly volume per muscle", { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 });
      // The kg-mode weekly peak (3 × 100 × 5 = 1500) shows in the stable
      // `weekly-muscle-peak` caption as "Peak 1,500 kg" (MIN-1: formatVolume
      // adds the " kg" suffix + a thousands comma). This <Text> handle is
      // queryable on web (the y-tick lives in <SvgText>, which is NOT a
      // reliable text-query target — MAJ-1).
      const peak = page.getByTestId("weekly-muscle-peak");
      await expect(peak).toHaveText("Peak 1,500 kg", { timeout: 5_000 });

      // Tap the "Hard sets" segment.
      await page.getByLabel("Metric: hard sets").click();

      // (a) Header swaps to the sets label — a regular <Text> node with the
      // same precedent as the kg header (teeth: a specific string that changes).
      // Await it FIRST so the subsequent value assertion can distinguish
      // "swapped because correct" from "not yet loaded".
      await expect(
        page.getByText("Weekly hard sets per muscle", { exact: true }).first(),
      ).toBeVisible({ timeout: 10_000 });
      // (b) The peak caption swaps to the unitless set count — 3 working sets →
      // "Peak 3 sets". This is the binding teeth: the SAME stable handle flips
      // from a kg string to a set count when the metric toggles. We assert the
      // POSITIVE swap (caption is "Peak 3 sets" — the kg string is gone FROM
      // THE CAPTION) rather than a page-wide absence of "1,500 kg": other
      // Progress surfaces (the weekly-volume PR strip + the exercise
      // volume-target card) legitimately render the same 1,500 kg weekly total
      // and are NOT affected by this chart-local toggle, so a page-wide
      // "1,500 kg" absence assertion would false-fail (proven via runtime probe
      // — those surfaces are unrelated to the muscle chart).
      await expect(peak).toHaveText("Peak 3 sets", { timeout: 5_000 });
      await expect(peak).not.toContainText("kg");

      const file = path.join(SCREENSHOT_DIR, "hard-sets-toggle.png");
      await page.screenshot({ path: file, fullPage: false });
      console.log(`[screenshot] ${file}`);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("6. dropset rows are EXCLUDED from the hard-sets count (Invariant D)", async ({
    page,
  }) => {
    const email = `e2e-muscle-vol-dropset-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const { id: exerciseId } = await pickCanonicalExercise(admin, "Bench Press");

    // Same ISO week, ONE session: 2 working sets + 1 dropset on the SAME muscle
    // (Chest). The dropset carries a non-null parent_set_id (linked to working
    // set 1) per the `sets_parent_matches_type` CHECK constraint. Naive
    // row-count = 3; working-only count = 2.
    const thisWeek = mondayNWeeksAgoUtc(0);
    thisWeek.setUTCDate(thisWeek.getUTCDate() + 1);
    thisWeek.setUTCHours(18, 0, 0, 0);
    await seedFinishedSession({
      userId,
      exerciseId,
      completedAt: thisWeek,
      workingSets: 2,
      weight: 100,
      reps: 5,
      addDropset: { weight: 80, reps: 8 },
    });

    try {
      await signInViaUi(page, email);
      await gotoProgress(page);

      await expect(
        page.getByText("Weekly volume per muscle", { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 });

      // Toggle to hard sets, awaiting the header FIRST so the value assertion
      // below means "correct because the dropset was excluded", not "not yet
      // rendered".
      await page.getByLabel("Metric: hard sets").click();
      await expect(
        page.getByText("Weekly hard sets per muscle", { exact: true }).first(),
      ).toBeVisible({ timeout: 10_000 });

      // Teeth (MAJ-1 / Invariant D): the peak hard-sets count is the
      // working-only value. 2 working + 1 dropset → "Peak 2 sets", NOT the
      // naive row-count "Peak 3 sets". If the dropset regressed into the count,
      // this caption would read "Peak 3 sets" and the assertion would FAIL —
      // real teeth, on a stable non-SVG <Text> handle. The naive "Peak 3 sets"
      // string is also asserted ABSENT for an explicit divergence signal (the
      // peak caption is the ONLY place that text could appear).
      const peak = page.getByTestId("weekly-muscle-peak");
      await expect(peak).toHaveText("Peak 2 sets", { timeout: 5_000 });
      await expect(
        page.getByText("Peak 3 sets", { exact: true }),
      ).toHaveCount(0);

      const file = path.join(SCREENSHOT_DIR, "hard-sets-dropset-excluded.png");
      await page.screenshot({ path: file, fullPage: false });
      console.log(`[screenshot] ${file}`);
    } finally {
      await deleteUserSafe(userId);
    }
  });
});
