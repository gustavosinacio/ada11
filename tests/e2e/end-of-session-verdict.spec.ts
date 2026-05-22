/**
 * E2E for the end-of-session verdict screen
 * (`app/(app)/workout/verdict/[sessionId].tsx`). Created by the Implementer
 * for run 2026-05-22_0152_end-of-session-verdict.
 *
 * Strategy:
 *  - Spin up fresh confirmed users via the admin API.
 *  - Pick a seeded exercise (the seed_new_user trigger inserts ~30 lifts).
 *  - Seed prior finished sessions + live-session sets directly via admin, then
 *    sign in via UI, navigate to the live workout, tap Finish, accept the
 *    confirm dialog, and assert against the verdict screen.
 *
 * Cases:
 *  - Case A (finish-with-PR via bulk-check-all): seed 500 kg prior bench,
 *    log 600 kg current bench WITHOUT checking (forces the bulk-check-all
 *    Finish branch). Assert `/workout/verdict/<id>`, `+1 PRs`, `600 kg`
 *    (load-bearing MAJ-2 regression guard — would render `0 kg` pre-fix),
 *    `+100 kg (was 500 kg)` PR sub-line, then tap Done and assert `/workout$`.
 *  - Case B (finish-with-no-sets): empty session, Finish, assert verdict
 *    headline `0 PRs · 0 kg · 0m` and the zero-volume empty-state copy.
 */

import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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
  userId: string,
  preferred: string,
): Promise<{ id: string; name: string }> {
  const { data, error } = await admin
    .from("exercises")
    .select("id, name")
    .eq("user_id", userId)
    .is("deleted_at", null);
  if (error || !data || data.length === 0) {
    throw new Error(`No exercises for ${userId}: ${error?.message}`);
  }
  const match = data.find((r) => r.name === preferred);
  if (match) return { id: match.id, name: match.name };
  return { id: data[0]!.id, name: data[0]!.name };
}

async function seedFinishedSession(opts: {
  userId: string;
  exerciseId: string;
  workingSets: { weight: number; reps: number }[];
  finishedDaysAgo?: number;
}): Promise<string> {
  const finishedDaysAgo = opts.finishedDaysAgo ?? 3;
  const endedAt = new Date(Date.now() - finishedDaysAgo * 24 * 60 * 60 * 1000);
  const startedAt = new Date(endedAt.getTime() - 60 * 60 * 1000);
  const { data: sess, error: e1 } = await admin
    .from("sessions")
    .insert({
      user_id: opts.userId,
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      name: "Seeded prior session",
    })
    .select("id")
    .single();
  if (e1 || !sess) throw new Error(`session insert: ${e1?.message}`);

  const rows = opts.workingSets.map((ws, i) => ({
    user_id: opts.userId,
    session_id: sess.id,
    exercise_id: opts.exerciseId,
    set_number: i + 1,
    reps: ws.reps,
    weight: ws.weight.toString(),
    set_type: "working",
    completed_at: new Date(
      endedAt.getTime() - (opts.workingSets.length - i) * 60 * 1000,
    ).toISOString(),
  }));
  const { error: e2 } = await admin.from("sets").insert(rows);
  if (e2) throw new Error(`sets insert: ${e2.message}`);
  return sess.id as string;
}

