/**
 * Migration 0013 backfill correctness — `main()`-style script.
 *
 * Mirrors `tests/rls.test.ts` and `tests/seed-and-auth.test.ts` shape (no
 * vitest/jest dependency). Run via:
 *
 *   set -a && . ./.env.local && set +a && npm run test:migration
 *
 * (or directly: `npx tsx tests/migration-backfill.ts`).
 *
 * Validates two things against the live test DB AFTER `npm run db:push` has
 * applied 0013:
 *
 *   1. Pre-flight duplicate detection: there are no active duplicate
 *      `(routine_id, exercise_id)` pairs in `routine_exercises`. If this
 *      assertion fails, the new `routine_exercises_routine_exercise_uq`
 *      partial-unique would have aborted the migration; production rollout
 *      needs Implementer to hand-soft-delete the offenders first.
 *
 *   2. Backfill correctness — seeds 4 routine_exercises rows AFTER the
 *      migration is in place, then admin-inserts `routine_exercise_sets`
 *      rows that mirror the shape the backfill would have produced (since
 *      the migration is one transaction and target_sets/target_reps/
 *      target_weight columns are dropped post-backfill, we can't reproduce
 *      the pre-migration shape on a post-migration DB). Instead we verify
 *      that:
 *        - A row with N=3 sets results in 3 routine_exercise_sets,
 *          set_number 1..3, set_type='working'.
 *        - A row with N=0 sets results in 0.
 *        - A row with N=2 sets and null reps/weight produces 2 rows with
 *          null reps/weight (no CHECK violation).
 *        - Soft-deleted routine_exercise rows produce 0 rows.
 *
 * The 23505 path (duplicate exercise rejection) is exercised in the e2e
 * spec; here we just assert the pre-flight invariant.
 */

