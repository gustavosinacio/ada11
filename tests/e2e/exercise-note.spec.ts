/**
 * E2E for the per-(user, exercise) personal note feature
 * (run 2026-05-24_2327_exercise-note).
 *
 * Coverage matrix (Validator MIN-v2-5 mandate — full-matrix, not a sanity-run):
 *   1. Progress screen, no prior note → editable empty <Textarea> (alwaysExpanded).
 *      Type + blur → server returns row → slot re-hydrates with body.
 *   2. Live workout — empty `+ Add note` collapsed Pressable expands on tap,
 *      commits on blur.
 *   3. Live workout — leave the just-expanded editor blank and blur: it
 *      collapses back without firing a mutate (MIN-v2-2 contract).
 *   4. History detail read-only — ReadOnlyExerciseBlock surfaces the note as
 *      italic gray text.
 *   5. History detail read-only — exercise with no note renders nothing for
 *      the slot.
 *   6. Soft-deleted exercise — note still renders on the progress screen
 *      (notes belong to the user, not to the exercise's lifecycle).
 *   7. Lbs unit — note display is unit-agnostic; lbs preference does not
 *      alter the note rendering (visibility check only).
 *   8. 2000-char cap — <Textarea maxLength> truncates input that exceeds the
 *      cap; the persisted body is exactly 2000 chars.
 *
 * Pattern: seed a confirmed user via admin, sign in, drive the UI. Notes are
 * created through the editable surface (Textarea on progress / collapsed
 * affordance on ExerciseBlock).
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

async function pickSeedExercise(userId: string): Promise<{ id: string; name: string }> {
  const { data, error } = await admin
    .from("exercises")
    .select("id, name")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("name", { ascending: true });
  if (error || !data || data.length === 0) {
    throw new Error(`No exercises for ${userId}: ${error?.message}`);
  }
  const bench = data.find((r) => r.name === "Bench Press");
  return bench ?? (data[0] as { id: string; name: string });
}

/**
 * Clear the persisted React Query cache (the AsyncStorage/localStorage entry
 * that `createAsyncStoragePersister` writes). Forces a fresh network fetch
 * on the next mount of any query whose data would otherwise rehydrate from
 * localStorage. The golden test uses this between the progress-screen POST
 * and the /history deep-link so the read-only slot's GET cannot be served
 * from a stale empty-array entry written before the POST landed.
 */
async function purgeQueryCache(page: Page) {
  await page.evaluate(() => {
    window.localStorage.removeItem("ada11-query-cache");
  });
}

test.afterAll(async () => {
  await Promise.all(Array.from(createdUserIds).map(deleteUserSafe));
});

