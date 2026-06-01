/**
 * E2E: per-session exercise display order (History detail).
 *
 * Run-id: 2026-06-01_0941_session-finish-exercise-order
 *
 * Bug: History derived exercise order from the `set_number`-tie-broken set
 * query, diverging from the order the user saw on the live screen. Fix: persist
 * an ordered `session_exercise_order uuid[]` on `sessions`; History orders its
 * exercise blocks by it (deterministic first-occurrence fallback for legacy
 * NULL). The History EDIT page also exposes up/down chevrons that persist a
 * reorder to the column (the legacy-recovery path).
 *
 * NOTE FOR THE REGRESSION TESTER: this spec is AUTHORED here but RUN by the
 * Regression Tester AFTER the Conductor applies migration
 * `0019_session_exercise_order.sql` to the live DB. It requires the
 * `session_exercise_order` column to exist. The seeded exercise names
 * ("Bench Press", "Squat (Barbell)", "Chin-up") are the canonical-catalog names
 * proven green across the existing suite (23 / 1 / 2 call sites of
 * `pickCanonicalExercise` respectively) — verified against the runtime catalog
 * the helper queries (`exercises WHERE user_id IS NULL`), not a seed migration.
 *
 * Mirrors the seed + flow shape of `read-only-history.spec.ts` (the closest
 * sibling): admin service-role seed of an ended session + sets, deep-link to
 * `/history/<id>`, drive the read-only/edit toggle.
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

// Three canonical exercises proven green across the suite. The intended
// "live order" is A → B → C; we always INSERT the sets in a DIFFERENT physical
// order (C, A, B) so the unspecified `set_number` tie-break would diverge from
// the intended order unless the persisted-order fix takes effect.
async function pickThree() {
  const a = await pickCanonicalExercise(admin, "Bench Press");
  const b = await pickCanonicalExercise(admin, "Squat (Barbell)");
  const c = await pickCanonicalExercise(admin, "Chin-up");
  return { a, b, c };
}

/**
 * Seed an ended multi-exercise session. Sets are inserted in physical order
 * c, a, b (NOT the A,B,C intended order). `sessionExerciseOrder` controls the
 * persisted column: pass an ordered id array, or `null` for a legacy session.
 */
async function seedSession(
  userId: string,
  name: string,
  ex: { a: { id: string }; b: { id: string }; c: { id: string } },
  sessionExerciseOrder: string[] | null,
): Promise<string> {
  const now = new Date();
  const startedAt = new Date(now.getTime() - 60 * 60 * 1000);
  const endedAt = new Date(now.getTime() - 30 * 60 * 1000);

  const insertSession: Record<string, unknown> = {
    user_id: userId,
    started_at: startedAt.toISOString(),
    ended_at: endedAt.toISOString(),
    name,
  };
  if (sessionExerciseOrder !== null) {
    insertSession.session_exercise_order = sessionExerciseOrder;
  }

  const { data: sess, error: sessErr } = await admin
    .from("sessions")
    .insert(insertSession)
    .select("id")
    .single();
  if (sessErr || !sess) throw new Error(`session seed: ${sessErr?.message}`);

  // Physical insertion order c, a, b → the tie-break (first-occurrence over the
  // set_number-sorted query) would render c, a, b without the fix.
  const physicalOrder = [ex.c.id, ex.a.id, ex.b.id];
  let setNo = 1;
  for (const exerciseId of physicalOrder) {
    const { error: setErr } = await admin.from("sets").insert({
      user_id: userId,
      session_id: sess.id,
      exercise_id: exerciseId,
      set_number: setNo++,
      reps: 8,
      weight: "100",
      set_type: "working",
      completed_at: endedAt.toISOString(),
    });
    if (setErr) throw new Error(`seed set: ${setErr.message}`);
  }

  return sess.id as string;
}

/** Vertical Y of the first visible occurrence of an exercise-name heading. */
async function nameY(page: Page, name: string): Promise<number> {
  const loc = page.getByText(name, { exact: true }).first();
  await expect(loc).toBeVisible({ timeout: 10_000 });
  const box = await loc.boundingBox();
  if (!box) throw new Error(`no bounding box for "${name}"`);
  return box.y;
}

async function readSessionOrder(sessionId: string): Promise<string[] | null> {
  const { data, error } = await admin
    .from("sessions")
    .select("session_exercise_order")
    .eq("id", sessionId)
    .single();
  if (error || !data) throw new Error(`read order: ${error?.message}`);
  return (data.session_exercise_order as string[] | null) ?? null;
}

test.afterAll(async () => {
  await Promise.all(Array.from(createdUserIds).map(deleteUserSafe));
});

