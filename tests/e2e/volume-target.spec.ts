/**
 * Dynamic E2E for the per-exercise volume-target strip on the live workout
 * screen. Created by the Tester agent for run 2026-05-21_1505_exercise-volume-target.
 *
 * Strategy:
 *  - Spin up a fresh confirmed user via the admin API.
 *  - Pick a seeded exercise (the seed_new_user trigger inserts ~30 lifts).
 *  - Seed a finished session for that exercise with deterministic working sets
 *    so we know the previous-best volume (1800 kg).
 *  - Seed live-session sets directly via admin and reset the persisted TanStack
 *    cache (`ada11-query-cache` in localStorage) between mutations so the page
 *    refetches deterministically — same pattern as `weekly-volume-strip.spec.ts`.
 *  - Assert the strip's rendered text (note: post-multi-metric-strip, the
 *    chasing copy is "Max X · Now Y · To PR Z" with optional "≈ R reps @ Wkg"):
 *      * "Max 1,800 kg · Now 0 kg · To PR 1,800 kg" before any checked weight.
 *      * "Max 1,800 kg · Now 500 kg · To PR 1,300 kg · ≈ 26.0 reps @ 50.0 kg"
 *        after a CHECKED 50 × 10 set.
 *      * "Max 1,800 kg · Now 980 kg · To PR 820 kg · ≈ 13.7 reps @ 60.0 kg"
 *        after a CHECKED 60 × 8 second set.
 *      * Emerald "New PR! +X over your previous" after surpassing.
 *      * "Matched your previous best — one more rep is a PR" on exact tie.
 *  - MAJ-1 regression: max(set_number) picks current weight despite array order.
 *  - Negative test: a brand-new exercise (no history) does not render the strip.
 *  - Regression: history detail does not render the strip.
 *
 * Playwright pattern note: the slot renders mixed inline `<Text>` nodes so
 * substrings like "Max 1,800 kg" span multiple DOM spans on web. For
 * prefix-bearing assertions use `getByText(/Max|Now|To PR/i).first().innerText()`
 * then `.toContain(value)` — same pattern already used at line ~348-353.
 */

import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import fs from "node:fs";

import { pickCanonicalExercise } from "./_helpers/canonical-exercise";
import path from "node:path";

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
const SCREENSHOT_DIR = path.resolve(
  "docs/runs/2026-05-21_1505_exercise-volume-target/screenshots",
);
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

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

