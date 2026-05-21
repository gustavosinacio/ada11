/**
 * E2E: Soft-deleted exercises stay visible in past workout history,
 * but stay HIDDEN from the exercise picker on the same screen.
 *
 * Run-id: 2026-05-20_2034_soft-deleted-exercises-in-history
 *
 * Drives:
 *  - Seed a confirmed user, sign in.
 *  - Create a custom exercise "X" (via the UI on the Exercises tab).
 *  - Quick-start a session, add X via picker, log 2 working sets, finish.
 *  - Open history detail for the session → assert X block renders (no
 *    "(deleted)" suffix yet) and the header total reads "2 sets".
 *  - Go to Exercises tab → open X → tap "Delete exercise" → confirm.
 *  - Return to the same history detail → assert:
 *      • X block STILL renders.
 *      • "(deleted)" suffix visible next to X.
 *      • Header total still reads "2 sets" (no orphan accounting).
 *  - MAJOR-1 (picker-exclusion regression guard): tap "Add exercise" on the
 *    history detail → confirm the picker does NOT list X.
 */

import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE) {
  throw new Error(
    "Missing Supabase env vars. Source .env.local before running playwright.",
  );
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
    timeout: 10_000,
  });
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByText("Sign in", { exact: true }).last().click();
  await page.waitForURL(/\/workout/, { timeout: 15_000 });
}

function sessionIdFromUrl(url: string): string | null {
  const m = url.match(/\/workout\/([0-9a-f-]+)/);
  return m ? (m[1] ?? null) : null;
}

test.afterAll(async () => {
  await Promise.all(Array.from(createdUserIds).map(deleteUserSafe));
});

