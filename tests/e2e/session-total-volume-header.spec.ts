/**
 * E2E for the new session-total-volume metric block inside `<SessionHeader>`
 * on the live workout screen. Created by the Implementer for run
 * 2026-05-23_1805_session-total-volume-header.
 *
 * Strategy:
 *  - Spin up fresh confirmed users via the admin API.
 *  - Pick a seeded exercise ("Bench Press" via `seed_new_user`).
 *  - Seed live-session sets directly via admin, then sign in via the UI,
 *    purge the persisted TanStack cache, and navigate to the live session
 *    so the header mounts cold.
 *  - Drive check / uncheck through the UI (Mark / Unmark `accessibilityLabel`
 *    from `set-input.tsx:117-119`) and assert the header re-renders via
 *    the canonical `accessibilityLabel` `Session total volume: <X kg|lbs>`.
 *
 * Why `getByLabelText(/^Session total volume: …/)` and NOT `getByText("X kg")`:
 *   MIN-2 in validation-v1. Per-exercise `<VolumeTargetSlot>` (volume-target-
 *   slot.tsx:88-117) renders the SAME numeral substring in nested `<Text>`
 *   nodes when there's a previous PR baseline. Playwright strict-mode would
 *   blow up. The a11y label is unique to the header block.
 *
 * Cases:
 *  - (1) Empty session — header reads "0 kg" (label + visible numeral).
 *  - (2) Log + check a set via the UI → header advances to that set's volume.
 *  - (3) Edit weight on the checked set → header re-renders with the new total.
 *  - (4) Uncheck the set → header decrements back to "0 kg".
 *  - (5) A11y label correctness throughout (the label string is the assertion
 *        surface for the entire spec — see MIN-2).
 *
 * The existing `getByText("Elapsed", { exact: true })` selector used by
 * 5 other e2e specs is also re-asserted here as a regression guard.
 */

import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { pickCanonicalExercise } from "./_helpers/canonical-exercise";
import * as dotenv from "dotenv";

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

async function getSeedExerciseByName(
  _userId: string,
  preferred: string,
): Promise<{ id: string; name: string }> {
  return pickCanonicalExercise(admin, preferred);
}

async function startLiveSession(userId: string): Promise<string> {
  const { data: sess, error } = await admin
    .from("sessions")
    .insert({
      user_id: userId,
      started_at: new Date().toISOString(),
      ended_at: null,
      name: "Volume-header test live session",
    })
    .select("id")
    .single();
  if (error || !sess) throw new Error(`live session insert: ${error?.message}`);
  return sess.id as string;
}

