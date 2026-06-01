/**
 * E2E for Phase-2b: favoriting an exercise pins it into the e1RM strength
 * chart (union with the auto top-N), on the Progress page (`/(app)/progress`).
 *
 * Tests the full union loop:
 *   - 5 high-distinct-session WEIGHTED exercises fill the auto top-5.
 *   - 1 single-session WEIGHTED TARGET sits OUTSIDE the top-5 → absent from the
 *     chart initially.
 *   - Favoriting the TARGET on its detail page (header-right star, OUTSIDE the
 *     `canEdit` gate so it works for a CANONICAL exercise) → the TARGET's line
 *     joins the chart.
 *   - Unfavoriting → it leaves (it was not also top-5).
 *   - Canonical gate split: on the canonical TARGET, the star renders AND the
 *     Pencil (a11y label "Edit exercise") is absent.
 *
 * Flow mirrors `e1rm-strength.spec.ts` (admin-seed via service role, sign in
 * via UI, navigate to /progress). Seed names are LIVE-CATALOG-VERIFIED via
 * `pickCanonicalExercise` (throws on a missing name → fails fast).
 *
 * CARRY-IN settle-gate (Phase-2a MAJ-1): EVERY "NOT present" assertion follows
 * a positive settle anchor (the section header visible) so it is not a cold
 * false-green before the chart mounts.
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
  "docs/runs/2026-06-01_1301_favorite-exercises-e1rm/screenshots",
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

/** Tuesday 18:00 UTC of the ISO week `weekOffset` weeks ago — mid-week. */
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
  await page.goto("/progress", { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
}

const SECTION_HEADER = "Estimated 1RM per exercise";

// 5 multi-session top exercises + 1 single-session outside-top-N TARGET.
// All LIVE-CATALOG-VERIFIED WEIGHTED canonical names (seeded with weight>0 so
// each plots under Invariant D). NOTE: design-v2 §D named "Deadlift (Barbell)",
// "Overhead Press (Barbell)", "Barbell Row", "Lat Pulldown (Cable)" — none of
// which exist in the live catalog (probed at implement time). Substituted the
// verified equivalents below (fails fast via pickCanonicalExercise otherwise).
const TOP_NAMES = [
  "Bench Press",
  "Squat (Barbell)",
  "Deadlift",
  "Overhead Press",
  "Row (Barbell)",
] as const;
const TARGET_NAME = "Lat Pulldown";

test.describe("favorite exercises → e1RM chart union", () => {
  test("favoriting an outside-top-N exercise pins it into the chart; unfavoriting removes it", async ({
    page,
  }) => {
    const email = `e2e-fav-e1rm-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);

    // 5 top exercises, each logged across 2 distinct sessions (2 weeks) → high
    // distinct-session count → fill the auto top-5.
    const topIds: string[] = [];
    for (const name of TOP_NAMES) {
      const { id } = await pickCanonicalExercise(admin, name);
      topIds.push(id);
      await seedFinishedSession({
        userId,
        exerciseId: id,
        completedAt: midWeekUtc(1),
        workingSets: 3,
        weight: 90,
        reps: 5,
      });
      await seedFinishedSession({
        userId,
        exerciseId: id,
        completedAt: midWeekUtc(0),
        workingSets: 3,
        weight: 100,
        reps: 5,
      });
    }

    // TARGET — a single session only (lowest distinct-session count) → sits
    // OUTSIDE the auto top-5. A canonical exercise → exercises the canonical-
    // favorite + Pencil-hidden path too.
    const { id: targetId } = await pickCanonicalExercise(admin, TARGET_NAME);
    await seedFinishedSession({
      userId,
      exerciseId: targetId,
      completedAt: midWeekUtc(0),
      workingSets: 3,
      weight: 60,
      reps: 8,
    });

    try {
      await signInViaUi(page, email);
      await gotoProgress(page);

      // --- Step 2: settle anchor + negative-before assertion ---------------
      await expect(
        page.getByText(SECTION_HEADER, { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 });
      // The TARGET is outside the top-5 → its legend chip is absent initially.
      await expect(
        page.getByLabel(`Toggle ${TARGET_NAME}`),
      ).toHaveCount(0);

      // --- Step 3: canonical gate split -----------------------------------
      await page.goto(`/exercises/${targetId}/progress`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      // The star renders on a CANONICAL exercise (outside the canEdit gate).
      const favStar = page.getByLabel(`Favorite ${TARGET_NAME}`);
      await expect(favStar).toBeVisible({ timeout: 15_000 });
      // The Pencil ("Edit exercise") is HIDDEN for a non-editable canonical
      // exercise → proves the star is OUTSIDE the canEdit gate.
      await expect(page.getByLabel("Edit exercise")).toHaveCount(0);

      // --- Step 4: favorite the TARGET (optimistic) -----------------------
      // Await the persistence INSERT before leaving the detail page so the
      // optimistic write has landed server-side (belt-and-suspenders against
      // the in-flight fetch being aborted by navigation).
      await Promise.all([
        page.waitForResponse(
          (r) =>
            /\/rest\/v1\/user_exercise_favorites/.test(r.url()) &&
            r.request().method() === "POST" &&
            r.status() < 300,
          { timeout: 15_000 },
        ),
        favStar.click(),
      ]);
      // Optimistic: the label flips to "Unfavorite …".
      await expect(
        page.getByLabel(`Unfavorite ${TARGET_NAME}`),
      ).toBeVisible({ timeout: 10_000 });

      // --- Step 5: settle anchor + positive assertion ---------------------
      // Return to /progress via a CLIENT-SIDE bottom-tab tap (no hard reload)
      // so the in-memory query cache (with the optimistic + onSettled-
      // invalidated favorites) is preserved — a hard page.goto reload would
      // rehydrate a stale empty favorites list from the AsyncStorage-persisted
      // cache. Mirrors the bottom-tab nav convention in auth.spec.ts:303.
      await page.getByText("Progress", { exact: true }).first().click();
      await page.waitForURL(/\/progress$/, { timeout: 10_000 });
      await expect(
        page.getByText(SECTION_HEADER, { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 });
      // The favorited line joined the chart.
      await expect(
        page.getByLabel(`Toggle ${TARGET_NAME}`),
      ).toBeVisible({ timeout: 10_000 });

      const file = path.join(SCREENSHOT_DIR, "favorite-pinned.png");
      await page.screenshot({ path: file, fullPage: false });
      console.log(`[screenshot] ${file}`);

      // --- Step 6: unfavorite → it leaves ---------------------------------
      await page.goto(`/exercises/${targetId}/progress`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      const unfavStar = page.getByLabel(`Unfavorite ${TARGET_NAME}`);
      await expect(unfavStar).toBeVisible({ timeout: 15_000 });
      // Await the persistence DELETE before leaving the detail page.
      await Promise.all([
        page.waitForResponse(
          (r) =>
            /\/rest\/v1\/user_exercise_favorites/.test(r.url()) &&
            r.request().method() === "DELETE" &&
            r.status() < 300,
          { timeout: 15_000 },
        ),
        unfavStar.click(),
      ]);
      await expect(
        page.getByLabel(`Favorite ${TARGET_NAME}`),
      ).toBeVisible({ timeout: 10_000 });

      // Return to /progress via the CLIENT-SIDE bottom-tab tap (no hard reload),
      // same reasoning as step 5.
      await page.getByText("Progress", { exact: true }).first().click();
      await page.waitForURL(/\/progress$/, { timeout: 10_000 });
      await expect(
        page.getByText(SECTION_HEADER, { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 });
      // It wasn't also top-5, so it leaves the chart.
      await expect(
        page.getByLabel(`Toggle ${TARGET_NAME}`),
      ).toHaveCount(0);
    } finally {
      await deleteUserSafe(userId);
    }
  });
});