async function seedFinishedPRSession(opts: {
  userId: string;
  exerciseId: string;
  workingSets: { weight: number; reps: number }[];
  finishedDaysAgo?: number;
}): Promise<string> {
  const finishedDaysAgo = opts.finishedDaysAgo ?? 2;
  const endedAt = new Date(Date.now() - finishedDaysAgo * 24 * 60 * 60 * 1000);
  const startedAt = new Date(endedAt.getTime() - 60 * 60 * 1000);
  const { data: sess, error: e1 } = await admin
    .from("sessions")
    .insert({
      user_id: opts.userId,
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      name: "Seeded PR session",
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
      name: "Live test session",
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
  // Purge the persisted TanStack cache so the next mount refetches cold.
  // Same pattern used by `tests/e2e/weekly-volume-strip.spec.ts:330`.
  await page.evaluate(() => {
    window.localStorage.removeItem("ada11-query-cache");
  });
}

async function gotoLiveSession(page: Page, sessionId: string) {
  // Cold mount on the live workout: clear cache, then `goto` so TanStack
  // runs fresh queries instead of restoring stale data from localStorage.
  await purgeQueryCache(page);
  await page.goto(`/(app)/workout/${sessionId}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForURL(/\/workout\/[0-9a-f-]+/, { timeout: 15_000 });
}

test.describe("Volume-target strip (live workout)", () => {
  test("golden path: chasing copy + reps clause across multiple seeded sets", async ({
    page,
  }) => {
    const email = `e2e-volt-golden-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exercise = await getSeedExerciseByName(userId, "Bench Press");

    // Seed previous best: 3 × 60 × 10 = 1800 kg.
    await seedFinishedPRSession({
      userId,
      exerciseId: exercise.id,
      workingSets: [
        { weight: 60, reps: 10 },
        { weight: 60, reps: 10 },
        { weight: 60, reps: 10 },
      ],
    });

    const liveSessionId = await startLiveSession(userId);

    // Phase B: seed a single CHECKED set 50 × 10 = 500 kg. Gap = 1300 kg.
    // Current weight 50 → reps to beat = 26.0. Now must be checked-only.
    await seedLiveSet({
      userId,
      sessionId: liveSessionId,
      exerciseId: exercise.id,
      setNumber: 1,
      weightKg: 50,
      reps: 10,
      completedAt: new Date().toISOString(),
    });

    try {
      await signInAndLand(page, email);
      await gotoLiveSession(page, liveSessionId);

      await expect(page.getByText(/To PR/i).first()).toBeVisible({
        timeout: 15_000,
      });
      // Mixed inline Text nodes: assert by reading the strip text and using
      // `.toContain` against the substrings (Max / Now / To PR values live
      // in separate spans on web).
      const phaseBText = await page
        .getByText(/Max|Now|To PR/i)
        .first()
        .innerText();
      expect(phaseBText).toContain("Max");
      expect(phaseBText).toContain("1,800 kg");
      expect(phaseBText).toContain("Now");
      expect(phaseBText).toContain("500 kg");
      expect(phaseBText).toContain("To PR");
      expect(phaseBText).toContain("1,300 kg");
      await expect(page.getByText(/26\.0 reps/).first()).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByText(/@ 50\.0 kg/).first()).toBeVisible({
        timeout: 10_000,
      });

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "02-chasing-50x10.png"),
        fullPage: false,
      });

      // Phase C: add CHECKED set #2 60 × 8 = 480. Cumulative 980. Gap 820.
      // Current weight = 60 (max set_number) → reps to beat = 13.666... → "13.7 reps".
      await seedLiveSet({
        userId,
        sessionId: liveSessionId,
        exerciseId: exercise.id,
        setNumber: 2,
        weightKg: 60,
        reps: 8,
        completedAt: new Date().toISOString(),
      });
      await gotoLiveSession(page, liveSessionId);
      await expect(page.getByText(/To PR/i).first()).toBeVisible({
        timeout: 15_000,
      });
      const phaseCText = await page
        .getByText(/Max|Now|To PR/i)
        .first()
        .innerText();
      expect(phaseCText).toContain("Max");
      expect(phaseCText).toContain("1,800 kg");
      expect(phaseCText).toContain("Now");
      expect(phaseCText).toContain("980 kg");
      expect(phaseCText).toContain("To PR");
      expect(phaseCText).toContain("820 kg");
      await expect(page.getByText(/13\.7 reps/).first()).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByText(/@ 60\.0 kg/).first()).toBeVisible({
        timeout: 10_000,
      });

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "03-chasing-after-60x8.png"),
        fullPage: false,
      });

      // Phase D: surpass with CHECKED set #3 60 × 20 = 1200. Cumulative 2180.
      // Overflow 380 kg over previous best.
      await seedLiveSet({
        userId,
        sessionId: liveSessionId,
        exerciseId: exercise.id,
        setNumber: 3,
        weightKg: 60,
        reps: 20,
        completedAt: new Date().toISOString(),
      });
      await gotoLiveSession(page, liveSessionId);
      await expect(page.getByText(/New PR/i).first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText(/\+380 kg/).first()).toBeVisible({
        timeout: 10_000,
      });

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "04-surpassed-380.png"),
        fullPage: false,
      });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("chasing — no weight logged: hides the reps clause", async ({ page }) => {
    const email = `e2e-volt-noweight-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exercise = await getSeedExerciseByName(userId, "Bench Press");

    await seedFinishedPRSession({
      userId,
      exerciseId: exercise.id,
      workingSets: [
        { weight: 60, reps: 10 },
        { weight: 60, reps: 10 },
        { weight: 60, reps: 10 },
      ],
    });

    // Seed a live "draft" set with no weight/reps yet — the exercise block
    // shows up but the strip should display only the gap with no reps clause.
    const liveSessionId = await startLiveSession(userId);
    await admin.from("sets").insert({
      user_id: userId,
      session_id: liveSessionId,
      exercise_id: exercise.id,
      set_number: 1,
      reps: null,
      weight: null,
      set_type: "working",
      completed_at: null,
    });

    try {
      await signInAndLand(page, email);
      await gotoLiveSession(page, liveSessionId);

      await expect(page.getByText("1,800 kg").first()).toBeVisible({
        timeout: 15_000,
      });
      const stripText = await page
        .getByText(/Max|Now|To PR/i)
        .first()
        .innerText();
      // Max = 1,800; Now = 0 (nothing checked); To PR = 1,800.
      expect(stripText).toContain("Max");
      expect(stripText).toContain("1,800 kg");
      expect(stripText).toContain("Now");
      expect(stripText).toContain("0 kg");
      expect(stripText).toContain("To PR");
      // No reps clause — both because `runningKg === 0` (MAJ-1 fix in slot)
      // AND because no weight is logged yet. Either gate alone would hide it.
      expect(stripText).not.toMatch(/reps/i);

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "01-chasing-no-weight.png"),
        fullPage: false,
      });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("tie case: matched copy renders when running == previous max", async ({
    page,
  }) => {
    const email = `e2e-volt-tie-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exercise = await getSeedExerciseByName(userId, "Bench Press");

    await seedFinishedPRSession({
      userId,
      exerciseId: exercise.id,
      workingSets: [
        { weight: 60, reps: 10 },
        { weight: 60, reps: 10 },
        { weight: 60, reps: 10 },
      ],
    });

    const liveSessionId = await startLiveSession(userId);
    for (let i = 1; i <= 3; i++) {
      await seedLiveSet({
        userId,
        sessionId: liveSessionId,
        exerciseId: exercise.id,
        setNumber: i,
        weightKg: 60,
        reps: 10,
        completedAt: new Date().toISOString(),
      });
    }

    try {
      await signInAndLand(page, email);
      await gotoLiveSession(page, liveSessionId);

      await expect(
        page.getByText(/Matched your previous best/i).first(),
      ).toBeVisible({ timeout: 15_000 });

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "05-tie-matched.png"),
        fullPage: false,
      });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("MAJ-1 regression: max(set_number) picks current weight, not array index", async ({
    page,
  }) => {
    const email = `e2e-volt-maj1-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exercise = await getSeedExerciseByName(userId, "Bench Press");

    // Previous best: 1 × 100 × 10 = 1000 kg.
    await seedFinishedPRSession({
      userId,
      exerciseId: exercise.id,
      workingSets: [{ weight: 100, reps: 10 }],
    });

    const liveSessionId = await startLiveSession(userId);
    // Set #1 CHECKED, 100 × 5 (volume 500). Now-counted under new
    // checked-only semantics so the running total is well defined.
    await seedLiveSet({
      userId,
      sessionId: liveSessionId,
      exerciseId: exercise.id,
      setNumber: 1,
      weightKg: 100,
      reps: 5,
      completedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    // Set #2 CHECKED, 80 × 5 (volume 400). Total running 900. Gap 100.
    // With max(set_number) → current weight = 80 → 1.25 reps → "1.3 reps".
    await seedLiveSet({
      userId,
      sessionId: liveSessionId,
      exerciseId: exercise.id,
      setNumber: 2,
      weightKg: 80,
      reps: 5,
      completedAt: new Date().toISOString(),
    });

    try {
      await signInAndLand(page, email);
      await gotoLiveSession(page, liveSessionId);

      // Mixed inline Text — read the strip and assert by substring.
      const stripText = await page
        .getByText(/Max|Now|To PR/i)
        .first()
        .innerText();
      expect(stripText).toContain("Max");
      expect(stripText).toContain("1,000 kg");
      expect(stripText).toContain("Now");
      expect(stripText).toContain("900 kg");
      expect(stripText).toContain("To PR");
      expect(stripText).toContain("100 kg");
      // Reps to beat = 1.25 → "1.3 reps" (toFixed(1)).
      await expect(page.getByText(/1\.3 reps/).first()).toBeVisible({
        timeout: 10_000,
      });
      // Current weight @ 80.0 kg — NOT 100.0 kg.
      await expect(page.getByText(/@ 80\.0 kg/).first()).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByText(/@ 100\.0 kg/)).toHaveCount(0);

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "06-maj1-regression.png"),
        fullPage: false,
      });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("no previous max: strip is hidden for a never-trained exercise", async ({
    page,
  }) => {
    const email = `e2e-volt-nopr-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exercise = await getSeedExerciseByName(userId, "Bench Press");

    // No seeded prior session for this exercise.
    const liveSessionId = await startLiveSession(userId);
    await seedLiveSet({
      userId,
      sessionId: liveSessionId,
      exerciseId: exercise.id,
      setNumber: 1,
      weightKg: 50,
      reps: 5,
    });

    try {
      await signInAndLand(page, email);
      await gotoLiveSession(page, liveSessionId);

      // The exercise block renders, but the strip does NOT.
      // MIN-1: assert against the new copy ("To PR", "Max ") — the old
      // "Volume to PR:" string is gone post-multi-metric-strip.
      await expect(page.getByText(/To PR/i)).toHaveCount(0);
      await expect(page.getByText(/Max\s/i)).toHaveCount(0);
      await expect(page.getByText(/New PR/i)).toHaveCount(0);
      await expect(page.getByText(/Matched your previous best/i)).toHaveCount(0);

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "07-no-pr-hidden.png"),
        fullPage: false,
      });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("history detail does NOT render the strip", async ({ page }) => {
    const email = `e2e-volt-history-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exercise = await getSeedExerciseByName(userId, "Bench Press");

    // Seed two finished sessions: one big (becomes the previous max), one
    // smaller that we'll open in history detail.
    await seedFinishedPRSession({
      userId,
      exerciseId: exercise.id,
      workingSets: [
        { weight: 60, reps: 10 },
        { weight: 60, reps: 10 },
        { weight: 60, reps: 10 },
      ],
      finishedDaysAgo: 3,
    });
    const targetSessionId = await seedFinishedPRSession({
      userId,
      exerciseId: exercise.id,
      workingSets: [{ weight: 50, reps: 5 }],
      finishedDaysAgo: 1,
    });

    try {
      await signInAndLand(page, email);
      await page.goto(`/(app)/history/${targetSessionId}`, {
        waitUntil: "domcontentloaded",
      });
      // History detail loads the session view; assert no strip rendered.
      await page
        .waitForLoadState("networkidle", { timeout: 10_000 })
        .catch(() => {});
      // MIN-1: assert against the new copy ("To PR", "Max ").
      await expect(page.getByText(/To PR/i)).toHaveCount(0);
      await expect(page.getByText(/Max\s/i)).toHaveCount(0);
      await expect(page.getByText(/New PR/i)).toHaveCount(0);
      await expect(page.getByText(/Matched your previous best/i)).toHaveCount(0);

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "08-history-no-strip.png"),
        fullPage: false,
      });
    } finally {
      await deleteUserSafe(userId);
    }
  });

  test("checked-only running volume: toggling a set's check updates Now, gap, and reps in lockstep", async ({
    page,
  }) => {
    const email = `e2e-volt-toggle-${Date.now()}@test.com`;
    const userId = await createConfirmedUser(email);
    const exercise = await getSeedExerciseByName(userId, "Bench Press");

    // Previous best: 100 × 10 = 1,000 kg.
    await seedFinishedPRSession({
      userId,
      exerciseId: exercise.id,
      workingSets: [{ weight: 100, reps: 10 }],
    });

    const liveSessionId = await startLiveSession(userId);
    // Seed a single DRAFT set: 100 × 5 (would-be volume 500 kg).
    await seedLiveSet({
      userId,
      sessionId: liveSessionId,
      exerciseId: exercise.id,
      setNumber: 1,
      weightKg: 100,
      reps: 5,
      completedAt: null,
    });

    try {
      await signInAndLand(page, email);
      await gotoLiveSession(page, liveSessionId);

      // Draft state: Now = 0 (checked-only), gap = 1,000. Reps clause is
      // hidden because runningKg === 0 (MAJ-1 fix in slot).
      const draftText = await page
        .getByText(/Max|Now|To PR/i)
        .first()
        .innerText();
      expect(draftText).toContain("Max");
      expect(draftText).toContain("1,000 kg");
      expect(draftText).toContain("Now");
      expect(draftText).toContain("0 kg");
      expect(draftText).toContain("To PR");
      expect(draftText).not.toMatch(/reps/i);

      // Toggle the set checked via admin (simulates the user pressing the
      // check button). Re-mount with cold cache so TanStack refetches.
      await admin
        .from("sets")
        .update({ completed_at: new Date().toISOString() })
        .eq("session_id", liveSessionId)
        .eq("set_number", 1);
      await gotoLiveSession(page, liveSessionId);

      // Checked state: Now = 500, gap = 500, reps clause appears at 100 kg.
      const checkedText = await page
        .getByText(/Max|Now|To PR/i)
        .first()
        .innerText();
      expect(checkedText).toContain("Max");
      expect(checkedText).toContain("1,000 kg");
      expect(checkedText).toContain("Now");
      expect(checkedText).toContain("500 kg");
      expect(checkedText).toContain("To PR");
      // 500 / 100 = 5.0 reps at 100.0 kg.
      await expect(page.getByText(/5\.0 reps/).first()).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByText(/@ 100\.0 kg/).first()).toBeVisible({
        timeout: 10_000,
      });

      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "09-toggle-lockstep.png"),
        fullPage: false,
      });
    } finally {
      await deleteUserSafe(userId);
    }
  });
});