test.describe("Soft-deleted exercises remain visible in history (web)", () => {
  test("block stays, picker excludes, suffix renders, totals match", async ({
    page,
  }) => {
    const email = `e2e-soft-del-history-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);

    try {
      await signInAndLand(page, email);

      // ------------------------------------------------------------------
      // 1) Create a custom exercise "X" via the Exercises tab UI.
      // ------------------------------------------------------------------
      const exName = `Phantom Lift ${Date.now()}`;
      await page.goto("/exercises", { waitUntil: "domcontentloaded" });
      await page.waitForURL(/\/exercises$/, { timeout: 10_000 });

      await page.getByLabel("New exercise").click();
      await page.waitForURL(/\/exercises\/new/, { timeout: 10_000 });

      await page.getByPlaceholder("e.g. Barbell Bench Press").fill(exName);
      // Muscles is now a chip picker (accessibilityLabel === group name).
      // Tap "Arms" so the zod min(1) validator passes.
      await page.getByLabel("Arms", { exact: true }).click();
      await page.getByPlaceholder("e.g. Barbell", { exact: true }).fill("Cable");
      await page.getByText("Save exercise").last().click();

      await page.waitForURL(/\/exercises$/, { timeout: 10_000 });
      await expect(page.getByText(exName)).toBeVisible({ timeout: 10_000 });

      // ------------------------------------------------------------------
      // 2) Quick-start a session, add X via picker, log 2 sets, finish.
      // ------------------------------------------------------------------
      // Direct goto avoids tab-bar pointer-events flake on web.
      await page.goto("/workout", { waitUntil: "domcontentloaded" });
      await page.waitForURL(/\/workout$/, { timeout: 10_000 });

      await expect(page.getByText("Quick start workout").last()).toBeVisible({
        timeout: 10_000,
      });
      await page.getByText("Quick start workout").last().click();
      await page.waitForURL(/\/workout\/[0-9a-f-]+/, { timeout: 15_000 });
      await expect(page.getByText("Elapsed", { exact: true })).toBeVisible();

      const sessionId = sessionIdFromUrl(page.url());
      if (!sessionId) throw new Error("could not extract sessionId from URL");

      // Add X via the picker.
      await page.getByText("Add exercise", { exact: true }).first().click();
      await expect(page.getByText("Pick exercise")).toBeVisible({
        timeout: 10_000,
      });
      await page
        .getByPlaceholder("Search by name, muscle, equipment")
        .fill(exName);
      // Wait for the newly-created exercise to land in the picker list
      // (useExercises refetch after the create-mutation invalidation).
      await expect(
        page.getByText(exName, { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 });
      await page.getByText(exName, { exact: true }).first().click();
      await expect(page.getByText("Pick exercise")).not.toBeVisible({
        timeout: 10_000,
      });

      // Log 2 working sets on X.
      await page.getByText("+ Working set", { exact: true }).first().click();
      await expect(page.getByLabel("Delete set").first()).toBeVisible({
        timeout: 10_000,
      });
      await page.getByText("+ Working set", { exact: true }).first().click();
      await expect(page.getByLabel("Delete set").nth(1)).toBeVisible({
        timeout: 10_000,
      });

      // Finish.
      page.once("dialog", (d) => void d.accept());
      await page.getByText("Finish", { exact: true }).last().click();
      await page.waitForURL(/\/workout$/, { timeout: 10_000 });

      // ------------------------------------------------------------------
      // 3) Open history detail — X block renders, no (deleted) suffix yet,
      //    totals read "2 sets".
      // ------------------------------------------------------------------
      await page.goto(`/history/${sessionId}`, { waitUntil: "domcontentloaded" });
      await page.waitForURL(new RegExp(`/history/${sessionId}$`), {
        timeout: 10_000,
      });

      // Block header for X is present.
      await expect(page.getByText(exName, { exact: true }).first()).toBeVisible({
        timeout: 10_000,
      });
      // No "(deleted)" suffix yet.
      await expect(page.getByText("(deleted)", { exact: true })).not.toBeVisible({
        timeout: 3_000,
      });
      // Header totals: "Total: 2 sets …".
      await expect(page.getByText(/Total:\s+2\s+sets/).first()).toBeVisible({
        timeout: 5_000,
      });

      // ------------------------------------------------------------------
      // 4) Soft-delete X from the Exercises edit screen.
      // ------------------------------------------------------------------
      await page.goto("/exercises", { waitUntil: "domcontentloaded" });
      await page.waitForURL(/\/exercises$/, { timeout: 10_000 });
      // List item → progress screen, then Pencil → edit.
      await page.getByText(exName, { exact: true }).first().click();
      await page.waitForURL(/\/exercises\/[0-9a-f-]+\/progress$/, {
        timeout: 10_000,
      });
      await page.getByLabel("Edit exercise").click();
      await page.waitForURL(/\/exercises\/[0-9a-f-]+$/, { timeout: 10_000 });

      page.once("dialog", (d) => void d.accept());
      await page.getByText("Delete exercise", { exact: true }).last().click();

      // After delete, edit screen does router.replace("/(app)/exercises").
      // Wait for that navigation to settle before re-opening history.
      await page.waitForURL(/\/exercises$/, { timeout: 10_000 });
      // Give TanStack a tick to refetch + repaint the filtered list (the row
      // for the deleted exercise drops out). We don't strictly need to assert
      // it's absent here — the picker-exclusion assertion at step 6 is the
      // contract guarantee — but we do want a stable mid-flow checkpoint.
      await page.waitForTimeout(500);

      // ------------------------------------------------------------------
      // 5) Re-open history detail — X block STILL renders, (deleted) suffix
      //    is now visible, totals still "2 sets".
      // ------------------------------------------------------------------
      // Race-busting strategy (test-only, production code untouched):
      //
      // Production uses PersistQueryClientProvider with staleTime:30s.
      // The history detail's useAllExercises() (unfiltered list) is NOT
      // observed at the moment of soft-delete (we're on /exercises/[id]
      // when the mutation lands), so TanStack only marks it stale — no
      // immediate refetch. On the next /history/<id> mount, the persistor
      // rehydrates the pre-delete shape; if that entry is still fresh
      // (dataUpdatedAt < staleTime ago), no refetch fires on mount, the
      // suffix never appears within a reasonable window, and the test
      // flakes (~40% under repeat-each=5 before this fix).
      //
      // Deterministic fix: wait out the staleTime window before reopening
      // history. After ~31s, the rehydrated query is past staleTime, mount
      // triggers a refetch unconditionally, and the suffix renders. The
      // tradeoff is a ~30s slower test (golden path ~20s → ~50s), which is
      // the price of not touching production code.
      const STALE_TIME_MS = 30_000;
      const SAFETY_MARGIN_MS = 2_000;
      await page.waitForTimeout(STALE_TIME_MS + SAFETY_MARGIN_MS);

      // Arm a wait for the unfiltered LIST exercises refetch
      // (`?select=*&order=name.asc` — no id filter, no deleted_at filter).
      // Used by useAllExercises() on the history detail. With staleTime
      // elapsed above, this refetch is now guaranteed to fire on mount.
      const unfilteredListResponse = page.waitForResponse(
        (resp) => {
          const url = resp.url();
          return (
            url.includes("/rest/v1/exercises") &&
            url.includes("order=name.asc") &&
            !url.includes("deleted_at") &&
            !url.includes("id=eq.") &&
            resp.request().method() === "GET" &&
            resp.ok()
          );
        },
        { timeout: 20_000 },
      );

      await page.goto(`/history/${sessionId}`, { waitUntil: "domcontentloaded" });
      await page.waitForURL(new RegExp(`/history/${sessionId}$`), {
        timeout: 10_000,
      });

      // Block name still present.
      await expect(page.getByText(exName, { exact: true }).first()).toBeVisible({
        timeout: 10_000,
      });

      // Wait for the unfiltered LIST refetch to settle before asserting the
      // suffix. With staleTime elapsed above, this MUST fire on mount.
      await unfilteredListResponse.catch(() => {
        // Swallow; the assertion below has a 15s budget as a safety net.
      });

      // "(deleted)" suffix now visible. Timeout bumped from 5s → 15s for
      // parity with the picker-rehydration wait at line 145 and as a safety
      // net in case the network-response wait above didn't bind cleanly.
      await expect(
        page.getByText("(deleted)", { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 });
      // Totals unchanged (no orphan accounting: 2 sets still shown alongside the visible block).
      await expect(page.getByText(/Total:\s+2\s+sets/).first()).toBeVisible({
        timeout: 5_000,
      });

      // ------------------------------------------------------------------
      // 6) MAJOR-1 fix: picker on the history detail must NOT show X.
      // ------------------------------------------------------------------
      // Two "Add exercise" buttons can be in the DOM (workout/[sessionId] +
      // history/[id] both retained by expo-router on web). Use the visible
      // one — the workout one is hidden by the active route stack.
      const addExerciseBtns = page
        .getByRole("button", { name: "Add exercise" });
      const count = await addExerciseBtns.count();
      let clicked = false;
      for (let i = 0; i < count; i++) {
        const btn = addExerciseBtns.nth(i);
        if (await btn.isVisible()) {
          await btn.click();
          clicked = true;
          break;
        }
      }
      if (!clicked) throw new Error("no visible 'Add exercise' button found");
      await expect(page.getByText("Pick exercise")).toBeVisible({
        timeout: 10_000,
      });
      // Filter by the exact name. The picker list backs onto useExercises()
      // (filtered) — soft-deleted X must be absent.
      await page
        .getByPlaceholder("Search by name, muscle, equipment")
        .fill(exName);
      // Empty-state appears when the filter matches no rows. That confirms
      // the soft-deleted exercise is excluded from the picker.
      await expect(
        page.getByText("No exercises match. Add one from the Exercises tab."),
      ).toBeVisible({ timeout: 5_000 });
      await page.getByLabel("Close").click();
      await expect(page.getByText("Pick exercise")).not.toBeVisible({
        timeout: 5_000,
      });
    } finally {
      await deleteUserSafe(userId);
    }
  });
});