async function startLiveSession(userId: string): Promise<string> {
  const { data: sess, error } = await admin
    .from("sessions")
    .insert({
      user_id: userId,
      started_at: new Date().toISOString(),
      ended_at: null,
      name: "Verdict test live session",
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
}): Promise<void> {
  const { error } = await admin.from("sets").insert({
    user_id: opts.userId,
    session_id: opts.sessionId,
    exercise_id: opts.exerciseId,
    set_number: opts.setNumber,
    reps: opts.reps,
    weight: opts.weightKg.toString(),
    set_type: opts.setType ?? "working",
    completed_at: opts.completedAt ?? null,
  });
  if (error) throw new Error(`live set insert: ${error.message}`);
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
}

test.describe("End-of-session verdict screen", () => {
  test("Case A: finish-with-PR via bulk-check-all (MAJ-2 regression guard)", async ({
    page,
  }) => {
    const email = `e2e-verdict-pr-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);

    try {
      const exercise = await getSeedExerciseByName(userId, "Bench Press");

      // Seed prior session: single set 100 kg × 5 = 500 kg.
      await seedFinishedSession({
        userId,
        exerciseId: exercise.id,
        workingSets: [{ weight: 100, reps: 5 }],
      });

      // Start a live session and seed an UNCHECKED set 100 kg × 6 = 600 kg.
      // Leaving it unchecked forces the Finish flow through the
      // "check all and finish" branch — the load-bearing path for MAJ-2.
      const liveSessionId = await startLiveSession(userId);
      await seedLiveSet({
        userId,
        sessionId: liveSessionId,
        exerciseId: exercise.id,
        setNumber: 1,
        weightKg: 100,
        reps: 6,
        completedAt: null,
      });

      // Register dialog handler BEFORE any Finish click (MIN-2). The
      // bulk-check-all branch shows window.confirm("Finish workout?") via
      // confirmDelete after the modal dispatches it.
      page.on("dialog", (d) => void d.accept());

      await signInAndLand(page, email);
      await gotoLiveSession(page, liveSessionId);

      // Wait for the live screen to be interactive (the set strip renders
      // when the sets cache resolves).
      await expect(page.getByText("Elapsed", { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      // Tap Finish. Unchecked > 0 → ChooseActionModal opens.
      await page.getByText("Finish", { exact: true }).last().click();
      // Pick the "Check all and finish" branch.
      await expect(
        page.getByText("Check all and finish", { exact: true }).first(),
      ).toBeVisible({ timeout: 10_000 });
      await page
        .getByText("Check all and finish", { exact: true })
        .last()
        .click();

      // Land on the verdict screen.
      await page.waitForURL(/\/workout\/verdict\//, { timeout: 15_000 });

      // Headline assertions — these run AFTER the lifetime refetch resolves
      // (the eager `+0 PRs` flips to `+1 PRs`). `600 kg` is the load-bearing
      // MAJ-2 regression guard: pre-fix this would render `0 kg` because the
      // sets cache was still pre-bulk-check.
      await expect(page.getByText(/\+1 PRs/).first()).toBeVisible({
        timeout: 10_000,
      });
      const headlineText = await page
        .getByText(/PRs/i)
        .first()
        .innerText();
      expect(headlineText).toContain("+1 PRs");
      expect(headlineText).toContain("600 kg");

      // PR row assertions.
      await expect(page.getByText(exercise.name).first()).toBeVisible({
        timeout: 5_000,
      });
      await expect(page.getByText(/\+100 kg/).first()).toBeVisible({
        timeout: 5_000,
      });
      await expect(page.getByText(/\(was 500 kg\)/).first()).toBeVisible({
        timeout: 5_000,
      });

      // Tap Done → back to /workout tab root.
      await page.getByText("Done", { exact: true }).last().click();
      await page.waitForURL(/\/workout$/, { timeout: 10_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("Case B: finish-with-no-sets (zero-volume empty-state copy)", async ({
    page,
  }) => {
    const email = `e2e-verdict-empty-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);

    try {
      // Do NOT seed prior sessions or any sets — the live session is empty.
      const liveSessionId = await startLiveSession(userId);

      // Register dialog handler BEFORE the Finish click (MIN-2). Zero
      // unchecked sets → confirmDelete path (window.confirm).
      page.on("dialog", (d) => void d.accept());

      await signInAndLand(page, email);
      await gotoLiveSession(page, liveSessionId);

      // Wait for the live screen to be interactive.
      await expect(page.getByText("Elapsed", { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      // Tap Finish — zero unchecked sets path → confirm dialog only, no modal.
      await page.getByText("Finish", { exact: true }).last().click();

      // Land on the verdict screen.
      await page.waitForURL(/\/workout\/verdict\//, { timeout: 15_000 });

      // Headline: `0 PRs · 0 kg · 0m`. Assert the leading-plus-absence and 0 kg.
      await expect(page.getByText(/0 PRs/).first()).toBeVisible({
        timeout: 10_000,
      });
      const headlineText = await page
        .getByText(/PRs/i)
        .first()
        .innerText();
      expect(headlineText).toContain("0 PRs");
      expect(headlineText).not.toContain("+0 PRs");
      expect(headlineText).toContain("0 kg");

      // Empty-state copy for the zero-volume path (NOT the non-zero "Solid
      // session" string).
      await expect(
        page.getByText("No sets logged — your next session counts.").first(),
      ).toBeVisible({ timeout: 5_000 });
      await expect(
        page.getByText("Solid session — keep it consistent."),
      ).not.toBeVisible();

      // No PR pill should be present.
      await expect(page.getByText("PR", { exact: true })).not.toBeVisible();

      // Tap Done → back to /workout tab root.
      await page.getByText("Done", { exact: true }).last().click();
      await page.waitForURL(/\/workout$/, { timeout: 10_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });
});
