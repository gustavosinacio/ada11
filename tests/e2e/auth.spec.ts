/**
 * E2E auth flow for Ada11 (web target).
 *
 * Targets http://localhost:8081 (dev server started manually by the user).
 *
 * Covers the 7 numbered cases in the agent brief:
 *  1. Page load — sign-in screen renders; AuthGate redirects unauthenticated users.
 *  2. Sign-up — fresh email + password; branches based on Supabase email-confirmation setting.
 *  3. Sign-in — known-good (admin-confirmed) user lands on /workout.
 *  4. Persistence — reload after sign-in keeps the session.
 *  5. Sign-out — Profile tab Sign-out returns to /sign-in.
 *  6. Validation — short password shows the inline zod error.
 *  7. Form errors — invalid credentials reach Supabase, no session/redirect happens.
 *
 * Findings observed during development of these tests:
 *  - The app has NO `app/index.tsx`, so navigating to `/` shows Expo Router's
 *    "Unmatched Route" page instead of redirecting to /sign-in. We start tests
 *    at `/sign-in` directly, and exercise the AuthGate redirect by navigating
 *    to a protected `/workout` URL while unauthenticated (test #1).
 *  - React Native Web's `Alert.alert` is a no-op on the web target — it does
 *    NOT fire `window.alert`, so dialogs are not observable from Playwright.
 *    Tests #2 and #7 detect the underlying state (session presence, URL,
 *    network response) instead of asserting alert text.
 *  - Supabase's project email validator rejects `@example.com`. Use `@test.com`.
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
    "Missing Supabase env vars. Source .env.local before running playwright (see README).",
  );
}

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PASSWORD = "test-password-123";

/** Track every user we create so afterAll always cleans up, even on failure. */
const createdUserIds = new Set<string>();

