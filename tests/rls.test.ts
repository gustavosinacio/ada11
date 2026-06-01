/**
 * Two-user RLS check.
 *
 * Run against a real Supabase project (local or hosted) with:
 *   DATABASE_URL=...
 *   EXPO_PUBLIC_SUPABASE_URL=...
 *   EXPO_PUBLIC_SUPABASE_ANON_KEY=...
 *   SUPABASE_SERVICE_ROLE_KEY=...
 *
 * Verifies user A cannot read, update, or delete user B's data.
 *
 * NOTE: This is a stub. Wire to your test runner of choice (vitest/jest/node:test)
 * once test infra is set up. Day 1 deliverable.
 */

import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anon || !serviceRole) {
    throw new Error("Missing Supabase env vars. See .env.example.");
  }

  const admin = createClient(url, serviceRole, { auth: { persistSession: false } });

  // Create two ephemeral test users via the admin API.
  const aEmail = `rls-a-${Date.now()}@example.com`;
  const bEmail = `rls-b-${Date.now()}@example.com`;
  const password = "test-password-123";

  const { data: a, error: aErr } = await admin.auth.admin.createUser({
    email: aEmail,
    password,
    email_confirm: true,
  });
  const { data: b, error: bErr } = await admin.auth.admin.createUser({
    email: bEmail,
    password,
    email_confirm: true,
  });
  if (aErr || bErr || !a.user || !b.user) {
    throw new Error(`createUser failed: ${aErr?.message ?? bErr?.message}`);
  }

  try {
    const clientA = createClient(url, anon, { auth: { persistSession: false } });
    const clientB = createClient(url, anon, { auth: { persistSession: false } });

    const signInA = await clientA.auth.signInWithPassword({ email: aEmail, password });
    if (signInA.error) throw new Error(`A sign-in failed: ${signInA.error.message}`);
    const signInB = await clientB.auth.signInWithPassword({ email: bEmail, password });
    if (signInB.error) throw new Error(`B sign-in failed: ${signInB.error.message}`);

    // A creates an exercise.
    const { data: aEx, error: insErr } = await clientA
      .from("exercises")
      .insert({ user_id: a.user.id, name: "RLS Test Lift" })
      .select()
      .single();
    if (insErr || !aEx) throw new Error(`A insert failed: ${insErr?.message}`);

    // B reads — must return zero rows for A's exercise.
    const { data: bRead } = await clientB
      .from("exercises")
      .select("*")
      .eq("id", aEx.id);
    if ((bRead ?? []).length > 0) throw new Error("FAIL: B can read A's exercise");

    // B updates — must affect zero rows.
    const { data: bUpd } = await clientB
      .from("exercises")
      .update({ name: "Hijacked" })
      .eq("id", aEx.id)
      .select();
    if ((bUpd ?? []).length > 0) throw new Error("FAIL: B updated A's exercise");

    // B deletes — must affect zero rows.
    const { data: bDel } = await clientB
      .from("exercises")
      .delete()
      .eq("id", aEx.id)
      .select();
    if ((bDel ?? []).length > 0) throw new Error("FAIL: B deleted A's exercise");

    // -------------------------------------------------------------------
    // measurement_entries — same RLS pattern, different table.
    // -------------------------------------------------------------------
    const { data: aMeas, error: mInsErr } = await clientA
      .from("measurement_entries")
      .insert({
        user_id: a.user.id,
        measured_at: new Date().toISOString(),
        weight_kg: "80",
      })
      .select()
      .single();
    if (mInsErr || !aMeas) {
      throw new Error(`A measurement insert failed: ${mInsErr?.message}`);
    }

    // B reads.
    const { data: bMRead } = await clientB
      .from("measurement_entries")
      .select("*")
      .eq("id", aMeas.id);
    if ((bMRead ?? []).length > 0) {
      throw new Error("FAIL: B can read A's measurement");
    }

    // B updates.
    const { data: bMUpd } = await clientB
      .from("measurement_entries")
      .update({ weight_kg: "1" })
      .eq("id", aMeas.id)
      .select();
    if ((bMUpd ?? []).length > 0) {
      throw new Error("FAIL: B updated A's measurement");
    }

    // B deletes.
    const { data: bMDel } = await clientB
      .from("measurement_entries")
      .delete()
      .eq("id", aMeas.id)
      .select();
    if ((bMDel ?? []).length > 0) {
      throw new Error("FAIL: B deleted A's measurement");
    }

    // -------------------------------------------------------------------
    // exercise_notes — same RLS pattern, a note attached to A's exercise.
    // -------------------------------------------------------------------
    const { data: aNote, error: nInsErr } = await clientA
      .from("exercise_notes")
      .insert({
        user_id: a.user.id,
        exercise_id: aEx.id,
        body: "grip width: shoulder-width",
      })
      .select()
      .single();
    if (nInsErr || !aNote) {
      throw new Error(`A exercise_note insert failed: ${nInsErr?.message}`);
    }

    // B reads — must return zero rows.
    const { data: bNRead } = await clientB
      .from("exercise_notes")
      .select("*")
      .eq("id", aNote.id);
    if ((bNRead ?? []).length > 0) {
      throw new Error("FAIL: B can read A's exercise_note");
    }

    // B updates — must affect zero rows.
    const { data: bNUpd } = await clientB
      .from("exercise_notes")
      .update({ body: "hijacked" })
      .eq("id", aNote.id)
      .select();
    if ((bNUpd ?? []).length > 0) {
      throw new Error("FAIL: B updated A's exercise_note");
    }

    // B deletes — must affect zero rows.
    const { data: bNDel } = await clientB
      .from("exercise_notes")
      .delete()
      .eq("id", aNote.id)
      .select();
    if ((bNDel ?? []).length > 0) {
      throw new Error("FAIL: B deleted A's exercise_note");
    }

    // B insert spoof — must fail (INSERT policy `with check
    // (auth.uid() = user_id)` rejects). Supabase JS surfaces this as either
    // an error (preferred) or zero affected rows depending on PostgREST
    // behavior. We assert at least one of those is true.
    const { data: bNSpoofData, error: bNSpoofErr } = await clientB
      .from("exercise_notes")
      .insert({
        user_id: a.user.id,
        exercise_id: aEx.id,
        body: "spoof",
      })
      .select();
    if (!bNSpoofErr && (bNSpoofData ?? []).length > 0) {
      throw new Error("FAIL: B spoofed an exercise_note insert on A's row");
    }

    // -------------------------------------------------------------------
    // canonical exercises (user_id IS NULL) — added in migration
    // 0011_canonical_exercises.sql. SELECT policy widens to
    // `user_id IS NULL OR auth.uid() = user_id`; INSERT/UPDATE/DELETE
    // stay scoped to `auth.uid() = user_id` so canonical rows are
    // app-immutable (service role bypasses RLS for admin edits).
    // -------------------------------------------------------------------
    const canonicalName = `Canonical RLS Test ${Date.now()}`;
    const { data: canonical, error: cInsErr } = await admin
      .from("exercises")
      .insert({ user_id: null, name: canonicalName })
      .select()
      .single();
    if (cInsErr || !canonical) {
      throw new Error(`canonical insert (admin): ${cInsErr?.message}`);
    }
    const canonicalId = canonical.id as string;

    try {
      // A reads canonical — must return the row (widened SELECT).
      const { data: aReadC } = await clientA
        .from("exercises")
        .select("id, name")
        .eq("id", canonicalId);
      if ((aReadC ?? []).length !== 1) {
        throw new Error(
          `FAIL: A cannot read canonical exercise (got ${(aReadC ?? []).length} rows)`,
        );
      }

      // B reads same canonical — must also return the row.
      const { data: bReadC } = await clientB
        .from("exercises")
        .select("id, name")
        .eq("id", canonicalId);
      if ((bReadC ?? []).length !== 1) {
        throw new Error(
          `FAIL: B cannot read canonical exercise (got ${(bReadC ?? []).length} rows)`,
        );
      }

      // A cannot UPDATE canonical — UPDATE policy still gates on
      // auth.uid() = user_id; canonical has user_id IS NULL so 0 rows affected.
      const { data: aUpdC } = await clientA
        .from("exercises")
        .update({ name: "hijacked" })
        .eq("id", canonicalId)
        .select();
      if ((aUpdC ?? []).length > 0) {
        throw new Error("FAIL: A updated a canonical exercise via RLS");
      }
      // Re-read via admin to confirm the name is unchanged.
      const { data: postUpd } = await admin
        .from("exercises")
        .select("name")
        .eq("id", canonicalId)
        .single();
      if (postUpd?.name !== canonicalName) {
        throw new Error(
          `FAIL: canonical name was actually mutated (expected ${canonicalName}, got ${postUpd?.name})`,
        );
      }

      // A cannot DELETE canonical — DELETE policy uses auth.uid() = user_id.
      const { data: aDelC } = await clientA
        .from("exercises")
        .delete()
        .eq("id", canonicalId)
        .select();
      if ((aDelC ?? []).length > 0) {
        throw new Error("FAIL: A deleted a canonical exercise via RLS");
      }
      // Re-read via admin to confirm the row is still present.
      const { data: postDel } = await admin
        .from("exercises")
        .select("id")
        .eq("id", canonicalId);
      if ((postDel ?? []).length !== 1) {
        throw new Error("FAIL: canonical row was actually deleted by A");
      }

      // A cannot INSERT a row with user_id = NULL (only the service role can).
      // Supabase JS surfaces this as either an error or zero affected rows.
      const { data: aInsSpoof, error: aInsSpoofErr } = await clientA
        .from("exercises")
        .insert({ user_id: null, name: "spoof-canonical" })
        .select();
      if (!aInsSpoofErr && (aInsSpoof ?? []).length > 0) {
        throw new Error("FAIL: A inserted a canonical row via RLS");
      }

      // Anonymous (no JWT) SELECT of canonical: pins U1's default ("looser"
      // variant — `user_id IS NULL OR auth.uid() = user_id` evaluates TRUE
      // for canonical rows when `auth.uid() IS NULL`). Tightening this to
      // `auth.uid() IS NOT NULL AND (...)` in a future migration must
      // break this arm and force a conscious choice.
      const anonClient = createClient(url, anon, {
        auth: { persistSession: false },
      });
      const { data: anonRead } = await anonClient
        .from("exercises")
        .select("id")
        .is("user_id", null)
        .limit(1);
      if ((anonRead ?? []).length < 1) {
        throw new Error(
          "FAIL: anon client cannot read canonical exercises (U1 looser-variant pin tripped)",
        );
      }
    } finally {
      // Service role bypasses RLS — cleanup the canonical test row.
      await admin.from("exercises").delete().eq("id", canonicalId);
    }

    // -------------------------------------------------------------------
    // routine_exercise_sets — added in migration 0013_routine_exercise_sets.sql.
    // Same 4-policy RLS shape as exercises / measurement_entries / exercise_notes.
    // -------------------------------------------------------------------

    // A creates a routine and a routine_exercise attached to A's RLS Test
    // Lift (aEx, owned by A). The routine_exercise_set is then attached to
    // that routine_exercise.
    const { data: aRoutine, error: rInsErr } = await clientA
      .from("routines")
      .insert({ user_id: a.user.id, name: "RLS Test Routine" })
      .select()
      .single();
    if (rInsErr || !aRoutine) {
      throw new Error(`A routine insert: ${rInsErr?.message}`);
    }

    const { data: aRoutEx, error: reInsErr } = await clientA
      .from("routine_exercises")
      .insert({
        user_id: a.user.id,
        routine_id: aRoutine.id,
        exercise_id: aEx.id,
        position: 0,
      })
      .select()
      .single();
    if (reInsErr || !aRoutEx) {
      throw new Error(`A routine_exercise insert: ${reInsErr?.message}`);
    }

    const { data: aSet, error: rsInsErr } = await clientA
      .from("routine_exercise_sets")
      .insert({
        user_id: a.user.id,
        routine_exercise_id: aRoutEx.id,
        set_number: 1,
        set_type: "working",
        target_reps: 8,
        target_weight: "60.00",
      })
      .select()
      .single();
    if (rsInsErr || !aSet) {
      throw new Error(`A routine_exercise_set insert: ${rsInsErr?.message}`);
    }

    // B reads — must return zero rows.
    const { data: bRsRead } = await clientB
      .from("routine_exercise_sets")
      .select("*")
      .eq("id", aSet.id);
    if ((bRsRead ?? []).length > 0) {
      throw new Error("FAIL: B can read A's routine_exercise_set");
    }

    // B updates — must affect zero rows.
    const { data: bRsUpd } = await clientB
      .from("routine_exercise_sets")
      .update({ target_reps: 999 })
      .eq("id", aSet.id)
      .select();
    if ((bRsUpd ?? []).length > 0) {
      throw new Error("FAIL: B updated A's routine_exercise_set");
    }

    // B deletes — must affect zero rows.
    const { data: bRsDel } = await clientB
      .from("routine_exercise_sets")
      .delete()
      .eq("id", aSet.id)
      .select();
    if ((bRsDel ?? []).length > 0) {
      throw new Error("FAIL: B deleted A's routine_exercise_set");
    }

    // B insert spoof — INSERT policy `with check (auth.uid() = user_id)` rejects.
    const { data: bRsSpoofData, error: bRsSpoofErr } = await clientB
      .from("routine_exercise_sets")
      .insert({
        user_id: a.user.id,
        routine_exercise_id: aRoutEx.id,
        set_number: 99,
        set_type: "working",
      })
      .select();
    if (!bRsSpoofErr && (bRsSpoofData ?? []).length > 0) {
      throw new Error(
        "FAIL: B spoofed a routine_exercise_set insert on A's row",
      );
    }

    // -------------------------------------------------------------------
    // user_exercise_favorites — added in migration
    // 0020_user_exercise_favorites.sql. 3-policy RLS (SELECT/INSERT/DELETE),
    // all gated on auth.uid() = user_id. No UPDATE policy (no mutable column).
    // Composite PK (user_id, exercise_id); a favorite on A's exercise (aEx).
    // -------------------------------------------------------------------
    const { data: aFav, error: fInsErr } = await clientA
      .from("user_exercise_favorites")
      .insert({ user_id: a.user.id, exercise_id: aEx.id })
      .select()
      .single();
    if (fInsErr || !aFav) {
      throw new Error(`A favorite insert failed: ${fInsErr?.message}`);
    }

    // B reads — must return zero rows (SELECT gated on auth.uid() = user_id).
    const { data: bFavRead } = await clientB
      .from("user_exercise_favorites")
      .select("*")
      .eq("user_id", a.user.id)
      .eq("exercise_id", aEx.id);
    if ((bFavRead ?? []).length > 0) {
      throw new Error("FAIL: B can read A's favorite");
    }

    // B deletes — must affect zero rows (no UPDATE arm: no mutable column).
    const { data: bFavDel } = await clientB
      .from("user_exercise_favorites")
      .delete()
      .eq("user_id", a.user.id)
      .eq("exercise_id", aEx.id)
      .select();
    if ((bFavDel ?? []).length > 0) {
      throw new Error("FAIL: B deleted A's favorite");
    }

    // B insert spoof — INSERT policy `with check (auth.uid() = user_id)` rejects
    // a row carrying user_id = A. Surfaced as an error or zero affected rows.
    const { data: bFavSpoofData, error: bFavSpoofErr } = await clientB
      .from("user_exercise_favorites")
      .insert({ user_id: a.user.id, exercise_id: aEx.id })
      .select();
    if (!bFavSpoofErr && (bFavSpoofData ?? []).length > 0) {
      throw new Error("FAIL: B spoofed a favorite insert on A's row");
    }

    console.log(
      "✅ RLS test passed — B cannot read/update/delete A's data; canonical rows visible to both users + immutable via RLS; routine_exercise_sets + user_exercise_favorites arms OK.",
    );
  } finally {
    await admin.auth.admin.deleteUser(a.user.id);
    await admin.auth.admin.deleteUser(b.user.id);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
