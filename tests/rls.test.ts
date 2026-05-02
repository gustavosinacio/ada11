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

    await clientA.auth.signInWithPassword({ email: aEmail, password });
    await clientB.auth.signInWithPassword({ email: bEmail, password });

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

    console.log("✅ RLS test passed — B cannot read/update/delete A's data.");
  } finally {
    await admin.auth.admin.deleteUser(a.user.id);
    await admin.auth.admin.deleteUser(b.user.id);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