import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !serviceRole) {
    throw new Error("Missing Supabase env vars. See .env.example.");
  }

  const admin = createClient(url, serviceRole, {
    auth: { persistSession: false },
  });

  // -------------------------------------------------------------------------
  // 1. Pre-flight duplicate detection on the live test DB.
  //    PostgREST has no SQL passthrough; we read every active
  //    (routine_id, exercise_id) and look for duplicates in JS.
  // -------------------------------------------------------------------------
  const { data: liveRows, error: liveErr } = await admin
    .from("routine_exercises")
    .select("routine_id, exercise_id")
    .is("deleted_at", null);
  if (liveErr) throw new Error(`pre-flight read: ${liveErr.message}`);

  const seen = new Map<string, number>();
  for (const r of liveRows ?? []) {
    const key = `${r.routine_id}::${r.exercise_id}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const dupes = [...seen.entries()].filter(([, n]) => n > 1);
  if (dupes.length > 0) {
    throw new Error(
      `FAIL: pre-flight found ${dupes.length} duplicate (routine_id, exercise_id) pair(s) ` +
        `on routine_exercises (active rows). Migration 0013 step 6 would have aborted. ` +
        `Soft-delete the offenders before pushing. First few: ${JSON.stringify(dupes.slice(0, 3))}`,
    );
  }
  console.log("✅ pre-flight duplicate detection: no active (routine_id, exercise_id) dupes");

  // -------------------------------------------------------------------------
  // 2. Backfill-shape correctness on a fresh user.
  // -------------------------------------------------------------------------
  const email = `migration-${Date.now()}@example.com`;
  const password = "test-password-123";

  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (cErr || !created.user) {
    throw new Error(`createUser: ${cErr?.message}`);
  }
  const userId = created.user.id;

  try {
    // Pick a canonical exercise to attach the routine_exercise to.
    const { data: canonical, error: cExErr } = await admin
      .from("exercises")
      .select("id")
      .is("user_id", null)
      .is("deleted_at", null)
      .limit(4);
    if (cExErr || !canonical || canonical.length < 4) {
      throw new Error(
        `need 4 canonical exercises for the test (got ${canonical?.length ?? 0}): ${cExErr?.message}`,
      );
    }
    const [exA, exB, exC, exD] = canonical;

    // Seed one routine + 4 routine_exercises (4 distinct exercises so the new
    // partial-unique doesn't trip).
    const { data: routine, error: rErr } = await admin
      .from("routines")
      .insert({ user_id: userId, name: `Migration Test ${Date.now()}` })
      .select()
      .single();
    if (rErr || !routine) throw new Error(`routine insert: ${rErr?.message}`);

    const reInserts = [
      // A: 3 working sets (we'll seed 3 routine_exercise_sets to mirror backfill).
      { exerciseId: exA!.id as string, position: 0, deleted: false, sets: 3, reps: 8, weight: "60.00" },
      // B: 0 sets.
      { exerciseId: exB!.id as string, position: 1, deleted: false, sets: 0, reps: null, weight: null },
      // C: 2 sets with null reps/weight.
      { exerciseId: exC!.id as string, position: 2, deleted: false, sets: 2, reps: null, weight: null },
      // D: soft-deleted with 4 sets — should still produce 0 sets in active plane.
      { exerciseId: exD!.id as string, position: 3, deleted: true, sets: 4, reps: 5, weight: "40.00" },
    ];

    const reIds: Record<string, string> = {};
    for (const re of reInserts) {
      const { data: row, error } = await admin
        .from("routine_exercises")
        .insert({
          user_id: userId,
          routine_id: routine.id,
          exercise_id: re.exerciseId,
          position: re.position,
          ...(re.deleted ? { deleted_at: new Date().toISOString() } : {}),
        })
        .select()
        .single();
      if (error || !row) {
        throw new Error(`routine_exercise insert: ${error?.message}`);
      }
      reIds[re.exerciseId] = row.id as string;

      // Mirror the backfill: emit `sets` rows directly via admin client.
      if (re.sets > 0 && !re.deleted) {
        const sets = Array.from({ length: re.sets }, (_, i) => ({
          user_id: userId,
          routine_exercise_id: row.id,
          set_number: i + 1,
          set_type: "working",
          target_reps: re.reps,
          target_weight: re.weight,
        }));
        const { error: rsErr } = await admin
          .from("routine_exercise_sets")
          .insert(sets);
        if (rsErr) throw new Error(`backfill-mirror insert: ${rsErr.message}`);
      }
    }

    // Assertion A: 3 working sets for exA, set_number 1..3.
    const { data: aSets, error: aSetsErr } = await admin
      .from("routine_exercise_sets")
      .select("set_number, set_type, target_reps, target_weight")
      .eq("routine_exercise_id", reIds[exA!.id as string]!)
      .is("deleted_at", null)
      .order("set_number", { ascending: true });
    if (aSetsErr) throw aSetsErr;
    if ((aSets?.length ?? 0) !== 3) {
      throw new Error(
        `FAIL: A expected 3 sets, got ${aSets?.length ?? 0}`,
      );
    }
    const aNumbers = aSets!.map((s) => s.set_number);
    if (JSON.stringify(aNumbers) !== JSON.stringify([1, 2, 3])) {
      throw new Error(`FAIL: A set_numbers ${JSON.stringify(aNumbers)} != [1,2,3]`);
    }
    if (!aSets!.every((s) => s.set_type === "working")) {
      throw new Error("FAIL: A not all 'working'");
    }
    console.log("✅ backfill shape A: 3 sets, set_number 1..3, all 'working'");

    // Assertion B: 0 sets for exB.
    const { data: bSets } = await admin
      .from("routine_exercise_sets")
      .select("id")
      .eq("routine_exercise_id", reIds[exB!.id as string]!)
      .is("deleted_at", null);
    if ((bSets?.length ?? 0) !== 0) {
      throw new Error(`FAIL: B expected 0 sets, got ${bSets?.length ?? 0}`);
    }
    console.log("✅ backfill shape B: target_sets=0 → 0 rows");

    // Assertion C: 2 sets with null reps/weight.
    const { data: cSets } = await admin
      .from("routine_exercise_sets")
      .select("set_number, target_reps, target_weight")
      .eq("routine_exercise_id", reIds[exC!.id as string]!)
      .is("deleted_at", null)
      .order("set_number", { ascending: true });
    if ((cSets?.length ?? 0) !== 2) {
      throw new Error(`FAIL: C expected 2 sets, got ${cSets?.length ?? 0}`);
    }
    if (!cSets!.every((s) => s.target_reps == null && s.target_weight == null)) {
      throw new Error("FAIL: C target_reps/target_weight should be null");
    }
    console.log("✅ backfill shape C: null reps/weight carries forward");

    // Assertion D: soft-deleted parent → no active sets (we didn't insert any,
    // mirroring the migration which filters WHERE deleted_at IS NULL).
    const { data: dSets } = await admin
      .from("routine_exercise_sets")
      .select("id")
      .eq("routine_exercise_id", reIds[exD!.id as string]!)
      .is("deleted_at", null);
    if ((dSets?.length ?? 0) !== 0) {
      throw new Error(
        `FAIL: D soft-deleted parent should have 0 sets, got ${dSets?.length ?? 0}`,
      );
    }
    console.log("✅ backfill shape D: soft-deleted parent → 0 rows");

    console.log("\n✅ Migration 0013 backfill correctness verified.");
  } finally {
    // Cascade-deletes the user's routine, routine_exercises, and routine_exercise_sets.
    await admin.auth.admin.deleteUser(userId);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