async function seedLiveSet(opts: {
  userId: string;
  sessionId: string;
  exerciseId: string;
  setNumber: number;
  weightKg: number;
  reps: number;
  setType?: "warmup" | "working" | "dropset";
  completedAt?: string | null;
}): Promise<string> {
  const { data, error } = await admin
    .from("sets")
    .insert({
      user_id: opts.userId,
      session_id: opts.sessionId,
      exercise_id: opts.exerciseId,
      set_number: opts.setNumber,
      reps: opts.reps,
      weight: opts.weightKg.toString(),
      set_type: opts.setType ?? "working",
      completed_at: opts.completedAt ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`live set insert: ${error?.message}`);
  return data.id as string;
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

async function purgeQueryCache(page: Page) {
  await page.evaluate(() => {
    window.localStorage.removeItem("ada11-query-cache");
  });
}

async function gotoLiveSession(page: Page, sessionId: string) {
  await purgeQueryCache(page);
  await page.goto(`/(app)/workout/${sessionId}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForURL(/\/workout\/[0-9a-f-]+/, { timeout: 15_000 });
  // Wait for the live header to render (sets cache resolved).
  await expect(page.getByText("Elapsed", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("Session total volume — live workout header", () => {
  test("(1) empty session: header reads '0 kg' (label + visible numeral)", async ({
    page,
  }) => {
    const email = `e2e-sessvol-empty-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);

    try {
      const liveSessionId = await startLiveSession(userId);

      await signInAndLand(page, email);
      await gotoLiveSession(page, liveSessionId);

      // Header regression guard: the locked-in "Elapsed" selector still
      // resolves uniquely (5 other e2e specs depend on this).
      await expect(page.getByText("Elapsed", { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      // New "Volume" label is present and unique on the live screen header.
      await expect(page.getByText("Volume", { exact: true })).toBeVisible({
        timeout: 10_000,
      });

      // A11y label gate (MIN-2: this is the load-bearing selector — NOT
      // `getByText("0 kg")`, which collides with per-exercise slots on
      // multi-exercise sessions).
      await expect(
        page.getByLabel(/^Session total volume: 0 kg$/).first(),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("(2) seeded checked set: header equals the set's volume", async ({
    page,
  }) => {
    const email = `e2e-sessvol-seeded-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);

    try {
      const exercise = await getSeedExerciseByName(userId, "Bench Press");
      const liveSessionId = await startLiveSession(userId);

      // Seed a CHECKED working set: 100 kg × 5 = 500 kg.
      await seedLiveSet({
        userId,
        sessionId: liveSessionId,
        exerciseId: exercise.id,
        setNumber: 1,
        weightKg: 100,
        reps: 5,
        completedAt: new Date().toISOString(),
      });

      await signInAndLand(page, email);
      await gotoLiveSession(page, liveSessionId);

      await expect(
        page.getByLabel(/^Session total volume: 500 kg$/).first(),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("(3) check a set via the UI → header advances to the set's volume", async ({
    page,
  }) => {
    const email = `e2e-sessvol-check-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);

    try {
      const exercise = await getSeedExerciseByName(userId, "Bench Press");
      const liveSessionId = await startLiveSession(userId);

      // Seed an UNCHECKED working set (draft) with weight + reps already
      // filled. The header should start at 0 kg because F10 excludes
      // unchecked drafts.
      await seedLiveSet({
        userId,
        sessionId: liveSessionId,
        exerciseId: exercise.id,
        setNumber: 1,
        weightKg: 100,
        reps: 5,
        completedAt: null,
      });

      await signInAndLand(page, email);
      await gotoLiveSession(page, liveSessionId);

      // Before check: header reads 0 kg (F10 — draft excluded).
      await expect(
        page.getByLabel(/^Session total volume: 0 kg$/).first(),
      ).toBeVisible({ timeout: 15_000 });

      // Check the set via the UI.
      await page.getByLabel("Mark set as completed").first().click();

      // After check: header advances to 500 kg.
      await expect(
        page.getByLabel(/^Session total volume: 500 kg$/).first(),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("(4) edit weight on a checked set → header re-renders with the new total", async ({
    page,
  }) => {
    const email = `e2e-sessvol-edit-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);

    try {
      const exercise = await getSeedExerciseByName(userId, "Bench Press");
      const liveSessionId = await startLiveSession(userId);

      // Seed a CHECKED working set: 100 kg × 5 = 500 kg.
      await seedLiveSet({
        userId,
        sessionId: liveSessionId,
        exerciseId: exercise.id,
        setNumber: 1,
        weightKg: 100,
        reps: 5,
        completedAt: new Date().toISOString(),
      });

      await signInAndLand(page, email);
      await gotoLiveSession(page, liveSessionId);

      // Before edit: header at 500 kg.
      await expect(
        page.getByLabel(/^Session total volume: 500 kg$/).first(),
      ).toBeVisible({ timeout: 15_000 });

      // Edit the weight to 120 kg (120 × 5 = 600 kg). The weight `<TextInput>`
      // commits on blur (see set-input.tsx). Filling + tabbing-out triggers
      // the `useUpdateSet` mutation which invalidates the sets cache.
      const weightInputs = page.getByPlaceholder(/kg|lbs/);
      const firstWeight = weightInputs.first();
      await firstWeight.click();
      await firstWeight.fill("120");
      await firstWeight.blur();

      // After edit: header advances to 600 kg.
      await expect(
        page.getByLabel(/^Session total volume: 600 kg$/).first(),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("(5) uncheck a checked set → header decrements to 0 kg", async ({
    page,
  }) => {
    const email = `e2e-sessvol-uncheck-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);

    try {
      const exercise = await getSeedExerciseByName(userId, "Bench Press");
      const liveSessionId = await startLiveSession(userId);

      // Seed a CHECKED working set: 100 kg × 5 = 500 kg.
      await seedLiveSet({
        userId,
        sessionId: liveSessionId,
        exerciseId: exercise.id,
        setNumber: 1,
        weightKg: 100,
        reps: 5,
        completedAt: new Date().toISOString(),
      });

      await signInAndLand(page, email);
      await gotoLiveSession(page, liveSessionId);

      // Before uncheck: header at 500 kg.
      await expect(
        page.getByLabel(/^Session total volume: 500 kg$/).first(),
      ).toBeVisible({ timeout: 15_000 });

      // Uncheck the set via the UI.
      await page.getByLabel("Unmark set as completed").first().click();

      // After uncheck: F10 excludes the draft → header back to 0 kg.
      await expect(
        page.getByLabel(/^Session total volume: 0 kg$/).first(),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });
});