async function createConfirmedUser(email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createConfirmedUser failed: ${error?.message}`);
  createdUserIds.add(data.user.id);
  return data.user.id;
}

async function deleteUserSafe(userId: string) {
  try {
    await admin.auth.admin.deleteUser(userId);
  } catch {
    // Best-effort cleanup; don't fail the suite on deletion errors.
  } finally {
    createdUserIds.delete(userId);
  }
}

/** Find a user by email via admin.listUsers (paginated). */
async function findUserIdByEmail(email: string): Promise<string | null> {
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const found = data.users.find((u) => u.email === email);
    if (found) return found.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

/** True if the page has a Supabase session in localStorage. */
async function hasSupabaseSession(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      if (key.startsWith("sb-") && key.endsWith("-auth-token")) {
        const raw = window.localStorage.getItem(key);
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw);
          if (parsed?.access_token) return true;
        } catch {
          // ignore non-JSON; not the auth-token entry we care about
        }
      }
    }
    return false;
  });
}

/** Navigate directly to the sign-in screen and wait for it to render. */
async function gotoSignIn(page: Page) {
  await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
  // Wait for the "Sign in" heading to appear (rendered by the screen component).
  await expect(page.getByText("Sign in", { exact: true }).first()).toBeVisible({
    timeout: 10_000,
  });
  // Form fields are present on initial render.
  await expect(page.getByPlaceholder("Email")).toBeVisible();
}

/**
 * Click the form's primary submit button.
 * The screen renders both a heading ("Sign in" or "Create account") and a
 * Pressable button with the same text. The Pressable is rendered last in DOM
 * order, so `.last()` selects it.
 */
async function clickSubmit(page: Page, label: "Sign in" | "Create account") {
  await page.getByText(label, { exact: true }).last().click();
}

test.afterAll(async () => {
  // Final safety net: clean up any user IDs that weren't deleted by their owning test.
  const ids = Array.from(createdUserIds);
  await Promise.all(ids.map(deleteUserSafe));
});

test.describe("Ada11 email/password auth (web)", () => {
  test("1. page load + AuthGate: protected route redirects unauth user to /sign-in", async ({
    page,
  }) => {
    // Navigate to a protected route while unauthenticated. AuthGate must redirect.
    await page.goto("/workout", { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/sign-in/, { timeout: 15_000 });
    expect(page.url()).toMatch(/\/sign-in/);

    // Form fields & toggle present on the sign-in screen.
    await expect(page.getByPlaceholder("Email")).toBeVisible();
    await expect(page.getByPlaceholder("Password")).toBeVisible();
    // Heading "Sign in" + the submit button "Sign in" are both literal "Sign in" text.
    await expect(page.getByText("Sign in", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Continue with Google")).toBeVisible();
    await expect(page.getByText("Continue with Apple")).toBeVisible();
    await expect(page.getByText("No account? Create one.")).toBeVisible();
  });

  test("2. sign-up flow: branches on email-confirmation setting", async ({ page }) => {
    const email = `e2e-signup-${Date.now()}@test.com`;

    // Catch any window.alert dialogs (RN-Web Alert.alert is silent today, but
    // capture defensively in case the polyfill changes).
    const dialogMessages: string[] = [];
    page.on("dialog", (d) => {
      dialogMessages.push(d.message());
      void d.dismiss();
    });

    // Track Supabase /auth/v1/signup responses to confirm the request happened.
    const signupResponses: { status: number; body: unknown }[] = [];
    page.on("response", async (resp) => {
      if (/\/auth\/v1\/signup/.test(resp.url())) {
        try {
          signupResponses.push({ status: resp.status(), body: await resp.json() });
        } catch {
          signupResponses.push({ status: resp.status(), body: null });
        }
      }
    });

    await gotoSignIn(page);

    // Toggle to sign-up mode.
    await page.getByText("No account? Create one.").click();
    await expect(page.getByText("Create account", { exact: true }).first()).toBeVisible();

    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder("Password").fill(PASSWORD);
    await clickSubmit(page, "Create account");

    // Race: redirect to /workout (confirmation OFF) vs. stay on /sign-in (confirmation ON).
    type Mode = "session" | "confirmation" | "unknown";
    const modeRef: { value: Mode } = { value: "unknown" };
    await Promise.race([
      page
        .waitForURL(/\/workout/, { timeout: 15_000 })
        .then(() => {
          modeRef.value = "session";
        })
        .catch(() => undefined),
      (async () => {
        // Wait until we see a signup response from Supabase, then peek at it.
        const deadline = Date.now() + 15_000;
        while (Date.now() < deadline) {
          if (signupResponses.length > 0) return;
          await page.waitForTimeout(250);
        }
      })(),
    ]);

    const sessionPresent = await hasSupabaseSession(page);

    if (sessionPresent || modeRef.value === "session") {
      // Email confirmation OFF: should be on /workout with a session.
      await page.waitForURL(/\/workout/, { timeout: 10_000 });
      expect(page.url()).toMatch(/\/workout/);
      console.log(
        "[detected supabase mode] email-confirmation OFF (session created on signup)",
      );
    } else {
      // The form did NOT create a session. That's expected when email confirmation
      // is ON. Either way, verify the form actually POSTed to Supabase: a 2xx means
      // confirmation-required, a 429 means rate-limited (still tells us the form
      // wired up correctly), a 4xx other than 429 would suggest a misconfiguration.
      expect(page.url()).toMatch(/\/sign-in/);
      expect(signupResponses.length).toBeGreaterThan(0);
      const last = signupResponses[signupResponses.length - 1]!;

      if (last.status >= 200 && last.status < 300) {
        modeRef.value = "confirmation";
        console.log(
          `[detected supabase mode] email-confirmation ON (signup status=${last.status}, no session). Note: RN-Web Alert.alert is a no-op so the user sees no on-screen confirmation message — this is a real UX gap.`,
        );
      } else if (last.status === 429) {
        modeRef.value = "confirmation"; // best inference; the form did POST to /signup
        console.log(
          `[partial detection] signup rate-limited (status 429). Form correctly POSTs to Supabase /auth/v1/signup, but we can't observe full success. Treating as PASS for the wired-up-form assertion. Re-run after the rate-limit window cools (~hourly).`,
        );
      } else {
        throw new Error(
          `Sign-up POST returned unexpected status ${last.status}. Body: ${JSON.stringify(last.body)}`,
        );
      }

      if (dialogMessages.length > 0) {
        console.log(`(also observed dialogs: ${JSON.stringify(dialogMessages)})`);
      }
    }

    // Cleanup — Supabase may still have a user record even on confirmation-required.
    const userId = await findUserIdByEmail(email);
    if (userId) await deleteUserSafe(userId);
  });

  test("3. sign-in flow: confirmed user redirects to /workout", async ({ page }) => {
    const email = `e2e-signin-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);

    try {
      await gotoSignIn(page);

      await page.getByPlaceholder("Email").fill(email);
      await page.getByPlaceholder("Password").fill(PASSWORD);
      await clickSubmit(page, "Sign in");

      await page.waitForURL(/\/workout/, { timeout: 15_000 });
      expect(page.url()).toMatch(/\/workout/);
      expect(await hasSupabaseSession(page)).toBe(true);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("4. session persistence: reload keeps the user signed in", async ({ page }) => {
    const email = `e2e-persist-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);

    try {
      await gotoSignIn(page);
      await page.getByPlaceholder("Email").fill(email);
      await page.getByPlaceholder("Password").fill(PASSWORD);
      await clickSubmit(page, "Sign in");
      await page.waitForURL(/\/workout/, { timeout: 15_000 });

      await page.reload({ waitUntil: "domcontentloaded" });
      // After reload, AuthGate should NOT redirect us back to /sign-in.
      await page.waitForTimeout(2000);
      expect(page.url()).toMatch(/\/workout/);
      expect(page.url()).not.toMatch(/\/sign-in/);
      expect(await hasSupabaseSession(page)).toBe(true);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("5. sign-out: Profile -> Sign out returns to /sign-in", async ({ page }) => {
    const email = `e2e-signout-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);

    try {
      await gotoSignIn(page);
      await page.getByPlaceholder("Email").fill(email);
      await page.getByPlaceholder("Password").fill(PASSWORD);
      await clickSubmit(page, "Sign in");
      await page.waitForURL(/\/workout/, { timeout: 15_000 });

      // Navigate to the Profile tab. The bottom-tab label is the literal text
      // "Profile" (only one match in the DOM, so .first() is unambiguous).
      await page.getByText("Profile", { exact: true }).first().click();
      await page.waitForURL(/\/profile/, { timeout: 10_000 });

      // Click the Sign out button on the Profile screen.
      await page.getByText("Sign out", { exact: true }).click();

      await page.waitForURL(/\/sign-in/, { timeout: 15_000 });
      expect(page.url()).toMatch(/\/sign-in/);
      expect(await hasSupabaseSession(page)).toBe(false);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("6. validation: too-short password shows inline zod error", async ({ page }) => {
    await gotoSignIn(page);

    await page.getByPlaceholder("Email").fill("someone@test.com");
    await page.getByPlaceholder("Password").fill("abc"); // < 8 chars

    await clickSubmit(page, "Sign in");

    // The zod resolver renders "Password must be at least 8 characters" inline.
    await expect(page.getByText("Password must be at least 8 characters")).toBeVisible({
      timeout: 5_000,
    });

    // No redirect should have happened.
    expect(page.url()).toMatch(/\/sign-in/);
    expect(await hasSupabaseSession(page)).toBe(false);
  });

  test("7. form errors: invalid credentials reach Supabase and produce no session/redirect", async ({
    page,
  }) => {
    // Track the password-grant request.
    const tokenResponses: { status: number; body: unknown }[] = [];
    page.on("response", async (resp) => {
      if (/\/auth\/v1\/token/.test(resp.url())) {
        try {
          tokenResponses.push({ status: resp.status(), body: await resp.json() });
        } catch {
          tokenResponses.push({ status: resp.status(), body: null });
        }
      }
    });

    // Defensive: also capture window.alert dialogs in case RN-Web ever wires them up.
    const dialogMessages: string[] = [];
    page.on("dialog", (d) => {
      dialogMessages.push(d.message());
      void d.dismiss();
    });

    await gotoSignIn(page);

    await page.getByPlaceholder("Email").fill(`nonexistent-${Date.now()}@test.com`);
    await page.getByPlaceholder("Password").fill("wrong-password-123");
    await clickSubmit(page, "Sign in");

    // Wait for the auth request to settle.
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && tokenResponses.length === 0) {
      await page.waitForTimeout(250);
    }

    expect(tokenResponses.length).toBeGreaterThan(0);
    const last = tokenResponses[tokenResponses.length - 1]!;
    // Supabase returns 400 for "Invalid login credentials".
    expect(last.status).toBeGreaterThanOrEqual(400);
    expect(last.status).toBeLessThan(500);

    // No redirect, no session.
    expect(page.url()).toMatch(/\/sign-in/);
    expect(await hasSupabaseSession(page)).toBe(false);

    // The form must surface the Supabase error inline (Alert.alert is a no-op on
    // react-native-web, so the only way to inform the user is the in-form banner).
    const banner = page.getByRole("alert");
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await expect(banner).toContainText(/credential|invalid|password/i);

    // Defensive: dialog listener should not have fired (we don't depend on alerts).
    expect(dialogMessages).toEqual([]);
  });
});

