/**
 * Probe for the strong-workout-routines-unify feature.
 * Run explicitly:
 *   npx playwright test tests/e2e/probe-strong-unify.spec.ts
 *
 * Covers scenarios not exercised by crud.spec.ts.
 *
 * Note 1: returning to the Workout *home* (/workout) while inside the workout
 * stack at /workout/[id] is done via page.goto("/workout") — Expo Router's
 * default tab-press behaviour stays inside the active nested stack. URL nav
 * simulates a legitimate user path (bookmark, browser back, reload).
 *
 * Note 2: after `Quick start` we wait 3s before `page.goto("/workout")`. The
 * react-query PersistQueryClientProvider persists the active-session entry to
 * AsyncStorage asynchronously; without this wait the new page load may bring
 * up an empty cache, and `useActiveSession` may race against
 * `supabase.auth.getSession()` rehydration, returning null. Real users
 * typically don't reload within the first 3s of starting a workout; this is a
 * known pre-existing race window documented in the test report.
 */

import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const admin: SupabaseClient = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const PASSWORD = "test-password-123";
const createdUserIds = new Set<string>();
const PERSIST_FLUSH_MS = 3000;

async function createConfirmedUser(email: string) {
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
  try { await admin.auth.admin.deleteUser(userId); } catch {}
  createdUserIds.delete(userId);
}
async function signInAndLand(page: Page, email: string) {
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("Sign in", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(PASSWORD);
  await page.getByText("Sign in", { exact: true }).last().click();
  await page.waitForURL(/\/workout/, { timeout: 15_000 });
}

test.afterAll(async () => {
  await Promise.all(Array.from(createdUserIds).map(deleteUserSafe));
});

test.describe("Strong-style unify — probes", () => {
  test("4-tab IA: tab bar shows Workout/Exercises/History/Profile (no Routines, no Measurements)", async ({ page }) => {
    const email = `e2e-probe-4tabs-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      await signInAndLand(page, email);
      await expect(page.getByText("Workout", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Exercises", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("History", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Profile", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Routines", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Measurements", { exact: true })).toHaveCount(0);
    } finally { await deleteUserSafe(userId); }
  });

  test("/routines URL redirects to /workout", async ({ page }) => {
    const email = `e2e-probe-redir-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      await signInAndLand(page, email);
      await page.goto("/routines", { waitUntil: "domcontentloaded" });
      await page.waitForURL(/\/workout$/, { timeout: 10_000 });
      expect(page.url()).toMatch(/\/workout$/);
    } finally { await deleteUserSafe(userId); }
  });

  test("empty state: new user sees 'No routines yet' + Quick start + Create routine", async ({ page }) => {
    const email = `e2e-probe-empty-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      await signInAndLand(page, email);
      await expect(page.getByText(/No routines yet\./)).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("Quick start workout", { exact: true }).last()).toBeVisible();
      await expect(page.getByText("Create routine", { exact: true }).first()).toBeVisible();
    } finally { await deleteUserSafe(userId); }
  });

  test("headerRight + button navigates to /routines/new", async ({ page }) => {
    const email = `e2e-probe-plus-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      await signInAndLand(page, email);
      await page.getByLabel("New routine").click();
      await page.waitForURL(/\/routines\/new$/, { timeout: 10_000 });
    } finally { await deleteUserSafe(userId); }
  });

  test("active session: banner visible across tabs, click resumes same session", async ({ page }) => {
    const email = `e2e-probe-banner-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      await signInAndLand(page, email);
      await page.getByText("Quick start workout", { exact: true }).last().click();
      await page.waitForURL(/\/workout\/[0-9a-f-]+/, { timeout: 15_000 });
      const sessionId = page.url().split("/").pop()!;

      await page.getByText("Exercises", { exact: true }).first().click();
      await page.waitForURL(/\/exercises/, { timeout: 10_000 });
      await expect(page.getByLabel("Resume workout in progress")).toBeVisible({ timeout: 10_000 });

      await page.getByText("History", { exact: true }).first().click();
      await page.waitForURL(/\/history/, { timeout: 10_000 });
      await expect(page.getByLabel("Resume workout in progress")).toBeVisible();

      await page.getByText("Profile", { exact: true }).first().click();
      await page.waitForURL(/\/profile/, { timeout: 10_000 });
      await expect(page.getByLabel("Resume workout in progress")).toBeVisible();

      await page.getByLabel("Resume workout in progress").click();
      await page.waitForURL(new RegExp(`/workout/${sessionId}`), { timeout: 10_000 });
    } finally { await deleteUserSafe(userId); }
  });

  test("active-session guard: Quick start from /workout home routes to same session id", async ({ page }) => {
    const email = `e2e-probe-guard-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      await signInAndLand(page, email);
      await page.getByText("Quick start workout", { exact: true }).last().click();
      await page.waitForURL(/\/workout\/[0-9a-f-]+/, { timeout: 15_000 });
      const sessionId = page.url().split("/").pop()!;

      // Wait for the active-session cache to persist (see Note 2 at top).
      await page.waitForTimeout(PERSIST_FLUSH_MS);

      // URL-nav back to /workout home (bookmark / browser back equivalent).
      await page.goto("/workout", { waitUntil: "domcontentloaded" });
      await page.waitForURL(/\/workout$/, { timeout: 10_000 });

      await expect(page.getByLabel("Resume workout in progress")).toBeVisible({ timeout: 10_000 });

      await page.getByText("Quick start workout", { exact: true }).last().click();
      await page.waitForURL(new RegExp(`/workout/${sessionId}`), { timeout: 10_000 });
      expect(page.url()).toContain(sessionId);
    } finally { await deleteUserSafe(userId); }
  });

  test("cold reload during live session: home shows banner + Quick start, guard still active", async ({ page }) => {
    const email = `e2e-probe-reload-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      await signInAndLand(page, email);
      await page.getByText("Quick start workout", { exact: true }).last().click();
      await page.waitForURL(/\/workout\/[0-9a-f-]+/, { timeout: 15_000 });
      const sessionId = page.url().split("/").pop()!;
      await page.waitForTimeout(PERSIST_FLUSH_MS);

      // Cold reload at /workout home URL.
      await page.goto("/workout", { waitUntil: "domcontentloaded" });
      await page.waitForURL(/\/workout$/, { timeout: 15_000 });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForURL(/\/workout$/, { timeout: 15_000 });

      // Banner visible AND Quick start visible.
      await expect(page.getByLabel("Resume workout in progress")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("Quick start workout", { exact: true }).last()).toBeVisible();

      // Guard still works after reload.
      await page.getByText("Quick start workout", { exact: true }).last().click();
      await page.waitForURL(new RegExp(`/workout/${sessionId}`), { timeout: 10_000 });
    } finally { await deleteUserSafe(userId); }
  });

  test("routine card with active session: opacity-60, tap is a no-op (banner is resume path)", async ({ page }) => {
    const email = `e2e-probe-dim-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      await signInAndLand(page, email);

      // Create a routine first. Saving navigates to the new routine's BUILDER
      // (`routines/new.tsx:42` does router.replace(`/routines/{id}`)), NOT back
      // to /workout — a pre-existing app behavior. Go to /workout explicitly to
      // assert the row appears in the unified home list.
      await page.getByLabel("New routine").click();
      await page.waitForURL(/\/routines\/new$/, { timeout: 10_000 });
      const routineName = `Push Day ${Date.now()}`;
      await page.getByPlaceholder("e.g. Push Day").fill(routineName);
      await page.getByText("Save routine").last().click();
      await page.waitForURL(/\/routines\/[0-9a-f-]+$/, { timeout: 10_000 });
      // Let the create persist to the query cache, then purge it before the
      // hard goto so /workout's routine list refetches fresh instead of
      // rehydrating a stale persisted cache (the hard-reload-nav-race class).
      await page.waitForTimeout(PERSIST_FLUSH_MS);
      await page.evaluate(() =>
        window.localStorage.removeItem("ada11-query-cache"),
      );
      await page.goto("/workout", { waitUntil: "domcontentloaded" });
      await page.waitForURL(/\/workout$/, { timeout: 10_000 });
      await expect(page.getByText(routineName)).toBeVisible({ timeout: 10_000 });

      // Quick start ad-hoc session.
      await page.getByText("Quick start workout", { exact: true }).last().click();
      await page.waitForURL(/\/workout\/[0-9a-f-]+/, { timeout: 15_000 });
      const sessionId = page.url().split("/").pop()!;
      await page.waitForTimeout(PERSIST_FLUSH_MS);

      // URL-nav back to home.
      await page.goto("/workout", { waitUntil: "domcontentloaded" });
      await page.waitForURL(/\/workout$/, { timeout: 10_000 });

      // Banner here too.
      await expect(page.getByLabel("Resume workout in progress")).toBeVisible({ timeout: 10_000 });

      // Row is rendered AT opacity 0.6. Label is now "View routine: {name}".
      // The `opacity-60` class sits on the row's WRAPPING <View>, while the
      // accessibilityLabel is on the inner <Pressable> (routine-list-item.tsx:
      // 28 vs 33). getComputedStyle(pressable).opacity would read the inner
      // node's OWN opacity ("1"), not the dimmed wrapper — so read the parent
      // View's opacity. Poll to settle the hasActive-propagation render race.
      const row = page.getByLabel(`View routine: ${routineName}`);
      await expect(row).toBeVisible();
      await expect
        .poll(
          () =>
            row.evaluate(
              (el) =>
                window.getComputedStyle(el.parentElement as Element).opacity,
            ),
          { message: "row dimmed to 0.6 while a session is active", timeout: 10_000 },
        )
        .toBe("0.6");

      // The row's single Pressable still honors `disabled={hasActive}`:
      // `onPress={disabled ? undefined : onPress}`. Tap on the dimmed body is a
      // no-op (does NOT route, does NOT navigate to the preview or the live
      // session). The banner is the intended resume mechanism.
      await row.click();
      await page.waitForTimeout(1500);
      expect(page.url()).toMatch(/\/workout$/);

      // The row's Edit pill was removed (the preview is the hub). Because the
      // row is disabled-while-active, its tap is a no-op (just asserted) so the
      // preview is UNREACHABLE here — the only way to the builder is a direct
      // goto (the same pattern as routine-strong-builder test 4). Read the
      // routine id once via admin (the test holds only the name).
      const { data: r } = await admin
        .from("routines")
        .select("id")
        .eq("user_id", userId)
        .eq("name", routineName)
        .single();
      await page.goto(`/routines/${r!.id}`, { waitUntil: "domcontentloaded" });
      await page.waitForURL(/\/routines\/[0-9a-f-]+$/, { timeout: 10_000 });

      // Banner still here on the routine builder screen.
      await expect(page.getByLabel("Resume workout in progress")).toBeVisible();

      // Banner click resumes the original session.
      await page.getByLabel("Resume workout in progress").click();
      await page.waitForURL(new RegExp(`/workout/${sessionId}`), { timeout: 10_000 });
      expect(page.url()).toContain(sessionId);
    } finally { await deleteUserSafe(userId); }
  });
});
