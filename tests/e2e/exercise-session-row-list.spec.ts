/**
 * E2E driver for the "Sessions" list on `/(app)/exercises/{id}/progress`
 * (run 2026-05-24_2233_sessions-list-on-progress-chart).
 *
 * Pinned surfaces (design-v2):
 *  - Multi-row a11y label: every row exposes `accessibilityLabel="Open session
 *    from <weekday, date, time>"`. We anchor on `page.getByLabel(/^Open session
 *    from /)` and assert `.count()` equals the number of seeded sessions.
 *  - Aggregate format: at least one row text matches the unit-agnostic
 *    `^\d+ × [\d,]+ (kg|lbs)$` regex.
 *  - Explicit lbs case: in lbs mode the label ends with `lbs` (the unit-test
 *    fixture in `exercise-session-row-format.test.ts` is not sufficient — the
 *    regex gates the screen output, so both units must be exercised).
 *  - Section header text "Sessions".
 *  - Negative case (warmup-only screen-wide): empty state copy
 *    `/No working sets recorded yet/i` remains visible AND the "Sessions"
 *    header is NOT in the DOM.
 *  - Ordering: DESC by `started_at` (newest row first).
 *  - Tap-through: pressing a row pushes `/(app)/history/{session_id}`.
 *
 * Created by the Implementer agent. Mirrors the seeding helpers in
 * `exercise-progress-ia.spec.ts` and `auto-fill-placeholder-on-check.spec.ts`.
 */

import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

import { pickCanonicalExercise } from "./_helpers/canonical-exercise";

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
  } catch {
    // best-effort
  } finally {
    createdUserIds.delete(userId);
  }
}

async function signInAndLand(page: Page, email: string) {
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Sign in", { exact: true }).first()).toBeVisible({
    timeout: 15_000,
  });
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByText("Sign in", { exact: true }).last().click();
  await page.waitForURL(/\/workout/, { timeout: 15_000 });
}

async function getSeedExerciseByName(
  _userId: string,
  preferred: string,
): Promise<{ id: string; name: string }> {
  return pickCanonicalExercise(admin, preferred);
}

async function setWeightUnit(userId: string, unit: "kg" | "lbs"): Promise<void> {
  const { error } = await admin
    .from("user_preferences")
    .upsert(
      { user_id: userId, weight_unit: unit },
      { onConflict: "user_id" },
    );
  if (error) throw new Error(`user_preferences upsert: ${error.message}`);
}

/**
 * Seeds a finished session with one or more sets for one exercise.
 * Returns the session id for tap-through assertions.
 */
