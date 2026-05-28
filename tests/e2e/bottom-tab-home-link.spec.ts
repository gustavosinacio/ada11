/**
 * E2E for the bottom-tab "re-tap to pop to root" behaviour
 * (run 2026-05-26_0307_bottom-tab-home-link).
 *
 * The Tabs root in `app/(app)/_layout.tsx` installs a custom `tabBarButton`
 * (`HomeLinkTabBarButton`). When the focused tab is re-tapped and its child
 * Stack has a nested route on top (e.g. user is at `/exercises/<id>`), the
 * button dispatches `StackActions.popToTop()` targeted at the child Stack —
 * popping back to the tab's index (e.g. `/exercises`). On root-of-tab re-taps
 * and leaf tabs (Profile, no child Stack) the button delegates to the
 * framework's default `onPress`, which is a no-op on the BottomTabBar side for
 * focused taps. Implementation history: round 1 wired `screenListeners.tabPress`
 * which never fired on focused re-tap on web (see test-report-v1.md); round 2
 * switched to a custom button that owns the press directly.
 *
 * Cases:
 *   1. Re-tap pops nested → root (Exercises tab), via same-tab click-through
 *      (Path A — the live "stack" child-state fast path).
 *   2. Cross-tab tap navigates normally + browser-back preserves the
 *      `backBehavior="history"` invariant
 *      (load-bearing comment block at `_layout.tsx:17-26`).
 *   3. Re-tap at a leaf tab (Profile, no child Stack) is harmless.
 *   4. Re-tap pops nested → root after a DEEP-LINK / refresh arrival
 *      (Path B — `page.goto` onto `/exercises/<id>/progress`). The child Stack
 *      rehydrates from the URL as a PartialState (`type === undefined`, no
 *      `key`), so the keyed fast path is skipped and the URL-gated
 *      (`useSegments()`) `router.navigate(TAB_ROOTS[name])` fallback in
 *      `HomeLinkTabBarButton` must pop to `/exercises`.
 *      (Run 2026-05-27_2144_navbar-tab-pop-to-root.)
 *   5. Re-tap pops nested → root after a CROSS-TAB arrival from a live workout
 *      (Path C — open a live session, tap the exercise name → progress with a
 *      `backHref`). Same PartialState rehydration as case 4; the single
 *      `tabBarButton` serves every tab so the same fallback covers it.
 *
 * Fixture pattern mirrors `tests/e2e/exercise-note.spec.ts:46-89`
 * (admin client + `createConfirmedUser` + `signInAndLand`) and
 * `tests/e2e/_helpers/canonical-exercise.ts:34-60` (canonical "Bench Press"
 * pick — visible to every signed-in user via the canonical-catalog RLS
 * widening from migration `0011`).
 *
 * Locator convention: tab-bar clicks use `getByRole("tab", { name })` rather
 * than `getByText(...).first()`. The page's navigation `<HeaderTitle>` is a
 * `<Text role="heading" aria-level=1>` in DOM whose text can collide with the
 * tab name (e.g. on `/exercises/<id>/progress` the route-header text takes the
 * page title and is selected by `getByText("Exercises").first()` before the
 * tab-bar item, often as a non-visible element that Playwright keeps retrying
 * until timeout). `getByRole("tab")` disambiguates because `BottomTabItem`
 * sets `role: Platform.select({ ios: 'button', default: 'tab' })` for tab-bar
 * buttons (`node_modules/@react-navigation/bottom-tabs/src/views/BottomTabItem.tsx:341`).
 * Followed by `waitForURL`, per the convention in
 * `tests/e2e/exercise-progress-ia.spec.ts` and `probe-strong-unify.spec.ts:121-131`.
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
  if (error || !data.user) {
    throw new Error(`createConfirmedUser: ${error?.message}`);
  }
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

// Live-session seed helpers for case 5 (Path C). Mirrors the canonical
// pattern in `tests/e2e/exercise-progress-back-nav.spec.ts:56-121` (routine
// with the canonical exercise + an un-ended `sessions` row → open the live
// workout → tap the exercise name to reach its progress screen with a
// `backHref`).
async function seedRoutineWithExercise(opts: {
  userId: string;
  exerciseId: string;
}): Promise<string> {
  const { data: r, error: e1 } = await admin
    .from("routines")
    .insert({ user_id: opts.userId, name: "Home-link e2e routine" })
    .select("id")
    .single();
  if (e1 || !r) throw new Error(`routine insert: ${e1?.message}`);

  const { error: e2 } = await admin.from("routine_exercises").insert({
    user_id: opts.userId,
    routine_id: r.id,
    exercise_id: opts.exerciseId,
    position: 0,
  });
  if (e2) throw new Error(`routine_exercises insert: ${e2.message}`);
  return r.id as string;
}

async function startLiveSession(
  userId: string,
  routineId: string,
): Promise<string> {
  const { data, error } = await admin
    .from("sessions")
    .insert({
      user_id: userId,
      routine_id: routineId,
      started_at: new Date().toISOString(),
      ended_at: null,
      name: "Home-link e2e live session",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`session insert: ${error?.message}`);
  return data.id as string;
}

test.afterAll(async () => {
  await Promise.all(Array.from(createdUserIds).map(deleteUserSafe));
});

test.describe("Bottom-tab re-tap pops nested stack to root", () => {
  test("case 1: re-tap on already-focused tab pops nested → root", async ({
    page,
  }) => {
    const email = `e2e-bothome-pop-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exercise = await pickCanonicalExercise(admin, "Bench Press");

    try {
      await signInAndLand(page, email);

      // Open the Exercises tab from /workout (cross-tab navigate).
      await page.getByRole("tab", { name: "Exercises" }).click();
      await page.waitForURL(/\/exercises$/, { timeout: 10_000 });
      // Sanity: the list root marker is present (the "+" New exercise CTA is
      // the stable selector on `app/(app)/exercises/index.tsx:22`).
      await expect(
        page.getByLabel("New exercise").first(),
      ).toBeVisible({ timeout: 10_000 });

      // Click-through navigation into a nested route under the same tab.
      // This pushes a frame onto the child Stack and exercises the live
      // "stack" fast path (`childState.type === "stack"` + `index > 0`). The
      // PartialState deep-link / cross-tab paths that this case intentionally
      // does NOT cover are now exercised by cases 4 and 5 below (the former
      // "known follow-up" — fixed in run 2026-05-27_2144_navbar-tab-pop-to-root
      // via the URL-gated `router.navigate(TAB_ROOTS[name])` fallback).
      await page.getByText(exercise.name, { exact: true }).first().click();
      await page.waitForURL(
        new RegExp(`/exercises/${exercise.id}/progress$`),
        { timeout: 10_000 },
      );

      // Re-tap the Exercises tab while focused: the custom `tabBarButton`
      // must dispatch popToTop on the child Stack. URL should return to
      // /exercises.
      await page.getByRole("tab", { name: "Exercises" }).click();
      await page.waitForURL(/\/exercises$/, { timeout: 10_000 });
      await expect(
        page.getByLabel("New exercise").first(),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("case 2: cross-tab tap navigates normally + browser-back preserves backBehavior=history", async ({
    page,
  }) => {
    const email = `e2e-bothome-xtab-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exercise = await pickCanonicalExercise(admin, "Bench Press");

    try {
      await signInAndLand(page, email);

      // Land on a nested route in the Exercises tab.
      await page.goto(`/(app)/exercises/${exercise.id}/progress`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForURL(
        new RegExp(`/exercises/${exercise.id}/progress$`),
        { timeout: 10_000 },
      );

      // Cross-tab jump to History — the custom button's `isFocused` check
      // is false so it delegates to the framework's default `onPress`
      // (which emits tabPress + dispatches the navigate action).
      await page.getByRole("tab", { name: "History" }).click();
      await page.waitForURL(/\/history$/, { timeout: 10_000 });

      // Browser back must restore the source deep route (the load-bearing
      // `backBehavior="history"` invariant). If our listener accidentally
      // mutated the Tabs `history` array, `goBack()` would land on /workout
      // (the initial deep route) instead of /exercises/<id>/progress.
      await page.goBack();
      await page.waitForURL(
        new RegExp(`/exercises/${exercise.id}/progress$`),
        { timeout: 10_000 },
      );
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("case 3: re-tap on a leaf tab (Profile, no child Stack) is a harmless no-op", async ({
    page,
  }) => {
    const email = `e2e-bothome-leaf-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);

    try {
      await signInAndLand(page, email);

      await page.getByRole("tab", { name: "Profile" }).click();
      await page.waitForURL(/\/profile$/, { timeout: 10_000 });
      // Stable marker for the Profile screen content
      // (`app/(app)/profile.tsx:219`).
      await expect(
        page.getByText("Sign out", { exact: true }).first(),
      ).toBeVisible({ timeout: 10_000 });

      // Re-tap Profile while focused: childState is `undefined` (Profile is a
      // leaf route, no child navigator) → the focused-branch guard chain
      // short-circuits and the button delegates to the framework default. URL
      // must stay on /profile and the screen must remain mounted.
      await page.getByRole("tab", { name: "Profile" }).click();
      // Small settle window so any erroneous dispatch / navigation would have
      // observable effect by the time we read the URL.
      await page.waitForTimeout(300);
      expect(page.url()).toMatch(/\/profile$/);
      await expect(
        page.getByText("Sign out", { exact: true }).first(),
      ).toBeVisible({ timeout: 5_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("case 4: re-tap pops to root after a deep-link arrival (Path B PartialState)", async ({
    page,
  }) => {
    const email = `e2e-bothome-deeplink-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exercise = await pickCanonicalExercise(admin, "Bench Press");

    try {
      await signInAndLand(page, email);

      // Deep-link / fresh-load directly onto the nested progress route. The
      // exercises tab's child Stack is rehydrated from the URL as a
      // single-route PartialState (`type === undefined`, no `key`), so the
      // keyed fast path is skipped and the URL-gated `router.navigate` fallback
      // must do the pop. This is the path that regressed: pre-fix it was a no-op.
      await page.goto(`/(app)/exercises/${exercise.id}/progress`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForURL(
        new RegExp(`/exercises/${exercise.id}/progress$`),
        { timeout: 10_000 },
      );

      // Re-tap the focused Exercises tab: URL must pop to /exercises and the
      // list root marker must appear.
      await page.getByRole("tab", { name: "Exercises" }).click();
      await page.waitForURL(/\/exercises$/, { timeout: 10_000 });
      await expect(
        page.getByLabel("New exercise").first(),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("case 5: re-tap pops to root after cross-tab arrival from a live workout (Path C)", async ({
    page,
  }) => {
    const email = `e2e-bothome-xtab-live-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exercise = await pickCanonicalExercise(admin, "Bench Press");

    try {
      const routineId = await seedRoutineWithExercise({
        userId,
        exerciseId: exercise.id,
      });
      const sessionId = await startLiveSession(userId, routineId);

      await signInAndLand(page, email);

      // Open the live (un-ended) session in the workout tab.
      await page.evaluate(() =>
        window.localStorage.removeItem("ada11-query-cache"),
      );
      await page.goto(`/(app)/workout/${sessionId}`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForURL(/\/workout\/[0-9a-f-]+/, { timeout: 15_000 });
      await expect(page.getByText("Elapsed", { exact: true })).toBeVisible({
        timeout: 15_000,
      });

      // Tap the exercise NAME → its progress screen (cross-tab into the
      // exercises tab, carries a `backHref`). The freshly-entered exercises
      // tab's child Stack is a PartialState — same fallback as case 4.
      await page.getByLabel(`View progress for ${exercise.name}`).click();
      await page.waitForURL(
        new RegExp(`/exercises/${exercise.id}/progress`),
        { timeout: 15_000 },
      );

      // Re-tap the focused Exercises tab: URL must pop to /exercises.
      await page.getByRole("tab", { name: "Exercises" }).click();
      await page.waitForURL(/\/exercises$/, { timeout: 10_000 });
      await expect(
        page.getByLabel("New exercise").first(),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });
});