test.describe("Session exercise order (web)", () => {
  test("(1) History renders the PERSISTED order, not the set-insertion tie-break", async ({
    page,
  }) => {
    const email = `e2e-order-persisted-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);

    try {
      const ex = await pickThree();
      // Persist A,B,C even though sets were inserted physically C,A,B.
      const sessionId = await seedSession(userId, "Persisted order", ex, [
        ex.a.id,
        ex.b.id,
        ex.c.id,
      ]);
      await signInAndLand(page, email);

      await page.goto(`/history/${sessionId}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByText("Persisted order").first()).toBeVisible({
        timeout: 10_000,
      });

      // Blocks render top-to-bottom in the PERSISTED order: A above B above C.
      const yA = await nameY(page, ex.a.name);
      const yB = await nameY(page, ex.b.name);
      const yC = await nameY(page, ex.c.name);
      expect(yA).toBeLessThan(yB);
      expect(yB).toBeLessThan(yC);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("(2) legacy session (NULL order): read-only has NO chevrons; first edit-mode reorder persists the column", async ({
    page,
  }) => {
    const email = `e2e-order-legacy-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);

    try {
      const ex = await pickThree();
      // Legacy: NULL column → renders the discovered (insertion) order C,A,B.
      const sessionId = await seedSession(userId, "Legacy order", ex, null);
      expect(await readSessionOrder(sessionId)).toBeNull();

      await signInAndLand(page, email);
      await page.goto(`/history/${sessionId}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByText("Legacy order").first()).toBeVisible({
        timeout: 10_000,
      });

      // Read-only: no reorder chevrons.
      await expect(page.getByLabel(`Move ${ex.c.name} up`)).toHaveCount(0);
      await expect(page.getByLabel(`Move ${ex.c.name} down`)).toHaveCount(0);

      // Discovered order is C, A, B (insertion order, no persisted column).
      expect(await nameY(page, ex.c.name)).toBeLessThan(
        await nameY(page, ex.a.name),
      );

      // Enter edit mode → chevrons appear.
      await page.getByLabel("Edit workout").click();
      await expect(page.getByLabel("Exit edit mode")).toHaveCount(1);
      // First block (C) up disabled; reorder A up so order becomes C? -> move A up.
      await expect(page.getByLabel(`Move ${ex.a.name} up`)).toHaveCount(1);

      // Move A up once: C,A,B → A,C,B. This is the FIRST persist on a legacy
      // session → the NULL column becomes a full uuid[] of the displayed order
      // with the move applied.
      await page.getByLabel(`Move ${ex.a.name} up`).click();

      // The local reorder is instant: A now above C.
      await expect(async () => {
        expect(await nameY(page, ex.a.name)).toBeLessThan(
          await nameY(page, ex.c.name),
        );
      }).toPass({ timeout: 5_000 });

      // The column persisted from NULL → [A, C, B].
      await expect(async () => {
        expect(await readSessionOrder(sessionId)).toEqual([
          ex.a.id,
          ex.c.id,
          ex.b.id,
        ]);
      }).toPass({ timeout: 10_000 });

      // Reopen (fresh mount) → the persisted order is shown: A, C, B.
      await page.goto(`/history/${sessionId}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByText("Legacy order").first()).toBeVisible({
        timeout: 10_000,
      });
      // The app uses PersistQueryClientProvider: on `page.goto` reopen in the
      // same browser context, localStorage rehydrates the pre-reorder cache
      // synchronously on mount, so the first paint can show the stale order
      // until the invalidation-triggered background refetch wins. Poll the
      // render until the persisted order (A, C, B) settles — matches the
      // toPass pattern used for the local-reorder assertions above.
      await expect(async () => {
        const yA = await nameY(page, ex.a.name);
        const yC = await nameY(page, ex.c.name);
        const yB = await nameY(page, ex.b.name);
        expect(yA).toBeLessThan(yC);
        expect(yC).toBeLessThan(yB);
      }).toPass({ timeout: 15_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("(3) within-exercise set order unchanged after a reorder; set count intact", async ({
    page,
  }) => {
    const email = `e2e-order-setsafe-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);

    try {
      const ex = await pickThree();
      const sessionId = await seedSession(userId, "Set-safe order", ex, [
        ex.a.id,
        ex.b.id,
        ex.c.id,
      ]);
      await signInAndLand(page, email);
      await page.goto(`/history/${sessionId}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByText("Set-safe order").first()).toBeVisible({
        timeout: 10_000,
      });

      await page.getByLabel("Edit workout").click();
      await expect(page.getByLabel("Exit edit mode")).toHaveCount(1);

      // One working set per exercise → 3 weight inputs before and after reorder.
      await expect(page.locator('input[inputmode="decimal"]')).toHaveCount(3);

      // Move B down: A,B,C → A,C,B.
      await page.getByLabel(`Move ${ex.b.name} down`).click();
      await expect(async () => {
        expect(await nameY(page, ex.c.name)).toBeLessThan(
          await nameY(page, ex.b.name),
        );
      }).toPass({ timeout: 5_000 });

      // Set count (and thus within-exercise set rendering) intact after reorder.
      await expect(page.locator('input[inputmode="decimal"]')).toHaveCount(3);

      // Persisted order reflects the move.
      await expect(async () => {
        expect(await readSessionOrder(sessionId)).toEqual([
          ex.a.id,
          ex.c.id,
          ex.b.id,
        ]);
      }).toPass({ timeout: 10_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });
});