async function seedFinishedSession(opts: {
  userId: string;
  exerciseId: string;
  startedAt: Date;
  endedAt: Date;
  sets: {
    setNumber: number;
    weightKg: number | null;
    reps: number | null;
    setType?: "warmup" | "working" | "dropset";
  }[];
}): Promise<string> {
  const { data: sess, error: e1 } = await admin
    .from("sessions")
    .insert({
      user_id: opts.userId,
      started_at: opts.startedAt.toISOString(),
      ended_at: opts.endedAt.toISOString(),
      name: "Seeded session",
    })
    .select("id")
    .single();
  if (e1 || !sess) throw new Error(`session insert: ${e1?.message}`);

  if (opts.sets.length > 0) {
    const { error: e2 } = await admin.from("sets").insert(
      opts.sets.map((s) => ({
        user_id: opts.userId,
        session_id: sess.id,
        exercise_id: opts.exerciseId,
        set_number: s.setNumber,
        reps: s.reps,
        weight: s.weightKg != null ? s.weightKg.toString() : null,
        set_type: s.setType ?? "working",
        completed_at: opts.endedAt.toISOString(),
      })),
    );
    if (e2) throw new Error(`sets insert: ${e2.message}`);
  }

  return sess.id as string;
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

test.afterAll(async () => {
  await Promise.all(Array.from(createdUserIds).map(deleteUserSafe));
});

test.describe("Exercise progress · Sessions list (web)", () => {
  test("golden: 3 sessions render DESC, aggregate matches `N × volume kg`, tap-through pushes /history/{id}", async ({
    page,
  }) => {
    const email = `e2e-ex-sess-golden-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);

    try {
      const bench = await getSeedExerciseByName(userId, "Bench Press");

      // Three sessions, DESC by date (most recent at the top).
      await seedFinishedSession({
        userId,
        exerciseId: bench.id,
        startedAt: daysAgo(10),
        endedAt: daysAgo(10),
        sets: [
          { setNumber: 1, weightKg: 100, reps: 8 },
          { setNumber: 2, weightKg: 100, reps: 8 },
          { setNumber: 3, weightKg: 100, reps: 8 },
        ],
      });
      await seedFinishedSession({
        userId,
        exerciseId: bench.id,
        startedAt: daysAgo(5),
        endedAt: daysAgo(5),
        sets: [
          { setNumber: 1, weightKg: 100, reps: 8 },
          { setNumber: 2, weightKg: 100, reps: 8 },
          { setNumber: 3, weightKg: 100, reps: 8 },
          { setNumber: 4, weightKg: 100, reps: 8 },
        ],
      });
      const newestSessionId = await seedFinishedSession({
        userId,
        exerciseId: bench.id,
        startedAt: daysAgo(1),
        endedAt: daysAgo(1),
        sets: [
          { setNumber: 1, weightKg: 110, reps: 6 },
          { setNumber: 2, weightKg: 110, reps: 6 },
        ],
      });

      await signInAndLand(page, email);

      // Navigate to Bench Press progress.
      await page.goto(`/(app)/exercises/${bench.id}/progress`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForURL(/\/exercises\/[0-9a-f-]+\/progress/, {
        timeout: 10_000,
      });

      // Section header.
      await expect(page.getByText("Sessions", { exact: true })).toBeVisible({
        timeout: 10_000,
      });

      // Cardinality: 3 rows with the a11y label prefix.
      const rows = page.getByLabel(/^Open session from /);
      await expect(rows).toHaveCount(3, { timeout: 10_000 });

      // Aggregate format unit-agnostic — at least one row exposes the
      // `4 × 3,200 kg` / `2 × 1,320 kg` shape.
      const aggregateText = page
        .getByText(/^\d+ × [\d,]+ (kg|lbs)$/)
        .first();
      await expect(aggregateText).toBeVisible({ timeout: 5_000 });

      // Tap the newest row (first in DESC order) — must land on the
      // corresponding history detail.
      await rows.first().click();
      await page.waitForURL(
        new RegExp(`/history/${newestSessionId}(\\?.*)?$`),
        { timeout: 10_000 },
      );
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("lbs mode: aggregate label suffix is 'lbs'", async ({ page }) => {
    const email = `e2e-ex-sess-lbs-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);

    try {
      const bench = await getSeedExerciseByName(userId, "Bench Press");
      await setWeightUnit(userId, "lbs");
      await seedFinishedSession({
        userId,
        exerciseId: bench.id,
        startedAt: daysAgo(2),
        endedAt: daysAgo(2),
        sets: [
          { setNumber: 1, weightKg: 100, reps: 8 },
          { setNumber: 2, weightKg: 100, reps: 8 },
          { setNumber: 3, weightKg: 100, reps: 8 },
          { setNumber: 4, weightKg: 100, reps: 8 },
        ],
      });

      await signInAndLand(page, email);

      await page.goto(`/(app)/exercises/${bench.id}/progress`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForURL(/\/exercises\/[0-9a-f-]+\/progress/, {
        timeout: 10_000,
      });

      // 4 × 100kg × 8 = 3,200 kg → 7,055 lbs (formatVolume rounding).
      await expect(
        page.getByText(/^\d+ × [\d,]+ lbs$/).first(),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("warmup-only fixture: empty state visible AND 'Sessions' header NOT in DOM", async ({
    page,
  }) => {
    const email = `e2e-ex-sess-warmup-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);

    try {
      const bench = await getSeedExerciseByName(userId, "Bench Press");
      // Only warmups → e1rmData.length === 0 → empty-state branch wins,
      // Sessions section is gated behind the truthy branch and must not
      // render.
      await seedFinishedSession({
        userId,
        exerciseId: bench.id,
        startedAt: daysAgo(3),
        endedAt: daysAgo(3),
        sets: [
          { setNumber: 1, setType: "warmup", weightKg: 40, reps: 10 },
          { setNumber: 2, setType: "warmup", weightKg: 60, reps: 5 },
        ],
      });

      await signInAndLand(page, email);

      await page.goto(`/(app)/exercises/${bench.id}/progress`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForURL(/\/exercises\/[0-9a-f-]+\/progress/, {
        timeout: 10_000,
      });

      // Pinned empty-state copy remains intact.
      await expect(
        page.getByText(/No working sets recorded yet/i),
      ).toBeVisible({ timeout: 10_000 });

      // Section header MUST NOT appear in the warmup-only state.
      await expect(
        page.getByText("Sessions", { exact: true }),
      ).toHaveCount(0);
      // ...and no row a11y labels either.
      await expect(page.getByLabel(/^Open session from /)).toHaveCount(0);
    } finally {
      await deleteUserSafe(userId);
    }
  });
});
