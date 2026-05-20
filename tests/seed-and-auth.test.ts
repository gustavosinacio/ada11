/**
 * Day 2 verification:
 * 1. Admin creates a user.
 * 2. Verify seed_new_user trigger populated user_preferences (1 row) and exercises (~30 rows).
 * 3. Verify RLS still scopes correctly: the new user, signed in as themselves, can read their own seeded rows.
 *
 * Run with:
 *   set -a && . ./.env.local && set +a && npx tsx tests/seed-and-auth.test.ts
 */

import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !serviceRole) throw new Error("Missing env vars");

  const admin = createClient(url, serviceRole, { auth: { persistSession: false } });

  const email = `seed-${Date.now()}@example.com`;
  const password = "test-password-123";

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created.user) throw new Error(`createUser: ${createErr?.message}`);
  const userId = created.user.id;

  try {
    // Admin queries (bypasses RLS) — verify the trigger ran.
    const { data: prefs, error: pErr } = await admin
      .from("user_preferences")
      .select("user_id, weight_unit, length_unit")
      .eq("user_id", userId);
    if (pErr) throw new Error(`prefs query: ${pErr.message}`);
    if (!prefs || prefs.length !== 1) {
      throw new Error(`FAIL: expected 1 user_preferences row, got ${prefs?.length ?? 0}`);
    }
    if (prefs[0]!.weight_unit !== "kg") {
      throw new Error(`FAIL: default weight_unit should be 'kg', got '${prefs[0]!.weight_unit}'`);
    }
    if (prefs[0]!.length_unit !== "cm") {
      throw new Error(`FAIL: default length_unit should be 'cm', got '${prefs[0]!.length_unit}'`);
    }
    console.log(
      `✅ user_preferences seeded (weight_unit=${prefs[0]!.weight_unit}, length_unit=${prefs[0]!.length_unit})`,
    );

    const { data: exercises, error: eErr } = await admin
      .from("exercises")
      .select("id, name")
      .eq("user_id", userId);
    if (eErr) throw new Error(`exercises query: ${eErr.message}`);
    if (!exercises || exercises.length < 25) {
      throw new Error(`FAIL: expected ~30 seeded exercises, got ${exercises?.length ?? 0}`);
    }
    console.log(`✅ exercises seeded (${exercises.length} rows)`);

    // RLS check: the new user, signed in as themselves, sees their seeded rows.
    const userClient = createClient(url, anon, { auth: { persistSession: false } });
    const { error: signInErr } = await userClient.auth.signInWithPassword({ email, password });
    if (signInErr) throw new Error(`sign-in: ${signInErr.message}`);

    const { data: ownPrefs, error: opErr } = await userClient
      .from("user_preferences")
      .select("user_id");
    if (opErr) throw new Error(`own prefs: ${opErr.message}`);
    if ((ownPrefs ?? []).length !== 1) {
      throw new Error(`FAIL: user should see 1 own pref row, got ${(ownPrefs ?? []).length}`);
    }
    console.log("✅ RLS allows user to read own user_preferences");

    const { data: ownEx, error: oeErr } = await userClient.from("exercises").select("id");
    if (oeErr) throw new Error(`own exercises: ${oeErr.message}`);
    if ((ownEx ?? []).length < 25) {
      throw new Error(`FAIL: user should see seeded exercises, got ${(ownEx ?? []).length}`);
    }
    console.log(`✅ RLS allows user to read own exercises (${ownEx!.length} rows)`);

    console.log("\n✅ Day 2 backend verification passed.");
  } finally {
    await admin.auth.admin.deleteUser(userId);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
