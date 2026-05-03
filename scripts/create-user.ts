/**
 * One-off helper to create a confirmed user via the Supabase admin API.
 * Bypasses signup email entirely (no rate-limit pressure).
 *
 * Run:
 *   set -a && . ./.env.local && set +a && \
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' npx tsx scripts/create-user.ts
 */

import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;

  if (!url || !serviceRole) throw new Error("Missing Supabase env vars");
  if (!email) throw new Error("Set ADMIN_EMAIL");
  if (!password || password.length < 8) {
    throw new Error("Set ADMIN_PASSWORD (≥8 chars)");
  }

  const admin = createClient(url, serviceRole, { auth: { persistSession: false } });

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    if (error.message.toLowerCase().includes("already")) {
      console.error(`User ${email} already exists. Reset their password instead via the dashboard.`);
      process.exit(2);
    }
    throw error;
  }
  if (!data.user) throw new Error("createUser returned no user");

  console.log(`✅ Created user ${email}`);
  console.log(`   user_id: ${data.user.id}`);

  // Verify the seed trigger fired.
  const [{ data: prefs }, { count: exCount }] = await Promise.all([
    admin
      .from("user_preferences")
      .select("user_id, weight_unit")
      .eq("user_id", data.user.id),
    admin
      .from("exercises")
      .select("id", { count: "exact", head: true })
      .eq("user_id", data.user.id),
  ]);

  console.log(`   user_preferences row: ${prefs?.length === 1 ? "yes" : "MISSING"}`);
  console.log(`   exercises seeded: ${exCount ?? 0}`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
