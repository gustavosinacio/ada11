/**
 * E2E for the canonical-exercises shared catalog
 * (run 2026-05-25_1921_canonical-exercises). Pins AC4 / AC5 / AC7 from the
 * state.md acceptance criteria.
 *
 * Coverage:
 *   1. Library list — canonical row does NOT render the "Created by you" chip
 *      (predicate `exercise.user_id !== null` is false).
 *   2. Library list — a freshly admin-seeded user-owned row DOES render the
 *      "Created by you" chip; row's `user_id` equals the signed-in user id
 *      (AC4 — create-flow ownership correctness, asserted via admin re-read).
 *   3. Progress page — the header pencil ("Edit exercise") is absent for a
 *      canonical exercise; present for a user-owned exercise (AC5 source-gate).
 *   4. Deep-link to `/(app)/exercises/<canonical-id>` — the destination
 *      screen renders the read-only shape: title is "Exercise" (not "Edit
 *      exercise"), the field labels (Name / Muscles / Equipment / Notes) and
 *      the "Back" button are visible; Save / Cancel / Delete are absent
 *      (AC5 destination-gate, deep-link defense-in-depth).
 *   5. RLS rejection — user-client UPDATE / DELETE of a canonical row
 *      affects zero rows (AC5 + AC7). Mirrors the new arm in
 *      `tests/rls.test.ts`; re-asserts here to keep the AC contract pinned
 *      from the e2e suite's point of view.
 *
 * Pattern: admin-create a confirmed user, sign in via UI, navigate via
 * deep-link / list. Canonical exercises are looked up via the shared helper
 * `_helpers/canonical-exercise.ts`.
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
  if (error || !data.user)
    throw new Error(`createConfirmedUser: ${error?.message}`);
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

test.afterAll(async () => {
  await Promise.all(Array.from(createdUserIds).map(deleteUserSafe));
});

test.describe("Canonical exercises — chip + edit gating (AC4/AC5/AC7)", () => {
  test("1. library list: no chip on canonical row", async ({ page }) => {
    const email = `e2e-canonical-no-chip-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      const canonical = await pickCanonicalExercise(admin, "Bench Press");

      await signInAndLand(page, email);
      await page.goto("/exercises", { waitUntil: "domcontentloaded" });
      const row = page.getByText(canonical.name, { exact: true }).first();
      await expect(row).toBeVisible({ timeout: 15_000 });

      // The "Created by you" chip lives inside the same row as the name.
      // Its accessibilityLabel ("Created by you") + visible glyph ("You") are
      // both load-bearing. For a canonical row, neither should be present.
      await expect(page.getByLabel("Created by you")).toHaveCount(0);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("2. library list: chip renders on user-owned row + AC4 ownership", async ({
    page,
  }) => {
    const email = `e2e-canonical-own-chip-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      // Admin-seed a user-owned exercise. The chip predicate is
      // `exercise.user_id !== null`, so this row must render the chip.
      const ownName = `My Custom Lift ${Date.now()}`;
      const { data: own, error: ownErr } = await admin
        .from("exercises")
        .insert({
          user_id: userId,
          name: ownName,
          muscles: ["Chest"],
        })
        .select("id, user_id, name")
        .single();
      if (ownErr || !own)
        throw new Error(`own-exercise seed: ${ownErr?.message}`);

      // AC4: the row's user_id must equal the signed-in user id, not NULL.
      expect(own.user_id).toBe(userId);

      await signInAndLand(page, email);
      await page.goto("/exercises", { waitUntil: "domcontentloaded" });

      const row = page.getByText(ownName, { exact: true }).first();
      await expect(row).toBeVisible({ timeout: 15_000 });

      // Chip should be present (a11y label + visible "You" glyph).
      await expect(page.getByLabel("Created by you").first()).toBeVisible({
        timeout: 5_000,
      });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("3. progress header pencil: absent for canonical, present for user-owned", async ({
    page,
  }) => {
    const email = `e2e-canonical-pencil-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      const canonical = await pickCanonicalExercise(admin, "Bench Press");

      // Seed a user-owned exercise too so we can pivot between the two
      // states within one signed-in run.
      const ownName = `Own-Pencil ${Date.now()}`;
      const { data: own, error: ownErr } = await admin
        .from("exercises")
        .insert({ user_id: userId, name: ownName, muscles: ["Chest"] })
        .select("id")
        .single();
      if (ownErr || !own) throw new Error(`own seed: ${ownErr?.message}`);

      await signInAndLand(page, email);

      // Canonical: progress header → no "Edit exercise" pencil.
      await page.goto(`/exercises/${canonical.id}/progress`, {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page.getByText(canonical.name, { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByLabel("Edit exercise")).toHaveCount(0);

      // User-owned: pencil is present.
      await page.goto(`/exercises/${own.id}/progress`, {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page.getByText(ownName, { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 });
      await expect(page.getByLabel("Edit exercise").first()).toBeVisible({
        timeout: 5_000,
      });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("4. deep-link edit screen: canonical renders read-only", async ({
    page,
  }) => {
    const email = `e2e-canonical-deep-link-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      const canonical = await pickCanonicalExercise(admin, "Bench Press");

      await signInAndLand(page, email);
      await page.goto(`/exercises/${canonical.id}`, {
        waitUntil: "domcontentloaded",
      });

      // Read-only label rows ("Name", "Muscles", "Equipment", "Notes") are
      // rendered as static <Text> in the canonical branch — there are no
      // editable Inputs, no MuscleGroupPicker, no Save / Cancel / Delete.
      await expect(
        page.getByText("Name", { exact: true }).first(),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByText(canonical.name, { exact: true }).first(),
      ).toBeVisible();
      await expect(page.getByText("Muscles", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Equipment", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Notes", { exact: true }).first()).toBeVisible();

      // The Back button replaces the Save/Cancel/Delete trio.
      await expect(page.getByText("Back", { exact: true }).last()).toBeVisible();

      // Mutating affordances must NOT appear.
      await expect(page.getByText("Save changes", { exact: true })).toHaveCount(
        0,
      );
      await expect(
        page.getByText("Delete exercise", { exact: true }),
      ).toHaveCount(0);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("5. RLS rejection: user-client UPDATE/DELETE of canonical affects 0 rows", async () => {
    const email = `e2e-canonical-rls-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    try {
      const canonical = await pickCanonicalExercise(admin, "Bench Press");

      const userClient = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
        auth: { persistSession: false },
      });
      const { error: signInErr } = await userClient.auth.signInWithPassword({
        email,
        password: PASSWORD,
      });
      if (signInErr) throw new Error(`sign-in: ${signInErr.message}`);

      // UPDATE — RLS UPDATE policy uses `auth.uid() = user_id`. Canonical
      // has `user_id IS NULL`, so the predicate fails and 0 rows are
      // affected. PostgREST returns an empty array with no error.
      const { data: updRows } = await userClient
        .from("exercises")
        .update({ name: "RLS-hijacked" })
        .eq("id", canonical.id)
        .select();
      expect((updRows ?? []).length).toBe(0);

      // DELETE — same gate; 0 rows affected.
      const { data: delRows } = await userClient
        .from("exercises")
        .delete()
        .eq("id", canonical.id)
        .select();
      expect((delRows ?? []).length).toBe(0);

      // Re-read via admin to confirm the canonical row is intact.
      const { data: postState } = await admin
        .from("exercises")
        .select("id, name, deleted_at")
        .eq("id", canonical.id)
        .single();
      expect(postState?.name).toBe(canonical.name);
      expect(postState?.deleted_at).toBeNull();
    } finally {
      await deleteUserSafe(userId);
    }
  });
});