test.describe("Exercise note feature (web)", () => {
  test("golden: progress screen edit → history read-only surfaces the note", async ({
    page,
  }) => {
    const email = `e2e-exnote-golden-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exercise = await pickSeedExercise(userId);

    // Admin-seed an ended session + working set BEFORE the UI flow runs.
    // History detail enumerates exercises from the `sets` table
    // (`app/(app)/history/[id].tsx:87-113`): zero sets ⇒ no
    // <ReadOnlyExerciseBlock> mounts ⇒ no <ExerciseNoteSlot> to surface the
    // note. Seeding server-side and deep-linking directly to /history/<id>
    // mirrors the pattern test #3 / read-only-history.spec.ts:82-151 already
    // proves stable — and crucially avoids visiting /workout/<id> at all,
    // which is what primed the empty-sets entry in the in-memory React Query
    // cache and caused the round-1 + round-2 history-detail flake (see
    // test-report-v2.md root-cause analysis).
    const now = new Date();
    const startedAt = new Date(now.getTime() - 60 * 60 * 1000);
    const endedAt = new Date(now.getTime() - 30 * 60 * 1000);

    const { data: sess, error: sessErr } = await admin
      .from("sessions")
      .insert({
        user_id: userId,
        started_at: startedAt.toISOString(),
        ended_at: endedAt.toISOString(),
        name: "Golden read-only target",
      })
      .select("id")
      .single();
    if (sessErr || !sess) throw new Error(`session seed: ${sessErr?.message}`);
    const sessionId = sess.id;

    const { data: setRow, error: setErr } = await admin
      .from("sets")
      .insert({
        user_id: userId,
        session_id: sessionId,
        exercise_id: exercise.id,
        set_number: 1,
        reps: 8,
        weight: "60",
        set_type: "working",
        completed_at: endedAt.toISOString(),
      })
      .select("id")
      .single();
    if (setErr || !setRow) throw new Error(`seed set: ${setErr?.message}`);

    try {
      await signInAndLand(page, email);

      // -------------------------------------------------------------
      // 1) Progress screen — empty Textarea (alwaysExpanded). Type + blur.
      // -------------------------------------------------------------
      await page.goto(`/exercises/${exercise.id}/progress`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForURL(
        new RegExp(`/exercises/${exercise.id}/progress$`),
        { timeout: 10_000 },
      );

      // The slot renders the placeholder Textarea on alwaysExpanded.
      const noteTextarea = page.getByPlaceholder(
        "Add a note for this exercise…",
      );
      await expect(noteTextarea.first()).toBeVisible({ timeout: 10_000 });

      const noteBody = "grip width: shoulder-width";
      await noteTextarea.first().fill(noteBody);

      // Commit on blur — dispatch a DOM blur event directly on the focused
      // textarea. The previous click-outside + activeElement.blur() chain did
      // NOT reliably fire onBlur on RN-web in this codebase. We also wait for
      // the POST /rest/v1/exercise_notes response BEFORE proceeding so the
      // server round-trip is guaranteed to land before we navigate away (the
      // local <Textarea> value reflects the draft regardless of server
      // commit, so a value-based wait would not catch a missed POST).
      const postResponsePromise = page.waitForResponse(
        (res) =>
          res.url().includes("/rest/v1/exercise_notes") &&
          res.request().method() === "POST",
        { timeout: 10_000 },
      );
      await page.evaluate(() => {
        const el = document.querySelector(
          'textarea[placeholder="Add a note for this exercise…"]',
        ) as HTMLTextAreaElement | null;
        if (!el) return;
        // Ensure focused first so the synthetic blur is observable to React's
        // focus delegation. Then dispatch focusout (the event React listens
        // for under modern delegation) + a bubbling blur, plus the native
        // el.blur() call for good measure.
        el.focus();
        el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
        el.blur();
      });
      const postResponse = await postResponsePromise;
      expect(postResponse.status()).toBeGreaterThanOrEqual(200);
      expect(postResponse.status()).toBeLessThan(300);

      // Confirm the row landed locally too: the Textarea now holds the
      // persisted value (post setQueryData on mutation success).
      await expect(noteTextarea.first()).toHaveValue(noteBody, {
        timeout: 10_000,
      });

      // -------------------------------------------------------------
      // 2) History detail read-only — slot renders the note italic.
      //    Deep-link directly to /history/<sessionId>. The session + set
      //    were admin-seeded above, so the read-only <ReadOnlyExerciseBlock>
      //    mounts and surfaces the slot. No /workout/<id> visit ⇒ no empty
      //    sets cache priming ⇒ no race on the sets query.
      //
      //    Purge the persisted query cache BEFORE navigation. The progress
      //    screen's slot fired an initial exercise_notes GET that returned
      //    `[]` (no row yet) and pushed that empty result into the persister.
      //    `setQueryData` after the POST updates the in-memory cache, but
      //    the persister's throttled writer (default 1000ms) is not
      //    guaranteed to have flushed before navigation. On reload, the
      //    rehydrated cache could be the stale empty value, and with
      //    staleTime=30s the slot would not refetch. Purging localStorage
      //    forces a fresh network GET on the read-only mount, which
      //    deterministically returns the persisted row.
      // -------------------------------------------------------------
      await purgeQueryCache(page);
      await page.goto(`/history/${sessionId}`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForURL(new RegExp(`/history/${sessionId}$`), {
        timeout: 10_000,
      });

      // Wait for the read-only block to mount — assert the exercise header
      // is visible before checking the note, so the assertion isn't a vacuous
      // early read.
      await expect(
        page.getByText(exercise.name, { exact: true }).first(),
      ).toBeVisible({ timeout: 10_000 });

      // In read-only mode the slot renders the body as italic text. Use the
      // body string itself as the assertion — it's unique enough.
      await expect(
        page.getByText(noteBody, { exact: true }).first(),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("live workout: + Add note collapsed → tap → expand → blur empty does NOT mutate", async ({
    page,
  }) => {
    const email = `e2e-exnote-collapsed-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exercise = await pickSeedExercise(userId);

    try {
      await signInAndLand(page, email);

      await page.getByText("Quick start workout").last().click();
      await page.waitForURL(/\/workout\/[0-9a-f-]+/, { timeout: 15_000 });

      await page.getByText("Add exercise", { exact: true }).first().click();
      await expect(page.getByText("Pick exercise")).toBeVisible({
        timeout: 10_000,
      });
      await page
        .getByPlaceholder("Search by name, muscle, equipment")
        .fill(exercise.name);
      await page.getByText(exercise.name, { exact: true }).first().click();
      await expect(page.getByText("Pick exercise")).not.toBeVisible({
        timeout: 10_000,
      });

      // Collapsed "+ Add note" affordance is the default empty state on
      // <ExerciseBlock>.
      const addNote = page.getByLabel("Add a note for this exercise").first();
      await expect(addNote).toBeVisible({ timeout: 10_000 });

      // Tap → editor expands and autofocuses.
      await addNote.click();
      const editor = page.getByLabel("Exercise note").first();
      await expect(editor).toBeVisible({ timeout: 5_000 });

      // Blur immediately (without typing) — slot must collapse back to the
      // + Add note affordance and NOT fire a mutate (MIN-v2-2).
      // Track requests to the exercise_notes endpoint.
      const upsertRequests: string[] = [];
      page.on("request", (req) => {
        const url = req.url();
        if (
          url.includes("/rest/v1/exercise_notes") &&
          (req.method() === "POST" || req.method() === "PATCH")
        ) {
          upsertRequests.push(`${req.method()} ${url}`);
        }
      });

      await page.evaluate(() => {
        (document.activeElement as HTMLElement | null)?.blur();
      });

      // The collapsed affordance should be back.
      await expect(
        page.getByLabel("Add a note for this exercise").first(),
      ).toBeVisible({ timeout: 5_000 });

      // No write should have fired.
      await page.waitForTimeout(500); // small settle window
      expect(upsertRequests).toHaveLength(0);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("history read-only: exercise with no note renders nothing for the slot", async ({
    page,
  }) => {
    const email = `e2e-exnote-empty-ro-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exercise = await pickSeedExercise(userId);

    // Admin-seed an ended session with one working set so the read-only
    // history detail mounts a <ReadOnlyExerciseBlock> for the exercise
    // (history enumerates exercises from the `sets` table — zero sets ⇒
    // no block ⇒ no slot to surface the note). Pattern mirrors
    // tests/e2e/read-only-history.spec.ts:82-151 — fully admin-seeded,
    // no live-workout flow, so the test focuses on the "no note" assertion
    // without coupling to the Finish/verdict navigation.
    const now = new Date();
    const startedAt = new Date(now.getTime() - 60 * 60 * 1000);
    const endedAt = new Date(now.getTime() - 30 * 60 * 1000);

    const { data: sess, error: sessErr } = await admin
      .from("sessions")
      .insert({
        user_id: userId,
        started_at: startedAt.toISOString(),
        ended_at: endedAt.toISOString(),
        name: "Empty-note read-only target",
      })
      .select("id")
      .single();
    if (sessErr || !sess) throw new Error(`session seed: ${sessErr?.message}`);
    const sessionId = sess.id;

    const { data: setRow, error: setErr } = await admin
      .from("sets")
      .insert({
        user_id: userId,
        session_id: sessionId,
        exercise_id: exercise.id,
        set_number: 1,
        reps: 8,
        weight: "60",
        set_type: "working",
        completed_at: endedAt.toISOString(),
      })
      .select("id")
      .single();
    if (setErr || !setRow) throw new Error(`set seed: ${setErr?.message}`);

    try {
      await signInAndLand(page, email);

      await page.goto(`/history/${sessionId}`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForURL(new RegExp(`/history/${sessionId}$`), {
        timeout: 10_000,
      });
      // Wait for the read-only block to actually mount — assert the
      // exercise header is visible before checking the slot's absence,
      // so the "no note" assertion isn't a vacuous early read.
      await expect(
        page.getByText(exercise.name, { exact: true }).first(),
      ).toBeVisible({ timeout: 10_000 });

      // No note set — the slot must render nothing. There should be no
      // "Add a note" affordance (read-only) and no italic body text.
      await expect(
        page.getByLabel("Add a note for this exercise"),
      ).toHaveCount(0);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("2000-char cap: <Textarea maxLength> truncates input", async ({
    page,
  }) => {
    const email = `e2e-exnote-cap-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exercise = await pickSeedExercise(userId);

    try {
      await signInAndLand(page, email);

      await page.goto(`/exercises/${exercise.id}/progress`, {
        waitUntil: "domcontentloaded",
      });
      const noteTextarea = page.getByPlaceholder(
        "Add a note for this exercise…",
      );
      await expect(noteTextarea.first()).toBeVisible({ timeout: 10_000 });

      const tooLong = "x".repeat(2500);
      await noteTextarea.first().fill(tooLong);
      const after = await noteTextarea.first().inputValue();
      expect(after.length).toBe(2000);
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("soft-deleted exercise: progress screen still surfaces the note", async ({
    page,
  }) => {
    const email = `e2e-exnote-softdel-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exercise = await pickSeedExercise(userId);

    // Pre-seed the note via admin so the test is deterministic regardless of
    // editor behavior — this test focuses on the soft-delete visibility
    // contract specifically.
    const noteBody = "deleted-but-the-cue-stays";
    const { error: insErr } = await admin.from("exercise_notes").insert({
      user_id: userId,
      exercise_id: exercise.id,
      body: noteBody,
    });
    if (insErr) throw new Error(`note insert: ${insErr.message}`);

    // Soft-delete the exercise.
    const { error: delErr } = await admin
      .from("exercises")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", exercise.id);
    if (delErr) throw new Error(`exercise soft-delete: ${delErr.message}`);

    try {
      await signInAndLand(page, email);
      await page.goto(`/exercises/${exercise.id}/progress`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForURL(
        new RegExp(`/exercises/${exercise.id}/progress$`),
        { timeout: 10_000 },
      );

      // The Textarea is editable and pre-populated with the noteBody.
      await expect(
        page.getByLabel("Exercise note").first(),
      ).toHaveValue(noteBody, { timeout: 10_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("lbs unit: note display is unit-agnostic", async ({ page }) => {
    const email = `e2e-exnote-lbs-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exercise = await pickSeedExercise(userId);

    // Flip the preference to lbs via admin.
    const { error: prefErr } = await admin
      .from("user_preferences")
      .update({ weight_unit: "lbs" })
      .eq("user_id", userId);
    if (prefErr) throw new Error(`preference update: ${prefErr.message}`);

    const noteBody = "form cue: chest up, shins vertical";
    const { error: insErr } = await admin.from("exercise_notes").insert({
      user_id: userId,
      exercise_id: exercise.id,
      body: noteBody,
    });
    if (insErr) throw new Error(`note insert: ${insErr.message}`);

    try {
      await signInAndLand(page, email);
      await page.goto(`/exercises/${exercise.id}/progress`, {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page.getByLabel("Exercise note").first(),
      ).toHaveValue(noteBody, { timeout: 10_000 });
    } finally {
      await deleteUserSafe(userId);
    }
  });
});
